import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import yaml from "js-yaml";
import { collectBackendEvidence, main, servingRevisions, shasTaggedAt } from "./release-evidence.mjs";

// Shapes as `gcloud ... --format json` printed them for the staging service on 2026-11-11.
const PROJECT = "bustrack-be165";
const SERVICE = "eki-backend-staging";
const REGIONS = ["asia-south2", "us-central1", "asia-southeast1"];
const REPOSITORY = "asia-south2-docker.pkg.dev/bustrack-be165/eki/backend";
const DIGEST = "sha256:f95eaca252037d22a96d5306aa61a11d59d178fc26514646d26b1801f605ec6a";
const OTHER_DIGEST = `sha256:${"1".repeat(64)}`;
const BUILT_SHA = "f925ebd723949c3470cf2bf0eb9581638148ad6d";
const HOSTING_SHA = "88901592917db5df6ddc3a25be2570263005832d";

const serviceJson = (traffic = [{ latestRevision: true, percent: 100, revisionName: "eki-backend-staging-00009-7sh" }]) => ({
  metadata: { name: SERVICE },
  status: { url: "https://eki-backend-staging-mjhig4qzea-em.a.run.app", traffic },
});
const revisionJson = ({ labels = {}, digest = DIGEST } = {}) => ({
  metadata: { labels: { "serving.knative.dev/service": SERVICE, ...labels } },
  spec: { containers: [{ image: `${REPOSITORY}@${digest}` }] },
  status: { imageDigest: `${REPOSITORY}@${digest}` },
});
const tagJson = (sha, digest = DIGEST) => ({
  image: REPOSITORY,
  tag: `projects/bustrack-be165/locations/asia-south2/repositories/eki/packages/backend/tags/${sha}`,
  version: `projects/bustrack-be165/locations/asia-south2/repositories/eki/packages/backend/versions/${digest}`,
});

/** A fake gcloud: `services` maps region to a service (absent regions answer "Cannot find service"). */
function fakeGcloud({ services = { "asia-south2": serviceJson() }, revisions = { "eki-backend-staging-00009-7sh": revisionJson() }, tags = [tagJson(BUILT_SHA)], fail = {} } = {}) {
  const calls = [];
  const gcloud = (args) => {
    calls.push(args.join(" "));
    const ok = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: "" });
    const denied = (what) => ({ status: 1, stdout: "", stderr: `ERROR: (gcloud.${what}) PERMISSION_DENIED: Permission denied on resource.` });
    if (args.slice(0, 3).join(" ") === "run services describe") {
      const region = args[args.indexOf("--region") + 1];
      if (fail.services?.includes(region)) return denied("run.services.describe");
      return services[region] ? ok(services[region]) : { status: 1, stdout: "", stderr: `ERROR: (gcloud.run.services.describe) Cannot find service [${SERVICE}]` };
    }
    if (args.slice(0, 3).join(" ") === "run revisions describe") {
      if (fail.revisions) return denied("run.revisions.describe");
      return revisions[args[3]] ? ok(revisions[args[3]]) : { status: 1, stdout: "", stderr: "ERROR: not found" };
    }
    if (args.slice(0, 4).join(" ") === "artifacts docker tags list") {
      return fail.tags ? denied("artifacts.docker.tags.list") : ok(tags);
    }
    throw new Error(`unexpected gcloud ${args.join(" ")}`);
  };
  return { gcloud, calls };
}

const collect = (fake, extra = {}) => collectBackendEvidence({ gcloud: fake.gcloud, project: PROJECT, service: SERVICE, regions: REGIONS, ...extra });

/** Runs the CLI with a fake gcloud and returns its exit code, log and JSON evidence. */
function runCli(fake, args) {
  const dir = mkdtempSync(path.join(tmpdir(), "eki-evidence-"));
  try {
    const json = path.join(dir, "evidence.json");
    const summary = path.join(dir, "summary.md");
    const lines = [];
    const code = main([
      "--project", PROJECT, "--service", SERVICE, "--regions", REGIONS.join(","),
      "--json", json, "--summary", summary, ...args,
    ], { gcloud: fake.gcloud, env: {}, log: (line) => lines.push(line) });
    return { code, log: lines.join("\n"), evidence: JSON.parse(readFileSync(json, "utf8")), summary: readFileSync(summary, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("release evidence: serving Cloud Run revision", () => {
  it("lists the revisions that receive traffic, largest share first", () => {
    assert.deepEqual(servingRevisions(serviceJson([
      { revisionName: "old", percent: 10 },
      { revisionName: "new", percent: 90 },
      { revisionName: "candidate", percent: 0, tag: "candidate" },
      { latestRevision: true, percent: 0 },
    ])), [{ name: "new", percent: 90 }, { name: "old", percent: 10 }]);
  });

  it("maps a digest only to full commit tags that point at it", () => {
    assert.deepEqual(shasTaggedAt([tagJson(BUILT_SHA), tagJson(HOSTING_SHA, OTHER_DIGEST), tagJson("latest")], DIGEST), [BUILT_SHA]);
  });

  it("records the revision label as the source commit", () => {
    const fake = fakeGcloud({ revisions: { "eki-backend-staging-00009-7sh": revisionJson({ labels: { "eki-source-sha": BUILT_SHA } }) } });
    const backend = collect(fake);
    assert.equal(backend.status, "verified");
    assert.equal(backend.region, "asia-south2");
    assert.deepEqual(backend.revisions, [{
      name: "eki-backend-staging-00009-7sh", percent: 100, image: `${REPOSITORY}@${DIGEST}`,
      imageDigest: DIGEST, sourceSha: BUILT_SHA, sourceShaFrom: "revision-label",
    }]);
    // Every guarded region is queried, so a second service cannot hide.
    assert.equal(fake.calls.filter((call) => call.startsWith("run services describe")).length, REGIONS.length);
    assert.ok(!fake.calls.some((call) => call.startsWith("artifacts")));
  });

  it("falls back to the Artifact Registry commit tag for a revision without the label", () => {
    const backend = collect(fakeGcloud());
    assert.equal(backend.status, "verified");
    assert.equal(backend.revisions[0].sourceSha, BUILT_SHA);
    assert.equal(backend.revisions[0].sourceShaFrom, "artifact-registry-tag");
  });

  it("marks the backend unverified, with the reason, whenever something cannot be read", () => {
    const cases = [
      [{ authOutcome: "failure" }, fakeGcloud(), /authentication failure/],
      [{}, fakeGcloud({ fail: { services: ["us-central1"] } }), /Could not read eki-backend-staging in us-central1: .*PERMISSION_DENIED/],
      [{}, fakeGcloud({ services: {} }), /exists in none of/],
      [{}, fakeGcloud({ services: { "asia-south2": serviceJson(), "us-central1": serviceJson() } }), /several regions/],
      [{}, fakeGcloud({ services: { "asia-south2": serviceJson([]) } }), /No revision receives traffic/],
      [{}, fakeGcloud({ fail: { revisions: true } }), /Could not read revision eki-backend-staging-00009-7sh/],
      [{}, fakeGcloud({ fail: { tags: true } }), /image tags could not be read: .*PERMISSION_DENIED/],
      [{}, fakeGcloud({ tags: [tagJson(BUILT_SHA, OTHER_DIGEST)] }), /no commit tag points at/],
      [{}, fakeGcloud({ tags: [tagJson(BUILT_SHA), tagJson(HOSTING_SHA)] }), /several commit tags/],
      [{}, fakeGcloud({ revisions: { "eki-backend-staging-00009-7sh": revisionJson({ labels: { "eki-source-sha": "" } }) }, tags: [] }), /malformed eki-source-sha label/],
    ];
    for (const [extra, fake, reason] of cases) {
      const backend = collect(fake, extra);
      assert.equal(backend.status, "unverified", String(reason));
      assert.match(backend.reasons.join("\n"), reason);
    }
  });
});

describe("release evidence CLI", () => {
  it("records the Hosting SHA next to the serving backend on a Hosting-only release", () => {
    const { code, evidence, summary } = runCli(fakeGcloud(), ["--hosting-sha", HOSTING_SHA, "--hosting-outcome", "success", "--auth-outcome", "success"]);
    assert.equal(code, 0);
    assert.equal(evidence.schema, "eki.release-evidence/v1");
    assert.deepEqual(evidence.hosting, { project: PROJECT, sha: HOSTING_SHA, outcome: "success" });
    assert.equal(evidence.backend.status, "verified");
    assert.equal(evidence.backend.revisions[0].name, "eki-backend-staging-00009-7sh");
    assert.equal(evidence.backend.revisions[0].imageDigest, DIGEST);
    assert.equal(evidence.backend.revisions[0].sourceSha, BUILT_SHA);
    // A Hosting-only release leaves an older backend serving: recorded, not a failure.
    assert.equal(evidence.backendMatchesHostingSha, false);
    assert.equal(evidence.expectation, null);
    assert.match(summary, new RegExp(`Hosting source SHA: \`${HOSTING_SHA}\``));
    assert.match(summary, new RegExp(`Revision \`eki-backend-staging-00009-7sh\` at 100%: image digest \`${DIGEST}\`, source SHA \`${BUILT_SHA}\``));
  });

  it("never passes silently: an unreadable backend is UNVERIFIED in the summary and warns", () => {
    const { code, evidence, summary, log } = runCli(fakeGcloud(), ["--hosting-sha", HOSTING_SHA, "--auth-outcome", "failure"]);
    assert.equal(code, 0, "recording evidence must not block a Hosting-only release");
    assert.equal(evidence.backend.status, "unverified");
    assert.equal(evidence.backendMatchesHostingSha, null);
    assert.match(summary, /\*\*UNVERIFIED\*\*/);
    assert.match(summary, /Unverified: Google Cloud authentication failure/);
    assert.match(log, /::warning title=Serving backend unverified::/);
  });

  it("fails when the serving revision is not the build the backend job deployed", () => {
    const labelled = fakeGcloud({ revisions: { "eki-backend-staging-00009-7sh": revisionJson({ labels: { "eki-source-sha": BUILT_SHA } }) } });
    assert.equal(runCli(labelled, ["--expect-source-sha", BUILT_SHA, "--expect-image-digest", DIGEST]).code, 0);

    const wrongSha = runCli(labelled, ["--expect-source-sha", HOSTING_SHA, "--expect-image-digest", DIGEST]);
    assert.equal(wrongSha.code, 1);
    assert.equal(wrongSha.evidence.expectation.met, false);
    assert.match(wrongSha.log, /::error title=Serving backend is not this build::Revision eki-backend-staging-00009-7sh \(100%\) serves source f925ebd/);

    assert.equal(runCli(labelled, ["--expect-image-digest", OTHER_DIGEST]).code, 1);
    // Old and new revisions both serving is not "this build is serving".
    const split = fakeGcloud({
      services: { "asia-south2": serviceJson([{ revisionName: "new", percent: 50 }, { revisionName: "old", percent: 50 }]) },
      revisions: { new: revisionJson({ labels: { "eki-source-sha": BUILT_SHA } }), old: revisionJson({ labels: { "eki-source-sha": HOSTING_SHA }, digest: OTHER_DIGEST }) },
    });
    assert.equal(runCli(split, ["--expect-source-sha", BUILT_SHA]).code, 1);
    // An expectation cannot be met by an unverified backend.
    assert.equal(runCli(fakeGcloud({ fail: { revisions: true } }), ["--expect-source-sha", BUILT_SHA]).code, 1);
  });

  it("refuses malformed arguments", () => {
    assert.throws(() => runCli(fakeGcloud(), ["--hosting-sha", "main"]), /--hosting-sha is malformed/);
    assert.throws(() => runCli(fakeGcloud(), ["--expect-image-digest", "latest"]), /--expect-image-digest is malformed/);
    assert.throws(() => main(["--project", PROJECT, "--service", SERVICE], { gcloud: fakeGcloud().gcloud, env: {}, log: () => {} }), /--regions are required/);
  });
});

describe("release evidence in the deploy workflow", () => {
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"));
  const manifest = readFileSync(new URL("../deploy/cloud-run/staging.service.yaml", import.meta.url), "utf8");
  const staging = workflow.jobs["deploy-staging"];
  const backend = workflow.jobs["deploy-backend-staging"];
  const stepIndex = (job, predicate) => job.steps.findIndex(predicate);

  it("records the evidence on every staging release, after Hosting, even when a step failed", () => {
    const hosting = stepIndex(staging, (step) => step.id === "hosting");
    const auth = stepIndex(staging, (step) => step.id === "gcp-auth");
    const record = stepIndex(staging, (step) => step.name === "Record the release evidence");
    const upload = stepIndex(staging, (step) => step.name === "Upload the release evidence");
    assert.ok(hosting > 0 && auth > hosting && record > auth && upload > record, "evidence steps follow the Hosting release");
    for (const index of [auth, record, upload]) assert.match(staging.steps[index].if, /^always\(\) && /);
    // A missing permission is recorded as unverified, never blocks or fails the release.
    assert.equal(staging.steps[auth]["continue-on-error"], true);
    assert.equal(staging.permissions["id-token"], "write");
    assert.equal(staging.steps[auth].with.service_account, backend.env.DEPLOY_SERVICE_ACCOUNT);
    assert.equal(staging.steps[auth].with.workload_identity_provider, backend.env.WORKLOAD_IDENTITY_PROVIDER);
    const run = staging.steps[record].run;
    assert.match(run, /--hosting-sha "\$HOSTING_SHA"/);
    assert.match(run, /--auth-outcome "\$GCP_AUTH_OUTCOME"/);
    assert.doesNotMatch(run, /--expect-/);
    assert.match(staging.env.HOSTING_SHA, /workflow_run\.head_sha \|\| github\.sha/);
    const regions = run.match(/--regions ([a-z0-9,-]+)/)?.[1].split(",");
    assert.deepEqual([...regions].sort(), [...workflow.on.workflow_dispatch.inputs.cloud_run_region.options].sort());
    assert.equal(staging.steps[upload].with.name, "release-evidence-staging");
  });

  it("labels each backend revision with its commit and requires the promoted revision to be this build", () => {
    assert.match(manifest, /\n {4}metadata:\r?\n {6}labels:\r?\n {8}eki-source-sha: "\$\{SOURCE_SHA\}"/);
    const build = backend.steps.find((step) => step.name === "Build and push the backend image").run;
    assert.match(build, /--build-arg "EKI_SOURCE_SHA=\$\{GITHUB_SHA\}"/);
    const promote = stepIndex(backend, (step) => step.name === "Promote the candidate");
    const verify = stepIndex(backend, (step) => step.name === "Require the serving revision to be this build");
    assert.ok(verify > promote, "verification follows promotion");
    assert.equal(backend.steps[verify].if, undefined, "a failed deploy skips it and a mismatch fails the job");
    assert.match(backend.steps[verify].run, /--expect-source-sha "\$GITHUB_SHA" --expect-image-digest "\$\{IMAGE##\*@\}"/);
  });
});
