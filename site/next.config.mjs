import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // This site lives nested inside the mockingpug monorepo (its own
  // package-lock.json alongside the repo root's) — pin the workspace root
  // explicitly so Turbopack doesn't have to guess.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default withMDX(config);
