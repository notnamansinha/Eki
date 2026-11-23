import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { safetyPreflight } from './safety-preflight.mjs';
import { removeGeneratedDemoConfig } from './emulator-environment.mjs';
import {
  LOCAL_BACKEND_PORT, LOCAL_PATH_VALUES, STAGING_ORIGIN, ZAP_IMAGE,
  CLOUD_RUN_NAME_CHARACTERS, HEX_DIGITS, applyTriage, assertStagingRun, automationPlan, canonicalCount, canonicalStatus,
  canonicalText, mergeAlerts, profileFor, redact,
  redactLog, riskCounts, sanitizeZapReport, scopedContract, selectOperations,
} from './dast-plan.mjs';
import { dastTriage } from '../../qa/dast-triage.mjs';

/**
 * Bounded OWASP ZAP scans of the Eki HTTP API (qa/DAST.md).
 *
 *   node scripts/qa/run-dast.mjs                      local profile; started by
 *                                                     `npm run qa:dast` inside the
 *                                                     disposable emulators
 *   node scripts/qa/run-dast.mjs --staging --dry-run  writes the staging plans only
 *   node scripts/qa/run-dast.mjs --staging            scans the approved staging origin
 */
const args = process.argv.slice(2);
const usage = [[], ['--staging'], ['--staging', '--dry-run']];
if (!usage.some(form => JSON.stringify(form) === JSON.stringify(args))) {
  throw new Error('Usage: node scripts/qa/run-dast.mjs [--staging [--dry-run]]');
}
const profileName = args[0] === '--staging' ? 'staging' : 'local';
const dryRun = args.includes('--dry-run');
const profile = profileFor(profileName);

const require = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const { dump } = require('js-yaml');
const contract = JSON.parse(readFileSync(resolve(repositoryRoot, 'backend/openapi.json'), 'utf8'));
const evidenceDirectory = resolve(repositoryRoot, 'artifacts/qa');
const workDirectory = resolve(evidenceDirectory, `dast-${profileName}`);
const reportBase = resolve(evidenceDirectory, `dast-${profileName}-report`);
rmSync(workDirectory, { recursive: true, force: true });
mkdirSync(workDirectory, { recursive: true });

const git = gitArgs => execFileSync('git', gitArgs, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const report = {
  schemaVersion: 1, profile: profileName, dryRun,
  sourceCommit: git(['rev-parse', 'HEAD']),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'])),
  startedAt: new Date().toISOString(), finishedAt: null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null, node: process.version, platform: process.platform,
  zapImage: ZAP_IMAGE, zapVersion: null,
  target: profileName === 'local' ? 'Disposable emulator backend (127.0.0.1:3116, demo-eki-qa)' : STAGING_ORIGIN,
  release: null,
  bounds: {
    methods: profile.methods, excludedPaths: profile.excludedPaths, threadPerHost: profile.threadPerHost,
    delayInMs: profile.delayInMs, defaultStrength: profile.defaultStrength, defaultThreshold: profile.defaultThreshold,
    maxRuleDurationInMins: profile.maxRuleDurationInMins, maxScanDurationInMins: profile.maxScanDurationInMins,
  },
  roles: [], fixtureEvidence: [], admissionCheck: null, alerts: [], counts: null, untriaged: null,
  verdict: 'BLOCKED', setupError: null,
};
const secrets = [];

// ZAP runs in a container. Docker Desktop (Windows, macOS) reaches the host's
// loopback through host.docker.internal; Linux shares the host network.
const linuxHost = process.platform === 'linux';
const scanOrigin = profileName === 'staging' ? STAGING_ORIGIN
  : linuxHost ? `http://127.0.0.1:${LOCAL_BACKEND_PORT}` : `http://host.docker.internal:${LOCAL_BACKEND_PORT}`;
const targetLabel = profileName === 'staging' ? '<staging>' : '<local-backend>';

function writePlan(role, pathValues) {
  const operations = selectOperations(contract, profileName, role);
  const directory = resolve(workDirectory, role);
  mkdirSync(directory, { recursive: true });
  // The container runs as uid 1000 and writes its report into this folder.
  try { chmodSync(directory, 0o777); } catch { /* Windows ignores modes */ }
  writeFileSync(resolve(directory, 'openapi.json'),
    JSON.stringify(scopedContract(contract, operations, { origin: scanOrigin, pathValues }), null, 2) + '\n');
  writeFileSync(resolve(directory, 'plan.yaml'), dump(automationPlan({ profileName, role, origin: scanOrigin }), { lineWidth: 160 }));
  return { directory, operations };
}

function runZap(role, directory, authorization) {
  const minutes = profile.maxScanDurationInMins[role];
  const name = `eki-dast-${profileName}-${role}-${process.pid}`;
  const dockerArgs = ['run', '--rm', '--name', name, '-v', `${directory}:/zap/wrk:rw`,
    ...(linuxHost && profileName === 'local' ? ['--network', 'host'] : []),
    // Passed by name: the value stays out of the command line and every file.
    ...(authorization ? ['-e', 'ZAP_AUTH_HEADER_VALUE', '-e', 'ZAP_AUTH_HEADER_SITE'] : []),
    ZAP_IMAGE, 'zap.sh', '-cmd', '-autorun', '/zap/wrk/plan.yaml'];
  // ZAP compares ZAP_AUTH_HEADER_SITE with the host name only; a port never matches.
  const env = { ...process.env, ...(authorization
    ? { ZAP_AUTH_HEADER_VALUE: authorization, ZAP_AUTH_HEADER_SITE: new URL(scanOrigin).hostname } : {}) };
  const logPath = resolve(directory, 'zap.log');
  const log = openSync(logPath, 'w');
  const child = spawn('docker', dockerArgs, { cwd: repositoryRoot, env, stdio: ['ignore', log, log] });
  closeSync(log);
  const started = Date.now();
  return new Promise(done => {
    // Import, both passive waits and the report add a few minutes to the active scan budget.
    const deadline = setTimeout(() => {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      child.kill();
    }, (minutes + 8) * 60_000);
    child.once('error', error => { clearTimeout(deadline); done({ exitCode: null, error: error.code ?? error.message, durationMs: Date.now() - started }); });
    child.once('exit', code => {
      clearTimeout(deadline);
      writeFileSync(logPath, redactLog(readFileSync(logPath, 'utf8'), secrets));
      done({ exitCode: code, error: null, durationMs: Date.now() - started });
    });
  });
}

async function scanRole(role, authorization, pathValues) {
  const { directory, operations } = writePlan(role, pathValues);
  const entry = { role, operations: operations.length, maxScanDurationInMins: profile.maxScanDurationInMins[role] };
  report.roles.push(entry);
  if (dryRun) return;
  const result = await runZap(role, directory, authorization);
  Object.assign(entry, result);
  const rawPath = resolve(directory, 'zap-report.json');
  // Exit 0 is success and 2 is warnings only (for example a skipped rule).
  if (![0, 2].includes(result.exitCode) || !existsSync(rawPath)) {
    throw new Error(`ZAP ${role} scan did not finish (exit ${result.exitCode ?? result.error}); see ${directory}/zap.log`);
  }
  const sanitized = sanitizeZapReport(JSON.parse(readFileSync(rawPath, 'utf8')),
    { role, secrets, origin: scanOrigin, label: targetLabel });
  // The raw report names the origin and quotes responses; keep only the sanitized form.
  rmSync(rawPath, { force: true });
  report.zapVersion = sanitized.zapVersion;
  entry.alerts = sanitized.alerts.length;
  writeFileSync(resolve(directory, 'alerts.json'), JSON.stringify(sanitized.alerts, null, 2) + '\n');
  return sanitized.alerts;
}

// Only canonical values from a response reach the report: the status from the
// fixed list of codes, and body fields through canonicalText or canonicalCount.
async function getJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  return { status: canonicalStatus(response.status), body: await response.json().catch(() => null) };
}

// ---- local profile: the disposable emulator backend ----------------------

// The synthetic device secret that e2e/emulator/backend.mjs provisions for qa_device.
const LOCAL_DEVICE_SECRET = 'synthetic-browser-device-only';
const control = path => getJson(`http://127.0.0.1:3117${path}`);

async function signIn(uid) {
  const { status, body } = await getJson('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-only', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${uid}@example.invalid`, password: 'SyntheticOnly123!', returnSecureToken: true }),
  });
  if (status !== 200 || typeof body?.idToken !== 'string') throw new Error(`Demo identity ${uid} could not sign in`);
  secrets.push(body.idToken);
  return body.idToken;
}

async function withLocalBackend(role, work) {
  const log = openSync(resolve(workDirectory, `backend-${role}.log`), 'w');
  const child = spawn(process.execPath, ['--import', './scripts/qa/network-guard.mjs', 'scripts/qa/dast-backend.mjs'], {
    cwd: repositoryRoot, stdio: ['ignore', log, log, 'ipc'],
    env: { ...process.env, PORT: String(LOCAL_BACKEND_PORT), WORKER_ENABLED: 'false', NODE_ENV: 'development',
      CORS_ORIGIN: 'http://127.0.0.1:3115', EKI_QA_DAST: '1', HTTPS_DEVICE_RATE_PER_MINUTE: '100000' },
  });
  closeSync(log);
  const exit = new Promise(done => child.once('exit', code => done(code)));
  try {
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (!ready && Date.now() < deadline && child.exitCode === null) {
      try { ready = (await control('/evidence')).body?.fixtureProcessId === child.pid; } catch { /* starting */ }
      if (!ready) await new Promise(done => setTimeout(done, 250));
    }
    if (!ready) throw new Error(`The disposable backend for ${role} did not start; see ${workDirectory}/backend-${role}.log`);
    const result = await work();
    const { body: state } = await control('/evidence');
    const executed = state?.providers?.externalNetworkExecuted;
    const transport = { role, deniedConnections: canonicalCount(state?.transport?.deniedConnections),
      providerDeniedRequests: canonicalCount(state?.providers?.deniedRequests),
      externalNetworkExecuted: executed === false ? false : executed === true ? true : null };
    report.fixtureEvidence.push(transport);
    if (transport.deniedConnections !== 0 || transport.providerDeniedRequests !== 0 || transport.externalNetworkExecuted !== false) {
      throw new Error(`The ${role} scan made the backend attempt a non-loopback connection`);
    }
    return result;
  } finally {
    if (child.connected) child.send({ type: 'eki-qa-shutdown', pid: child.pid }, error => { if (error) child.kill('SIGTERM'); });
    else child.kill('SIGTERM');
    const backstop = setTimeout(() => child.kill('SIGKILL'), 12_000);
    await exit;
    clearTimeout(backstop);
  }
}

async function runLocal() {
  removeGeneratedDemoConfig(process.env);
  safetyPreflight(process.env, { mode: 'emulator' });
  const hub = await getJson('http://127.0.0.1:4405/emulators');
  if (hub.status !== 200 || !Object.entries({ firestore: 8085, database: 9005, auth: 9095 })
    .every(([name, port]) => hub.body?.[name]?.host === '127.0.0.1' && hub.body[name].port === port)) {
    throw new Error('Verified emulator targets required');
  }
  secrets.push(LOCAL_DEVICE_SECRET);
  const alerts = [];
  for (const role of profile.roles) {
    alerts.push(...await withLocalBackend(role, async () => {
      const authorization = role === 'anonymous' ? null
        : role === 'device' ? `Device ${LOCAL_DEVICE_SECRET}` : `Bearer ${await signIn(`qa_${role}`)}`;
      if (role === 'passenger') {
        // One more read than the production per-user budget of 200 a minute:
        // proves the raised budgets apply, so scan payloads reach the handlers.
        // Batches of 10 keep the burst within what the emulators answer in time.
        const statuses = [];
        for (let sent = 0; sent < 201; sent += 10) {
          statuses.push(...await Promise.all(Array.from({ length: Math.min(10, 201 - sent) }, () =>
            getJson(`http://127.0.0.1:${LOCAL_BACKEND_PORT}/api/buses`, { headers: { Authorization: authorization } })
              .then(result => result.status, () => 'error'))));
        }
        const byStatus = {};
        for (const status of statuses) byStatus[status] = (byStatus[status] ?? 0) + 1;
        report.admissionCheck = { reads: statuses.length, byStatus };
        if (byStatus[200] !== statuses.length) throw new Error(`Admission check: ${JSON.stringify(report.admissionCheck)}`);
      }
      const alerts = await scanRole(role, authorization, LOCAL_PATH_VALUES);
      await assertCredentialAfterScan(role, authorization, `http://127.0.0.1:${LOCAL_BACKEND_PORT}`);
      return alerts;
    }));
  }
  return alerts;
}

// A scan that revoked or exhausted its own credential would finish the rest of
// its rules unauthenticated, and its alerts would describe 401 responses.
const credentialProbes = { passenger: '/api/buses', admin: '/api/health', device: '/api/devices/qa_device/firmware?sequence=1' };
async function assertCredentialAfterScan(role, authorization, origin) {
  if (!authorization) return;
  const { status } = await getJson(`${origin}${credentialProbes[role]}`, { headers: { Authorization: authorization } });
  report.roles.find(entry => entry.role === role).credentialStatusAfterScan = status;
  if (status === 401 || status === 403) throw new Error(`The ${role} credential was rejected after its scan (HTTP ${status}); its results are not authenticated coverage`);
}

// ---- staging profile: the approved Cloud Run origin ----------------------

async function readRelease(adminToken) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const { status, body } = await getJson(`${STAGING_ORIGIN}/api/health`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (status === 200 && body?.release) {
      return { sourceSha: canonicalText(body.release.sourceSha, HEX_DIGITS, 40),
        service: canonicalText(body.release.service, CLOUD_RUN_NAME_CHARACTERS, 63),
        revision: canonicalText(body.release.revision, CLOUD_RUN_NAME_CHARACTERS, 63) };
    }
    // A cold instance answers 503 until its first Firestore and RTDB probes succeed.
    if (![502, 503, 504].includes(status) || Date.now() > deadline) throw new Error(`Admin health read failed with HTTP ${status}`);
    await new Promise(done => setTimeout(done, 5_000));
  }
}

async function runStaging() {
  const run = assertStagingRun(process.env);
  secrets.push(run.tokens.passenger, run.tokens.admin);
  if (dryRun) {
    for (const role of profile.roles) await scanRole(role, null, run.pathValues);
    return [];
  }
  if (report.dirty) throw new Error('A staging scan needs a clean checkout so the evidence names the harness commit');
  const before = await readRelease(run.tokens.admin);
  report.release = { expectedRevision: run.revision, before, after: null };
  if (before.revision !== run.revision) throw new Error(`Staging serves ${before.revision}, not ${run.revision}`);
  const alerts = [];
  for (const role of profile.roles) {
    const authorization = role === 'anonymous' ? null : `Bearer ${run.tokens[role]}`;
    alerts.push(...await scanRole(role, authorization, run.pathValues));
    await assertCredentialAfterScan(role, authorization, STAGING_ORIGIN);
  }
  report.release.after = await readRelease(run.tokens.admin);
  if (report.release.after.revision !== before.revision || report.release.after.sourceSha !== before.sourceSha) {
    report.verdict = 'REVISION_CHANGED';
  }
  return alerts;
}

// ---- evidence -------------------------------------------------------------

function markdown() {
  const lines = [`# DAST ${profileName} scan`, '',
    `Source ${report.sourceCommit}; dirty: ${report.dirty}; verdict: ${report.verdict}.`, '',
    `Target: ${report.target}. ZAP ${report.zapVersion ?? 'not run'} (${report.zapImage}).`, ''];
  if (report.release) {
    lines.push(`Serving revision: ${report.release.before?.revision} built from ${report.release.before?.sourceSha}; `
      + `after the scan: ${report.release.after?.revision ?? 'not read'}.`, '');
  }
  if (report.setupError) lines.push(`Setup: ${report.setupError}`, '');
  lines.push('| Role | Operations | Active scan cap (min) | Exit | Duration (s) | Alerts |', '|---|---|---|---|---|---|');
  for (const role of report.roles) {
    lines.push(`| ${role.role} | ${role.operations} | ${role.maxScanDurationInMins} | ${role.exitCode ?? '-'} | `
      + `${role.durationMs === undefined ? '-' : Math.round(role.durationMs / 1000)} | ${role.alerts ?? '-'} |`);
  }
  lines.push('', '| Risk | Alert | Name | Roles | Count | Disposition |', '|---|---|---|---|---|---|');
  for (const alert of report.alerts) {
    lines.push(`| ${alert.risk} | ${alert.alertRef} | ${alert.name} | ${alert.roles.join(', ')} | ${alert.count} | `
      + `${alert.triage?.disposition ?? (alert.untriaged ? 'UNTRIAGED' : 'informational')} |`);
  }
  if (!report.alerts.length) lines.push('| - | - | No alerts | - | - | - |');
  return lines.join('\n') + '\n';
}

try {
  const alerts = profileName === 'local' ? await runLocal() : await runStaging();
  const triaged = applyTriage(mergeAlerts(alerts), dastTriage, profileName);
  report.alerts = triaged.alerts;
  report.untriaged = triaged.untriaged;
  report.counts = riskCounts(triaged.alerts);
  if (dryRun) report.verdict = 'DRY_RUN';
  else if (report.verdict !== 'REVISION_CHANGED') report.verdict = triaged.untriaged ? 'UNTRIAGED_ALERTS' : 'NO_UNTRIAGED_ALERTS';
} catch (error) {
  report.setupError = redact(error.message, { secrets, limit: 500 });
}
report.finishedAt = new Date().toISOString();
writeFileSync(`${reportBase}.json`, JSON.stringify(report, null, 2) + '\n');
const summary = markdown();
writeFileSync(`${reportBase}.md`, summary);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
if (!['NO_UNTRIAGED_ALERTS', 'DRY_RUN'].includes(report.verdict)) process.exitCode = 1;
