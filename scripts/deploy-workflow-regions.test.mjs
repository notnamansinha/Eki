import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

describe("backend deploy job regions", () => {
  it("guards exactly the regions that the cloud_run_region input offers", () => {
    const options = workflow.match(/\n {6}cloud_run_region:[\s\S]*?options:\n((?: {10}- [a-z0-9-]+\n)+)/)?.[1];
    assert.ok(options, "cloud_run_region options not found");
    const offered = [...options.matchAll(/- ([a-z0-9-]+)/g)].map((match) => match[1]);
    const guarded = workflow.match(/for region in ([a-z0-9 -]+); do/)?.[1].trim().split(/\s+/);
    assert.ok(guarded, "guard region loop not found");
    assert.deepEqual([...guarded].sort(), [...offered].sort());
  });

  it("lists each region on its own and refuses to deploy when a listing fails", () => {
    assert.match(workflow, /gcloud run services list[^\n]*--region "\$region"/);
    assert.match(workflow, /Could not inspect Cloud Run services in \$\{region\}; refusing to deploy\./);
  });
});
