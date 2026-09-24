import type {MetadataRoute} from 'next';
import {
  SITE_NAME,
  SITE_SHORT_NAME,
  SITE_DESCRIPTION,
  THEME,
} from '@/lib/site';

/**
 * manifest.webmanifest — served at /manifest.webmanifest.
 * Makes the game installable ("Add to Home Screen") and supplies the
 * icon set for install prompts / splash screens.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    description: SITE_DESCRIPTION,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    orientation: 'any',
    background_color: THEME.background,
    theme_color: THEME.background,
    categories: ['games', 'entertainment'],
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
        purpose: 'any',
      },
      {
        src: '/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
