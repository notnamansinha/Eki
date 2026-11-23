import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import {
  HOSTING_DEFAULT_CACHE_CONTROL, LIVE_BOUNDS, LIVE_ORIGINS, NOT_FOUND_PATH,
  buildPlan, compareSnapshots, createLimiter, discoverAssets, evaluateMatrix, expectedHeaders, exportCoverage,
  extractBuildId, hostingConfig, observe, parseCacheMatrixArgs, policyProblems, requestHeaders, routeRequest,
  routesFromPageFiles,
} from './qa/cache-matrix.mjs';

const repository = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const realHosting = hostingConfig(repository);
const appRoutes = routesFromPageFiles(readdirSync(new URL('../frontend/src/app', import.meta.url), { recursive: true })
  .map(String).filter(file => /^page\.(tsx|ts|jsx|js|mdx)$/.test(basename(file))));

const STATIC = 'public, max-age=31536000, immutable';
const NO_STORE = 'no-cache, no-store, must-revalidate';
const IMAGE = 'public, max-age=2592000, stale-while-revalidate=86400';
const fixtureHosting = hostingConfig({ hosting: {
  public: 'out', cleanUrls: true, trailingSlash: false,
  headers: [
    { source: '**', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Strict-Transport-Security', value: 'max-age=31536000' }] },
    { source: '/{,admin}', headers: [{ key: 'Cache-Control', value: NO_STORE }] },
    { source: '/404.html', headers: [{ key: 'Cache-Control', value: NO_STORE }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: NO_STORE }, { key: 'Service-Worker-Allowed', value: '/' }] },
    { source: '/_next/static/**', headers: [{ key: 'Cache-Control', value: STATIC }] },
    { source: '**/*.@(png|svg)', headers: [{ key: 'Cache-Control', value: IMAGE }] },
    { regex: '^/legacy/.*\\.json$', headers: [{ key: 'Cache-Control', value: 'max-age=60' }] },
  ],
  redirects: [{ source: '/old-install', destination: '/admin', type: 301 }],
  rewrites: [{ source: '/app/**', destination: '/index.html' }, { source: '/api/**', run: { serviceId: 'backend' } }],
} });
const fixtureFiles = new Set(['/index.html', '/admin.html', '/404.html', '/_not-found.html', '/sw.js', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest',
  '/_next/static/chunks/main.js', '/_next/static/chunks/app.css', '/_next/static/media/font.woff2', '/_next/static/media/icon.png',
  '/logo.png', '/index.txt']);
const BUILD = 'a'.repeat(32), NEXT_BUILD = 'b'.repeat(32);
const html = (build = BUILD) => `<!DOCTYPE html><html><head><link rel="manifest" href="/manifest.webmanifest"/>
<link rel="icon" href="/logo.png?logo.123.png"/><link rel="stylesheet" href="/_next/static/chunks/app.css"/>
<link rel="preload" href="/_next/static/media/font.woff2"/><img src="https://elsewhere.example/a.png"/>
<script src="/_next/static/chunks/main.js"></script></head><body><script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"${build}\\"}\\n"])</script></body></html>`;

// ------------------------------------------------------------ derivation

test('the real firebase.json gives every class the policy it needs', () => {
  assert.ok(appRoutes.includes('/') && appRoutes.length >= 5, appRoutes.join(', '));
  // A page added without a no-store rule falls back to Hosting's one-hour default and fails here.
  for (const route of appRoutes) assert.deepEqual(policyProblems('document', expectedHeaders(realHosting, route).cacheControl), [], route);
  const sw = expectedHeaders(realHosting, '/sw.js');
  assert.deepEqual(policyProblems('service-worker', sw.cacheControl, Object.fromEntries(sw.headers)), []);
  assert.deepEqual(policyProblems('next-static', expectedHeaders(realHosting, '/_next/static/chunks/x.js').cacheControl), []);
  for (const image of ['/icon-192.png', '/images/hero-background.jpg', '/uni-logo.webp', '/google-g.svg']) {
    assert.deepEqual(policyProblems('image', expectedHeaders(realHosting, image).cacheControl), [], image);
  }
  const notFound = expectedHeaders(realHosting, NOT_FOUND_PATH, { notFound: true });
  assert.deepEqual(policyProblems('not-found', notFound.cacheControl), []);
  assert.ok(notFound.sources.includes('/404.html'));
  for (const path of ['/manifest.webmanifest', '/robots.txt', '/sitemap.xml']) {
    assert.deepEqual([expectedHeaders(realHosting, path).cacheControl, expectedHeaders(realHosting, path).cacheControlFrom],
      [HOSTING_DEFAULT_CACHE_CONTROL, 'hosting-default'], path);
  }
});

test('header rules apply in file order, and the 404 page merges 404.html with the requested path', () => {
  assert.equal(expectedHeaders(fixtureHosting, '/').cacheControl, NO_STORE);
  assert.equal(expectedHeaders(fixtureHosting, '/admin/x').cacheControl, HOSTING_DEFAULT_CACHE_CONTROL);
  // Both /_next/static/** and the image rule match; the later image rule wins.
  assert.equal(expectedHeaders(fixtureHosting, '/_next/static/media/icon.png').cacheControl, IMAGE);
  assert.equal(expectedHeaders(fixtureHosting, '/_next/static/media/font.woff2').cacheControl, STATIC);
  assert.equal(expectedHeaders(fixtureHosting, '/legacy/a.json').cacheControl, 'max-age=60');
  assert.equal(expectedHeaders(fixtureHosting, '/legacy/a.json.bak').cacheControl, HOSTING_DEFAULT_CACHE_CONTROL);
  const missing = expectedHeaders(fixtureHosting, '/nothing.png', { notFound: true });
  assert.equal(missing.cacheControl, IMAGE, 'the requested path is matched after 404.html');
  assert.deepEqual(missing.sources, ['**', '/404.html', '**/*.@(png|svg)']);
  const bare = hostingConfig({ hosting: { headers: [] } });
  assert.deepEqual([expectedHeaders(bare, '/x', { notFound: true }).cacheControl, expectedHeaders(bare, '/x', { notFound: true }).cacheControlFrom],
    [null, 'unmodelled']);
  assert.throws(() => hostingConfig({ hosting: [{}, {}] }), /exactly one hosting site/);
});

test('routing follows the Hosting priority order, cleanUrls and trailingSlash', () => {
  const has = path => fixtureFiles.has(path);
  assert.deepEqual(routeRequest(fixtureHosting, '/__/auth/handler', has), { kind: 'reserved' });
  assert.deepEqual(routeRequest(fixtureHosting, '/old-install', has), { kind: 'redirect', status: 301, location: '/admin' });
  assert.deepEqual(routeRequest(fixtureHosting, '/admin.html', has), { kind: 'redirect', status: 301, location: '/admin' });
  assert.deepEqual(routeRequest(fixtureHosting, '/index.html', has), { kind: 'redirect', status: 301, location: '/' });
  assert.deepEqual(routeRequest(fixtureHosting, '/admin/', has), { kind: 'redirect', status: 301, location: '/admin' });
  assert.equal(routeRequest(fixtureHosting, '//evil.example/', has).location, '/evil.example', 'never a protocol-relative Location');
  assert.deepEqual(routeRequest(fixtureHosting, '/admin', has), { kind: 'file', status: 200, file: '/admin.html' });
  assert.deepEqual(routeRequest(fixtureHosting, '/', has), { kind: 'file', status: 200, file: '/index.html' });
  assert.equal(routeRequest(fixtureHosting, '/app/deep/link', has).file, '/index.html');
  assert.deepEqual(routeRequest(fixtureHosting, '/api/buses', has), { kind: 'backend', rewrite: '/api/**' });
  assert.deepEqual(routeRequest(fixtureHosting, '/missing', has), { kind: 'not-found', status: 404, file: '/404.html' });
});

test('page files map to the routes the export serves', () => {
  assert.deepEqual(routesFromPageFiles(['page.tsx', 'admin/page.tsx', '(marketing)/install/page.tsx', 'trip/[id]/page.tsx',
    '_private/page.tsx', '@modal/page.tsx', 'a\\b\\page.tsx']), ['/', '/a/b', '/admin', '/install']);
});

// ------------------------------------------------------------ discovery and plan

test('discovery reads same-origin assets and the Next.js 16 build ID', () => {
  const assets = discoverAssets(html());
  assert.deepEqual(assets, { js: '/_next/static/chunks/main.js', css: '/_next/static/chunks/app.css',
    font: '/_next/static/media/font.woff2', images: ['/logo.png'], manifest: '/manifest.webmanifest' });
  assert.equal(extractBuildId(html()), BUILD);
  assert.equal(extractBuildId('<script src="/_next/static/abcdef123456/_buildManifest.js">'), 'abcdef123456');
  assert.equal(extractBuildId('<p>no build here</p>'), null);
});

test('the live plan stays inside its request budget and sends no cache-busting query', () => {
  const plan = buildPlan({ hosting: realHosting, documents: appRoutes, html: html(), live: true,
    publicImages: ['/google-g.svg', '/icon-192.png', '/images/hero-background.jpg', '/uni-logo.webp'] });
  assert.ok(plan.probes.length <= LIVE_BOUNDS.maxRequests, `${plan.probes.length} requests`);
  assert.ok(plan.probes.every(probe => ['primary', 'alias'].includes(probe.origin) && probe.path.startsWith('/') && !/[?#]/.test(probe.path)));
  assert.equal(plan.probes.at(-1).variant, 'repeat', 'repeats run last');
  assert.deepEqual(plan.paths.filter(entry => entry.class === 'redirect').map(entry => [entry.path, entry.location]),
    [['/admin.html', '/admin'], ['/admin/', '/admin']]);
  const local = buildPlan({ hosting: realHosting, documents: appRoutes, html: html(), live: false });
  assert.deepEqual([...new Set(local.probes.map(probe => probe.variant))].sort(), ['credentials', 'plain']);
  assert.equal(requestHeaders({ variant: 'credentials' }).authorization, 'Bearer eki-cache-matrix-dummy');
  assert.equal(requestHeaders({ variant: 'plain' })['accept-encoding'], 'identity');
  assert.match(requestHeaders({ variant: 'plain' })['user-agent'], /^Eki-QA-cache-matrix\//);
});

// ------------------------------------------------------------ evaluation

const RELEASE = 'Fri, 20 Nov 2026 11:59:57 GMT';
const body = path => Buffer.from(path === '/' || path === '/admin' || path === NOT_FOUND_PATH ? html() : `content of ${path}`);

/** A synthetic Hosting answer built from the fixture config, with CDN headers. */
function respond(probe, { build = BUILD, stamp = RELEASE } = {}) {
  const has = path => fixtureFiles.has(path);
  const route = routeRequest(fixtureHosting, probe.path, has);
  const expected = expectedHeaders(fixtureHosting, probe.path, { notFound: route.kind === 'not-found' });
  const headers = { ...Object.fromEntries(expected.headers), 'cache-control': expected.cacheControl, 'x-cache': 'MISS', 'x-cache-hits': '0',
    'x-served-by': 'cache-bom-1-BOM', 'last-modified': stamp, date: 'Mon, 23 Nov 2026 19:26:20 GMT', vary: 'x-fh-requested-host, accept-encoding',
    etag: `"${probe.path}"`, 'content-security-policy': "default-src 'self'" };
  if (route.kind === 'redirect') return { status: 301, headers: { ...headers, location: route.location }, body: Buffer.alloc(0) };
  const path = route.kind === 'not-found' ? NOT_FOUND_PATH : probe.path;
  let content = path === '/' || path === '/admin' || path === NOT_FOUND_PATH ? Buffer.from(html(build)) : body(path);
  headers['content-type'] = path.endsWith('.js') ? 'text/javascript' : /^\/(admin)?$/.test(path) || route.kind === 'not-found' ? 'text/html; charset=utf-8' : 'text/plain';
  let status = route.kind === 'not-found' ? 404 : 200;
  if (probe.variant === 'repeat' && /immutable|public/.test(headers['cache-control'])) headers['x-cache'] = 'HIT';
  if (['if-none-match', 'if-modified-since'].includes(probe.variant)) {
    status = /no-store/.test(headers['cache-control']) ? 200 : 304;
    if (status === 304) content = Buffer.alloc(0);
  }
  if (probe.variant === 'range') {
    headers['content-range'] = `bytes 0-99/${content.length}`;
    content = Buffer.concat([content, Buffer.alloc(200)]).subarray(0, 100);
    status = 206;
  }
  if (probe.variant === 'br') { headers['content-encoding'] = 'br'; content = brotliCompressSync(content); }
  if (probe.variant === 'gzip') { headers['content-encoding'] = 'gzip'; content = gzipSync(content); }
  return { status, headers, body: content };
}

function run({ mode = 'live', change = () => {}, options = {} } = {}) {
  const plan = buildPlan({ hosting: fixtureHosting, documents: ['/', '/admin'], html: html(), live: mode === 'live' });
  const classOf = path => plan.paths.find(entry => entry.path === path)?.class ?? 'other';
  const observations = plan.probes.map(probe => {
    const response = respond(probe, options);
    change(probe, response);
    return observe(probe, response, classOf(probe.path));
  });
  return { plan, observations, result: evaluateMatrix({ mode, hosting: fixtureHosting, plan, observations, documents: ['/', '/admin'],
    exportFiles: mode === 'local' ? fixtureFiles : null }) };
}
const status = (result, name) => result.checks.find(entry => entry.name === name).status;
const failures = (result, name) => result.checks.find(entry => entry.name === name).failures.join('\n');

test('a Hosting that follows firebase.json passes the live matrix', () => {
  const { result } = run();
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.checks.filter(entry => entry.status === 'FAIL'), null, 1));
  assert.equal(status(result, 'conditional'), 'WARN', 'the no-store document answers 200 and is only a finding');
  assert.equal(result.identity.buildId, BUILD);
  assert.deepEqual(result.identity.pops, ['cache-bom-1-BOM']);
  assert.equal(result.rows.find(row => row.path === NOT_FOUND_PATH).status, 404);
});

test('each deviation fails its own check', () => {
  const cases = [
    ['not-found', (probe, response) => { if (probe.path === NOT_FOUND_PATH) response.status = 200; }, /answered 200|status 200/],
    ['cache-policy-by-class', (probe, response) => { if (probe.path === '/sw.js') response.headers['cache-control'] = 'max-age=3600'; }, /Cache-Control "max-age=3600"/],
    ['no-set-cookie', (probe, response) => { if (probe.path === '/logo.png') response.headers['set-cookie'] = ['a=1']; }, /sets a cookie on a storable/],
    ['auth-invariance', (probe, response) => { if (probe.variant === 'credentials' && probe.path === '/admin') response.body = Buffer.from('hello user'); }, /differs/],
    ['auth-invariance', (probe, response) => { if (probe.path === '/') response.headers.vary = 'Cookie'; }, /Vary names Cookie/],
    ['conditional', (probe, response) => { if (probe.variant === 'if-none-match' && probe.path.endsWith('.js')) response.status = 200; }, /answered 200, not 304$/m],
    ['range', (probe, response) => { if (probe.variant === 'range') response.status = 200; }, /status 200, expected 206/],
    ['compression', (probe, response) => { if (probe.variant === 'br') response.headers.vary = 'x-fh-requested-host'; }, /lacks Accept-Encoding/],
    ['compression', (probe, response) => { if (probe.variant === 'gzip') { response.body = response.body.subarray(0, 0); delete response.headers['content-encoding']; } }, /Content-Encoding "none"/],
    ['cdn-cache', (probe, response) => { if (probe.variant === 'repeat' && probe.path === '/admin') response.headers['x-cache'] = 'HIT'; }, /\/admin \(repeat\): X-Cache "HIT"/],
    ['configured-headers', (probe, response) => { if (probe.path === '/') delete response.headers['x-frame-options']; }, /x-frame-options missing/],
    ['build-consistency', (probe, response) => { if (probe.path === '/admin') response.body = Buffer.from(html(NEXT_BUILD)); }, /build IDs/],
    ['alias', (probe, response) => { if (probe.origin === 'alias' && probe.path === '/sw.js') response.body = Buffer.from('old worker'); }, /alias body differs/],
    ['redirects', (probe, response) => { if (probe.path === '/admin/') response.headers.location = '/'; }, /Location \//],
  ];
  for (const [name, change, pattern] of cases) {
    const { result } = run({ change });
    assert.equal(status(result, name), 'FAIL', `${name} should fail`);
    assert.match(failures(result, name), pattern, name);
    assert.equal(result.verdict, 'FAIL');
  }
  const hsts = run({ change: (probe, response) => { response.headers['strict-transport-security'] = 'max-age=31556926; includeSubDomains; preload'; } }).result;
  assert.equal(status(hsts, 'configured-headers'), 'WARN', 'a replaced header value is a finding, not a failure');
  assert.equal(hsts.verdict, 'PASS');
});

test('a local run marks CDN checks live-only and checks every exported file', () => {
  const { result } = run({ mode: 'local' });
  for (const name of ['conditional', 'range', 'compression', 'cdn-cache', 'alias']) assert.equal(status(result, name), 'LIVE_ONLY', name);
  const coverage = result.checks.find(entry => entry.name === 'export-coverage');
  assert.equal(coverage.status, 'WARN');
  assert.match(coverage.warnings.join('\n'), /\/_next\/static\/media\/icon\.png: next-static gets "public, max-age=2592000/);
  const uncovered = exportCoverage(fixtureHosting, new Set([...fixtureFiles, '/install.html']), ['/', '/admin', '/install']);
  assert.equal(uncovered.status, 'FAIL');
  assert.match(uncovered.failures.join('\n'), /\/install: document gets "max-age=3600" from hosting-default/);
  const noScope = hostingConfig({ hosting: { headers: fixtureHosting.headers.filter(rule => rule.source !== '/sw.js')
    .concat([{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: NO_STORE }] }]) } });
  assert.match(exportCoverage(noScope, fixtureFiles, ['/', '/admin']).failures.join('\n'), /service-worker-allowed is missing/);
});

test('observations keep no cookie or CSP value and decode compressed bodies', () => {
  const response = { status: 200, body: gzipSync(Buffer.from('<p>x</p>')), headers: { 'content-encoding': 'gzip', 'content-type': 'text/html',
    'set-cookie': ['session=secret-value'], 'content-security-policy': "script-src 'sha256-x'", 'x-cache': 'HIT\r\nInjected: 1' } };
  const entry = observe({ origin: 'primary', variant: 'gzip', path: '/' }, response, 'document');
  assert.equal(entry.setCookieCount, 1);
  assert.equal(entry.cspPresent, true);
  assert.doesNotMatch(JSON.stringify(entry), /secret-value|sha256-x/);
  assert.equal(entry.headers['x-cache'], 'HIT??Injected: 1');
  const identity = observe({ origin: 'primary', variant: 'plain', path: '/' }, { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<p>x</p>') }, 'document');
  assert.equal(entry.bodySha256, identity.bodySha256);
  const broken = observe({ origin: 'primary', variant: 'br', path: '/' }, { status: 200, headers: { 'content-encoding': 'br' }, body: Buffer.from('not brotli') }, 'document');
  assert.equal(broken.bodySha256, null);
  assert.ok(broken.decodeError);
});

// ------------------------------------------------------------ after deploy

const snapshot = ({ build, stamp, worker = build, alias = build }) => {
  const { result, observations } = run({ options: { build, stamp } });
  for (const entry of observations) if (entry.origin === 'alias' && entry.buildId) entry.buildId = alias;
  return { mode: 'live', identity: { ...result.identity, swSha256: `sw-${worker}` }, observations };
};
const LATER = 'Tue, 24 Nov 2026 09:00:00 GMT';

test('the comparator accepts a clean invalidation and names each stale signal', () => {
  const before = snapshot({ build: BUILD, stamp: RELEASE });
  assert.equal(compareSnapshots(before, snapshot({ build: NEXT_BUILD, stamp: LATER })).verdict, 'INVALIDATED');
  const staleAlias = compareSnapshots(before, snapshot({ build: NEXT_BUILD, stamp: LATER, alias: BUILD }));
  assert.equal(staleAlias.verdict, 'STALE');
  assert.match(staleAlias.checks.find(entry => entry.name === 'no-stale-html').failures.join('\n'), /alias \/ \(plain\) still carries build a{32}/);
  const oldWorker = compareSnapshots(before, snapshot({ build: NEXT_BUILD, stamp: LATER, worker: BUILD }));
  assert.equal(oldWorker.verdict, 'STALE');
  const oldStamp = snapshot({ build: NEXT_BUILD, stamp: LATER });
  oldStamp.observations.find(entry => entry.path === '/logo.png').headers['last-modified'] = RELEASE;
  const stamped = compareSnapshots(before, oldStamp);
  assert.equal(stamped.verdict, 'STALE');
  assert.match(stamped.checks.find(entry => entry.name === 'age-reset').failures.join('\n'), /\/logo\.png \(plain\): Last-Modified Fri, 20 Nov/);
  const aged = snapshot({ build: NEXT_BUILD, stamp: LATER });
  Object.assign(aged.observations.find(entry => entry.path === '/logo.png').headers, { age: '90000', date: 'Tue, 24 Nov 2026 09:10:00 GMT' });
  assert.match(compareSnapshots(before, aged).checks.find(entry => entry.name === 'age-reset').failures.join('\n'), /Age 90000 s, but the release is 600 s old/);
  assert.equal(compareSnapshots(before, snapshot({ build: BUILD, stamp: LATER })).verdict, 'NO_FRONTEND_CHANGE');
  assert.equal(compareSnapshots(before, snapshot({ build: NEXT_BUILD, stamp: RELEASE })).verdict, 'NOT_A_NEW_RELEASE');
});

// ------------------------------------------------------------ bounds

test('live runs target only the staging Hosting site and its alias, within the bounds', async () => {
  assert.deepEqual(parseCacheMatrixArgs(['--live']), { mode: 'live', port: 20520, origin: LIVE_ORIGINS[0], compare: null });
  assert.equal(parseCacheMatrixArgs(['--live', '--origin', LIVE_ORIGINS[1]]).origin, LIVE_ORIGINS[1]);
  assert.throws(() => parseCacheMatrixArgs(['--live', '--origin', 'https://eki-production.web.app']), /may target only/);
  assert.throws(() => parseCacheMatrixArgs(['--live', '--origin', 'https://bustrack-be165.web.app/']), /may target only/);
  assert.throws(() => parseCacheMatrixArgs(['--origin', LIVE_ORIGINS[0]]), /needs --live/);
  assert.throws(() => parseCacheMatrixArgs(['--port', '8080']), /20000 to 20999/);
  assert.deepEqual(parseCacheMatrixArgs(['--compare', 'a.json', 'b.json']).compare, ['a.json', 'b.json']);
  assert.ok(LIVE_BOUNDS.minDelayMs >= 300 && LIVE_BOUNDS.maxRequests <= 80);
  let clock = 0;
  const waits = [];
  const limiter = createLimiter({ maxRequests: 3, minDelayMs: 300 }, { now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; } });
  await limiter.take();
  clock += 100;
  await limiter.take();
  await limiter.take();
  assert.deepEqual(waits, [200, 300]);
  await assert.rejects(limiter.take(), /budget of 3 exhausted/);
});
