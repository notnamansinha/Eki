import { Buffer } from 'node:buffer';

/**
 * Bounded OWASP ZAP scan plans for the Eki HTTP API (issue #503).
 *
 * Everything here is a pure function of backend/openapi.json and the caller's
 * inputs: the operations in scope, the scoped contract ZAP imports, the ZAP
 * Automation Framework plan it runs, the staging preconditions and the
 * sanitized, triaged evidence. scripts/qa/run-dast.mjs owns every process,
 * container and network step. qa/DAST.md explains each bound.
 */

// Pinned by digest. Version 2.17.0, published 2026-11-03.
export const ZAP_IMAGE = 'zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af';

// The only hosted target this harness accepts (docs/operations/STAGING_RUNTIME_CONFIG.md, Section 2).
export const STAGING_ORIGIN = 'https://eki-backend-staging-449313371438.asia-south2.run.app';
export const STAGING_PROJECT_ID = 'bustrack-be165';
const STAGING_REVISION = /^eki-backend-staging-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const LOCAL_BACKEND_PORT = 3116;
export const HTTP_METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete'];
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UNKNOWN_ID = 'dast-probe';

// Staging rule allowlist. Each rule sends GET requests to the URLs the
// OpenAPI import produced, with payloads in the parameters. None switches the
// HTTP method (unlike 90028 Insecure HTTP Method or 20018 CVE-2012-1823),
// waits on time-based payloads or needs an out-of-band callback. Rules that
// ZAP adds in a later version stay off until someone reviews them here.
export const STAGING_RULES = Object.freeze([
  { id: 0, name: 'Directory Browsing' },
  { id: 6, name: 'Path Traversal' },
  { id: 7, name: 'Remote File Inclusion' },
  { id: 20019, name: 'External Redirect' },
  { id: 30001, name: 'Buffer Overflow' },
  { id: 30002, name: 'Format String Error' },
  { id: 40003, name: 'CRLF Injection' },
  { id: 40008, name: 'Parameter Tampering' },
  { id: 40009, name: 'Server Side Include' },
  { id: 40012, name: 'Cross Site Scripting (Reflected)' },
  { id: 40018, name: 'SQL Injection' },
  { id: 40034, name: '.env Information Leak' },
  { id: 40035, name: 'Hidden File Finder' },
  { id: 90019, name: 'Server Side Code Injection' },
  { id: 90020, name: 'Remote OS Command Injection' },
  { id: 90021, name: 'XPath Injection' },
  { id: 90034, name: 'Cloud Metadata Potentially Exposed' },
  { id: 90035, name: 'Server Side Template Injection' },
]);

// Local denylist. Everything else ZAP installs runs against the disposable
// backend, including rules that switch methods. These are off because they
// need TLS, an out-of-band callback service, or measure time-based delays
// that only reflect emulator latency. Every ID here and in STAGING_RULES is
// installed in the pinned image: ZAP warns about, and ignores, unknown IDs.
export const LOCAL_DISABLED_RULES = Object.freeze([
  { id: 20015, name: 'Heartbleed OpenSSL Vulnerability' },
  { id: 40019, name: 'SQL Injection - MySQL (Time Based)' },
  { id: 40020, name: 'SQL Injection - Hypersonic SQL (Time Based)' },
  { id: 40021, name: 'SQL Injection - Oracle (Time Based)' },
  { id: 40022, name: 'SQL Injection - PostgreSQL (Time Based)' },
  { id: 40027, name: 'SQL Injection - MsSQL (Time Based)' },
  { id: 40043, name: 'Log4Shell' },
  { id: 90036, name: 'Server Side Template Injection (Blind)' },
]);

export const PROFILES = Object.freeze({
  local: Object.freeze({
    roles: ['anonymous', 'passenger', 'admin', 'device'],
    methods: ['get', 'post', 'put', 'patch', 'delete'],
    excludedPaths: [],
    // Fleet mutations admit two at a time; more threads turn the boolean SQL
    // injection comparisons into measurements of admission overflow.
    threadPerHost: 2,
    delayInMs: 0,
    defaultStrength: 'medium',
    defaultThreshold: 'medium',
    maxRuleDurationInMins: 2,
    maxScanDurationInMins: { anonymous: 4, passenger: 10, admin: 14, device: 5 },
  }),
  staging: Object.freeze({
    roles: ['anonymous', 'passenger', 'admin'],
    methods: ['get'],
    // Calls the billed Places API on every request that passes validation.
    excludedPaths: ['/api/places/search'],
    threadPerHost: 1,
    // About 150 requests a minute: under the 200 reads per minute per verified
    // user and the 1,000 requests per minute per IP that the backend enforces.
    delayInMs: 400,
    defaultStrength: 'low',
    defaultThreshold: 'off',
    maxRuleDurationInMins: 2,
    maxScanDurationInMins: { anonymous: 3, passenger: 12, admin: 12 },
  }),
});

// Staging tokens must outlive every role's scan and the closing revision read.
export const STAGING_MIN_TOKEN_LIFETIME_MS = 40 * 60_000;

// Fixture identifiers from e2e/emulator/backend.mjs, so local payloads reach
// handlers with real records instead of stopping at a 404. A key names a path
// parameter, query parameter or JSON body property; `<path>|<name>` applies to
// one path only.
export const LOCAL_PATH_VALUES = Object.freeze({
  busId: 'qa_bus',
  deviceId: 'qa_device',
  driverId: 'qa_driver',
  routeId: 'qa_route',
  sessionId: 'qa_session',
  feedbackId: 'qa_feedback',
  saveId: 'qa_save',
  operationId: 'qa_operation',
  uid: 'qa_passenger',
  boardingStopId: 'origin',
  alightingStopId: 'end',
  startStopId: 'origin',
  endStopId: 'end',
  viaStopId: 'middle',
  assignedBusId: 'qa_bus',
  assignedRoutes: 'qa_route',
  // A fixture account the scan never signs in as, so operator assignments
  // cannot revoke the scanning identity's token.
  authUid: 'qa_other',
  '/api/fleet/buses/{id}|id': 'qa_bus',
  '/api/fleet/drivers/{id}|id': 'qa_driver',
  '/api/requests/{id}|id': 'qa_session',
});

export function profileFor(name) {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`Unknown DAST profile: ${name}`);
  return profile;
}

/** The contract operations one role scans under one profile. */
export function selectOperations(contract, profileName, role) {
  const profile = profileFor(profileName);
  if (!profile.roles.includes(role)) throw new Error(`Role ${role} is not part of the ${profileName} profile`);
  const operations = [];
  for (const [path, item] of Object.entries(contract?.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const auth = operation?.['x-auth-class'];
      if (typeof auth !== 'string' || !auth) throw new Error(`${method.toUpperCase()} ${path}: x-auth-class missing`);
      if (!profile.methods.includes(method) || profile.excludedPaths.includes(path)) continue;
      // Device routes take a device secret, browser routes a Firebase ID token.
      if ((role === 'device') !== (auth === 'device')) continue;
      operations.push({ method, path, auth });
    }
  }
  if (!operations.length) throw new Error(`No ${profileName} operations in scope for ${role}`);
  return operations;
}

export function pathValue(path, name, values = {}) {
  const value = values[`${path}|${name}`] ?? values[name] ?? UNKNOWN_ID;
  if (!SAFE_ID.test(value)) throw new Error(`Path value for ${name} must match ${SAFE_ID}`);
  return value;
}

const allowsString = schema => schema?.type === 'string' || (Array.isArray(schema?.type) && schema.type.includes('string'))
  || ['anyOf', 'oneOf'].some(key => Array.isArray(schema?.[key]) && schema[key].some(allowsString));

// Gives string properties named in `values` that value as their example, and
// string-array properties a one-element array, in place, through nested
// objects, arrays and combinators. References are left to the caller, which
// walks components.schemas separately.
function exampleIdentifiers(schema, values, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return;
  seen.add(schema);
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const value = values[name];
    if (typeof value === 'string' && SAFE_ID.test(value)) {
      if (allowsString(property)) property.example = value;
      else if (property?.type === 'array' && allowsString(property.items)) property.example = [value];
    }
    exampleIdentifiers(property, values, seen);
  }
  for (const key of ['items', 'additionalProperties']) exampleIdentifiers(schema[key], values, seen);
  for (const key of ['allOf', 'anyOf', 'oneOf']) for (const part of schema[key] ?? []) exampleIdentifiers(part, values, seen);
}

/**
 * A copy of the contract that holds only `operations`, names `origin` as its
 * only server and gives every path parameter, and every identifier query
 * parameter or body property named in `pathValues`, an example value. The ZAP
 * OpenAPI import uses examples when it builds each request.
 */
export function scopedContract(contract, operations, { origin, pathValues = {} }) {
  const scoped = structuredClone(contract);
  scoped.servers = [{ url: origin }];
  const identifiers = Object.fromEntries(Object.entries(pathValues).filter(([key]) => !key.includes('|')));
  for (const schema of Object.values(scoped.components?.schemas ?? {})) exampleIdentifiers(schema, identifiers);
  const keep = new Set(operations.map(operation => `${operation.method} ${operation.path}`));
  for (const [path, item] of Object.entries(scoped.paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.includes(method) && !keep.has(`${method} ${path}`)) delete item[method];
    }
    const methods = Object.keys(item).filter(method => HTTP_METHODS.includes(method));
    if (!methods.length) { delete scoped.paths[path]; continue; }
    const parameters = [...(item.parameters ?? []), ...methods.flatMap(method => item[method].parameters ?? [])];
    for (const parameter of parameters) {
      if (parameter.$ref) throw new Error(`${path}: parameter references are not supported`);
      if (parameter.in === 'path') parameter.example = pathValue(path, parameter.name, pathValues);
      else if (parameter.in === 'query' && typeof identifiers[parameter.name] === 'string' && allowsString(parameter.schema)) {
        parameter.example = pathValue(path, parameter.name, identifiers);
      }
    }
    for (const method of methods) {
      for (const media of Object.values(item[method].requestBody?.content ?? {})) exampleIdentifiers(media.schema, identifiers);
    }
  }
  return scoped;
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ZAP Automation Framework plan for one role. Secrets never enter it. */
export function automationPlan({ profileName, role, origin }) {
  const profile = profileFor(profileName);
  const maxScanDurationInMins = profile.maxScanDurationInMins[role];
  if (!Number.isInteger(maxScanDurationInMins)) throw new Error(`No scan budget for ${role}`);
  const rules = profileName === 'staging'
    ? STAGING_RULES.map(rule => ({ ...rule, strength: 'low', threshold: 'medium' }))
    : LOCAL_DISABLED_RULES.map(rule => ({ ...rule, threshold: 'off' }));
  const context = 'eki-api';
  return {
    env: {
      contexts: [{ name: context, urls: [origin], includePaths: [`${escapeRegex(origin)}/.*`] }],
      parameters: { failOnError: true, failOnWarning: false, progressToStdout: true },
    },
    jobs: [
      { type: 'passiveScan-config', parameters: { maxAlertsPerRule: 10, scanOnlyInScope: true } },
      { type: 'openapi', parameters: { apiFile: '/zap/wrk/openapi.json', targetUrl: origin, context } },
      { type: 'passiveScan-wait', parameters: { maxDuration: 2 } },
      {
        type: 'activeScan',
        parameters: {
          context,
          maxRuleDurationInMins: profile.maxRuleDurationInMins,
          maxScanDurationInMins,
          threadPerHost: profile.threadPerHost,
          delayInMs: profile.delayInMs,
          addQueryParam: false,
          handleAntiCSRFTokens: false,
          injectPluginIdInHeader: true,
          scanHeadersAllRequests: false,
          maxAlertsPerRule: 10,
        },
        policyDefinition: { defaultStrength: profile.defaultStrength, defaultThreshold: profile.defaultThreshold, rules },
      },
      { type: 'passiveScan-wait', parameters: { maxDuration: 2 } },
      {
        type: 'report',
        parameters: { template: 'traditional-json', reportDir: '/zap/wrk', reportFile: 'zap-report', reportTitle: `Eki ${profileName} DAST (${role})` },
        risks: ['info', 'low', 'medium', 'high'],
        confidences: ['low', 'medium', 'high', 'confirmed'],
      },
    ],
  };
}

export function decodeIdTokenClaims(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Not a JWT');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('Not a JWT');
  return claims;
}

export function parsePathValues(raw) {
  if (raw === undefined || raw.trim() === '') return {};
  let values;
  try { values = JSON.parse(raw); } catch { throw new Error('EKI_DAST_PATH_VALUES must be a JSON object'); }
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('EKI_DAST_PATH_VALUES must be a JSON object');
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`EKI_DAST_PATH_VALUES.${key} must match ${SAFE_ID}`);
  }
  return values;
}

/**
 * Preconditions for a hosted run. The caller names the approved origin and the
 * Cloud Run revision it expects to scan, and supplies one passenger and one
 * administrator ID token for two different dedicated test accounts.
 */
export function assertStagingRun(env, now = Date.now()) {
  if (env.EKI_DAST_CONFIRM_TARGET !== STAGING_ORIGIN) {
    throw new Error(`EKI_DAST_CONFIRM_TARGET must equal the approved staging origin ${STAGING_ORIGIN}`);
  }
  const revision = env.EKI_DAST_EXPECTED_REVISION?.trim() ?? '';
  if (!STAGING_REVISION.test(revision)) throw new Error('EKI_DAST_EXPECTED_REVISION must name the serving eki-backend-staging revision');
  const accounts = {};
  for (const [role, key] of [['passenger', 'EKI_DAST_PASSENGER_ID_TOKEN'], ['admin', 'EKI_DAST_ADMIN_ID_TOKEN']]) {
    const token = env[key]?.trim();
    if (!token) throw new Error(`${key}: required`);
    let claims;
    try { claims = decodeIdTokenClaims(token); } catch { throw new Error(`${key}: not a Firebase ID token`); }
    if (claims.aud !== STAGING_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${STAGING_PROJECT_ID}`) {
      throw new Error(`${key}: not issued for ${STAGING_PROJECT_ID}`);
    }
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 - now < STAGING_MIN_TOKEN_LIFETIME_MS) {
      throw new Error(`${key}: expires in less than ${STAGING_MIN_TOKEN_LIFETIME_MS / 60_000} minutes; sign in again`);
    }
    const admin = claims.admin === true && claims.role === 'admin';
    if (role === 'admin' && !admin) throw new Error(`${key}: the account has no administrator claims`);
    if (role === 'passenger' && (claims.admin === true || claims.role === 'admin' || claims.role === 'driver')) {
      throw new Error(`${key}: use a passenger account without administrator or operator claims`);
    }
    const uid = claims.user_id ?? claims.sub;
    if (typeof uid !== 'string' || !uid) throw new Error(`${key}: no user ID`);
    accounts[role] = { token, uid };
  }
  if (accounts.passenger.uid === accounts.admin.uid) throw new Error('Use two different dedicated test accounts');
  return {
    revision,
    tokens: { passenger: accounts.passenger.token, admin: accounts.admin.token },
    pathValues: parsePathValues(env.EKI_DAST_PATH_VALUES),
  };
}

const JWT = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Text with credentials, e-mail addresses and the target origin removed,
 * bounded in length. `markup` strips the HTML that ZAP writes in its prose
 * fields; attack strings and evidence keep theirs, because a reflected
 * `<script>` payload is the finding.
 */
export function redact(value, { secrets = [], origin, label = '<target>', limit = 300, markup = false } = {}) {
  let text = String(value ?? '');
  if (markup) text = text.replace(/<\/?[a-z][^>]*>/gi, ' ');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  if (origin) text = text.split(origin).join(label);
  text = text.replace(JWT, '[REDACTED_JWT]').replace(BEARER, 'Bearer [REDACTED]').replace(EMAIL, '[REDACTED_EMAIL]');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

/** A log with credentials removed and its lines kept. */
export function redactLog(text, secrets = []) {
  let value = String(text ?? '');
  for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
  return value.replace(JWT, '[REDACTED_JWT]').replace(BEARER, 'Bearer [REDACTED]');
}

const RISKS = ['Informational', 'Low', 'Medium', 'High'];
const CONFIDENCES = ['False Positive', 'Low', 'Medium', 'High', 'Confirmed'];

/** The alerts of one ZAP traditional-json report, without request headers, bodies or credentials. */
export function sanitizeZapReport(report, { role, ...options }) {
  const clean = (value, limit, markup = false) => redact(value, { ...options, limit, markup });
  const alerts = [];
  for (const site of Array.isArray(report?.site) ? report.site : []) {
    for (const alert of Array.isArray(site?.alerts) ? site.alerts : []) {
      const riskCode = Number(alert.riskcode);
      const confidenceCode = Number(alert.confidence);
      const instances = Array.isArray(alert.instances) ? alert.instances : [];
      alerts.push({
        role,
        pluginId: clean(alert.pluginid, 16),
        alertRef: clean(alert.alertRef ?? alert.pluginid, 24),
        name: clean(alert.name ?? alert.alert, 120),
        riskCode,
        risk: RISKS[riskCode] ?? 'Unknown',
        confidence: CONFIDENCES[confidenceCode] ?? 'Unknown',
        cweId: Number(alert.cweid),
        wascId: Number(alert.wascid),
        count: Number(alert.count) || instances.length,
        solution: clean(alert.solution, 400, true),
        instances: instances.slice(0, 5).map(instance => ({
          method: clean(instance.method, 10),
          uri: clean(instance.uri),
          param: clean(instance.param, 80),
          attack: clean(instance.attack, 160),
          evidence: clean(instance.evidence, 160),
          otherInfo: clean(instance.otherinfo, 300),
        })),
      });
    }
  }
  return { zapVersion: clean(report?.['@version'], 24), alerts };
}

/** One entry per alert reference across roles, with the roles that raised it. */
export function mergeAlerts(alerts) {
  const merged = new Map();
  for (const alert of alerts) {
    const existing = merged.get(alert.alertRef);
    if (!existing) {
      merged.set(alert.alertRef, { ...alert, roles: [alert.role], instances: [...alert.instances] });
      continue;
    }
    if (!existing.roles.includes(alert.role)) existing.roles.push(alert.role);
    existing.count += alert.count;
    existing.riskCode = Math.max(existing.riskCode, alert.riskCode);
    existing.risk = RISKS[existing.riskCode] ?? existing.risk;
    for (const instance of alert.instances) if (existing.instances.length < 5) existing.instances.push(instance);
  }
  return [...merged.values()]
    .map(({ role: _role, ...alert }) => alert)
    .sort((a, b) => b.riskCode - a.riskCode || a.alertRef.localeCompare(b.alertRef, 'en', { numeric: true }));
}

export const DISPOSITIONS = ['fixed', 'false-positive', 'accepted-risk', 'not-applicable'];

/**
 * Attaches the reviewed disposition to every alert. An alert of Low risk or
 * above with no disposition, or one recorded as fixed that appears again, is
 * untriaged and makes the run fail.
 */
export function applyTriage(alerts, triage, profileName) {
  for (const entry of triage) {
    if (!entry?.alertRef || !DISPOSITIONS.includes(entry.disposition) || !entry.rationale
      || !Array.isArray(entry.profiles) || !entry.profiles.every(name => name in PROFILES)) {
      throw new Error(`Invalid DAST triage entry: ${JSON.stringify(entry)}`);
    }
  }
  const triaged = alerts.map(alert => {
    const entry = triage.find(item => item.alertRef === alert.alertRef && item.profiles.includes(profileName)) ?? null;
    const reappeared = entry?.disposition === 'fixed';
    return { ...alert, triage: entry && !reappeared ? { disposition: entry.disposition, rationale: entry.rationale } : null,
      untriaged: alert.riskCode >= 1 && (!entry || reappeared), ...(reappeared ? { fixedAlertReappeared: true } : {}) };
  });
  return { alerts: triaged, untriaged: triaged.filter(alert => alert.untriaged).length };
}

export function riskCounts(alerts) {
  return Object.fromEntries(RISKS.map((risk, code) => [risk, alerts.filter(alert => alert.riskCode === code).length]));
}
