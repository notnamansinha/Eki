import { MetadataRoute } from 'next';

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/passenger', '/route-planner'],
      disallow: ['/admin', '/driver', '/feedback', '/api/*'],
    },
    sitemap: 'https://bustrack-be165.web.app/sitemap.xml',
  };
}
