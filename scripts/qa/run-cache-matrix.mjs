import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_EXTENSIONS, LIVE_BOUNDS, LIVE_ORIGINS, LOCAL_BOUNDS, USER_AGENT,
  buildPlan, compareSnapshots, createLimiter, decodeBody, evaluateMatrix, hostingConfig, observe,
  parseCacheMatrixArgs, requestHeaders, routesFromPageFiles, skippedObservation,
} from './cache-matrix.mjs';
import { createHostingReplay, listExport } from './hosting-replay.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';

/**
 * HTTP cache and CDN matrix for Firebase Hosting (qa/CACHE_MATRIX.md).
 *
 *   node scripts/qa/run-cache-matrix.mjs [--port 20520]         loopback replay of frontend/out
 *   node scripts/qa/run-cache-matrix.mjs --live [--origin <o>]   bounded read-only GETs to staging Hosting
 *   node scripts/qa/run-cache-matrix.mjs --compare <before.json> <after.json>
 */
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = parseCacheMatrixArgs(process.argv.slice(2));
const evidenceDirectory = resolve(root, 'artifacts/qa');
const reportBase = resolve(evidenceDirectory, `cache-matrix-${options.mode}-report`);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const firebaseText = readFileSync(resolve(root, 'firebase.json'), 'utf8');
const hosting = hostingConfig(JSON.parse(firebaseText));
const { dirty, ignoredChanges } = workingTreeState(root);
const report = {
  schemaVersion: 1, mode: options.mode, sourceCommit: git(['rev-parse', 'HEAD']), dirty, ignoredChanges,
  startedAt: new Date().toISOString(), finishedAt: null, node: process.version, platform: process.platform,
  firebaseJsonSha256: createHash('sha256').update(firebaseText.replace(/\r\n/g, '\n')).digest('hex'),
  target: null, bounds: null, userAgent: USER_AGENT, requestsSent: 0, plan: null,
  identity: null, rows: [], checks: [], observations: [], verdict: 'BLOCKED', setupError: null,
};

function send(url, headers, timeoutMs) {
  return new Promise((done, fail) => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: 'GET', headers }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) request.destroy(new Error(`${target.pathname}: body exceeds ${MAX_BODY_BYTES} bytes`));
        else chunks.push(chunk);
      });
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), at: new Date().toISOString() }));
      response.on('error', fail);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`${target.pathname}: no answer within ${timeoutMs} ms`)));
    request.on('error', fail);
    request.end();
  });
}

const relativeFiles = (directory, pattern) => existsSync(directory)
  ? readdirSync(directory, { recursive: true }).map(file => String(file).replaceAll('\\', '/')).filter(file => pattern.test(basename(file))).sort()
  : [];

async function matrix({ mode, origins, bounds, exportFiles = null }) {
  const limiter = createLimiter(bounds);
  const documents = routesFromPageFiles(relativeFiles(resolve(root, 'frontend/src/app'), /^page\.(tsx|ts|jsx|js|mdx)$/));
  const publicImages = relativeFiles(resolve(root, 'frontend/public'), IMAGE_EXTENSIONS).map(file => `/${file}`);
  const fetchProbe = async (probe, validators) => {
    const origin = origins[probe.origin];
    if (!origin) throw new Error(`no origin for ${probe.origin}`);
    await limiter.take();
    report.requestsSent = limiter.sent;
    return send(`${origin}${probe.path}`, requestHeaders(probe, validators), bounds.timeoutMs);
  };
  // The first GET of / discovers the assets; it is also the plain observation of /.
  const rootProbe = { origin: 'primary', variant: 'plain', path: '/' };
  const rootResponse = await fetchProbe(rootProbe);
  if (rootResponse.status !== 200) throw new Error(`GET / answered ${rootResponse.status}`);
  const html = decodeBody(rootResponse.body, rootResponse.headers['content-encoding']).toString('utf8');
  const plan = buildPlan({ hosting, documents, html, publicImages, live: mode === 'live' });
  if (plan.probes.length > bounds.maxRequests) throw new Error(`the plan needs ${plan.probes.length} requests; the bound is ${bounds.maxRequests}`);
  report.plan = { requests: plan.probes.length, documents, paths: plan.paths };
  const classOf = path => plan.paths.find(entry => entry.path === path)?.class ?? 'other';
  const observations = [observe(rootProbe, rootResponse, 'document')];
  report.observations = observations;
  for (const probe of plan.probes) {
    if (probe.origin === 'primary' && probe.variant === 'plain' && probe.path === '/') continue;
    let validators = {};
    if (['if-none-match', 'if-modified-since'].includes(probe.variant)) {
      const base = observations.find(entry => entry.origin === 'primary' && entry.variant === 'plain' && entry.path === probe.path);
      const name = probe.variant === 'if-none-match' ? 'etag' : 'last-modified';
      if (!base?.headers[name]) {
        observations.push(skippedObservation(probe, classOf(probe.path), `no ${name} served`));
        continue;
      }
      validators = { etag: base.headers.etag, lastModified: base.headers['last-modified'] };
    }
    observations.push(observe(probe, await fetchProbe(probe, validators), classOf(probe.path)));
  }
  Object.assign(report, evaluateMatrix({ mode, hosting, plan, observations, documents, exportFiles }));
}

async function runLocal() {
  const publicDir = resolve(root, hosting.public);
  if (!existsSync(join(publicDir, 'index.html'))) {
    throw new Error(`${hosting.public}/index.html is missing: build the export first (npm run build:production or npm run build)`);
  }
  const files = await listExport(publicDir);
  const server = createHostingReplay({ hosting, publicDir, files });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(options.port, '127.0.0.1', done); });
  report.target = `loopback replay of ${hosting.public} (${files.size} files) on 127.0.0.1:${options.port}`;
  report.bounds = LOCAL_BOUNDS;
  try {
    await matrix({ mode: 'local', origins: { primary: `http://127.0.0.1:${options.port}` }, bounds: LOCAL_BOUNDS, exportFiles: files });
  } finally {
    server.closeAllConnections?.();
    await new Promise(done => server.close(done));
  }
}

async function runLive() {
  const alias = LIVE_ORIGINS.find(origin => origin !== options.origin);
  report.target = { primary: options.origin, alias };
  report.bounds = LIVE_BOUNDS;
  await matrix({ mode: 'live', origins: { primary: options.origin, alias }, bounds: LIVE_BOUNDS });
}

function runCompare() {
  const [before, after] = options.compare.map(file => JSON.parse(readFileSync(resolve(file), 'utf8')));
  for (const snapshot of [before, after]) if (snapshot.mode !== 'live') throw new Error('--compare needs two live reports');
  report.target = { before: { startedAt: before.startedAt, sourceCommit: before.sourceCommit }, after: { startedAt: after.startedAt, sourceCommit: after.sourceCommit } };
  const result = compareSnapshots(before, after);
  Object.assign(report, { identity: { before: result.before, after: result.after }, checks: result.checks, verdict: result.verdict });
}

const cell = value => String(value ?? '').replaceAll('|', '\\|');
const short = value => (value ? String(value).slice(0, 12) : '');

function markdown() {
  const lines = [`# Cache matrix: ${report.mode}`, '', '| Item | Value |', '|---|---|',
    `| Verdict | ${report.verdict}${report.setupError ? `: ${cell(report.setupError)}` : ''} |`,
    `| Source commit | \`${report.sourceCommit}\`, dirty: ${describeDirty(report)} |`,
    `| Target | ${cell(typeof report.target === 'string' ? report.target : JSON.stringify(report.target))} |`,
    `| Started, finished (UTC) | ${report.startedAt}, ${report.finishedAt} |`];
  if (report.mode !== 'compare') {
    lines.push(`| Requests | ${report.requestsSent} sent of ${report.plan?.requests ?? 0} planned; bound ${report.bounds?.maxRequests}, at least ${report.bounds?.minDelayMs} ms apart |`,
      `| User-Agent | \`${report.userAgent}\` |`,
      `| firebase.json SHA-256 | \`${short(report.firebaseJsonSha256)}\` |`);
    if (report.identity) {
      lines.push(`| Build ID of / | \`${report.identity.buildId}\` |`, `| sw.js SHA-256 | \`${report.identity.swSha256}\` |`,
        `| / ETag, Last-Modified | ${cell(report.identity.rootEtag) || 'none'}, ${cell(report.identity.rootLastModified) || 'none'} |`,
        `| X-Served-By | ${cell(report.identity.pops.join(', ')) || 'none'} |`);
    }
    lines.push('', '## Matrix', '', '| Path | Class | Status | Cache-Control | Expected (from) | Age 1, 2 | X-Cache 1, 2 | ETag | Result |', '|---|---|---|---|---|---|---|---|---|');
    for (const row of report.rows) {
      const expected = row.class === 'redirect' ? `${row.expectedStatus} to ${row.expectedLocation}` : `${row.expectedCacheControl ?? 'none'} (${row.cacheControlFrom})`;
      lines.push(`| \`${cell(row.path)}\` | ${row.class} | ${row.status ?? ''} | ${cell(row.cacheControl)} | ${cell(expected)} | ${cell(row.age.join(', '))} | ${cell(row.xCache.join(', '))} | ${cell(row.etag)} | ${row.result} |`);
    }
  } else if (report.identity) {
    lines.push(`| Build ID | \`${report.identity.before?.buildId}\` to \`${report.identity.after?.buildId}\` |`,
      `| sw.js SHA-256 | \`${short(report.identity.before?.swSha256)}\` to \`${short(report.identity.after?.swSha256)}\` |`,
      `| Last-Modified of / | ${cell(report.identity.before?.rootLastModified)} to ${cell(report.identity.after?.rootLastModified)} |`);
  }
  lines.push('', '## Checks', '', '| Check | Status | Detail |', '|---|---|---|');
  for (const entry of report.checks) lines.push(`| ${entry.name} | ${entry.status} | ${cell(entry.detail)} |`);
  const notes = report.checks.flatMap(entry => [...entry.failures.map(text => `- FAIL ${entry.name}: ${text}`), ...entry.warnings.map(text => `- WARN ${entry.name}: ${text}`)]);
  if (notes.length) lines.push('', '## Failures and findings', '', ...notes);
  return `${lines.join('\n')}\n`;
}

try {
  if (options.mode === 'local') await runLocal();
  else if (options.mode === 'live') await runLive();
  else runCompare();
} catch (error) {
  report.verdict = 'BLOCKED';
  report.setupError = error instanceof Error ? error.message : String(error);
}
report.finishedAt = new Date().toISOString();
mkdirSync(evidenceDirectory, { recursive: true });
writeFileSync(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(`${reportBase}.md`, markdown());
console.log(`${report.mode} cache matrix: ${report.verdict}${report.setupError ? ` (${report.setupError})` : ''}; ${reportBase}.md`);
// WARN exits 0: no check failed, and the report lists every finding.
process.exitCode = ['PASS', 'WARN', 'INVALIDATED'].includes(report.verdict) ? 0 : 1;
