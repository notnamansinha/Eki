import { MetadataRoute } from 'next';

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/driver', '/passenger', '/feedback', '/api/'],
    },
    sitemap: 'https://bustrack-be165.web.app/sitemap.xml',
  };
}
