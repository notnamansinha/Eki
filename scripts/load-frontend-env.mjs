import { createRequire } from "node:module";
import path from "node:path";

/**
 * Load frontend/.env* into process.env with the same loader, file precedence
 * and production mode that `next build` uses, so build scripts see the
 * NEXT_PUBLIC_* values the bundle is compiled with. Values already present in
 * the shell win, exactly as they do for Next.js.
 */
export function loadFrontendEnv(root) {
  const frontend = path.join(root, "frontend");
  const requireFromFrontend = createRequire(path.join(frontend, "package.json"));
  const { loadEnvConfig } = requireFromFrontend("@next/env");
  loadEnvConfig(frontend, false);
}
