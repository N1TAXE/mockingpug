export const appName = 'mockingpug';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

// No production domain is deployed yet — falls back to localhost in dev.
// Set NEXT_PUBLIC_SITE_URL once this site has a real one.
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const gitConfig = {
  user: 'N1TAXE',
  repo: 'mockingpug',
  branch: 'main',
};
