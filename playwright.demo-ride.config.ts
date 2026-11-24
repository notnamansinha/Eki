import { defineConfig } from "@playwright/test";
const baseURL = `http://127.0.0.1:${process.env.EKI_DEMO_PORT || 3131}`;
export default defineConfig({
  testDir: "./e2e/demo-ride", workers: 1, timeout: 60_000,
  outputDir: "artifacts/demo-ride", reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --config e2e/demo-ride/vite.config.mts", url: baseURL, reuseExistingServer: false },
  projects: [ { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } } ],
});
