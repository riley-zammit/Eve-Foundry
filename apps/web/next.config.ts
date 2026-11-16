import path from "node:path";
import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The shared package ships TypeScript source.
  transpilePackages: ["@foundry/factory"],
  turbopack: {
    // npm workspaces hoist dependencies to the repo root.
    root: path.join(import.meta.dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Next.js hosts the eve agent at the repo root and serves it under /eve/v1/*.
export default withEve(nextConfig, { eveRoot: "../.." });
