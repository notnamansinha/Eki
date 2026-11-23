import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './qa/acceptance-catalog.mjs';
import {
  LOCAL_DISABLED_RULES, LOCAL_PATH_VALUES, PROFILES, STAGING_MIN_TOKEN_LIFETIME_MS, STAGING_ORIGIN, STAGING_RULES, ZAP_IMAGE,
  applyTriage, assertStagingRun, automationPlan, mergeAlerts, redact, redactLog, sanitizeZapReport, scopedContract, selectOperations,
} from './qa/dast-plan.mjs';
import { dastTriage } from '../qa/dast-triage.mjs';

const contract = JSON.parse(readFileSync(resolve(repositoryRoot, 'backend/openapi.json'), 'utf8'));
const operationsOf = (profile, role) => selectOperations(contract, profile, role);
const now = Date.parse('2026-11-23T10:00:00Z');
const jwt = claims => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`;
const claims = extra => ({ aud: 'bustrack-be165', iss: 'https://securetoken.google.com/bustrack-be165',
  exp: Math.floor((now + STAGING_MIN_TOKEN_LIFETIME_MS + 60_000) / 1000), ...extra });
const stagingEnv = (overrides = {}) => ({
  EKI_DAST_CONFIRM_TARGET: STAGING_ORIGIN,
  EKI_DAST_EXPECTED_REVISION: 'eki-backend-staging-00012-x7q',
  EKI_DAST_PASSENGER_ID_TOKEN: jwt(claims({ user_id: 'test-passenger', role: 'passenger' })),
  EKI_DAST_ADMIN_ID_TOKEN: jwt(claims({ user_id: 'test-admin', role: 'admin', admin: true })),
  ...overrides,
});

test('the ZAP image is pinned by version and digest', () => {
  assert.match(ZAP_IMAGE, /^zaproxy\/zap-stable:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
});

test('the staging profile scans only GET operations, never device ingress or the billed Places search', () => {
  for (const role of PROFILES.staging.roles) {
    const operations = operationsOf('staging', role);
    assert(operations.length > 0);
    assert(operations.every(operation => operation.method === 'get'), role);
    assert(operations.every(operation => operation.auth !== 'device'), role);
    assert(!operations.some(operation => operation.path === '/api/places/search'), role);
  }
  const everyGet = Object.entries(contract.paths).flatMap(([path, item]) => Object.entries(item)
    .filter(([method, operation]) => method === 'get' && operation['x-auth-class'] !== 'device' && path !== '/api/places/search'));
  assert.equal(operationsOf('staging', 'admin').length, everyGet.length, 'every other GET operation stays in scope');
  assert.throws(() => operationsOf('staging', 'device'), /not part of the staging profile/);
});

test('the local profile covers every operation, with device routes scanned under the device role only', () => {
  const all = Object.values(contract.paths).flatMap(item => Object.keys(item).filter(method => ['get', 'post', 'put', 'patch', 'delete'].includes(method)));
  const browser = operationsOf('local', 'admin');
  const device = operationsOf('local', 'device');
  assert.equal(browser.length + device.length, all.length);
  assert(device.length > 0 && device.every(operation => operation.auth === 'device'));
  assert(browser.every(operation => operation.auth !== 'device'));
  assert.deepEqual(operationsOf('local', 'passenger'), browser);
});

test('an operation without an x-auth-class fails closed', () => {
  const broken = structuredClone(contract);
  delete broken.paths['/api/buses'].get['x-auth-class'];
  assert.throws(() => selectOperations(broken, 'local', 'admin'), /x-auth-class missing/);
});

test('the scoped contract keeps only the scanned operations and gives identifiers fixture examples', () => {
  const operations = operationsOf('local', 'admin');
  const scoped = scopedContract(contract, operations, { origin: 'http://host.docker.internal:3116', pathValues: LOCAL_PATH_VALUES });
  assert.deepEqual(scoped.servers, [{ url: 'http://host.docker.internal:3116' }]);
  const kept = Object.entries(scoped.paths).flatMap(([path, item]) => Object.keys(item).filter(method => method !== 'parameters').map(method => `${method} ${path}`));
  assert.deepEqual(kept.sort(), operations.map(operation => `${operation.method} ${operation.path}`).sort());
  const parameter = (path, method, name) => [...(scoped.paths[path].parameters ?? []), ...(scoped.paths[path][method].parameters ?? [])].find(item => item.name === name);
  assert.equal(parameter('/api/buses/{busId}', 'get', 'busId').example, 'qa_bus');
  assert.equal(parameter('/api/fleet/drivers/{id}', 'put', 'id').example, 'qa_driver');
  assert.equal(parameter('/api/fleet/buses/{id}', 'put', 'id').example, 'qa_bus');
  assert.equal(parameter('/api/buses', 'get', 'routeId').example, 'qa_route');
  const bodyExamples = name => {
    const found = new Set();
    JSON.stringify(scoped, (key, value) => { if (value?.properties?.[name]) found.add(JSON.stringify(value.properties[name].example)); return value; });
    return [...found];
  };
  assert.deepEqual(bodyExamples('assignedRoutes'), ['["qa_route"]'], 'string arrays get a one-element example');
  assert.deepEqual(bodyExamples('assignedBusId'), ['"qa_bus"'], 'nullable strings get an example');
  assert.deepEqual(bodyExamples('authUid'), ['"qa_other"'], 'operator assignments never name the scanning identities');
  assert.equal(JSON.stringify(contract).includes('qa_bus'), false, 'the repository contract is not modified');
  const staging = scopedContract(contract, operationsOf('staging', 'admin'), { origin: STAGING_ORIGIN });
  const stagingParameter = staging.paths['/api/buses/{busId}'].get.parameters.find(item => item.name === 'busId');
  assert.equal(stagingParameter.example, 'dast-probe', 'staging uses a placeholder unless the caller names an ID');
  assert(Object.values(staging.paths).every(item => Object.keys(item).every(method => ['get', 'parameters'].includes(method))));
});

test('unsafe identifier values are refused before they reach a URL', () => {
  assert.throws(() => scopedContract(contract, operationsOf('local', 'admin'), { origin: 'http://127.0.0.1:3116', pathValues: { busId: '../x' } }), /must match/);
  assert.throws(() => assertStagingRun(stagingEnv({ EKI_DAST_PATH_VALUES: '{"routeId":"a b"}' }), now), /must match/);
  assert.throws(() => assertStagingRun(stagingEnv({ EKI_DAST_PATH_VALUES: '[1]' }), now), /JSON object/);
});

test('the staging plan enables only the reviewed GET rules at low strength, paced under the read budget', () => {
  const plan = automationPlan({ profileName: 'staging', role: 'admin', origin: STAGING_ORIGIN });
  const scan = plan.jobs.find(job => job.type === 'activeScan');
  assert.equal(scan.policyDefinition.defaultThreshold, 'off');
  assert.deepEqual(scan.policyDefinition.rules.map(rule => rule.id), STAGING_RULES.map(rule => rule.id));
  for (const forbidden of [90028, 20018, 40025, 40045, 40043, 40046]) assert(!STAGING_RULES.some(rule => rule.id === forbidden), `rule ${forbidden}`);
  assert(scan.policyDefinition.rules.every(rule => rule.strength === 'low' && rule.threshold === 'medium'));
  assert.equal(scan.parameters.threadPerHost, 1);
  assert(60_000 / scan.parameters.delayInMs < 200, 'one thread stays under 200 reads a minute per user');
  assert(scan.parameters.maxScanDurationInMins <= 15 && scan.parameters.maxRuleDurationInMins <= 2);
  assert.deepEqual(plan.env.contexts[0].includePaths, ['https://eki-backend-staging-449313371438\\.asia-south2\\.run\\.app/.*']);
  assert.doesNotMatch(JSON.stringify(plan), /Bearer|eyJ/);
  const local = automationPlan({ profileName: 'local', role: 'admin', origin: 'http://127.0.0.1:3116' })
    .jobs.find(job => job.type === 'activeScan');
  assert.deepEqual(local.policyDefinition.rules.map(rule => [rule.id, rule.threshold]), LOCAL_DISABLED_RULES.map(rule => [rule.id, 'off']));
});

test('a staging run needs the approved origin, the serving revision and two unexpired test-account tokens', () => {
  const run = assertStagingRun(stagingEnv(), now);
  assert.equal(run.revision, 'eki-backend-staging-00012-x7q');
  assert.deepEqual(Object.keys(run.tokens), ['passenger', 'admin']);
  const refused = [
    [{ EKI_DAST_CONFIRM_TARGET: 'https://bustrack-be165.web.app' }, /approved staging origin/],
    [{ EKI_DAST_CONFIRM_TARGET: undefined }, /approved staging origin/],
    [{ EKI_DAST_EXPECTED_REVISION: 'latest' }, /serving eki-backend-staging revision/],
    [{ EKI_DAST_ADMIN_ID_TOKEN: '' }, /EKI_DAST_ADMIN_ID_TOKEN: required/],
    [{ EKI_DAST_PASSENGER_ID_TOKEN: 'not-a-token' }, /not a Firebase ID token/],
    [{ EKI_DAST_ADMIN_ID_TOKEN: jwt(claims({ user_id: 'a', role: 'admin', admin: true, aud: 'other-project' })) }, /not issued for bustrack-be165/],
    [{ EKI_DAST_ADMIN_ID_TOKEN: jwt(claims({ user_id: 'a', role: 'admin', admin: true, exp: Math.floor(now / 1000) + 600 })) }, /sign in again/],
    [{ EKI_DAST_ADMIN_ID_TOKEN: jwt(claims({ user_id: 'a', role: 'passenger' })) }, /no administrator claims/],
    [{ EKI_DAST_PASSENGER_ID_TOKEN: jwt(claims({ user_id: 'p', role: 'admin', admin: true })) }, /passenger account/],
    [{ EKI_DAST_PASSENGER_ID_TOKEN: jwt(claims({ user_id: 'p', role: 'driver' })) }, /passenger account/],
    [{ EKI_DAST_PASSENGER_ID_TOKEN: jwt(claims({ user_id: 'test-admin', role: 'passenger' })) }, /two different dedicated test accounts/],
  ];
  for (const [overrides, message] of refused) assert.throws(() => assertStagingRun(stagingEnv(overrides), now), message);
});

test('sanitized alerts carry no credentials, e-mail addresses, origin or markup, and stay bounded', () => {
  const token = jwt({ sub: 'secret-user' });
  const raw = { '@version': '2.17.0', site: [{ '@name': 'http://host.docker.internal:3116', alerts: [{
    pluginid: '10021', alertRef: '10021', alert: 'X-Content-Type-Options Header Missing', riskcode: '1', confidence: '2',
    cweid: '693', wascid: '15', count: '7', solution: '<p>Set the header.</p>',
    instances: Array.from({ length: 9 }, (_, index) => ({
      uri: `http://host.docker.internal:3116/api/buses/${index}`, method: 'GET', param: '', attack: `Bearer ${token}`,
      evidence: `qa_admin@example.invalid ${'x'.repeat(400)}`, otherinfo: `Authorization: Device synthetic-browser-device-only`,
    })),
  }] }] };
  const { zapVersion, alerts } = sanitizeZapReport(raw, { role: 'admin', secrets: ['synthetic-browser-device-only'],
    origin: 'http://host.docker.internal:3116', label: '<local-backend>' });
  assert.equal(zapVersion, '2.17.0');
  const [alert] = alerts;
  assert.equal(alert.risk, 'Low');
  assert.equal(alert.instances.length, 5);
  assert.equal(alert.solution, 'Set the header.');
  const text = JSON.stringify(alerts);
  for (const leaked of [token, 'secret-user', 'qa_admin@example.invalid', 'synthetic-browser-device-only', 'host.docker.internal']) {
    assert(!text.includes(leaked), leaked);
  }
  assert.equal(alert.instances[0].uri, '<local-backend>/api/buses/0');
  assert.equal(redact('<scrIpt>alert(1);</scRipt>'), '<scrIpt>alert(1);</scRipt>', 'attack payloads keep their markup');
  assert(alert.instances[0].evidence.length <= 163);
  assert.equal(redact('Bearer abcdefghijklmnopqrstuvwxyz'), 'Bearer [REDACTED]');
  assert.equal(redactLog(`line one ${token}\nline two`, []), 'line one [REDACTED_JWT]\nline two');
});

test('alerts merge across roles, and every Low or higher alert needs a disposition', () => {
  const alert = (role, alertRef, riskCode) => ({ role, alertRef, pluginId: alertRef, name: alertRef, riskCode, risk: '', count: 1, instances: [] });
  const merged = mergeAlerts([alert('passenger', '10021', 1), alert('admin', '10021', 1), alert('admin', '10049', 0)]);
  assert.deepEqual(merged.map(item => [item.alertRef, item.roles, item.count]), [['10021', ['passenger', 'admin'], 2], ['10049', ['admin'], 1]]);
  assert.equal(applyTriage(merged, [], 'local').untriaged, 1);
  const accepted = applyTriage(merged, [{ alertRef: '10021', profiles: ['local'], disposition: 'accepted-risk', rationale: 'Reviewed.' }], 'local');
  assert.equal(accepted.untriaged, 0);
  assert.equal(accepted.alerts[0].triage.disposition, 'accepted-risk');
  assert.equal(applyTriage(merged, [{ alertRef: '10021', profiles: ['local'], disposition: 'accepted-risk', rationale: 'Reviewed.' }], 'staging').untriaged, 1,
    'a local disposition does not cover staging');
  const regressed = applyTriage(merged, [{ alertRef: '10021', profiles: ['local'], disposition: 'fixed', rationale: 'Fixed in #503.' }], 'local');
  assert.equal(regressed.untriaged, 1);
  assert.equal(regressed.alerts[0].fixedAlertReappeared, true);
  assert.throws(() => applyTriage(merged, [{ alertRef: '10021', profiles: ['local'], disposition: 'ignored', rationale: 'x' }], 'local'));
});

test('the triage register is well formed', () => {
  assert.doesNotThrow(() => applyTriage([], dastTriage, 'local'));
});
