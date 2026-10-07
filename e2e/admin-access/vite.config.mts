import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: local("."), server: { host: "127.0.0.1", port: 3105, strictPort: true },
  resolve: { alias: [
    ...["firebase/auth", "firebase/app-check", "firebase/firestore", "firebase/database", "@/lib/firebaseAuth", "@/lib/firebaseFirestore", "@/lib/firebaseDatabase", "./firebaseDatabase", "./firebaseCore"].map(find => ({ find, replacement: local("firebase.ts") })),
    ...["@/hooks/useBuses", "@/hooks/useDrivers", "@/hooks/useSettings", "next/navigation", "next/link"].map(find => ({ find, replacement: local("adapters.tsx") })),
    { find: "@", replacement: local("../../frontend/src") },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } }, oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env": JSON.stringify({ NODE_ENV: "development", NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY: "synthetic-key", NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:3105" }) },
});
