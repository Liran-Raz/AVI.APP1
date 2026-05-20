import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the Turbopack project root to this folder. Without this, Next.js can
  // walk up the parent directories and pick the wrong workspace root when
  // there's an unrelated project nearby — which leaks weird paths into source
  // maps and error stacks.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
