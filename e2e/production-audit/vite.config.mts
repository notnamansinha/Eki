import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: local("."), server: { host: "127.0.0.1", port: 3123, strictPort: true },
  resolve: { alias: [
    ...["@/hooks/useAuth", "@/hooks/useRoutes", "@/hooks/useLiveRouteCatalog", "@/hooks/useSettings", "@/hooks/useRTDBResume", "@/hooks/useDynamicRouteGeometries", "@/lib/liveBusStore", "@/lib/joinedRideStatus", "@/lib/authState", "@/hooks/useBuses", "@/hooks/useDrivers", "@/hooks/useCollection", "@/lib/firebaseAuth"].map(find => ({ find, replacement: local("state.ts") })),
    ...["@/components/passenger/AccountTab", "@/components/shared/MessagingPanel", "@/components/shared/FeedbackModal", "@/components/passenger/PassengerBoardingView"].map(find => ({ find, replacement: local("../fixtures/panels.tsx") })),
    { find: "@vis.gl/react-google-maps", replacement: local("../fixtures/map-adapter.tsx") },
    { find: "@/components/maps/DirectionsRoute", replacement: local("../fixtures/map-adapter.tsx") },
    { find: "next/dynamic", replacement: local("../fixtures/dynamic.tsx") },
    { find: "@", replacement: local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } }, oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env": JSON.stringify({ NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:3123", NEXT_PUBLIC_BUS_EXPIRY_MS: "300000" }) },
});
