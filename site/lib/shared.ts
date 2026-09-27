export const appName = 'mockingpug';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

// Production docs domain; override with NEXT_PUBLIC_SITE_URL (e.g. localhost in dev).
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://docs.mockingpug.com';

export const gitConfig = {
  user: 'N1TAXE',
  repo: 'mockingpug',
  branch: 'master',
};
