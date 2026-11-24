import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";

// Issue #502. The staging host is the indexable public pilot until the
// production project exists, recorded as OPS-04 in the risk register. These
// checks tie that record to what the Deploy workflow builds, so a change to one
// side without the other fails:
// - OPS-04 stays Accepted exactly as long as the staging build leaves indexing on;
// - the accepted scope names the host that the staging build serves;
// - naming another project (production) in .firebaserc ends the exception;
// - the staging cell of the configuration's environment table agrees with the build.

const EXCEPTION = "OPS-04";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function repository() {
  return {
    workflow: yaml.load(read(".github/workflows/deploy.yml")),
    register: read("docs/operations/ARCHITECTURE_RISK_REGISTER.md"),
    configuration: read("docs/CONFIGURATION.md"),
    siteMetadata: read("frontend/src/lib/siteMetadata.ts"),
    firebaserc: JSON.parse(read(".firebaserc")),
  };
}

/**
 * The environment a Deploy job's frontend build sees (workflow, job and step
 * `env`, the later one winning, as in GitHub Actions) and the project its
 * Hosting deploy names.
 */
function release(workflow, job) {
  const steps = workflow.jobs?.[job]?.steps ?? [];
  const build = steps.find((step) => step.run?.trim() === "npm run build:production");
  const hosting = steps.find((step) => /--only\s+\S*\bhosting\b/.test(step.run ?? ""));
  return {
    env: build && { ...workflow.env, ...workflow.jobs[job].env, ...build.env },
    project: hosting?.run.match(/--project\s+([a-z0-9-]+)/)?.[1],
  };
}

const isExpression = (value) => typeof value === "string" && value.includes("${{");

/** Cells of a Markdown table row, without the outer pipes. */
const cells = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());

/** The rows of the first table whose header starts with `firstHeader`, with column lookup. */
function table(markdown, firstHeader) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("|") && cells(line)[0] === firstHeader);
  if (start < 0) return undefined;
  const header = cells(lines[start]);
  const rows = [];
  for (let index = start + 2; lines[index]?.startsWith("|"); index++) rows.push({ index, cells: cells(lines[index]) });
  return { header, rows, lines, column: (name) => header.indexOf(name) };
}

/** OPS-04 as the register records it: status, and the bullets of its own section. */
function exceptionRecord(register) {
  const risks = table(register, "ID");
  const row = risks?.rows.find((candidate) => candidate.cells[0] === EXCEPTION);
  const status = row?.cells[risks.column("Status")];
  const heading = register.match(new RegExp(`^### [\\d.]+ ${EXCEPTION}:.*$`, "m"));
  const rest = heading ? register.slice(heading.index + heading[0].length) : "";
  const end = rest.search(/^#{2,3} /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const bullet = (label) => section.match(new RegExp(`^- ${label}: (.+)$`, "m"))?.[1];
  const scope = bullet("Scope") ?? "";
  return { status, bullet, origins: [...scope.matchAll(/`(https:\/\/[^`/]+)`/g)].map((match) => match[1]) };
}

/** The staging cell of the `NEXT_PUBLIC_SITE_INDEXING` row in the environment separation table. */
function stagingPolicyCell(configuration) {
  const environments = table(configuration, "Concern");
  const row = environments?.rows.find((candidate) => candidate.cells[0] === "`NEXT_PUBLIC_SITE_INDEXING`");
  return row?.cells[environments.column("Staging")];
}

function stagingIndexingProblems(repo) {
  const problems = [];
  const staging = release(repo.workflow, "deploy-staging");
  if (!staging.env || !staging.project) {
    return ["deploy-staging needs an `npm run build:production` step and a `--only hosting` deploy with --project"];
  }
  for (const name of ["NEXT_PUBLIC_SITE_INDEXING", "NEXT_PUBLIC_SITE_URL"]) {
    if (isExpression(staging.env[name])) {
      problems.push(`deploy-staging must set ${name} to a literal, so the indexing policy can be checked`);
    }
  }

  // siteIndexingEnabled() turns indexing off only for the exact string "false"
  // (frontend/src/lib/siteMetadata.test.ts). An unset value leaves it on, and an
  // unquoted YAML false reaches the build as "false" too.
  const indexed = String(staging.env.NEXT_PUBLIC_SITE_INDEXING) !== "false";

  // OPS-04 is Accepted exactly while staging stays indexable. After the flag
  // flips, whichever other status fits the remaining access-control work is fine.
  const record = exceptionRecord(repo.register);
  const accepted = record.status === "Accepted";
  if (!record.status) {
    problems.push(`the risk register has no ${EXCEPTION} row`);
  } else if (indexed && !accepted) {
    problems.push(`deploy-staging leaves indexing on, so ${EXCEPTION} must stay Accepted (it is ${record.status})`);
  } else if (!indexed && accepted) {
    problems.push(`deploy-staging sets NEXT_PUBLIC_SITE_INDEXING=false: move ${EXCEPTION} out of Accepted`);
  }

  if (accepted) {
    for (const label of ["Owner", "Scope", "Reason", "Exit condition"]) {
      if (!record.bullet(label)) problems.push(`${EXCEPTION} is Accepted but its section has no "- ${label}:" line`);
    }
    // The build's canonical origin and the Hosting site it deploys to must both be in scope.
    const defaultOrigin = repo.siteMetadata.match(/const DEFAULT_SITE_ORIGIN = "([^"]+)"/)?.[1];
    if (!defaultOrigin) problems.push("DEFAULT_SITE_ORIGIN not found in frontend/src/lib/siteMetadata.ts");
    const siteUrl = staging.env.NEXT_PUBLIC_SITE_URL ?? defaultOrigin;
    const served = [`https://${staging.project}.web.app`];
    if (siteUrl && !isExpression(siteUrl)) {
      try {
        served.push(new URL(siteUrl).origin);
      } catch {
        problems.push(`deploy-staging NEXT_PUBLIC_SITE_URL "${siteUrl}" is not a URL`);
      }
    }
    for (const origin of new Set(served)) {
      if (!record.origins.includes(origin)) {
        problems.push(`deploy-staging serves ${origin}, which the ${EXCEPTION} scope does not name`);
      }
    }
    // The first repository change that production needs is a .firebaserc entry
    // for its project: deploy-production stops at its RTDB deploy-target check
    // until then. Provisioning production is the exception's exit condition, so
    // any project other than staging ends it. Firebase demo-* projects exist
    // only in the emulators.
    const rc = repo.firebaserc;
    const named = new Set([...Object.values(rc.projects ?? {}), ...Object.keys(rc.targets ?? {})]);
    for (const project of named) {
      if (project !== staging.project && !project.startsWith("demo-")) {
        problems.push(`.firebaserc names ${project}: set NEXT_PUBLIC_SITE_INDEXING to "false" for deploy-staging and move ${EXCEPTION} out of Accepted (if ${project} is not the production project, remove it or use a demo- project)`);
      }
    }
  }

  const cell = stagingPolicyCell(repo.configuration);
  if (cell === undefined) {
    problems.push("docs/CONFIGURATION.md has no NEXT_PUBLIC_SITE_INDEXING row in the environment separation table");
  } else {
    // A value cell leads with its value, as the other rows do: a cell that starts
    // with `false` promises noindex, anything else describes indexing on.
    const promisesNoindex = cell.startsWith("`false`");
    if (promisesNoindex === indexed) {
      problems.push(`docs/CONFIGURATION.md gives staging "${cell}", but deploy-staging ${indexed ? "leaves indexing on" : "sets false"}`);
    }
    if (accepted && !cell.includes(EXCEPTION)) {
      problems.push(`the staging cell in docs/CONFIGURATION.md must name ${EXCEPTION} while it is Accepted`);
    }
  }
  return problems;
}

// Small stand-ins for the five files, in the accepted state unless an option
// says otherwise, so the cases below keep working after OPS-04 is exited.
const ACCEPTED_CELL = "Unset, so indexing is on: public-pilot exception [OPS-04](register.md) until production exists, then `false`";
const BULLETS = ["Owner", "Scope", "Reason", "Exit condition"];
const STAGING_ONLY_RC = { projects: { default: "bustrack-be165" }, targets: { "bustrack-be165": { database: { rtdb: ["bustrack-be165-asia-rtdb"] } } } };
const WITH_PRODUCTION_RC = { projects: { default: "bustrack-be165" }, targets: { ...STAGING_ONLY_RC.targets, "eki-production": { database: { rtdb: ["eki-production-rtdb"] } } } };

function fixture({
  flag,
  siteUrl,
  jobEnv,
  stagingProject = "bustrack-be165",
  status = "Accepted",
  cell = status === "Accepted" ? ACCEPTED_CELL : "`false`",
  bullets = BULLETS,
  row = true,
  firebaserc = STAGING_ONLY_RC,
} = {}) {
  const job = (project, extra, env) => ({
    ...(env && { env }),
    steps: [
      { name: "Strict production build", env: { NEXT_PUBLIC_BACKEND_URL: "${{ secrets.NEXT_PUBLIC_BACKEND_URL }}", ...extra }, run: "npm run build:production" },
      { name: "Deploy indexes", run: `$FIREBASE_CLI deploy --project ${project} --only firestore:indexes --non-interactive` },
      { name: "Deploy", run: `$FIREBASE_CLI deploy --project ${project} --only hosting,firestore:rules,database:rtdb --token "$FIREBASE_TOKEN"` },
    ],
  });
  const stagingEnv = {};
  if (flag !== undefined) stagingEnv.NEXT_PUBLIC_SITE_INDEXING = flag;
  if (siteUrl !== undefined) stagingEnv.NEXT_PUBLIC_SITE_URL = siteUrl;
  const text = {
    Owner: "the platform owner.",
    Scope: "the Hosting site of `bustrack-be165` only, served as `https://bustrack-be165.web.app` and `https://bustrack-be165.firebaseapp.com`.",
    Reason: "the only live origin.",
    "Exit condition": "when production is provisioned, set the flag.",
  };
  return {
    workflow: {
      env: { FIREBASE_CLI: "npx --yes firebase-tools@15.14.0" },
      jobs: { "deploy-staging": job(stagingProject, stagingEnv, jobEnv), "deploy-production": job("eki-production", {}) },
    },
    register: [
      "| ID | Risk | Severity | Status | Closure evidence or open gate |",
      "|---|---|---|---|---|",
      "| OPS-03 | The `main` ruleset requires no status checks | Medium | Closed | Ruleset |",
      ...(row ? [`| OPS-04 | The staging host is indexable | Low | ${status} | Exit at production |`] : []),
      "",
      "### 3.10 OPS-03: the main ruleset requires no status checks",
      "",
      "- Owner: the repository owner.",
      "",
      "### 3.11 OPS-04: the staging host is indexable without access control",
      "",
      ...bullets.map((label) => `- ${label}: ${text[label]}`),
      "",
      "## 4. Maintenance rule",
      "",
    ].join("\n"),
    configuration: [
      "| Concern | Local development | Staging | Production |",
      "|---|---|---|---|",
      "| `NODE_ENV` | `development` | `production` | `production` |",
      `| \`NEXT_PUBLIC_SITE_INDEXING\` | Not relevant | ${cell} | \`true\` |`,
      "",
    ].join("\n"),
    siteMetadata: 'const DEFAULT_SITE_ORIGIN = "https://bustrack-be165.web.app";\n',
    firebaserc,
  };
}

const expectProblem = (repo, pattern) => {
  const problems = stagingIndexingProblems(repo);
  assert.ok(problems.some((problem) => pattern.test(problem)), `expected ${pattern} in:\n${problems.join("\n") || "(no problems)"}`);
  return problems;
};

describe("staging indexing policy (issue #502, OPS-04)", () => {
  it("agrees across the Deploy workflow, the risk register, the configuration table and .firebaserc", () => {
    assert.deepEqual(stagingIndexingProblems(repository()), []);
  });

  it("accepts both consistent states: the public pilot and its exit", () => {
    assert.deepEqual(stagingIndexingProblems(fixture()), []);
    // After the flip, any status other than Accepted fits: Open while access
    // control is still to be built, External gate or Closed after that.
    for (const status of ["Open", "External gate", "Closed"]) {
      assert.deepEqual(stagingIndexingProblems(fixture({ flag: "false", status, firebaserc: WITH_PRODUCTION_RC })), [], status);
    }
    // The flag may also come from the job's env.
    const fromJob = fixture({ jobEnv: { NEXT_PUBLIC_SITE_INDEXING: "false" }, status: "External gate", firebaserc: WITH_PRODUCTION_RC });
    assert.deepEqual(stagingIndexingProblems(fromJob), []);
  });

  it("fails when staging turns indexing off while OPS-04 is still accepted", () => {
    // An unquoted YAML false parses as a boolean and reaches the build as "false".
    for (const flag of ["false", false]) {
      const problems = expectProblem(fixture({ flag }), /move OPS-04 out of Accepted/);
      assert.ok(problems.some((problem) => /CONFIGURATION\.md gives staging .* but deploy-staging sets false/.test(problem)));
    }
    expectProblem(fixture({ jobEnv: { NEXT_PUBLIC_SITE_INDEXING: "false" } }), /move OPS-04 out of Accepted/);
  });

  it("fails when OPS-04 leaves Accepted while staging still indexes", () => {
    for (const status of ["External gate", "Closed", "Open"]) {
      expectProblem(fixture({ status, cell: ACCEPTED_CELL }), new RegExp(`must stay Accepted \\(it is ${status}\\)`));
    }
    // Any value other than the exact string "false" leaves indexing on, and the
    // step's own env wins over the job's.
    expectProblem(fixture({ flag: "False", status: "Closed", cell: ACCEPTED_CELL }), /must stay Accepted/);
    expectProblem(fixture({ flag: "true", jobEnv: { NEXT_PUBLIC_SITE_INDEXING: "false" }, status: "Closed", cell: ACCEPTED_CELL }), /must stay Accepted/);
  });

  it("reports a missing OPS-04 row and a table that promises noindex, as on main before #502", () => {
    assert.deepEqual(stagingIndexingProblems(fixture({ row: false, cell: "`false`" })), [
      "the risk register has no OPS-04 row",
      'docs/CONFIGURATION.md gives staging "`false`", but deploy-staging leaves indexing on',
    ]);
  });

  it("ends the exception once .firebaserc names a project other than staging", () => {
    expectProblem(fixture({ firebaserc: WITH_PRODUCTION_RC }), /\.firebaserc names eki-production/);
    expectProblem(fixture({ firebaserc: { projects: { default: "bustrack-be165", production: "eki-production" } } }), /\.firebaserc names eki-production/);
    // A production project under another ID counts too, even before the Deploy workflow is renamed.
    expectProblem(fixture({ firebaserc: { ...STAGING_ONLY_RC, targets: { ...STAGING_ONLY_RC.targets, "aru-eki-prod": {} } } }), /\.firebaserc names aru-eki-prod/);
    // Emulator-only demo projects do not.
    assert.deepEqual(stagingIndexingProblems(fixture({ firebaserc: { projects: { default: "bustrack-be165", qa: "demo-eki-qa" } } })), []);
  });

  it("fails when staging serves an origin outside the accepted scope", () => {
    expectProblem(fixture({ siteUrl: "https://bus.example.edu" }), /serves https:\/\/bus\.example\.edu, which the OPS-04 scope does not name/);
    expectProblem(fixture({ stagingProject: "eki-staging" }), /serves https:\/\/eki-staging\.web\.app/);
    // The canonical value is compared as an origin, as resolveSiteOrigin() does.
    assert.deepEqual(stagingIndexingProblems(fixture({ siteUrl: "https://bustrack-be165.web.app/" })), []);
    expectProblem(fixture({ siteUrl: "not a url" }), /NEXT_PUBLIC_SITE_URL "not a url" is not a URL/);
  });

  it("fails when the configuration table disagrees with the staging build", () => {
    const problems = expectProblem(fixture({ cell: "`false`" }), /CONFIGURATION\.md gives staging "`false`", but deploy-staging leaves indexing on/);
    assert.ok(problems.some((problem) => /must name OPS-04 while it is Accepted/.test(problem)));
    expectProblem(fixture({ cell: "Unset, so indexing is on" }), /must name OPS-04 while it is Accepted/);
    expectProblem(fixture({ flag: "false", status: "Closed", cell: ACCEPTED_CELL }), /but deploy-staging sets false/);
  });

  it("requires literal values, so the policy stays checkable", () => {
    expectProblem(fixture({ flag: "${{ vars.SITE_INDEXING }}" }), /NEXT_PUBLIC_SITE_INDEXING to a literal/);
    expectProblem(fixture({ siteUrl: "${{ vars.SITE_URL }}" }), /NEXT_PUBLIC_SITE_URL to a literal/);
  });

  it("requires the accepted entry to name its owner, scope, reason and exit condition", () => {
    for (const label of BULLETS) {
      expectProblem(fixture({ bullets: BULLETS.filter((other) => other !== label) }), new RegExp(`no "- ${label}:" line`));
    }
  });
});
