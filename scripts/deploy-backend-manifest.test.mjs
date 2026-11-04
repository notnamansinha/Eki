import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const steps = yaml.load(readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8")).jobs["deploy-backend-staging"].steps;
const rtdbStep = steps.find((step) => step.name === "Require the Hosting build to target the RTDB instance the backend will use");
const candidateStep = steps.find((step) => step.name === "Deploy a candidate revision that receives no traffic");
const manifest = readFileSync(path.join(root, "deploy/cloud-run/staging.service.yaml"), "utf8");

const works = (command, args) => spawnSync(command, args).status === 0;
const awk = works("awk", ["BEGIN { exit 0 }"]);
// The full step needs bash, jq and envsubst, as on the Linux runner; a Windows checkout may lack jq.
const fullStep = works("bash", ["-c", "true"]) && works("jq", ["-n", "1"]) && works("envsubst", ["--version"]);

describe("backend deploy manifest", () => {
  it("reads the RTDB URL only from the exact FIREBASE_DATABASE_URL entry", { skip: !awk && "no awk" }, () => {
    const program = rtdbStep.run.match(/awk '([^']+)'/)?.[1];
    assert.ok(program, "awk program not found");
    const dir = mkdtempSync(path.join(tmpdir(), "eki-manifest-"));
    try {
      const read = (text) => {
        const file = path.join(dir, "service.yaml");
        writeFileSync(file, text);
        return spawnSync("awk", [program, file], { encoding: "utf8" });
      };
      const url = "https://bustrack-be165-asia-rtdb.asia-southeast1.firebasedatabase.app";
      assert.equal(read(manifest).stdout.trim(), url);
      const entry = (name, value) => `            - name: ${name}\n              ${value}\n`;
      // A commented copy or a longer name before the real entry is not picked up.
      assert.equal(read(`# - name: FIREBASE_DATABASE_URL\n#   value: "https://wrong.firebaseio.com"\n${entry("FIREBASE_DATABASE_URL_LEGACY", 'value: "https://old.firebaseio.com"')}${entry("FIREBASE_DATABASE_URL", `value: "${url}"`)}`).stdout.trim(), url);
      assert.equal(read(entry("FIREBASE_DATABASE_URL", `value: ${url}`)).stdout.trim(), url);
      // A secret reference or a missing value line fails; no entry gives an empty URL.
      assert.notEqual(read(entry("FIREBASE_DATABASE_URL", "valueFrom:")).status, 0);
      assert.notEqual(read("            - name: FIREBASE_DATABASE_URL\n").status, 0);
      assert.equal(read(entry("OTHER", 'value: "x"')).stdout, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders every manifest placeholder the job provides", () => {
    const rendered = new Set([...candidateStep.run.matchAll(/envsubst '([^']+)'/g)].flatMap(([, list]) => list.match(/[A-Z_]+/g)));
    const used = new Set([...manifest.replace(/^\s*#.*$/gm, "").matchAll(/\$\{([A-Z_]+)\}/g)].map(([, name]) => name));
    assert.deepEqual([...used].sort(), [...rendered].sort());
    assert.match(manifest, /\n {2}annotations:\r?\n(?: {4}.*\r?\n)*? {4}run\.googleapis\.com\/minScale: "\$\{SERVICE_MIN_SCALE\}"/);
  });

  it("keeps the live service-level minimum instances in the applied manifest", { skip: !fullStep && "no bash, jq or envsubst" }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eki-candidate-"));
    try {
      writeFileSync(path.join(dir, "step.sh"), candidateStep.run);
      // A fake gcloud: describe answers $FAKE_SERVICE_JSON (or "Cannot find service"),
      // replace copies the rendered manifest to $FAKE_APPLIED.
      writeFileSync(path.join(dir, "gcloud"), [
        "#!/bin/sh",
        'if [ "$1 $2 $3" = "run services describe" ]; then',
        '  [ -n "$FAKE_SERVICE_JSON" ] || { echo "ERROR: Cannot find service [eki-backend-staging]." >&2; exit 1; }',
        '  printf "%s\\n" "$FAKE_SERVICE_JSON"',
        'elif [ "$1 $2 $3" = "run services replace" ]; then',
        '  cp "$4" "$FAKE_APPLIED"',
        "fi",
        "",
      ].join("\n"));
      chmodSync(path.join(dir, "gcloud"), 0o755);
      const applied = path.join(dir, "applied.yaml");
      const deploy = (service) => {
        rmSync(applied, { force: true });
        const result = spawnSync("bash", ["-e", path.join(dir, "step.sh")], {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${dir}${path.delimiter}${process.env.PATH}`,
            FAKE_SERVICE_JSON: service ? JSON.stringify(service) : "",
            FAKE_APPLIED: applied,
            RUNNER_TEMP: dir,
            GITHUB_ENV: path.join(dir, "github_env"),
            // Should a real gcloud ever run instead of the fake, it has no credentials
            // and names a project and service that do not exist.
            CLOUDSDK_CONFIG: path.join(dir, "gcloud-config"),
            CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
            SERVICE: "eki-test-service",
            GCP_PROJECT: "eki-test-project-0000",
            REGION: "asia-south2",
            IMAGE: "asia-south2-docker.pkg.dev/bustrack-be165/eki/backend@sha256:0123",
            RUNTIME_SERVICE_ACCOUNT: "eki-backend-runtime@bustrack-be165.iam.gserviceaccount.com",
          },
        });
        return { ...result, service: existsSync(applied) ? yaml.load(readFileSync(applied, "utf8")) : undefined };
      };
      const serving = (annotations) => ({
        metadata: { annotations },
        status: { traffic: [{ revisionName: "eki-backend-staging-00007-k6j", percent: 100 }] },
      });

      const daytime = deploy(serving({ "run.googleapis.com/minScale": "1", "run.googleapis.com/ingress": "all" }));
      assert.equal(daytime.status, 0, daytime.stderr);
      assert.equal(daytime.service.metadata.annotations["run.googleapis.com/minScale"], "1");
      assert.equal(daytime.service.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"], "0");
      assert.deepEqual(daytime.service.spec.traffic[0], { revisionName: "eki-backend-staging-00007-k6j", percent: 100 });

      const overnight = deploy(serving({}));
      assert.equal(overnight.status, 0, overnight.stderr);
      assert.equal(overnight.service.metadata.annotations["run.googleapis.com/minScale"], "0");

      const first = deploy(undefined);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.service.metadata.annotations["run.googleapis.com/minScale"], "0");

      const garbled = deploy(serving({ "run.googleapis.com/minScale": "1; rm -rf /" }));
      assert.notEqual(garbled.status, 0);
      assert.equal(garbled.service, undefined);
      assert.match(garbled.stdout, /is not a whole number; refusing to deploy/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
