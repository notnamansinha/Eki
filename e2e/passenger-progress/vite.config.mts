import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: local("."), server: { host: "127.0.0.1", port: 3127, strictPort: true },
  resolve: { alias: [
    ...["@/lib/firebaseAuth", "@/lib/authState", "@/lib/liveBusStore", "@/lib/joinedRideStatus", "@/hooks/useDynamicRouteGeometries",
      "@/hooks/useAuth", "@/hooks/useRoutes", "@/hooks/useSettings", "@/hooks/useRTDBResume", "@/hooks/useLiveRouteCatalog", "@/hooks/useRideChatUnread", "@/hooks/usePassengerRouteConfig"].map(find => ({ find, replacement: local("state.ts") })),
    { find: "next/dynamic", replacement: local("../fixtures/dynamic.tsx") },
    { find: "@/components/maps/PassengerTrackingMap", replacement: local("../../frontend/src/components/maps/PassengerMap.tsx") },
    { find: "@vis.gl/react-google-maps", replacement: local("maps.tsx") },
    { find: "@", replacement: local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } }, oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env": JSON.stringify({ NEXT_PUBLIC_BUS_EXPIRY_MS: "300000" }) },
});
