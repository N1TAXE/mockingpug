import { ImageResponse } from 'next/og';
import { generate as DefaultImage } from 'fumadocs-ui/og';
import { appName } from '@/lib/shared';

export const revalidate = false;

export default function Image() {
  return new ImageResponse(
    (
      <DefaultImage
        title="Describe your data once. Get a real API, instantly."
        description="Mock data & mock APIs for React and Next.js"
        site={appName}
      />
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
