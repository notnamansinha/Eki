import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/production-audit", workers: 1, timeout: 45_000,
  outputDir: "artifacts/production-audit", reporter: [["list"], ["json", { outputFile: "artifacts/production-audit/results.json" }]],
  use: { baseURL: "http://127.0.0.1:3123", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --config e2e/production-audit/vite.config.mts", url: "http://127.0.0.1:3123", reuseExistingServer: false },
  projects: [
    { name: "narrow", use: { viewport: { width: 360, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
