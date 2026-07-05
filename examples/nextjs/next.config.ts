import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // This example lives nested inside the mockingpug monorepo (its own
  // package-lock.json alongside the repo root's) — pin the workspace root
  // explicitly so Turbopack doesn't have to guess.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
