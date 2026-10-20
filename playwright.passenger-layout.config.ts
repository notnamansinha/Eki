import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/passenger-layout", workers: 1, timeout: 30_000,
  outputDir: "artifacts/passenger-layout",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config e2e/fixtures/vite.config.mts",
    url: "http://127.0.0.1:3100", reuseExistingServer: false,
  },
  projects: [
    { name: "narrow", use: { viewport: { width: 360, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
