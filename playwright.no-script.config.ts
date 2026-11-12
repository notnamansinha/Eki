import { defineConfig, devices } from "@playwright/test";

// Runs against the built static export (`npm run build` first) with JavaScript
// disabled, served with the firebase.json security headers.
const port = Number(process.env.EKI_NOSCRIPT_PORT || 3129);

export default defineConfig({
  testDir: "./e2e/no-script",
  timeout: 30_000,
  outputDir: "artifacts/no-script",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    javaScriptEnabled: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/no-script/serve-export.mjs",
    url: `http://127.0.0.1:${port}/install`,
    reuseExistingServer: false,
    env: { EKI_NOSCRIPT_PORT: String(port) },
  },
  projects: [
    { name: "android-small", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: "android", use: devices["Pixel 7"] },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
