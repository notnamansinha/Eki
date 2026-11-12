import { MetadataRoute } from 'next';
import { siteOrigin, siteIndexingEnabled } from "@/lib/siteMetadata";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteIndexingEnabled()) return [];
  const baseUrl = siteOrigin();

  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      // The public home-screen install guide, linked from the landing footer.
      url: `${baseUrl}/install`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];
}
