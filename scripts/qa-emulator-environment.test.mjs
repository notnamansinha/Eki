import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEmulatorBrowserLaunch, removeGeneratedDemoConfig } from './qa/emulator-environment.mjs';
import { safetyPreflight } from './qa/safety-preflight.mjs';

const wrapperEnvironment = { GCLOUD_PROJECT: 'demo-eki-qa', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9005', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9095',
  FIREBASE_DATABASE_URL: 'http://127.0.0.1:9005/', EKI_QA_BASE_URL: 'http://127.0.0.1:3116/',
  EKI_QA_EXTERNAL_PROVIDERS: 'mock', EKI_QA_CONFIRM_DISPOSABLE: '1' };

test('a direct emulator Playwright run names the supported qa:browser entry point', () => {
  assert.throws(() => assertEmulatorBrowserLaunch({}),
    /\(playwright\.emulator\.config\.ts\) cannot run directly: GCLOUD_PROJECT: required for emulator QA\. Run `npm run qa:browser`/);
  const { FIRESTORE_EMULATOR_HOST, ...noEmulators } = wrapperEnvironment;
  assert.ok(FIRESTORE_EMULATOR_HOST);
  assert.throws(() => assertEmulatorBrowserLaunch(noEmulators), /FIRESTORE_EMULATOR_HOST: required.*npm run qa:browser/);
  assert.throws(() => assertEmulatorBrowserLaunch({ ...wrapperEnvironment, GCLOUD_PROJECT: 'bustrack-be165' }),
    /approved demo project required.*npm run qa:browser/);
  assert.doesNotThrow(() => assertEmulatorBrowserLaunch(wrapperEnvironment));
});

test('the browser backend fixture checks its launch before it touches any SDK', () => {
  const fixture = readFileSync(new URL('../e2e/emulator/backend.mjs', import.meta.url), 'utf8');
  const guard = fixture.indexOf('\nassertEmulatorBrowserLaunch(process.env);');
  assert.ok(guard > 0, 'e2e/emulator/backend.mjs must call assertEmulatorBrowserLaunch(process.env)');
  assert.ok(guard < fixture.indexOf("require('firebase-admin/app')"), 'the launch check must run before Firebase Admin loads');
});

test('only the CLI-generated demo config can be removed before SDK import', () => {
  const config = { projectId: 'demo-eki-qa', storageBucket: 'demo-eki-qa.appspot.com', databaseURL: 'https://demo-eki-qa.firebaseio.com' };
  const env = { GCLOUD_PROJECT: 'demo-eki-qa', FIREBASE_CONFIG: JSON.stringify(config) };
  assert.throws(() => safetyPreflight(env), /FIREBASE_CONFIG/);
  assert.equal(removeGeneratedDemoConfig(env), true);
  assert.equal(env.FIREBASE_CONFIG, undefined);
  assert.equal(safetyPreflight(env).configAccepted, true);
  for (const candidate of [null, {}, { ...config, projectId: 'production' },
    { ...config, databaseURL: 'https://production.firebaseio.com' }, { ...config, private_key: 'synthetic' }]) {
    assert.throws(() => removeGeneratedDemoConfig({ GCLOUD_PROJECT: 'demo-eki-qa', FIREBASE_CONFIG: JSON.stringify(candidate) }));
  }
  assert.throws(() => removeGeneratedDemoConfig({ GCLOUD_PROJECT: 'wrong', FIREBASE_CONFIG: JSON.stringify(config) }));
  assert.throws(() => removeGeneratedDemoConfig({ GCLOUD_PROJECT: 'demo-eki-qa', FIREBASE_CONFIG: 'invalid' }));
});
