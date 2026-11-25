import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

/**
 * HTTP cache and CDN matrix for Firebase Hosting (qa/CACHE_MATRIX.md, issue #520).
 *
 * Every expectation comes from the `hosting` block of firebase.json: header
 * rules, redirects, rewrites, cleanUrls and trailingSlash. This module holds
 * the pure parts (derivation, routing, planning, evaluation and the
 * before/after comparison); scripts/qa/run-cache-matrix.mjs does the I/O.
 */

export const LIVE_ORIGINS = Object.freeze(['https://bustrack-be165.web.app', 'https://bustrack-be165.firebaseapp.com']);
export const LIVE_BOUNDS = Object.freeze({ maxRequests: 80, minDelayMs: 300, timeoutMs: 15_000 });
export const LOCAL_BOUNDS = Object.freeze({ maxRequests: 200, minDelayMs: 0, timeoutMs: 15_000 });
export const LOCAL_PORT = 20520;
export const USER_AGENT = 'Eki-QA-cache-matrix/1.0 (read-only GET; issue 520)';
// Firebase documents a one-hour browser cache for static files that no header rule covers.
export const HOSTING_DEFAULT_CACHE_CONTROL = 'max-age=3600';
export const NOT_FOUND_PATH = '/eki-cache-matrix-no-such-page';
export const DUMMY_CREDENTIALS = Object.freeze({
  authorization: 'Bearer eki-cache-matrix-dummy', cookie: '__session=eki-cache-matrix-dummy',
});
export const LIVE_ONLY_CHECKS = Object.freeze(['conditional', 'range', 'compression', 'cdn-cache', 'alias']);
/**
 * What the `image` class covers. Like the class requirements, this is the
 * harness's own definition, not a copy of the firebase.json image rule. It is
 * deliberately wider than that rule (`gif`, `avif`): an image the rule misses
 * gets the Hosting default, which lacks `public`, and is reported.
 */
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|svg|ico|gif|avif)$/i;

// ---------------------------------------------------------------- firebase.json

const withSlash = source => (source.startsWith('/') ? source : `/${source}`);
const ruleName = rule => rule.source ?? `regex:${rule.regex}`;

/** Hosting matches `source` as a glob with extglob, or `regex`, against the request path. */
export function ruleMatches(rule, pathname) {
  if (typeof rule.source === 'string') return posix.matchesGlob(pathname, withSlash(rule.source));
  if (typeof rule.regex === 'string') return new RegExp(`^(?:${rule.regex})$`).test(pathname);
  return false;
}

export function hostingConfig(firebase) {
  const hosting = firebase?.hosting;
  if (!hosting || Array.isArray(hosting)) throw new Error('firebase.json must configure exactly one hosting site');
  return {
    public: hosting.public, cleanUrls: hosting.cleanUrls === true, trailingSlash: hosting.trailingSlash,
    headers: hosting.headers ?? [], redirects: hosting.redirects ?? [], rewrites: hosting.rewrites ?? [],
  };
}

/**
 * The headers Hosting should send for a path. Rules apply in file order, so a
 * later rule replaces an earlier rule's value for the same key. The custom 404
 * page is matched against `404.html` first and then against the requested path.
 * Without a configured Cache-Control a 200 gets Hosting's one-hour default; a
 * 404 without one gets a CDN default this harness does not model.
 */
export function expectedHeaders(hosting, pathname, { notFound = false } = {}) {
  const headers = new Map();
  const sources = [];
  for (const target of notFound ? ['/404.html', pathname] : [pathname]) {
    for (const rule of hosting.headers) {
      if (!ruleMatches(rule, target)) continue;
      sources.push(ruleName(rule));
      for (const { key, value } of rule.headers ?? []) headers.set(key.toLowerCase(), value);
    }
  }
  const configured = headers.get('cache-control') ?? null;
  return {
    headers, sources: [...new Set(sources)],
    cacheControl: configured ?? (notFound ? null : HOSTING_DEFAULT_CACHE_CONTROL),
    cacheControlFrom: configured ? 'firebase.json' : notFound ? 'unmodelled' : 'hosting-default',
  };
}

const safeLocation = location => location.replace(/^\/+/, '/');

/**
 * How Hosting answers a path, in its documented priority order: reserved
 * `/__/` paths, redirects, exact static content (with cleanUrls and
 * trailingSlash), rewrites, then the custom 404 page.
 */
export function routeRequest(hosting, pathname, hasFile) {
  if (pathname.startsWith('/__/')) return { kind: 'reserved' };
  for (const rule of hosting.redirects) {
    if (ruleMatches(rule, pathname)) return { kind: 'redirect', status: rule.type ?? 301, location: rule.destination };
  }
  if (hosting.cleanUrls && pathname.endsWith('.html') && hasFile(pathname)) {
    return { kind: 'redirect', status: 301, location: safeLocation(pathname.replace(/(\/?index)?\.html$/, '') || '/') };
  }
  if (hosting.trailingSlash === false && pathname.length > 1 && pathname.endsWith('/')) {
    return { kind: 'redirect', status: 301, location: safeLocation(pathname.replace(/\/+$/, '') || '/') };
  }
  const candidates = pathname === '/' ? ['/index.html']
    : [pathname, ...(hosting.cleanUrls ? [`${pathname}.html`] : []), `${pathname}/index.html`];
  const file = candidates.find(candidate => hasFile(candidate));
  if (file) return { kind: 'file', status: 200, file };
  for (const rule of hosting.rewrites) {
    if (!ruleMatches(rule, pathname)) continue;
    if (typeof rule.destination === 'string' && hasFile(rule.destination)) {
      return { kind: 'file', status: 200, file: rule.destination, rewrite: ruleName(rule) };
    }
    if (typeof rule.destination !== 'string') return { kind: 'backend', rewrite: ruleName(rule) };
  }
  return { kind: 'not-found', status: 404, file: hasFile('/404.html') ? '/404.html' : null };
}

/** Rewrites and redirects that would make a document path depend on more than the static release. */
export function dynamicRulesFor(hosting, pathname) {
  return [
    ...hosting.redirects.filter(rule => ruleMatches(rule, pathname)).map(rule => `redirect ${ruleName(rule)}`),
    ...hosting.rewrites.filter(rule => typeof rule.destination !== 'string' && ruleMatches(rule, pathname))
      .map(rule => `rewrite ${ruleName(rule)} to a backend`),
  ];
}

// ------------------------------------------------------------- cache policy

export function cacheDirectives(value) {
  const directives = new Map();
  for (const part of String(value ?? '').split(',')) {
    const [name, ...rest] = part.trim().toLowerCase().split('=');
    if (name) directives.set(name.trim(), rest.length ? rest.join('=').trim().replace(/^"|"$/g, '') : true);
  }
  return directives;
}

const sameDirectives = (left, right) => {
  const a = cacheDirectives(left), b = cacheDirectives(right);
  return a.size === b.size && [...a].every(([name, value]) => b.get(name) === value);
};
const storable = value => {
  const directives = cacheDirectives(value);
  return !directives.has('no-store') && !directives.has('private');
};

/**
 * What each class must satisfy, independent of firebase.json. A `fail`
 * problem fails the run; a `warn` problem is reported as a finding.
 */
export const CLASS_POLICY = Object.freeze({
  document: { severity: 'fail', needs: ['no-store'], why: 'the HTML names the chunks of one build' },
  'not-found': { severity: 'fail', needs: ['no-store'], status: 404, why: 'a cached 404 hides a page the next release adds' },
  'service-worker': { severity: 'fail', needs: ['no-store'], headers: { 'service-worker-allowed': '/' },
    why: 'the browser must see a new worker after each release' },
  'next-static': { severity: 'fail', needs: ['public', 'immutable'], minMaxAge: 31_536_000,
    why: 'fingerprinted files never change under one URL' },
  image: { severity: 'fail', needs: ['public'], minMaxAge: 1, why: 'images may be shared from the CDN' },
  'internal-document': { severity: 'warn', needs: ['no-store'], why: 'the HTML names the chunks of one build' },
});

export function policyProblems(pathClass, cacheControl, headers = {}) {
  const policy = CLASS_POLICY[pathClass];
  if (!policy) return [];
  const directives = cacheDirectives(cacheControl);
  const problems = policy.needs.filter(name => !directives.has(name)).map(name => `Cache-Control lacks ${name}`);
  if (policy.minMaxAge && !(Number(directives.get('max-age')) >= policy.minMaxAge)) {
    problems.push(`Cache-Control max-age is below ${policy.minMaxAge}`);
  }
  for (const [key, value] of Object.entries(policy.headers ?? {})) {
    if (headers[key] !== value) problems.push(`${key} is ${headers[key] === undefined ? 'missing' : `"${headers[key]}"`}, not "${value}"`);
  }
  return problems;
}

// ------------------------------------------------------------- discovery

/** Next.js App Router page files to the routes the static export serves. */
export function routesFromPageFiles(pageFiles) {
  const routes = [];
  for (const file of pageFiles) {
    const segments = file.replaceAll('\\', '/').split('/').slice(0, -1);
    if (segments.some(segment => /^[[_@]/.test(segment))) continue;
    routes.push(`/${segments.filter(segment => !/^\(.*\)$/.test(segment)).join('/')}`);
  }
  return [...new Set(routes)].sort();
}

/** Same-origin assets that a document references. Only paths, never other origins. */
export function discoverAssets(html) {
  const statics = [...new Set(html.match(/\/_next\/static\/[A-Za-z0-9._~\-/]+/g) ?? [])];
  const images = [...html.matchAll(/(?:href|src)="(\/[A-Za-z0-9._~\-/]+)(?:\?[^"]*)?"/g)]
    .map(match => match[1]).filter(path => IMAGE_EXTENSIONS.test(path) && !path.startsWith('/_next/'));
  return {
    js: statics.find(path => path.endsWith('.js')) ?? null,
    css: statics.find(path => path.endsWith('.css')) ?? null,
    font: statics.find(path => path.endsWith('.woff2')) ?? null,
    images: [...new Set(images)],
    manifest: /<link[^>]*rel="manifest"[^>]*href="(\/[A-Za-z0-9._~\-/]+)"/.exec(html)?.[1] ?? null,
  };
}

/**
 * The build ID of an exported page. Next.js 16 writes it into the flight data
 * as `"b":"<id>"`; older exports also name `/_next/static/<id>/_buildManifest.js`.
 */
export function extractBuildId(html) {
  const fromPath = /\/_next\/static\/([A-Za-z0-9_-]{8,64})\/_(?:buildManifest|ssgManifest)\.js/.exec(html)?.[1];
  return fromPath ?? /\\?"b\\?"\s*:\s*\\?"([A-Za-z0-9_-]{8,64})\\?"/.exec(html)?.[1] ?? null;
}

/** One image per extension: those a document references first, then the public folder. */
export function imageSample(referenced, publicImages) {
  const byExtension = new Map();
  for (const path of [...referenced, ...publicImages]) {
    const extension = IMAGE_EXTENSIONS.exec(path)?.[1].toLowerCase().replace('jpeg', 'jpg');
    if (extension && !byExtension.has(extension)) byExtension.set(extension, path);
  }
  return [...byExtension.values()];
}

/** Every exported file, classified by the request path Hosting serves it at. */
export function classifyPath(pathname, documents) {
  if (documents.includes(pathname)) return 'document';
  if (pathname === '/sw.js') return 'service-worker';
  if (pathname.endsWith('.webmanifest')) return 'manifest';
  if (pathname === '/robots.txt') return 'robots';
  if (pathname === '/sitemap.xml') return 'sitemap';
  if (pathname.startsWith('/_next/static/')) return 'next-static';
  if (IMAGE_EXTENSIONS.test(pathname)) return 'image';
  if (pathname.endsWith('.html')) return 'internal-document';
  if (pathname.endsWith('.txt')) return 'rsc-payload';
  return 'other';
}

export function servedPath(hosting, file) {
  if (!hosting.cleanUrls || !file.endsWith('.html')) return file;
  return file.replace(/(\/?index)?\.html$/, '') || '/';
}

// ------------------------------------------------------------------ plan

/**
 * Paths and requests for one run. Local runs send only the requests a
 * loopback replay can answer meaningfully; live runs add the CDN probes.
 */
export function buildPlan({ hosting, documents, html, publicImages = [], live = false }) {
  const assets = discoverAssets(html);
  const paths = [];
  const add = (path, pathClass, extra = {}) => {
    if (path && !paths.some(entry => entry.path === path)) paths.push({ path, class: pathClass, ...extra });
  };
  for (const route of documents) add(route, 'document');
  for (const path of [assets.js, assets.css, assets.font]) add(path, 'next-static');
  for (const path of imageSample(assets.images, publicImages)) add(path, 'image');
  add('/sw.js', 'service-worker');
  add(assets.manifest ?? '/manifest.webmanifest', 'manifest');
  add('/robots.txt', 'robots');
  add('/sitemap.xml', 'sitemap');
  add('/index.txt', 'rsc-payload');
  add('/404', 'internal-document');
  add('/_not-found', 'internal-document');
  add(NOT_FOUND_PATH, 'not-found');
  const page = documents.find(route => route !== '/') ?? null;
  const redirects = [];
  if (page && hosting.cleanUrls) redirects.push({ path: `${page}.html`, class: 'redirect', location: page });
  if (page && hosting.trailingSlash === false) redirects.push({ path: `${page}/`, class: 'redirect', location: page });
  for (const rule of hosting.redirects) {
    // Only literal sources can be requested without guessing a match.
    if (typeof rule.source === 'string' && !/[*?{}()[\]!@+:]/.test(rule.source)) {
      redirects.push({ path: withSlash(rule.source), class: 'redirect', location: rule.destination, status: rule.type ?? 301 });
    }
  }
  const content = paths.map(entry => entry.path);
  const probes = [
    ...content.map(path => ({ origin: 'primary', variant: 'plain', path })),
    ...redirects.map(({ path }) => ({ origin: 'primary', variant: 'plain', path })),
    ...documents.map(path => ({ origin: 'primary', variant: 'credentials', path })),
  ];
  if (live) {
    for (const path of ['/', assets.js, paths.find(entry => entry.class === 'image')?.path].filter(Boolean)) {
      probes.push({ origin: 'primary', variant: 'if-none-match', path }, { origin: 'primary', variant: 'if-modified-since', path });
    }
    if (assets.js) probes.push({ origin: 'primary', variant: 'range', path: assets.js });
    for (const path of ['/', assets.js].filter(Boolean)) {
      probes.push({ origin: 'primary', variant: 'br', path }, { origin: 'primary', variant: 'gzip', path });
    }
    for (const path of ['/', '/sw.js', assets.js, NOT_FOUND_PATH].filter(Boolean)) probes.push({ origin: 'alias', variant: 'plain', path });
    probes.push({ origin: 'alias', variant: 'credentials', path: '/' });
    // Repeat last, so a cacheable object has had time to gain an Age.
    probes.push(...content.map(path => ({ origin: 'primary', variant: 'repeat', path })));
  }
  return { paths: [...paths, ...redirects], probes, assets };
}

/** Request headers for one probe. Identity encoding unless the probe tests compression. */
export function requestHeaders(probe, validators = {}) {
  const headers = { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'identity' };
  if (probe.variant === 'credentials') Object.assign(headers, DUMMY_CREDENTIALS);
  if (probe.variant === 'if-none-match') headers['if-none-match'] = validators.etag;
  if (probe.variant === 'if-modified-since') headers['if-modified-since'] = validators.lastModified;
  if (probe.variant === 'range') headers.range = 'bytes=0-99';
  if (probe.variant === 'br') headers['accept-encoding'] = 'br';
  if (probe.variant === 'gzip') headers['accept-encoding'] = 'gzip';
  return headers;
}

// ------------------------------------------------------------ observation

const RECORDED_HEADERS = ['cache-control', 'age', 'x-cache', 'x-cache-hits', 'x-served-by', 'etag', 'last-modified',
  'vary', 'content-encoding', 'content-range', 'content-type', 'content-length', 'location', 'date',
  'service-worker-allowed', 'strict-transport-security', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'cross-origin-opener-policy', 'permissions-policy'];

/** Header values come from the network: keep printable ASCII and bound the length. */
export const cleanValue = value => String(value).replace(/[^\x20-\x7e]/g, '?').slice(0, 300);
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

export function decodeBody(body, encoding) {
  const name = String(encoding ?? '').trim().toLowerCase();
  if (!name || name === 'identity') return body;
  if (name === 'br') return brotliDecompressSync(body);
  if (name === 'gzip') return gunzipSync(body);
  if (name === 'deflate') return inflateSync(body);
  throw new Error(`unsupported content-encoding ${cleanValue(name)}`);
}

/**
 * The sanitized record of one response. Bodies are reduced to a length and a
 * SHA-256 of the decoded bytes; Set-Cookie and CSP values are never stored.
 */
export function observe(probe, response, pathClass) {
  const headers = {};
  for (const name of RECORDED_HEADERS) {
    const value = response.headers[name];
    if (value !== undefined) headers[name] = cleanValue(Array.isArray(value) ? value.join(', ') : value);
  }
  const setCookie = response.headers['set-cookie'];
  let decoded = null;
  let decodeError = null;
  try { decoded = decodeBody(response.body, response.headers['content-encoding']); } catch (error) { decodeError = cleanValue(error.message); }
  const html = decoded && /text\/html/i.test(headers['content-type'] ?? '') ? decoded.toString('utf8') : null;
  return {
    origin: probe.origin, variant: probe.variant, path: probe.path, class: pathClass, status: response.status,
    headers, cspPresent: response.headers['content-security-policy'] !== undefined,
    setCookieCount: setCookie === undefined ? 0 : [].concat(setCookie).length,
    bodyLength: response.body.length, bodySha256: decoded ? sha256(decoded) : null, decodeError,
    buildId: html ? extractBuildId(html) : null, at: response.at ?? null,
  };
}

/** A planned request that was not sent, for example a conditional request without a validator. */
export const skippedObservation = (probe, pathClass, reason) => ({
  origin: probe.origin, variant: probe.variant, path: probe.path, class: pathClass, skipped: reason,
  status: null, headers: {}, cspPresent: false, setCookieCount: 0, bodyLength: 0, bodySha256: null, decodeError: null, buildId: null, at: null,
});

// ------------------------------------------------------------ evaluation

const hit = observation => /\bHIT\b/i.test(observation?.headers['x-cache'] ?? '') || Number(observation?.headers.age) > 0;
const check = (name, failures, detail, warnings = []) => ({
  name, status: failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS', detail, failures, warnings,
});
const notRun = (name, status, detail) => ({ name, status, detail, failures: [], warnings: [] });

const cacheState = entry => (entry?.headers['x-cache'] ? `${entry.headers['x-cache']}${entry.headers['x-cache-hits'] ? ` (${entry.headers['x-cache-hits']})` : ''}` : null);

function rowFor(hosting, target, plain, repeat) {
  const row = {
    path: target.path, class: target.class, status: plain?.status ?? null, cacheControl: plain?.headers['cache-control'] ?? null,
    age: [plain?.headers.age ?? null, repeat?.headers.age ?? null], xCache: [cacheState(plain), cacheState(repeat)],
    servedBy: plain?.headers['x-served-by'] ?? null, etag: plain?.headers.etag ?? null, lastModified: plain?.headers['last-modified'] ?? null,
    problems: [], warnings: [], headerProblems: [], headerWarnings: [],
  };
  if (!plain) {
    row.problems.push('not observed');
    return { ...row, result: 'FAIL' };
  }
  if (target.class === 'redirect') {
    row.expectedStatus = target.status ?? 301;
    row.expectedLocation = target.location;
    let location = null;
    try { location = plain.headers.location ? new URL(plain.headers.location, 'https://hosting.invalid').pathname : null; } catch { /* reported below */ }
    if (plain.status !== row.expectedStatus) row.problems.push(`status ${plain.status}, expected ${row.expectedStatus}`);
    if (location !== target.location) row.problems.push(`Location ${plain.headers.location ?? 'missing'}, expected ${target.location}`);
    return { ...row, result: row.problems.length ? 'FAIL' : 'PASS' };
  }
  const notFound = target.class === 'not-found';
  const expected = expectedHeaders(hosting, target.path, { notFound });
  Object.assign(row, { expectedStatus: notFound ? 404 : 200, expectedCacheControl: expected.cacheControl,
    cacheControlFrom: expected.cacheControlFrom, rules: expected.sources });
  if (plain.status !== row.expectedStatus) row.problems.push(`status ${plain.status}, expected ${row.expectedStatus}`);
  if (expected.cacheControl !== null && !sameDirectives(row.cacheControl, expected.cacheControl)) {
    row.problems.push(`Cache-Control "${row.cacheControl ?? 'missing'}", expected "${expected.cacheControl}" (${expected.cacheControlFrom})`);
  }
  // Other configured headers: a missing one fails; a different value is a finding,
  // because Hosting may replace a header on its own domains.
  for (const [key, value] of expected.headers) {
    if (key === 'cache-control') continue;
    // The CSP is regenerated by every build, so only its presence is compared.
    if (key === 'content-security-policy') {
      if (!plain.cspPresent) row.headerProblems.push('Content-Security-Policy missing');
    } else if (plain.headers[key] === undefined) {
      row.headerProblems.push(`${key} missing, expected "${value}"`);
    } else if (plain.headers[key] !== value) {
      row.headerWarnings.push(`${key} "${plain.headers[key]}", firebase.json sets "${value}"`);
    }
  }
  const policy = CLASS_POLICY[target.class];
  for (const problem of policyProblems(target.class, row.cacheControl, plain.headers)) {
    (policy.severity === 'fail' ? row.problems : row.warnings).push(`${problem}: ${policy.why}`);
  }
  return { ...row, result: row.problems.length ? 'FAIL' : row.warnings.length ? 'WARN' : 'PASS' };
}

/** Static check of every exported file: does firebase.json give its class the policy it needs? */
export function exportCoverage(hosting, files, documents) {
  const failures = [], findings = new Map();
  const counts = {};
  for (const file of [...files].sort()) {
    if (file.endsWith('.map')) continue;
    const path = servedPath(hosting, file);
    const pathClass = file.endsWith('.html') ? (documents.includes(path) ? 'document' : 'internal-document') : classifyPath(path, documents);
    counts[pathClass] = (counts[pathClass] ?? 0) + 1;
    const expected = expectedHeaders(hosting, path);
    const problems = policyProblems(pathClass, expected.cacheControl, Object.fromEntries(expected.headers));
    if (!problems.length) continue;
    const message = `${pathClass} gets "${expected.cacheControl}" from ${expected.cacheControlFrom}: ${problems.join('; ')}`;
    if (['document', 'service-worker'].includes(pathClass)) failures.push(`${path}: ${message}`);
    else findings.set(message, [...(findings.get(message) ?? []), path]);
  }
  const notFound = expectedHeaders(hosting, NOT_FOUND_PATH, { notFound: true });
  for (const problem of policyProblems('not-found', notFound.cacheControl)) failures.push(`custom 404 page: ${problem}`);
  const warnings = [...findings].map(([message, paths]) => `${paths.length} file(s), for example ${paths.slice(0, 2).join(', ')}: ${message}`);
  return check('export-coverage', failures, `${files.size} files: ${Object.entries(counts).sort().map(([name, count]) => `${count} ${name}`).join(', ')} (source maps not classified)`, warnings);
}

export function evaluateMatrix({ mode, hosting, plan, observations, documents, exportFiles = null }) {
  const find = (origin, variant, path) => observations.find(entry => entry.origin === origin && entry.variant === variant && entry.path === path);
  const rows = plan.paths.map(target => rowFor(hosting, target, find('primary', 'plain', target.path), find('primary', 'repeat', target.path)));
  const checks = [];
  const content = rows.filter(row => row.class !== 'redirect');
  checks.push(check('cache-policy-by-class', content.filter(row => row.result === 'FAIL').map(row => `${row.path}: ${row.problems.join('; ')}`),
    `${content.length} paths in ${new Set(content.map(row => row.class)).size} classes`,
    content.filter(row => row.result === 'WARN').map(row => `${row.path}: ${row.warnings.join('; ')}`)));
  const notFound = rows.find(row => row.class === 'not-found');
  checks.push(check('not-found', notFound?.result === 'FAIL' ? [`${notFound.path}: ${notFound.problems.join('; ')}`] : [],
    `${notFound?.path} answered ${notFound?.status} with "${notFound?.cacheControl}"`));
  const redirects = rows.filter(row => row.class === 'redirect');
  const headerWarnings = new Map();
  for (const row of content) for (const text of row.headerWarnings) headerWarnings.set(text, [...(headerWarnings.get(text) ?? []), row.path]);
  checks.push(check('configured-headers', content.flatMap(row => row.headerProblems.map(text => `${row.path}: ${text}`)),
    `${content.length} paths compared with every other header firebase.json sets for them; the CSP by presence only`,
    [...headerWarnings].map(([text, paths]) => `${paths.length} of ${content.length} paths, for example ${paths.slice(0, 2).join(', ')}: ${text}`)));
  checks.push(redirects.length
    ? check('redirects', redirects.filter(row => row.result === 'FAIL').map(row => `${row.path}: ${row.problems.join('; ')}`),
      redirects.map(row => `${row.path} -> ${row.expectedLocation}`).join(', '))
    : notRun('redirects', 'NOT_APPLICABLE', 'firebase.json configures no redirect, cleanUrls or trailingSlash'));

  const cookies = observations.filter(entry => entry.setCookieCount > 0);
  checks.push(check('no-set-cookie', cookies.filter(entry => storable(entry.headers['cache-control']))
    .map(entry => `${entry.origin} ${entry.path} (${entry.variant}) sets a cookie on a storable response`),
  `${observations.length} responses, ${cookies.length} with Set-Cookie`,
  cookies.filter(entry => !storable(entry.headers['cache-control'])).map(entry => `${entry.origin} ${entry.path} sets a cookie`)));

  // Premises of "the CDN cannot serve one user's HTML to another".
  const authFailures = [];
  for (const route of documents) {
    for (const rule of dynamicRulesFor(hosting, route)) authFailures.push(`${route}: ${rule} (premise: documents are static files)`);
    for (const origin of ['primary', 'alias']) {
      const plain = find(origin, 'plain', route), withCredentials = find(origin, 'credentials', route);
      if (!withCredentials) continue;
      if (!plain) { authFailures.push(`${origin} ${route}: no anonymous response to compare`); continue; }
      if (plain.status !== withCredentials.status || plain.bodySha256 !== withCredentials.bodySha256) {
        authFailures.push(`${origin} ${route}: the response with a dummy Authorization and __session cookie differs (${plain.status} ${plain.bodySha256?.slice(0, 12)} vs ${withCredentials.status} ${withCredentials.bodySha256?.slice(0, 12)})`);
      }
      for (const entry of [plain, withCredentials]) {
        if (entry.setCookieCount) authFailures.push(`${origin} ${route}: Set-Cookie on a document`);
        if (/\b(cookie|authorization)\b/i.test(entry.headers.vary ?? '')) authFailures.push(`${origin} ${route}: Vary names ${entry.headers.vary}`);
      }
    }
  }
  const compared = observations.filter(entry => entry.variant === 'credentials').length;
  checks.push(check('auth-invariance', authFailures, `${compared} document responses with dummy credentials compared byte for byte`));

  const documentIds = observations.filter(entry => documents.includes(entry.path) && entry.status === 200 && ['plain', 'credentials', 'repeat'].includes(entry.variant));
  const buildIds = [...new Set(documentIds.map(entry => entry.buildId))];
  checks.push(check('build-consistency', buildIds.length === 1 && buildIds[0] ? [] : [`documents carry build IDs ${buildIds.join(', ') || 'none'}`],
    `${documentIds.length} document responses, build ID ${buildIds.join(', ')}`));

  if (mode === 'live') checks.push(...liveChecks(rows, observations, find));
  else for (const name of LIVE_ONLY_CHECKS) checks.push(notRun(name, 'LIVE_ONLY', 'CDN behaviour; the loopback replay does not model it'));
  checks.push(exportFiles ? exportCoverage(hosting, exportFiles, documents)
    : notRun('export-coverage', 'LOCAL_ONLY', 'needs the static export of the served release'));

  const root = find('primary', 'plain', '/');
  const sw = find('primary', 'plain', '/sw.js');
  const identity = {
    buildId: root?.buildId ?? null, swSha256: sw?.status === 200 ? sw.bodySha256 : null,
    rootEtag: root?.headers.etag ?? null, rootLastModified: root?.headers['last-modified'] ?? null,
    pops: [...new Set(observations.map(entry => entry.headers['x-served-by']).filter(Boolean))].sort(),
  };
  return { verdict: matrixVerdict(checks), identity, rows, checks };
}

/** `FAIL` if a check failed, `WARN` if one has findings, else `PASS`. Findings never read as a clean pass. */
export function matrixVerdict(checks) {
  if (checks.some(entry => entry.status === 'FAIL')) return 'FAIL';
  return checks.some(entry => entry.status === 'WARN') ? 'WARN' : 'PASS';
}

function liveChecks(rows, observations, find) {
  const checks = [];
  // A client may store, and so revalidate, only a storable response. Hosting
  // answering 200 to a conditional request for a no-store response costs
  // nothing, because no browser sends one; it is recorded as a finding.
  const conditionalFailures = [], conditionalNotes = [];
  for (const variant of ['if-none-match', 'if-modified-since']) {
    for (const entry of observations.filter(item => item.variant === variant)) {
      if (entry.skipped) { conditionalNotes.push(`${entry.path}: ${variant} not sent (${entry.skipped})`); continue; }
      if (entry.status === 304) continue;
      const base = find('primary', 'plain', entry.path);
      const message = `${entry.path}: ${variant} answered ${entry.status}, not 304`;
      if (storable(base?.headers['cache-control'])) conditionalFailures.push(message);
      else conditionalNotes.push(`${message}; the response is no-store, so no browser revalidates it`);
    }
  }
  const sent = observations.filter(item => ['if-none-match', 'if-modified-since'].includes(item.variant) && !item.skipped).length;
  checks.push(sent || conditionalFailures.length
    ? check('conditional', conditionalFailures, `${sent} conditional requests`, conditionalNotes)
    : notRun('conditional', 'NOT_APPLICABLE', `no validator served: ${conditionalNotes.join('; ')}`));

  const range = observations.find(item => item.variant === 'range');
  const full = range && find('primary', 'plain', range.path);
  const rangeFailures = [];
  if (!range) rangeFailures.push('no range probe');
  else {
    if (range.status !== 206) rangeFailures.push(`${range.path}: status ${range.status}, expected 206`);
    if (range.status === 206 && range.bodyLength !== 100) rangeFailures.push(`${range.path}: ${range.bodyLength} bytes, expected 100`);
    const expected = full ? `bytes 0-99/${full.bodyLength}` : null;
    if (range.status === 206 && range.headers['content-range'] !== expected) rangeFailures.push(`${range.path}: Content-Range "${range.headers['content-range']}", expected "${expected}"`);
  }
  checks.push(check('range', rangeFailures, range ? `${range.path}: ${range.status} ${range.headers['content-range'] ?? ''}`.trim() : 'not probed'));

  const compressionFailures = [];
  for (const entry of observations.filter(item => ['br', 'gzip'].includes(item.variant))) {
    const identity = find('primary', 'plain', entry.path);
    if (entry.headers['content-encoding'] !== entry.variant) compressionFailures.push(`${entry.path}: Accept-Encoding ${entry.variant} gave Content-Encoding "${entry.headers['content-encoding'] ?? 'none'}"`);
    if (!/\baccept-encoding\b/i.test(entry.headers.vary ?? '')) compressionFailures.push(`${entry.path} (${entry.variant}): Vary "${entry.headers.vary ?? 'missing'}" lacks Accept-Encoding`);
    if (entry.decodeError || (identity && entry.bodySha256 !== identity.bodySha256)) compressionFailures.push(`${entry.path} (${entry.variant}): decoded body differs from the identity body`);
  }
  checks.push(check('compression', compressionFailures, `${observations.filter(item => ['br', 'gzip'].includes(item.variant)).length} compressed responses`));

  // A no-store response must never come from the CDN cache.
  const noStore = rows.filter(row => ['document', 'not-found', 'service-worker'].includes(row.class));
  const cdnFailures = noStore.flatMap(row => ['plain', 'repeat'].map(variant => find('primary', variant, row.path))
    .filter(hit).map(entry => `${entry.path} (${entry.variant}): X-Cache "${entry.headers['x-cache']}", Age ${entry.headers.age}`));
  const cacheable = rows.filter(row => ['next-static', 'image'].includes(row.class));
  const hits = cacheable.filter(row => hit(find('primary', 'repeat', row.path))).length;
  checks.push(check('cdn-cache', cdnFailures, `no-store classes: ${noStore.length} paths never served from cache; cacheable classes: ${hits} of ${cacheable.length} repeats were hits`));

  const aliasFailures = [];
  for (const entry of observations.filter(item => item.origin === 'alias' && item.variant === 'plain')) {
    const primary = find('primary', 'plain', entry.path);
    if (!primary) continue;
    if (entry.status !== primary.status) aliasFailures.push(`${entry.path}: alias ${entry.status}, primary ${primary.status}`);
    if (!sameDirectives(entry.headers['cache-control'], primary.headers['cache-control'])) aliasFailures.push(`${entry.path}: alias Cache-Control "${entry.headers['cache-control']}", primary "${primary.headers['cache-control']}"`);
    if (entry.status === 200 && entry.bodySha256 !== primary.bodySha256) aliasFailures.push(`${entry.path}: alias body differs from the primary body`);
  }
  checks.push(check('alias', aliasFailures, `${observations.filter(item => item.origin === 'alias').length} alias responses compared with the primary host`));
  return checks;
}

// ------------------------------------------------------------ after deploy

/**
 * Compares two live reports taken before and after a Hosting release. The
 * verdict rests on content: the build ID that every HTML response carries and
 * the SHA-256 of `sw.js`. `Last-Modified` of `/` only tells a release without
 * frontend changes from no release at all. `age-reset` compares every
 * `Last-Modified`, and any `Age`, with that stamp, but reports disagreements as
 * findings: that Hosting stamps every file of a release with the release time
 * was observed on one release (2026-11-23), not proven. Hosting sent no `Age`.
 */
export function compareSnapshots(before, after, { toleranceSeconds = 5 } = {}) {
  const checks = [];
  const beforeId = before.identity?.buildId, afterId = after.identity?.buildId;
  const released = Date.parse(after.identity?.rootLastModified ?? '');
  const previous = Date.parse(before.identity?.rootLastModified ?? '');
  const sameBuild = Boolean(beforeId) && beforeId === afterId;
  const newBuild = Boolean(beforeId) && Boolean(afterId) && beforeId !== afterId;
  const restamped = Number.isFinite(released) && Number.isFinite(previous) && released > previous;
  const stamps = `Last-Modified of / ${before.identity?.rootLastModified} -> ${after.identity?.rootLastModified}`;
  checks.push(check('new-release', newBuild || restamped ? [] : [`the build ID is unchanged and ${stamps}`],
    `${newBuild ? 'new build ID' : 'same build ID'}; ${stamps}`));
  checks.push(check('new-build-id', afterId ? [] : ['no build ID after the deploy'], `${beforeId} -> ${afterId}`,
    sameBuild ? ['the build ID is unchanged: the deploy changed no frontend build input, so it cannot show invalidation of HTML'] : []));
  const sameWorker = before.identity?.swSha256 && before.identity.swSha256 === after.identity?.swSha256;
  checks.push(check('new-service-worker', sameWorker && !sameBuild ? ['sw.js is unchanged although the build ID changed: a cached worker is still served'] : [],
    `${before.identity?.swSha256?.slice(0, 12)} -> ${after.identity?.swSha256?.slice(0, 12)}`));
  const documents = after.observations.filter(entry => entry.buildId !== null);
  const stale = sameBuild ? [] : documents.filter(entry => entry.buildId === beforeId)
    .map(entry => `${entry.origin} ${entry.path} (${entry.variant}) still carries build ${beforeId}`);
  const mixed = [...new Set(documents.map(entry => entry.buildId))];
  if (mixed.length > 1) stale.push(`documents after the deploy carry ${mixed.length} build IDs: ${mixed.join(', ')}`);
  checks.push(check('no-stale-html', stale, `${documents.length} HTML responses after the deploy`));
  const old = [];
  let stamped = 0;
  if (Number.isFinite(released)) {
    for (const entry of after.observations) {
      const stamp = Date.parse(entry.headers?.['last-modified'] ?? '');
      if (Number.isFinite(stamp)) {
        stamped += 1;
        if (stamp !== released) old.push(`${entry.origin} ${entry.path} (${entry.variant}): Last-Modified ${entry.headers['last-modified']}, not that of / (${after.identity.rootLastModified})`);
      }
      const age = Number(entry.headers?.age), date = Date.parse(entry.headers?.date ?? '');
      if (!Number.isFinite(age) || !Number.isFinite(date)) continue;
      const sinceRelease = (date - released) / 1000;
      if (age > sinceRelease + toleranceSeconds) old.push(`${entry.origin} ${entry.path} (${entry.variant}): Age ${age} s, but / was stamped ${Math.round(sinceRelease)} s earlier`);
    }
  }
  checks.push(Number.isFinite(released)
    ? check('age-reset', [], `${stamped} Last-Modified stamps and every Age compared with the Last-Modified of /; differences are findings, because the release stamp is a premise under test`, old)
    : notRun('age-reset', 'NOT_APPLICABLE', 'no Last-Modified for / after the deploy'));
  const failed = name => checks.find(entry => entry.name === name).status === 'FAIL';
  const verdict = failed('new-release') ? 'NOT_A_NEW_RELEASE'
    : ['no-stale-html', 'new-service-worker', 'new-build-id'].some(failed) ? 'STALE'
      : sameBuild ? 'NO_FRONTEND_CHANGE' : 'INVALIDATED';
  return { verdict, before: before.identity, after: after.identity, checks };
}

// ------------------------------------------------------------ arguments and bounds

export function assertLiveOrigin(origin) {
  if (!LIVE_ORIGINS.includes(origin)) throw new Error(`live runs may target only ${LIVE_ORIGINS.join(' and ')}, not ${cleanValue(origin)}`);
  return origin;
}

export function parseCacheMatrixArgs(argv) {
  const options = { mode: 'local', port: LOCAL_PORT, origin: null, compare: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      index += 1;
      return argv[index];
    };
    if (arg === '--live') options.mode = 'live';
    else if (arg === '--origin') options.origin = value();
    else if (arg === '--port') options.port = Number(value());
    else if (arg === '--compare') { options.mode = 'compare'; options.compare = [value(), value()]; }
    else throw new Error(`Unknown argument ${cleanValue(arg)}`);
  }
  if (options.origin !== null && options.mode !== 'live') throw new Error('--origin needs --live');
  if (options.mode === 'live') options.origin = assertLiveOrigin(options.origin ?? LIVE_ORIGINS[0]);
  // Loopback ports for QA replays on shared machines stay in 20000 to 20999.
  if (!Number.isInteger(options.port) || options.port < 20_000 || options.port > 20_999) throw new Error('--port must be from 20000 to 20999');
  return options;
}

/** Spaces requests at least `minDelayMs` apart and refuses the request after `maxRequests`. */
export function createLimiter({ maxRequests, minDelayMs }, { now = () => Date.now(), sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  let sent = 0, last = -Infinity;
  return {
    get sent() { return sent; },
    async take() {
      if (sent >= maxRequests) throw new Error(`request budget of ${maxRequests} exhausted`);
      const wait = last + minDelayMs - now();
      if (wait > 0) await sleep(wait);
      sent += 1;
      last = now();
    },
  };
}
