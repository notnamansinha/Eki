import type { NextConfig } from "next";

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
