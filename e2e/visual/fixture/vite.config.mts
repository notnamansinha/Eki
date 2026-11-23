import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const auditState = local("../../production-audit/state.ts");

// Public pages and the real admin page and panels on synthetic boundaries for
// the visual baseline suite. Nothing here reaches Firebase, Maps or the API.
export default defineConfig({
  root: local("."),
  publicDir: local("../../../frontend/public"),
  server: { host: "127.0.0.1", port: Number(process.env.EKI_VISUAL_SURFACE_PORT || 3142), strictPort: true },
  resolve: { alias: [
    { find: "@/hooks/useAuth", replacement: local("auth.ts") },
    ...["@/hooks/useRoutes", "@/hooks/usePassengerRouteConfig", "@/hooks/useLiveRouteCatalog", "@/hooks/useSettings", "@/hooks/useRTDBResume",
      "@/hooks/useDynamicRouteGeometries", "@/lib/liveBusStore", "@/lib/joinedRideStatus", "@/lib/authState", "@/hooks/useBuses",
      "@/hooks/useDrivers", "@/hooks/useCollection"].map(find => ({ find, replacement: auditState })),
    { find: "@/lib/firebaseAuth", replacement: local("firebase-auth.ts") },
    { find: "@/lib/feedbackStore", replacement: local("feedback.ts") },
    { find: "@/components/shared/MessagingPanel", replacement: local("../../fixtures/panels.tsx") },
    ...["@/components/shared/RoleGuard", "@/components/shared/WorkspacePrefetch"].map(find => ({ find, replacement: local("../../fixtures/passthrough.tsx") })),
    { find: /^next\/link$/, replacement: local("../../fixtures/next-stubs.tsx") },
    { find: /^next\/image$/, replacement: local("next-image.tsx") },
    { find: /^next\/navigation$/, replacement: local("next-navigation.ts") },
    { find: "next/dynamic", replacement: local("../../fixtures/dynamic.tsx") },
    { find: "@vis.gl/react-google-maps", replacement: local("../../fixtures/map-adapter.tsx") },
    { find: "@/components/maps/DirectionsRoute", replacement: local("../../fixtures/map-adapter.tsx") },
    { find: "@", replacement: local("../../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } },
  define: { "process.env": JSON.stringify({ NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:3142" }) },
  oxc: { jsx: { runtime: "automatic" } },
});
