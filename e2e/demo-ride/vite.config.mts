import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { parse } from "dotenv";
import tailwindcss from "@tailwindcss/postcss";

// Demo ride fixture: the real passenger layout, workspace, boarding view,
// map logic and road drawing, with the shared synthetic auth, routes and live
// catalog (e2e/fixtures). The demo ride is the production simulator.
//
// By default the Google Maps SDK is the synthetic adapter in maps.tsx. For a
// local recording on real tiles, set EKI_DEMO_ENV_FILE to a frontend env file
// holding the browser Maps key and map ID; the fixture then serves on
// http://localhost:3001, an allowed referrer of that key. Never commit a key.
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const envFile = process.env.EKI_DEMO_ENV_FILE;
const env = envFile ? parse(readFileSync(envFile)) : {};
const realMaps = Boolean(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && env.NEXT_PUBLIC_GOOGLE_MAP_ID);
if (envFile && !realMaps) throw new Error("EKI_DEMO_ENV_FILE needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and NEXT_PUBLIC_GOOGLE_MAP_ID.");

export default defineConfig({
  root: local("."),
  publicDir: local("../../frontend/public"),
  cacheDir: local("../../node_modules/.vite-demo-ride"),
  server: realMaps
    ? { host: "localhost", port: 3001, strictPort: true }
    : { host: "127.0.0.1", port: Number(process.env.EKI_DEMO_PORT || 3131), strictPort: true },
  resolve: { alias: [
    ...["@/hooks/useAuth", "@/hooks/useRoutes", "@/hooks/usePassengerRouteConfig", "@/hooks/useLiveRouteCatalog", "@/hooks/useSettings", "@/hooks/useRTDBResume", "@/hooks/useDynamicRouteGeometries", "@/lib/liveBusStore", "@/lib/joinedRideStatus", "@/lib/authState"].map(find => ({ find, replacement: local("../fixtures/state.ts") })),
    ...["@/lib/firebaseAuth", "@/lib/feedbackStore", "@/lib/apiClient"].map(find => ({ find, replacement: local("../fixtures/providers.ts") })),
    { find: "@/components/shared/MessagingPanel", replacement: local("../fixtures/panels.tsx") },
    ...["@/components/shared/RoleGuard", "@/components/shared/WorkspacePrefetch"].map(find => ({ find, replacement: local("../fixtures/passthrough.tsx") })),
    { find: /^next\/link$/, replacement: local("../fixtures/next-stubs.tsx") },
    { find: "next/dynamic", replacement: local("../fixtures/dynamic.tsx") },
    ...(realMaps ? [] : [{ find: "@vis.gl/react-google-maps", replacement: local("maps.tsx") }]),
    { find: "@", replacement: local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss({ base: local("../../frontend") })] } },
  define: {
    // The demo ride is off unless turned on; this fixture exists to show it.
    "process.env": JSON.stringify({
      NEXT_PUBLIC_DEMO_RIDE: "true",
      ...(realMaps ? {
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
        NEXT_PUBLIC_GOOGLE_MAP_ID: env.NEXT_PUBLIC_GOOGLE_MAP_ID,
      } : {}),
    }),
  },
  oxc: { jsx: { runtime: "automatic" } },
});
