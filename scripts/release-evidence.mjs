import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * Release evidence for a staging release (issue #504).
 *
 * Hosting and the Cloud Run backend are released by different jobs, and an
 * automatic release deploys Hosting only. The public /health and /live answers
 * carry no build identity, so the evidence reads the serving backend from the
 * Cloud Run API instead: every revision that receives traffic, its image digest
 * and the source commit it was built from. The source commit comes from the
 * revision label that the backend job sets, or, for a revision deployed before
 * that label existed, from the Artifact Registry tag (the commit SHA) that
 * points at the same digest. Anything that cannot be read is recorded as
 * unverified with the reason, never left out.
 */

export const SOURCE_SHA_LABEL = "eki-source-sha";
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Revisions that receive traffic, largest share first. */
export function servingRevisions(service) {
  const byName = new Map();
  for (const entry of service?.status?.traffic ?? []) {
    const percent = Number(entry?.percent ?? 0);
    if (!(percent > 0) || typeof entry.revisionName !== "string" || !entry.revisionName) continue;
    byName.set(entry.revisionName, (byName.get(entry.revisionName) ?? 0) + percent);
  }
  return [...byName].map(([name, percent]) => ({ name, percent })).sort((a, b) => b.percent - a.percent);
}

/** The image repository path and digest of a revision, from its status or its image reference. */
export function revisionImage(revision) {
  const image = revision?.spec?.containers?.[0]?.image ?? null;
  const resolved = revision?.status?.imageDigest ?? null;
  const digestOf = (reference) => {
    const at = typeof reference === "string" ? reference.lastIndexOf("@") : -1;
    const digest = at >= 0 ? reference.slice(at + 1) : null;
    return digest && DIGEST.test(digest) ? digest : null;
  };
  const repositoryOf = (reference) => {
    if (typeof reference !== "string" || !reference) return null;
    const withoutDigest = reference.split("@")[0];
    // A tag follows the last colon after the last slash; a registry port does not.
    const slash = withoutDigest.lastIndexOf("/");
    const colon = withoutDigest.lastIndexOf(":");
    return colon > slash ? withoutDigest.slice(0, colon) : withoutDigest;
  };
  return {
    image,
    repository: repositoryOf(resolved) ?? repositoryOf(image),
    digest: digestOf(resolved) ?? digestOf(image),
  };
}

/** Commit SHAs that Artifact Registry tags point at the digest (the backend job tags each image with its commit). */
export function shasTaggedAt(tags, digest) {
  const found = new Set();
  for (const entry of Array.isArray(tags) ? tags : []) {
    if (typeof entry?.version !== "string" || !entry.version.endsWith(`/versions/${digest}`)) continue;
    const tag = typeof entry.tag === "string" ? entry.tag.split("/").pop() : "";
    if (SHA.test(tag)) found.add(tag);
  }
  return [...found];
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The gcloud error line (it prints details after it), or the last line of other output. */
function firstLine(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => line.startsWith("ERROR:")) ?? lines.pop() ?? "no output";
}

/**
 * Reads the serving backend through `gcloud` (passed in, so tests can fake it).
 * `gcloud(args)` returns `{ status, stdout, stderr }`.
 */
export function collectBackendEvidence({ gcloud, project, service, regions, authOutcome }) {
  const evidence = { status: "unverified", reasons: [], project, service, region: null, url: null, revisions: [] };
  if (authOutcome && authOutcome !== "success") {
    evidence.reasons.push(`Google Cloud authentication ${authOutcome}; the Cloud Run API was not read.`);
    return evidence;
  }

  const found = [];
  for (const region of regions) {
    const result = gcloud(["run", "services", "describe", service, "--project", project, "--region", region, "--format", "json"]);
    if (result.status === 0) {
      const parsed = parseJson(result.stdout);
      if (parsed) found.push({ region, service: parsed });
      else evidence.reasons.push(`Unreadable service description in ${region}.`);
    } else if (!/Cannot find service/i.test(result.stderr ?? "")) {
      evidence.reasons.push(`Could not read ${service} in ${region}: ${firstLine(result.stderr)}`);
    }
  }
  if (found.length === 0) {
    if (evidence.reasons.length === 0) evidence.reasons.push(`${service} exists in none of ${regions.join(", ")}.`);
    return evidence;
  }
  if (found.length > 1) {
    evidence.reasons.push(`${service} exists in several regions (${found.map(({ region }) => region).join(", ")}); the serving one is ambiguous.`);
  }
  const [{ region, service: description }] = found;
  evidence.region = region;
  evidence.url = description?.status?.url ?? null;

  const serving = servingRevisions(description);
  if (serving.length === 0) evidence.reasons.push("No revision receives traffic.");
  const tagCache = new Map();
  for (const { name, percent } of serving) {
    const revision = { name, percent, image: null, imageDigest: null, sourceSha: null, sourceShaFrom: null };
    evidence.revisions.push(revision);
    const result = gcloud(["run", "revisions", "describe", name, "--project", project, "--region", region, "--format", "json"]);
    const parsed = result.status === 0 ? parseJson(result.stdout) : undefined;
    if (!parsed) {
      evidence.reasons.push(`Could not read revision ${name}: ${firstLine(result.stderr)}`);
      continue;
    }
    const { image, repository, digest } = revisionImage(parsed);
    revision.image = image;
    revision.imageDigest = digest;
    if (!digest) evidence.reasons.push(`Revision ${name} reports no image digest.`);

    const label = parsed?.metadata?.labels?.[SOURCE_SHA_LABEL];
    if (typeof label === "string" && SHA.test(label)) {
      revision.sourceSha = label;
      revision.sourceShaFrom = "revision-label";
      continue;
    }
    if (label !== undefined) evidence.reasons.push(`Revision ${name} has a malformed ${SOURCE_SHA_LABEL} label.`);
    if (!digest || !repository) {
      evidence.reasons.push(`Revision ${name} has no source commit: no ${SOURCE_SHA_LABEL} label and no digest to look up.`);
      continue;
    }
    if (!tagCache.has(repository)) {
      const tags = gcloud(["artifacts", "docker", "tags", "list", repository, "--format", "json"]);
      tagCache.set(repository, tags.status === 0 ? parseJson(tags.stdout) ?? null : { error: firstLine(tags.stderr) });
    }
    const tags = tagCache.get(repository);
    if (!Array.isArray(tags)) {
      evidence.reasons.push(`Revision ${name} has no ${SOURCE_SHA_LABEL} label and its image tags could not be read: ${tags?.error ?? "unreadable output"}`);
      continue;
    }
    const shas = shasTaggedAt(tags, digest);
    if (shas.length === 1) {
      revision.sourceSha = shas[0];
      revision.sourceShaFrom = "artifact-registry-tag";
    } else {
      evidence.reasons.push(shas.length === 0
        ? `Revision ${name} has no ${SOURCE_SHA_LABEL} label and no commit tag points at ${digest}.`
        : `Revision ${name} has no ${SOURCE_SHA_LABEL} label and several commit tags point at ${digest} (${shas.join(", ")}).`);
    }
  }
  if (evidence.reasons.length === 0) evidence.status = "verified";
  return evidence;
}

/** Fails the expectation unless every serving revision is the expected build. */
export function checkExpectations(backend, { sourceSha, imageDigest }) {
  const problems = [];
  if (!sourceSha && !imageDigest) return problems;
  if (backend.status !== "verified") problems.push("The serving backend is unverified, so it cannot be matched to this build.");
  if (backend.revisions.length === 0) problems.push("No serving revision to compare.");
  for (const revision of backend.revisions) {
    if (sourceSha && revision.sourceSha !== sourceSha) {
      problems.push(`Revision ${revision.name} (${revision.percent}%) serves source ${revision.sourceSha ?? "unknown"}, expected ${sourceSha}.`);
    }
    if (imageDigest && revision.imageDigest !== imageDigest) {
      problems.push(`Revision ${revision.name} (${revision.percent}%) serves image ${revision.imageDigest ?? "unknown"}, expected ${imageDigest}.`);
    }
  }
  return problems;
}

export function buildEvidence({ environment, hosting, backend, expectation, recordedAt = new Date().toISOString() }) {
  const problems = checkExpectations(backend, expectation ?? {});
  const backendShas = [...new Set(backend.revisions.map((revision) => revision.sourceSha))];
  return {
    schema: "eki.release-evidence/v1",
    recordedAt,
    environment,
    hosting,
    backend,
    // Whether the serving backend was built from the commit that Hosting released.
    // An automatic release deploys Hosting only, so false there is expected, not a failure.
    backendMatchesHostingSha: hosting?.sha && backend.status === "verified" && backendShas.length > 0
      ? backendShas.every((sha) => sha === hosting.sha)
      : null,
    expectation: expectation?.sourceSha || expectation?.imageDigest
      ? { ...expectation, met: problems.length === 0, problems }
      : null,
  };
}

const code = (value) => (value ? `\`${value}\`` : "unknown");

export function renderMarkdown(evidence) {
  const { backend, hosting } = evidence;
  const lines = [`### Release evidence (${evidence.environment})`, ""];
  if (hosting) {
    lines.push(`- Hosting source SHA: ${code(hosting.sha)}${hosting.outcome ? ` (Hosting deploy: ${hosting.outcome})` : ""}`);
  }
  const state = backend.status === "verified" ? "verified" : "**UNVERIFIED**";
  lines.push(`- Serving backend: ${code(backend.service)} in ${code(backend.region)}, ${state}`);
  for (const revision of backend.revisions) {
    lines.push(`  - Revision ${code(revision.name)} at ${revision.percent}%: image digest ${code(revision.imageDigest)}, source SHA ${code(revision.sourceSha)}${revision.sourceShaFrom ? ` (from ${revision.sourceShaFrom})` : ""}`);
  }
  for (const reason of backend.reasons) lines.push(`  - Unverified: ${reason}`);
  if (evidence.backendMatchesHostingSha !== null) {
    lines.push(`- Backend built from the Hosting commit: ${evidence.backendMatchesHostingSha ? "yes" : "no"}`);
  }
  if (evidence.expectation) {
    lines.push(`- Expected build: ${evidence.expectation.met ? "matches the serving revision" : "**does not match**"}`);
    for (const problem of evidence.expectation.problems) lines.push(`  - ${problem}`);
  }
  return `${lines.join("\n")}\n`;
}

function runGcloud(args) {
  // gcloud is a .cmd script on Windows, which needs a shell. Every argument here is a
  // plain token (names, regions, flags and JSON format), so joining them is safe.
  const result = process.platform === "win32"
    ? spawnSync(["gcloud", ...args].join(" "), { encoding: "utf8", shell: true })
    : spawnSync("gcloud", args, { encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? String(result.error ?? "") };
}

export function main(argv, { gcloud = runGcloud, env = process.env, log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      environment: { type: "string", default: "staging" },
      project: { type: "string" },
      service: { type: "string" },
      regions: { type: "string" },
      "hosting-sha": { type: "string" },
      "hosting-outcome": { type: "string" },
      "auth-outcome": { type: "string" },
      "expect-source-sha": { type: "string" },
      "expect-image-digest": { type: "string" },
      json: { type: "string" },
      summary: { type: "string" },
    },
  });
  const regions = (values.regions ?? "").split(",").map((region) => region.trim()).filter(Boolean);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project ?? "") || !values.service || regions.length === 0) {
    throw new Error("--project, --service and --regions are required.");
  }
  for (const [flag, value, pattern] of [
    ["--hosting-sha", values["hosting-sha"], SHA],
    ["--expect-source-sha", values["expect-source-sha"], SHA],
    ["--expect-image-digest", values["expect-image-digest"], DIGEST],
  ]) {
    if (value !== undefined && !pattern.test(value)) throw new Error(`${flag} is malformed: ${value}`);
  }

  const backend = collectBackendEvidence({
    gcloud, project: values.project, service: values.service, regions, authOutcome: values["auth-outcome"],
  });
  const evidence = buildEvidence({
    environment: values.environment,
    hosting: values["hosting-sha"] ? { project: values.project, sha: values["hosting-sha"], outcome: values["hosting-outcome"] ?? null } : null,
    backend,
    expectation: { sourceSha: values["expect-source-sha"], imageDigest: values["expect-image-digest"] },
  });

  const markdown = renderMarkdown(evidence);
  log(markdown);
  if (values.json) writeFileSync(values.json, `${JSON.stringify(evidence, null, 2)}\n`);
  const summary = values.summary ?? env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${markdown}\n`);
  if (backend.status !== "verified") {
    log(`::warning title=Serving backend unverified::${backend.reasons.join(" ")}`);
  }
  if (evidence.expectation && !evidence.expectation.met) {
    log(`::error title=Serving backend is not this build::${evidence.expectation.problems.join(" ")}`);
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 2;
  }
}
