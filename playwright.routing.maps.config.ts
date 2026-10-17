import { defineConfig } from "@playwright/test";
// Manual opt-in provider check. Never included in the offline or default suite.
export default defineConfig({
  testDir: "./e2e/routing/live-maps", testMatch: "in-app.spec.ts", workers: 1,
  outputDir: "artifacts/routing-in-app-maps", timeout: 90_000,
  reporter: [["list"], ["json", { outputFile: "artifacts/routing-in-app-maps/results.json" }]],
  use: { baseURL: "http://127.0.0.1:3163", viewport: { width: 1920, height: 1080 }, trace: "off", actionTimeout: 10_000 },
  webServer: { command: "node node_modules/vite/bin/vite.js --config e2e/routing/live-maps/vite.config.mts",
    url: "http://127.0.0.1:3163", reuseExistingServer: true },
});
