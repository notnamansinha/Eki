import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { repositoryRoot } from './acceptance-catalog.mjs';
import { describeDirty, workingTreeState } from './working-tree.mjs';
import { inlineScriptHashes } from '../inline-script-hashes.mjs';
import {
  LIVE_ORIGIN, PUBLIC_ROUTES, configuredNoticeUrl, cspHostSources, declaredVendors, evaluateDisclosure, unobservedVendors, vendorForCspHost,
} from './privacy-vendors.mjs';

/**
 * Loads every public route without signing in and records each request host
 * (qa/PRIVACY_VERIFICATION.md, Section 5).
 *
 *   node scripts/qa/run-privacy-hosts.mjs --local   the built static export on
 *                                                   127.0.0.1; every other host
 *                                                   is recorded and blocked
 *   node scripts/qa/run-privacy-hosts.mjs --live    the public staging site; no
 *                                                   sign-in, no input, no clicks
 *   add `--notice <file>` to compare with a saved copy of the published notice
 */
const args = process.argv.slice(2);
const target = args[0] === '--live' ? 'live' : args[0] === '--local' ? 'local' : null;
const noticeIndex = args.indexOf('--notice');
if (!target || (noticeIndex !== -1 && noticeIndex !== 1) || args.length !== (noticeIndex === -1 ? 1 : 3)) {
  throw new Error('Usage: node scripts/qa/run-privacy-hosts.mjs --local|--live [--notice <file>]');
}
const port = Number(process.env.EKI_PRIVACY_HOSTS_PORT || 24524);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('EKI_PRIVACY_HOSTS_PORT must be a port number');
const evidenceDirectory = resolve(repositoryRoot, 'artifacts/qa');
mkdirSync(evidenceDirectory, { recursive: true });
const reportBase = resolve(evidenceDirectory, `privacy-hosts-${target}`);
const git = gitArgs => execFileSync('git', gitArgs, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const loopback = host => ['127.0.0.1', '[::1]', 'localhost'].includes(host.replace(/:\d+$/, ''));

const configuredUrl = configuredNoticeUrl(readFileSync(resolve(repositoryRoot, 'frontend/src/config/university.ts'), 'utf8'));
const noticeFile = noticeIndex === -1 ? null : resolve(args[2]);
const noticeText = noticeFile ? readFileSync(noticeFile, 'utf8') : '';
const report = {
  schemaVersion: 1, target, sourceCommit: git(['rev-parse', 'HEAD']),
  ...workingTreeState(repositoryRoot),
  startedAt: new Date().toISOString(), finishedAt: null, node: process.version, platform: process.platform,
  browser: null, origin: target === 'live' ? LIVE_ORIGIN : `http://127.0.0.1:${port}`,
  notice: { configuredUrl, published: configuredUrl !== '', file: noticeFile ? 'provided' : null,
    sha256: noticeFile ? createHash('sha256').update(noticeText).digest('hex') : null, declared: declaredVendors(noticeText) },
  routes: [], hosts: {}, cookies: [], storage: null, csp: null, release: null, permitted: null, permittedUndeclared: [], permittedUnobserved: [],
  evaluation: null, verdict: 'BLOCKED', setupError: null,
};
const storageKinds = ['localStorage', 'sessionStorage', 'indexedDB'];

// ---- local static server ---------------------------------------------------

const outDirectory = resolve(repositoryRoot, 'frontend/out');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? htmlFiles(join(directory, entry.name))
    : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []))).flat();
}

/**
 * Serve frontend/out the way Hosting does: clean URLs and the global headers
 * of the committed firebase.json. The build rewrites the inline-script hashes
 * in firebase.json; this server computes them from the export in memory, so
 * the run needs no modified tracked file.
 */
async function startLocalServer() {
  if (!existsSync(join(outDirectory, 'index.html'))) throw new Error('frontend/out is missing: run `npm run build` first');
  const hosting = JSON.parse(readFileSync(resolve(repositoryRoot, 'firebase.json'), 'utf8')).hosting;
  const headers = Object.fromEntries((hosting.headers.find(rule => rule.source === '**')?.headers ?? []).map(({ key, value }) => [key, value]));
  delete headers['Strict-Transport-Security'];
  const hashes = new Set();
  for (const file of await htmlFiles(outDirectory)) for (const hash of inlineScriptHashes(await readFile(file, 'utf8'))) hashes.add(hash);
  headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/(^|;\s*)script-src ([^;]*)/, (_match, prefix, sources) =>
    `${prefix}script-src ${['\'self\'', ...[...hashes].sort(), ...sources.split(/\s+/).filter(source => source && source !== '\'self\'' && !source.startsWith('\'sha256-'))].join(' ')}`);
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const clean = normalize(pathname).replace(/^([/\\])+/, '');
    let file = null;
    for (const candidate of clean === '' || clean === '.' ? ['index.html'] : [clean, `${clean}.html`, join(clean, 'index.html')]) {
      const path = join(outDirectory, candidate);
      if (!path.startsWith(outDirectory)) break;
      try { if ((await stat(path)).isFile()) { file = path; break; } } catch { /* next candidate */ }
    }
    const served = file ?? join(outDirectory, '404.html');
    const body = await readFile(served);
    response.writeHead(file ? 200 : 404, { ...headers, 'Content-Type': types[extname(served)] ?? 'application/octet-stream' });
    response.end(body);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  report.csp = { source: 'firebase.json (committed) with the export\'s inline-script hashes', value: headers['Content-Security-Policy'] };
  return server;
}

// ---- page loads ------------------------------------------------------------

function record(host, entry) {
  report.hosts[host] ??= { requests: 0, methods: [], types: [], blocked: 0, routes: [] };
  const item = report.hosts[host];
  item.requests += 1;
  for (const [key, value] of [['methods', entry.method], ['types', entry.type], ['routes', entry.route]]) {
    if (!item[key].includes(value)) item[key].push(value);
  }
  if (entry.blocked) item.blocked += 1;
}

async function loadRoutes(origin) {
  const browser = await chromium.launch();
  report.browser = `Chromium ${browser.version()}`;
  try {
    // Local: block service workers, so every request is a page request. Live: a
    // visitor's browser registers the worker, so the run does too.
    const context = await browser.newContext({ serviceWorkers: target === 'local' ? 'block' : 'allow', viewport: { width: 1280, height: 800 } });
    let current = '';
    context.on('request', request => {
      const url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return;
      record(url.host, { method: request.method(), type: request.resourceType(), route: current, blocked: target === 'local' && !loopback(url.host) });
    });
    if (target === 'local') {
      // Recorded above, then refused: the local run sends nothing off the machine.
      await context.route('**/*', route => loopback(new URL(route.request().url()).host) ? route.continue() : route.abort('blockedbyclient'));
      await context.routeWebSocket(/.*/, socket => { record(new URL(socket.url()).host, { method: 'WEBSOCKET', type: 'websocket', route: current, blocked: true }); socket.close(); });
    }
    for (const route of PUBLIC_ROUTES) {
      current = route;
      const page = await context.newPage();
      if (target === 'live') page.on('websocket', socket => record(new URL(socket.url()).host, { method: 'WEBSOCKET', type: 'websocket', route, blocked: false }));
      const entry = { route, status: null, finalPath: null, title: null, storage: null, error: null };
      try {
        const response = await page.goto(`${origin}${route}`, { waitUntil: 'load', timeout: 45_000 });
        entry.status = response?.status() ?? null;
        if (route === '/' && target === 'live') {
          const headers = (await response?.allHeaders()) ?? {};
          report.csp = { source: 'response header of / on the live site', value: headers['content-security-policy'] ?? null };
          // Hosting sets Last-Modified to the release time, which names the Deploy run that published it.
          report.release = { lastModified: headers['last-modified'] ?? null, etag: headers.etag ?? null };
        }
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(2_000);
        entry.finalPath = new URL(page.url()).pathname;
        entry.title = (await page.title()).slice(0, 120);
        // Key and database names only, never values: what the page stored for a visitor without a session.
        entry.storage = await page.evaluate(async () => ({
          localStorage: Object.keys(localStorage).sort(), sessionStorage: Object.keys(sessionStorage).sort(),
          indexedDB: ((await indexedDB.databases?.()) ?? []).map(database => database.name).sort(),
        }));
      } catch (error) {
        entry.error = String(error.message).split('\n')[0].slice(0, 200);
      }
      report.routes.push(entry);
      await page.close();
    }
    report.cookies = (await context.cookies()).map(cookie => ({ domain: cookie.domain, name: cookie.name, sameSite: cookie.sameSite }));
    report.storage = Object.fromEntries(storageKinds.map(kind =>
      [kind, [...new Set(report.routes.flatMap(item => item.storage?.[kind] ?? []))].sort()]));
    await context.close();
  } finally {
    await browser.close();
  }
}

function permittedVendors(cspValue) {
  if (!cspValue) return null;
  const sources = cspHostSources(cspValue);
  const hosts = [...new Set(Object.values(sources).flat())].sort();
  return hosts.map(host => ({ host, directives: Object.keys(sources).filter(name => sources[name].includes(host)),
    vendor: vendorForCspHost(host)?.id ?? null }));
}

function markdown() {
  const lines = [`# Privacy host check: ${target}`, '',
    `Source ${report.sourceCommit}; dirty: ${describeDirty(report)}; verdict: ${report.verdict}.`, '',
    `Origin: ${report.origin}. ${report.browser ?? 'Browser not started'}. Started ${report.startedAt}, finished ${report.finishedAt}.`, '',
    `Privacy notice: ${report.notice.published ? `configured at ${report.notice.configuredUrl}` : 'not published (UNIVERSITY_LINKS privacy notice URL is empty)'}; `
      + `notice file: ${report.notice.file ?? 'none'}; declared vendors: ${report.notice.declared.join(', ') || 'none'}.`, '',
    `Coverage: ${PUBLIC_ROUTES.length} public routes without a session. Vendors the Content-Security-Policy permits that no page loaded, `
      + `so this run says nothing about them: ${report.permitted ? report.permittedUnobserved.join(', ') || 'none' : 'not computed'}.`, ''];
  if (report.release) lines.push(`Release headers of /: Last-Modified ${report.release.lastModified ?? 'none'}, ETag ${report.release.etag ?? 'none'}.`, '');
  if (report.setupError) lines.push(`Setup: ${report.setupError}`, '');
  lines.push('| Route | Status | Final path | Error |', '|---|---|---|---|');
  for (const route of report.routes) lines.push(`| ${route.route} | ${route.status ?? '-'} | ${route.finalPath ?? '-'} | ${route.error ?? ''} |`);
  lines.push('', '| Host | Vendor | Requests | Methods | Types | Blocked | Routes |', '|---|---|---|---|---|---|---|');
  for (const [host, item] of Object.entries(report.hosts).sort()) {
    const vendor = report.evaluation?.vendors.find(entry => entry.hosts.includes(host))?.id ?? (loopback(host) ? 'local' : 'UNMAPPED');
    lines.push(`| ${host} | ${vendor} | ${item.requests} | ${item.methods.join(', ')} | ${item.types.join(', ')} | ${item.blocked} | ${item.routes.join(' ')} |`);
  }
  if (report.evaluation) {
    lines.push('', `Undeclared vendors: ${report.evaluation.undeclared.join(', ') || 'none'}. Unmapped hosts: ${report.evaluation.unmapped.join(', ') || 'none'}.`);
    if (report.evaluation.warnings.length) lines.push('', `Warnings: ${report.evaluation.warnings.join('; ')}.`);
  }
  if (report.permitted) {
    lines.push('', 'Hosts the Content-Security-Policy permits (the vendors a signed-in session can reach):', '',
      '| CSP host | Directives | Vendor |', '|---|---|---|');
    for (const item of report.permitted) lines.push(`| ${item.host} | ${item.directives.join(', ')} | ${item.vendor ?? 'UNMAPPED'} |`);
    lines.push('', `Permitted vendors the notice does not declare: ${report.permittedUndeclared.join(', ') || 'none'}.`);
  }
  lines.push('', `Cookies after the run: ${report.cookies.length ? report.cookies.map(cookie => `${cookie.domain} ${cookie.name}`).join(', ') : 'none'}.`);
  if (report.storage) {
    lines.push('', `Browser storage after the run (names only): ${storageKinds.map(kind => `${kind} ${report.storage[kind].join(', ') || 'none'}`).join('; ')}.`);
  }
  return lines.join('\n') + '\n';
}

let server = null;
try {
  if (target === 'local') server = await startLocalServer();
  await loadRoutes(report.origin);
  if (!report.routes.some(route => route.status === 200)) throw new Error('No public route loaded');
  const observedHosts = Object.keys(report.hosts).filter(host => !loopback(host));
  report.evaluation = evaluateDisclosure({ observedHosts, declared: report.notice.declared, noticeAvailable: Boolean(noticeFile) });
  report.permitted = permittedVendors(report.csp?.value);
  report.permittedUndeclared = [...new Set((report.permitted ?? []).map(item => item.vendor)
    .filter(vendor => vendor && !report.notice.declared.includes(vendor)))].sort();
  report.permittedUnobserved = unobservedVendors(report.permitted, report.evaluation.vendors.map(vendor => vendor.id));
  report.verdict = report.evaluation.verdict;
  if (report.permitted?.some(item => !item.vendor) && report.verdict === 'DISCLOSED') report.verdict = 'UNMAPPED_HOSTS';
} catch (error) {
  report.setupError = String(error.message).split('\n')[0].slice(0, 300);
} finally {
  server?.close();
}
report.finishedAt = new Date().toISOString();
writeFileSync(`${reportBase}.json`, JSON.stringify(report, null, 2) + '\n');
const summary = markdown();
writeFileSync(`${reportBase}.md`, summary);
console.log(summary);
if (report.verdict !== 'DISCLOSED') process.exitCode = 1;
