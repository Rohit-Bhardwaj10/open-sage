import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable Turbopack (default in Next.js 16)
  turbopack: {},

  // Required for Docker standalone build
  output: "standalone",

  // Tell Next.js to trace files from the monorepo root, not just /frontend
  outputFileTracingRoot: path.join(__dirname, "../"),
};

export default nextConfig;
