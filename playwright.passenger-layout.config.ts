import { defineConfig } from "@playwright/test";
const baseURL = `http://127.0.0.1:${process.env.EKI_QA_PORT || 3100}`;

export default defineConfig({
  testDir: "./e2e/passenger-layout", workers: 1, timeout: 30_000,
  outputDir: "artifacts/passenger-layout",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config e2e/fixtures/vite.config.mts",
    url: baseURL, reuseExistingServer: false,
  },
  projects: [
    { name: "narrow", use: { viewport: { width: 360, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "reported-phone", use: { viewport: { width: 440, height: 956 } } },
    { name: "short-desktop", use: { viewport: { width: 1280, height: 585 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
