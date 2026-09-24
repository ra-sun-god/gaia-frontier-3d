import type {MetadataRoute} from 'next';
import {SITE_URL} from '@/lib/site';

/**
 * sitemap.xml — served at /sitemap.xml.
 * Single-page game app: the root experience is the one indexable URL.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
