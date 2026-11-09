import { MetadataRoute } from 'next';

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Eki – Live Transit Tracking',
    short_name: 'Eki',
    description: 'Real-time bus tracking for Ahmedabad. Live GPS, speed-aware ETAs, and passenger-admin communication.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    // Android paints the installed app's navigation-bar strip with this one
    // colour on every page. It matches the dark start page (`/`) and its
    // status bar so the sign-in painting runs to the gesture bar.
    theme_color: '#09090b',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
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
