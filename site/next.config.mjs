import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Self-contained build for the VPS: `.next/standalone/server.js` bundles
  // only the node_modules it actually needs, so the deploy is a file copy +
  // `node server.js` — no `npm ci` on the server. Static assets and `public/`
  // are copied alongside it by the deploy workflow.
  output: 'standalone',
  // This site lives nested inside the mockingpug monorepo (its own
  // package-lock.json alongside the repo root's) — pin the workspace root
  // explicitly so Turbopack doesn't have to guess.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default withMDX(config);
