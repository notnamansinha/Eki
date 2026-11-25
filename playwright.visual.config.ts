import { defineConfig, devices } from "@playwright/test";

// Visual and accessibility-tree baselines (qa/VISUAL_BASELINES.md). Start it
// with `npm run qa:visual`: scripts/qa/run-visual.mjs runs the browsers in the
// pinned Linux image and passes their endpoint here, so every baseline is
// rendered by the same browser build and fonts on any host.
const wsEndpoint = process.env.EKI_VISUAL_WS_ENDPOINT;
if (!wsEndpoint) {
  throw new Error("Run the visual baselines with `npm run qa:visual`; they are only valid from the pinned browser image.");
}
const passengerPort = 3141;
const surfacePort = 3142;

export default defineConfig({
  testDir: "./e2e/visual",
  testIgnore: ["fixture/**"],
  globalSetup: "./e2e/visual/warm-up.ts",
  outputDir: "artifacts/visual/results",
  snapshotPathTemplate: "{testDir}/baselines/{projectName}/{arg}{ext}",
  timeout: 60_000,
  workers: 2,
  reporter: [["list"], ["html", { outputFolder: "artifacts/visual/report", open: "never" }], ["json", { outputFile: "artifacts/visual/results.json" }]],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    connectOptions: { wsEndpoint, exposeNetwork: "<loopback>" },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node node_modules/vite/bin/vite.js --config e2e/fixtures/vite.config.mts",
      url: `http://127.0.0.1:${passengerPort}`,
      env: { EKI_QA_PORT: String(passengerPort) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node node_modules/vite/bin/vite.js --config e2e/visual/fixture/vite.config.mts",
      url: `http://127.0.0.1:${surfacePort}`,
      env: { EKI_VISUAL_SURFACE_PORT: String(surfacePort) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    // The iPad viewport, touch and user agent, rendered by Chromium like the other projects.
    { name: "tablet", use: { ...devices["iPad Pro 11"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
