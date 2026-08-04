import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Firebase Admin creates its RTDB client while application modules load.
    // Unit tests do not contact that URL, but Admin still requires a syntactically
    // valid database URL before those imports run.
    setupFiles: ["./src/testSetup.ts"],
  },
});
