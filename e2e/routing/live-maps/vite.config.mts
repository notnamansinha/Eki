import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { parse } from "dotenv";
import tailwindcss from "@tailwindcss/postcss";
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const envFile = process.env.EKI_MAPS_ENV_FILE;
if (!envFile) throw new Error("Set EKI_MAPS_ENV_FILE to the configured frontend .env.local for this manual live-provider check.");
const env = parse(readFileSync(envFile));
if (!env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || !env.NEXT_PUBLIC_GOOGLE_MAP_ID) throw new Error("Configured browser Maps key and map ID are required.");
const adapters = local("./store.tsx");
const boundary = /\/(?:hooks\/(?:useActiveBuses|useBuses|useDrivers|useRoutes|useAuth|useRTDBResume)|lib\/(?:liveBusStore|firebaseAuth|firebaseDatabase|firebaseFirestore|authState))$/;
export default defineConfig({
  root: local("."), cacheDir: local("../../../artifacts/routing-in-app-vite-cache"),
  server: { host: "127.0.0.1", port: 3163, strictPort: true },
  plugins: [{ name: "routing-simulation-boundaries", enforce: "pre",
    resolveId(id) {
      const normalized = id.replaceAll("\\", "/").replace(/\.(tsx?|jsx?)$/, "");
      if (boundary.test(normalized) || /(?:^|\/)(?:liveBusStore|firebaseAuth|firebaseDatabase|firebaseFirestore|authState)$/.test(normalized) || id === "firebase/database") return adapters;
      if (id === "@/components/shared/MessagingPanel") return local("./excluded-messaging.tsx");
      if (id === "virtual:eki-route-fixture") return "\0eki-route-fixture";
    },
    load(id) {
      if (id !== "\0eki-route-fixture") return;
      const fixture = JSON.parse(readFileSync(local("../../../artifacts/routing-provider/result.json"), "utf8"));
      if (!fixture.passed || fixture.directions.length !== 2) throw new Error("A successful cached two-direction Google Routes probe is required.");
      return `export default ${JSON.stringify(fixture)};`;
    },
  }],
  resolve: { alias: { "@": local("../../../frontend/src") } },
  css: { postcss: { plugins: [tailwindcss()] } },
  define: { "process.env": JSON.stringify({
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    NEXT_PUBLIC_GOOGLE_MAP_ID: env.NEXT_PUBLIC_GOOGLE_MAP_ID,
  }) },
  oxc: { jsx: { runtime: "automatic" } },
});
