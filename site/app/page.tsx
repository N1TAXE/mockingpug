import { redirect } from 'next/navigation';

// The marketing landing now lives in the shared SEO app; this repo's site is
// documentation only, so the root redirects into the docs.
export default function RootPage() {
  redirect('/docs');
}
