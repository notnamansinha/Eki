import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"));
const jobs = workflow.jobs;
const guardName = "Refuse a commit that main does not contain";
const guard = jobs["deploy-staging"].steps.find((step) => step.name === guardName);

// bash is available on the Linux CI runner; a Windows checkout may lack a usable one.
const bash = spawnSync("bash", ["-c", "true"]).status === 0 ? "bash" : null;

describe("deploy workflow releases only commits on main", () => {
  it("gates every deploying job on main", () => {
    assert.match(jobs["deploy-staging"].if, /workflow_run\.event == 'push'/);
    assert.match(jobs["deploy-staging"].if, /workflow_run\.head_branch == 'main'/);
    assert.match(jobs["deploy-staging"].if, /workflow_run\.repository\.full_name == github\.repository/);
    assert.match(jobs["deploy-staging"].if, /github\.ref == 'refs\/heads\/main'/);
    assert.match(jobs["deploy-production"].if, /github\.event_name == 'workflow_dispatch'.*github\.ref == 'refs\/heads\/main'/);
    assert.match(jobs["deploy-backend-staging"].if, /github\.event_name == 'workflow_dispatch'/);
    assert.match(jobs["deploy-backend-staging"].if, /github\.ref == 'refs\/heads\/main'/);
  });

  it("checks that main contains the commit before anything else in the staging release", () => {
    assert.ok(guard, "guard step missing");
    assert.equal(jobs["deploy-staging"].steps[0].name, guardName);
    assert.match(guard.env.SHA, /workflow_run\.head_sha \|\| github\.sha/);
    assert.match(guard.run, /compare\/\$\{SHA\}\.\.\.main/);
  });

  it("keeps no git credentials in any checkout", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps.filter((s) => s.uses?.startsWith("actions/checkout@"))) {
        assert.equal(step.with?.["persist-credentials"], false, `${name} checkout keeps credentials`);
      }
    }
  });

  it("accepts only identical or ahead from the compare API", { skip: !bash && "no usable bash" }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eki-guard-"));
    try {
      writeFileSync(path.join(dir, "guard.sh"), guard.run);
      // A fake gh that answers the compare call with $FAKE_STATUS, or fails like a 404.
      writeFileSync(path.join(dir, "gh"), '#!/bin/sh\n[ "$FAKE_STATUS" = 404 ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }\necho "$FAKE_STATUS"\n');
      chmodSync(path.join(dir, "gh"), 0o755);
      const run = (status) => spawnSync(bash, ["-e", path.join(dir, "guard.sh")], {
        env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_STATUS: status,
          SHA: "0123456789abcdef0123456789abcdef01234567", GITHUB_REPOSITORY: "notnamansinha/Eki" },
        encoding: "utf8",
      });
      for (const status of ["identical", "ahead"]) assert.equal(run(status).status, 0, status);
      for (const status of ["behind", "diverged", "404", ""]) {
        const result = run(status);
        assert.notEqual(result.status, 0, `${status || "empty"} must refuse`);
      }
      assert.match(run("diverged").stdout, /is not on main \(compare status: diverged\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
