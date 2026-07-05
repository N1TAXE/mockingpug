import type { Metadata } from 'next';
import { gitConfig, siteUrl } from '@/lib/shared';
import { GITHUB_URL, HomeView } from './HomeView';

const title = 'mockingpug - declarative mock data & mock APIs for React and Next.js';
const description =
  'Describe your data once as a JSON schema. mockingpug generates a deterministic, relational dataset and serves it over the exact REST endpoints your app already calls — no separate mock server, no hand-written fixtures.';

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    'mock data',
    'mock api',
    'json schema',
    'msw',
    'next.js',
    'react',
    'testing',
    'fixtures',
    'faker alternative',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title,
    description,
    url: '/',
    siteName: 'mockingpug',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'mockingpug',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  description,
  url: siteUrl,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  sameAs: [GITHUB_URL],
  license: 'https://opensource.org/licenses/MIT',
};

async function getGithubStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${gitConfig.user}/${gitConfig.repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const count = (data as { stargazers_count?: unknown }).stargazers_count;
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const githubStars = await getGithubStars();

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeView githubStars={githubStars} />
    </>
  );
}
