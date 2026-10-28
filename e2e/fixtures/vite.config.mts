import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: local("."),
  server: { host: "127.0.0.1", port: Number(process.env.EKI_QA_PORT || 3100), strictPort: true },
  resolve: { alias: [
    ...["@/hooks/useAuth", "@/hooks/useRoutes", "@/hooks/useLiveRouteCatalog", "@/hooks/useSettings", "@/hooks/useRTDBResume", "@/hooks/useDynamicRouteGeometries", "@/lib/liveBusStore", "@/lib/joinedRideStatus", "@/lib/authState"].map(find => ({ find, replacement: local("state.ts") })),
    // Profile and feedback render for real; only their provider boundaries are synthetic.
    ...["@/lib/firebaseAuth", "@/lib/feedbackStore", "@/lib/apiClient"].map(find => ({ find, replacement: local("providers.ts") })),
    ...["@/components/shared/MessagingPanel", "@/components/passenger/PassengerBoardingView",
      "@/components/admin/DashboardPanel", "@/components/admin/RouteManagementPanel", "@/components/admin/FleetManagementPanel",
      "@/components/admin/RideHistoryPanel", "@/components/admin/FeedbackPanel"].map(find => ({ find, replacement: local("panels.tsx") })),
    ...["@/components/shared/RoleGuard", "@/components/shared/WorkspacePrefetch"].map(find => ({ find, replacement: local("passthrough.tsx") })),
    { find: /^next\/link$/, replacement: local("next-stubs.tsx") },
    { find: "@vis.gl/react-google-maps", replacement: local("map-adapter.tsx") },
    { find: "@/components/maps/DirectionsRoute", replacement: local("map-adapter.tsx") },
    { find: "next/dynamic", replacement: local("dynamic.tsx") },
    { find: "@", replacement: local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } },
  define: { "process.env": "{}" },
  oxc: { jsx: { runtime: "automatic" } },
});
