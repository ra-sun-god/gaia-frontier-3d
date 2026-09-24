/**
 * Canonical site identity — single source of truth for SEO metadata,
 * robots/sitemap/manifest routes, JSON-LD and AI-discovery docs.
 *
 * APP_URL may arrive without a scheme (e.g. "gaia-frontier.libertypie.com"
 * in .env) — normalize it; fall back to the production origin in every
 * environment that doesn't set one.
 */
function normalizeOrigin(raw: string | undefined): string {
  const fallback = 'https://gaia-frontier.libertypie.com';
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return fallback;
  }
}

export const SITE_URL = normalizeOrigin(process.env.APP_URL);

export const SITE_NAME = 'Gaia Frontier: After Contact';

export const SITE_SHORT_NAME = 'Gaia Frontier';

export const SITE_TAGLINE = 'Arcade Planetary Defense';

export const SITE_DESCRIPTION =
  'Contact was made — and it turned hostile. Gaia Frontier: After Contact is a free browser arcade planetary-defense shooter: upgrade your orbital turret, hunt 15 bosses across 16 eras, survive the daily Boss Rush and the Endless Gauntlet, and push the adrenaline overdrive to keep Gaia alive.';

export const SITE_KEYWORDS = [
  'planetary defense game',
  'arcade space shooter',
  'browser game',
  'free web game',
  'earth defense game',
  'turret defense game',
  'boss rush game',
  'endless mode shooter',
  'HTML5 game',
  'space arcade game',
  'alien invasion game',
  'planetary defense shooter',
  'Gaia Frontier',
  'LibertyPie games',
];

/** Publisher shown in metadata + JSON-LD. */
export const SITE_PUBLISHER = {
  name: 'LibertyPie',
  url: 'https://libertypie.com',
};

/** Brand palette (matches globals.css chassis + HUD accents). */
export const THEME = {
  background: '#181B2E',
  accent: '#00D2FF',
};
