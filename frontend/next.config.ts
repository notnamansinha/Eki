import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// Generate a unique version identifier (timestamp) for the build
const appVersion = Date.now().toString();

// Write the version to public/version.json for the client to poll
const publicDir = path.join(process.cwd(), "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
fs.writeFileSync(
  path.join(publicDir, "version.json"),
  JSON.stringify({ version: appVersion })
);

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  productionBrowserSourceMaps: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  devIndicators: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

export default nextConfig;
