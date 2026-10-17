import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: local("."), cacheDir: local("../../artifacts/routing-offline-vite-cache"),
  server: { host: "127.0.0.1", port: 3162, strictPort: true },
  resolve: { alias: { "@": local("../../frontend/src") } },
  define: { "process.env": "{}" }, oxc: { jsx: { runtime: "automatic" } },
});
