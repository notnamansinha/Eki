import { MetadataRoute } from 'next';

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Eki – Live Transit Tracking',
    short_name: 'Eki',
    description: 'Real-time bus tracking for Ahmedabad. Live GPS, speed-aware ETAs, and driver-rider communication.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#3b82f6', // Brand accent color
    icons: [
      {
        src: '/icon.png',
        sizes: 'any',
        type: 'image/png',
      },
    ],
  };
}
