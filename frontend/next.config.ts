import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Content hash of the frontend build inputs (source, public assets, configs).
 * Used by generateBuildId so that `next build` is reproducible: unchanged
 * source ⇒ same build ID ⇒ byte-identical out/ ⇒ the post-build workbox SW
 * generation (scripts/generate-sw.mjs) can replay its cached sw.js instead of
 * re-bundling. Changed source ⇒ new build ID ⇒ new _next/static/<id>/ URLs,
 * which keeps Firebase's immutable caching safe for the manifest files.
 */
async function buildInputsHash(): Promise<string> {
  const hash = createHash("sha256");
  // `next build` always runs with cwd = the frontend project root.
  const dir = process.cwd();

  // Only deterministic build inputs feed the hash — never build artifacts
  // (.next/, out/, *.tsbuildinfo) which rewrite themselves on every build.
  const ignored = new Set([
    "node_modules",
    ".next",
    "out",
    "tsconfig.tsbuildinfo",
    ".vite",
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "next-env.d.ts",
  ]);

  async function walk(dirname: string): Promise<void> {
    const entries = await readdir(dirname, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dirname, entry.name);
      if (entry.isDirectory()) {
        hash.update(`d:${entry.name}\n`);
        await walk(full);
      } else if (entry.isFile()) {
        hash.update(`f:${entry.name}:`);
        hash.update(await readFile(full));
        hash.update("\n");
      }
    }
  }

  await walk(dir);
  return hash.digest("hex").slice(0, 32);
}

if (process.env.EKI_STRICT_PRODUCTION_BUILD === "true") {
  const requiredPublicVariables = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
    "NEXT_PUBLIC_GOOGLE_MAP_ID",
    "NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY",
    "NEXT_PUBLIC_BACKEND_URL",
  ];
  const missing = requiredPublicVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Production build is missing: ${missing.join(", ")}`);
  }

  const secureUrls = [
    "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
    "NEXT_PUBLIC_BACKEND_URL",
  ];
  for (const name of secureUrls) {
    const value = process.env[name] as string;
    const url = new URL(value);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error(`${name} must be a non-local HTTPS URL for production.`);
    }
  }
}

const nextConfig: NextConfig = {
  output: "export",
  // Deterministic build ID: reproducible builds (see buildInputsHash above).
  generateBuildId: () => buildInputsHash(),
  images: {
    unoptimized: true,
  },
  // This project is open source, so publishing production maps does not expose
  // private implementation details and gives monitoring/Lighthouse actionable
  // stack traces for the large client bundles.
  productionBrowserSourceMaps: true,
  experimental: {
    // Only add barrel-heavy UI libraries here. Firebase already has proper
    // ESM subpath exports and does NOT benefit from this — adding it causes
    // ~800ms extra dev startup cost with no tree-shaking gain.
    optimizePackageImports: ["lucide-react"],
  },
  devIndicators: false,
};

export default nextConfig;
