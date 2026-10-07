import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: local("."),
  server: { host: "127.0.0.1", port: Number(process.env.EKI_QA_PORT || 3100), strictPort: true },
  resolve: { alias: [
    ...["@/hooks/useAuth", "@/hooks/useRoutes", "@/hooks/useLiveRouteCatalog", "@/hooks/useSettings", "@/hooks/useRTDBResume", "@/hooks/useDynamicRouteGeometries", "@/lib/liveBusStore", "@/lib/joinedRideStatus", "@/lib/authState"].map(find => ({ find, replacement: local("state.ts") })),
    ...["@/components/passenger/AccountTab", "@/components/shared/MessagingPanel", "@/components/shared/FeedbackModal", "@/components/passenger/PassengerBoardingView"].map(find => ({ find, replacement: local("panels.tsx") })),
    { find: "@vis.gl/react-google-maps", replacement: local("map-adapter.tsx") },
    { find: "@/components/maps/DirectionsRoute", replacement: local("map-adapter.tsx") },
    { find: "next/dynamic", replacement: local("dynamic.tsx") },
    { find: "@", replacement: local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } },
  define: { "process.env": "{}" },
  oxc: { jsx: { runtime: "automatic" } },
});
