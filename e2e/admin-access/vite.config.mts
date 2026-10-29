import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: local("."), server: { host: "127.0.0.1", port: 3105, strictPort: true },
  resolve: { alias: [
    // Same adapter instance, but its own URL, so a test can hold the lazy sign-in code download.
    { find: "firebase/auth", replacement: local("firebaseAuthSdk.ts") },
    ...["firebase/firestore", "firebase/database", "@/lib/firebaseAuth", "@/lib/firebaseFirestore", "@/lib/firebaseDatabase", "./firebaseDatabase", "./firebaseCore"].map(find => ({ find, replacement: local("firebase.ts") })),
    ...["@/hooks/useBuses", "@/hooks/useDrivers", "@/hooks/useSettings", "next/navigation", "next/link", "@vis.gl/react-google-maps"].map(find => ({ find, replacement: local("adapters.tsx") })),
    { find: "next/image", replacement: local("nextImage.tsx") },
    // EKI_ADMIN_ACCESS_SRC may point at another checkout's frontend/src (for an A/B
    // baseline against a committed revision); by default the working tree is tested.
    { find: "@", replacement: process.env.EKI_ADMIN_ACCESS_SRC || local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } }, oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env": JSON.stringify({ NODE_ENV: "development", NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:3105" }) },
});
