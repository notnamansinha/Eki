import { safetyPreflight } from './safety-preflight.mjs';

/**
 * The emulator-mode safety preflight for the browser suite's backend fixture.
 * playwright.emulator.config.ts needs the disposable emulators and the demo
 * environment that only scripts/run-rules-emulator.mjs creates. A direct
 * `playwright test --config playwright.emulator.config.ts` used to stop with a
 * bare "GCLOUD_PROJECT: required for emulator QA". There is no safe default to
 * fill in (without the emulators the fixture has nothing to talk to), so keep
 * failing closed and name the supported entry point.
 */
export function assertEmulatorBrowserLaunch(env) {
  try {
    safetyPreflight(env, { mode: 'emulator' });
  } catch (error) {
    throw new Error(`The emulator browser suite (playwright.emulator.config.ts) cannot run directly: ${error.message}. ` +
      'Run `npm run qa:browser` (or qa:browser:providers / qa:browser:service), which builds the backend, ' +
      'starts the disposable demo-eki-qa emulators and sets this environment for Playwright.');
  }
}

// firebase-tools synthesizes this demo-only configuration in emulators:exec.
// Validate its exact shape, then remove it before any SDK can select its URLs.
// The outer launcher still rejects every inherited FIREBASE_CONFIG.
export function removeGeneratedDemoConfig(env) {
  if (!env.FIREBASE_CONFIG) return false;
  let config;
  try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('Unexpected emulator-generated Firebase configuration'); }
  const expected = { projectId: 'demo-eki-qa', storageBucket: 'demo-eki-qa.appspot.com', databaseURL: 'https://demo-eki-qa.firebaseio.com' };
  if (env.GCLOUD_PROJECT !== expected.projectId || !config ||
    Object.keys(config).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => config[key] !== value)) {
    throw new Error('Unexpected emulator-generated Firebase configuration');
  }
  delete env.FIREBASE_CONFIG;
  return true;
}
