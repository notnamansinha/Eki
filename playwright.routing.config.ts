import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/routing", testIgnore: ["**/live-maps/**"], outputDir: "artifacts/routing-browser", workers: 1,
  reporter: [["list"], ["json", { outputFile: "artifacts/routing-browser/results.json" }]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3162", trace: "on" },
  webServer: { command: "node node_modules/vite/bin/vite.js --config e2e/routing/vite.config.mts",
    url: "http://127.0.0.1:3162", reuseExistingServer: false },
});
