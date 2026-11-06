import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../.github/workflows/publish-backend-image.yml", import.meta.url), "utf8"));
const job = workflow.jobs.publish;
const step = (name) => job.steps.find((s) => s.name === name);

describe("backend image publishing to Docker Hub", () => {
  it("publishes only a green push to main in this repository, or a dispatch from main", () => {
    // A fork pull request from a branch named main also reports head_branch main.
    assert.match(job.if, /workflow_run\.conclusion == 'success'/);
    assert.match(job.if, /workflow_run\.event == 'push'/);
    assert.match(job.if, /workflow_run\.head_branch == 'main'/);
    assert.match(job.if, /workflow_run\.head_repository\.full_name == github\.repository/);
    assert.match(job.if, /github\.event_name == 'workflow_dispatch' &&\s*github\.ref == 'refs\/heads\/main'/);
    assert.deepEqual(workflow.permissions, { contents: "read" });
  });

  it("refuses a commit that main does not contain before checking it out", () => {
    const names = job.steps.map((s) => s.name ?? s.uses);
    const guard = names.indexOf("Refuse a commit that main does not contain");
    assert.ok(guard >= 0, "guard step missing");
    assert.ok(guard < names.findIndex((n) => n.startsWith("actions/checkout@")));
    assert.match(step("Refuse a commit that main does not contain").run, /compare\/\$\{SOURCE_SHA\}\.\.\.heads\/main"/);
  });

  it("gives the Docker Hub secrets only to the credential check and the push", () => {
    assert.ok(!JSON.stringify(job.env ?? {}).includes("secrets."), "job-level env must not carry secrets");
    const withSecrets = job.steps.filter((s) => JSON.stringify(s).includes("secrets.")).map((s) => s.name);
    assert.deepEqual(withSecrets, ["Check for Docker Hub credentials", "Push to Docker Hub"]);
  });
});
