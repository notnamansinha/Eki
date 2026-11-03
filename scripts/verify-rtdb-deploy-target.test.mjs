import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";
import { rtdbDeployTargets } from "./verify-rtdb-deploy-target.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const firebase = read("firebase.json");
const firebaserc = read(".firebaserc");

describe("RTDB deploy target", () => {
  it("resolves the staging project to the Singapore instance", () => {
    assert.deepEqual(rtdbDeployTargets(firebase, firebaserc, "bustrack-be165"), [
      { target: "rtdb", instances: ["bustrack-be165-asia-rtdb"] },
    ]);
  });

  it("refuses a project without a mapping, a default-instance config and a bad project", () => {
    assert.throws(() => rtdbDeployTargets(firebase, firebaserc, "eki-production"), /maps no RTDB instance to the deploy target "rtdb" for eki-production/);
    assert.throws(() => rtdbDeployTargets({ database: { rules: "database.rules.json" } }, firebaserc, "bustrack-be165"), /as deploy targets/);
    assert.throws(() => rtdbDeployTargets({ database: [{ rules: "database.rules.json" }] }, firebaserc, "bustrack-be165"), /maps no RTDB instance/);
    for (const project of [undefined, "", "--project", "Bad_Project"]) {
      assert.throws(() => rtdbDeployTargets(firebase, firebaserc, project), /valid --project/);
    }
  });

  it("checks the target and the region before App Check in both deploy jobs", () => {
    const jobs = yaml.load(readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")).jobs;
    for (const [job, project] of [["deploy-staging", "bustrack-be165"], ["deploy-production", "eki-production"]]) {
      const steps = jobs[job].steps;
      const target = steps.findIndex((step) => step.run === `node scripts/verify-rtdb-deploy-target.mjs --project ${project}`);
      const region = steps.findIndex((step) => step.run === "npm run verify:rtdb-instance -- --require-region");
      const appCheck = steps.findIndex((step) => step.name?.startsWith("Disable Firebase App Check"));
      assert.ok(target > 0 && region > 0 && appCheck > target && appCheck > region, `${job}: ${target}, ${region}, ${appCheck}`);
    }
  });
});
