import type { NextConfig } from "next";

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
  images: {
    unoptimized: true,
  },
  productionBrowserSourceMaps: false,
  experimental: {
    // Only add barrel-heavy UI libraries here. Firebase already has proper
    // ESM subpath exports and does NOT benefit from this — adding it causes
    // ~800ms extra dev startup cost with no tree-shaking gain.
    optimizePackageImports: ["lucide-react"],
  },
  devIndicators: false,
};

export default nextConfig;
