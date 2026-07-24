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
    theme_color: '#FA5D29',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
