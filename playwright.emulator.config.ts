import { defineConfig, devices } from '@playwright/test';
// Only `npm run qa:browser` (scripts/run-rules-emulator.mjs --browser) starts the
// disposable emulators this suite needs. A direct run stops in the backend
// fixture (assertEmulatorBrowserLaunch) with an error that names that command.
// The fixture servers start inside a fresh emulator session. On a loaded Windows
// host (issue #500) the first Vite start after `npm ci` took 33 s to answer and
// the backend fixture took from 5 s to more than 30 s while the emulators warmed
// up, so a 30 s start budget blocked whole runs before any test executed. 90 s
// each stays well inside run-browser-tests' 6 min and the launcher's 8 min
// deadlines, and a fixture that never starts still fails the run.
const serverStartMs = 90_000;
export default defineConfig({
  testDir: './e2e', testMatch: 'emulator-acceptance.spec.ts', timeout: 30000, workers: 1, retries: 0,
  grep: process.env.EKI_QA_BROWSER_SCOPE === 'providers' ? /provider quota/ : process.env.EKI_QA_BROWSER_SCOPE === 'service' ? /admin live service controls/ : undefined,
  outputDir: 'artifacts/qa/browser-results',
  reporter: [['list'], ['./e2e/emulator/progress-reporter.mts'], ['json', { outputFile: 'artifacts/qa/browser-playwright.json' }], ['junit', { outputFile: 'artifacts/qa/browser-junit.xml' }]],
  use: { baseURL: 'http://127.0.0.1:3115', trace: 'off', screenshot: 'only-on-failure',
    permissions: ['geolocation'], geolocation: { latitude: 23, longitude: 72, accuracy: 5 } },
  webServer: [
    { command: 'node --import ./scripts/qa/network-guard.mjs e2e/emulator/backend.mjs', url: 'http://127.0.0.1:3117/evidence', reuseExistingServer: false, timeout: serverStartMs,
      // Exercise the maximum supported passenger revocation-cache window so
      // retirement checks prove storage fencing rather than cache expiry.
      env: { PORT: '3116', CORS_ORIGIN: 'http://127.0.0.1:3115', NODE_ENV: 'development', API_APPCHECK_MODE: 'off', AUTH_REVOCATION_CACHE_MS: '60000' } },
    { command: 'node node_modules/vite/bin/vite.js --config e2e/emulator/vite.config.mts', url: 'http://127.0.0.1:3115', reuseExistingServer: false, timeout: serverStartMs },
  ],
  projects: [
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
