import type {Metadata, Viewport} from 'next';
import './globals.css'; // Global styles
import {
  SITE_URL,
  SITE_NAME,
  SITE_SHORT_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_PUBLISHER,
  THEME,
} from '@/lib/site';

const OG_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} — a planet wrapped in a cyan energy shield under meteor fire`,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  // iOS "Add to Home Screen" support: launches full-screen (black-translucent
  // status bar over the space background) with the game's short name under
  // the home-screen icon. The web app manifest covers Android/desktop.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: SITE_SHORT_NAME,
  },
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  authors: [{name: SITE_PUBLISHER.name, url: SITE_PUBLISHER.url}],
  creator: SITE_PUBLISHER.name,
  publisher: SITE_PUBLISHER.name,
  category: 'games',
  classification: 'Games & Entertainment',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    locale: 'en_US',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  appLinks: {
    web: {
      url: SITE_URL,
      should_fallback: true,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: THEME.background,
};

/**
 * Structured data for search engines AND AI assistants: a schema.org
 * VideoGame entity describing the app. Rendered once in the root layout,
 * server-side, so every crawler (Google, Bing, GPTBot, ClaudeBot, …)
 * sees identical machine-readable facts about the game.
 */
function JsonLd() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame',
        '@id': `${SITE_URL}/#game`,
        name: SITE_NAME,
        alternateName: 'Gaia Frontier',
        headline: `${SITE_NAME} — ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        url: `${SITE_URL}/`,
        image: [`${SITE_URL}/opengraph-image.png`, `${SITE_URL}/icon-512.png`],
        genre: ['Arcade', 'Shooter', 'Action', 'Strategy', 'Tower Defense'],
        gamePlatform: ['Web Browser', 'Mobile Web', 'Desktop Web'],
        applicationCategory: 'Game',
        operatingSystem: 'Any (HTML5-capable browser)',
        playMode: ['SinglePlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 1 },
        inLanguage: 'en',
        isAccessibleForFree: true,
        publisher: { '@id': `${SITE_URL}/#publisher` },
        author: { '@id': `${SITE_URL}/#publisher` },
        offers: {
          '@type': 'Offer',
          price: 0,
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/`,
        },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#publisher`,
        name: SITE_PUBLISHER.name,
        url: SITE_PUBLISHER.url,
        logo: `${SITE_URL}/icon-512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: 'en',
        publisher: { '@id': `${SITE_URL}/#publisher` },
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{__html: JSON.stringify(graph)}}
    />
  );
}

// NOTE — YouTube Playables SDK loading:
// The SDK script (<script src="https://www.youtube.com/game_api/v1">) is
// injected by server.mjs as the literal FIRST element of <head> on every HTML
// response. It CANNOT be rendered here: Next.js always serializes its own
// bootstrap chunk scripts (main-app.js, app/page.js, ...) BEFORE any
// layout-rendered head child, which fails the Playables certification check
// "SDK loaded before any game code". Loading order is enforced upstream of
// React entirely — see server.mjs and lib/ytplayables.ts.
export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <JsonLd />
        {children}
      </body>
    </html>
  );
}
