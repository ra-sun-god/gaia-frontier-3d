/**
 * Google Analytics 4 telemetry — the measurement spine for Gaia Frontier.
 *
 * HOW TO ENABLE: set NEXT_PUBLIC_GA_MEASUREMENT_ID (e.g. "G-AB12CD34EF")
 * in the environment before build/serve. Until a syntactically valid ID is
 * present every call below is a silent no-op, so local dev, offline PWA play
 * and the YouTube Playables iframe build ship zero telemetry. (The Playables
 * runtime forbids third-party network calls anyway — GA stays off there.)
 *
 * EVENT TAXONOMY (custom events, snake_case, GA4 limits enforced):
 *   game_start        — a run began (mode, first_run)
 *   wave_start        — every wave setup (wave, era, mode)
 *   wave_complete     — wave cleared (wave, era, mode, kills, cash, score)
 *   wave_fail         — run ended during this wave (wave, era, mode)
 *   era_start         — era entered (era_number, era_name, mode, wave)
 *   era_complete      — era cleared (era_number, era_name, mode)
 *   boss_spawn        — boss encounter began (boss_name, era, wave, mode)
 *   boss_defeated     — boss killed (boss_name, era, wave, mode)
 *   game_over         — full run report (score, waves, kills, bosses, …)
 *   story_complete    — first-contact cinematic funnel (pages_viewed, skipped)
 *   revive            — continue used (method, wave, gems_spent)
 *   rewarded_ad       — sponsored-ad placement shown/earned
 *   purchase          — any shop/intermission spend (item, cost, currency)
 *   pwa_install       — install prompt outcome (accepted)
 * page_view, session_start and first_visit arrive automatically from the
 * gtag config call.
 */
import { inPlayablesEnv } from './ytplayables';

/** Placeholder until a real ID is configured — replace here or via env. */
const FALLBACK_ID = 'G-XXXXXXXXXX';

export const GA_MEASUREMENT_ID = (
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || FALLBACK_ID
).trim();

/** Placeholder-aware validity: format check AND not the fallback itself. */
const VALID_ID =
  /^G-[A-Z0-9]{4,12}$/i.test(GA_MEASUREMENT_ID) && !/X{4,}/i.test(GA_MEASUREMENT_ID);

type EventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let booted = false;

/** GA4 guardrails: ≤25 params per event, names ≤40 chars, values ≤100 chars. */
function sanitizeParams(params: EventParams): EventParams {
  const out: EventParams = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(params)) {
    if (count >= 25) break;
    const key = rawKey.slice(0, 40);
    if (rawValue === undefined || rawValue === null) continue;
    if (typeof rawValue === 'number') {
      if (!Number.isFinite(rawValue)) continue;
      out[key] = Math.round(rawValue * 100) / 100;
    } else if (typeof rawValue === 'boolean') {
      out[key] = rawValue;
    } else {
      out[key] = String(rawValue).slice(0, 100);
    }
    count += 1;
  }
  return out;
}

/**
 * Idempotent, client-only, failure-proof. Injects the gtag.js snippet + the
 * external script; every event afterwards flows through window.gtag.
 */
export function initAnalytics(): void {
  if (booted || typeof window === 'undefined') return;
  if (inPlayablesEnv()) return; // YouTube Playables iframe: no external calls
  if (!VALID_ID) return; // no real ID configured → stay dark, zero noise
  booted = true;

  const w = window;
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    // Pushes the raw Arguments object, exactly like the official snippet —
    // gtag.js accepts both arrays and arguments-objects as commands.
    w.gtag = function gtag(): void {
      w.dataLayer!.push(arguments);
    };
  }
  w.gtag('js', new Date());
  w.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: true, // single-page game: exactly one page_view
    anonymize_ip: true, // GA4 default, kept explicit for privacy optics
  });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

/** Raw event send — safe everywhere (SSR, disabled, malformed params). */
export function trackEvent(name: string, params: EventParams = {}): void {
  if (typeof window === 'undefined') return;
  if (!booted || !window.gtag) return;
  try {
    window.gtag('event', name.slice(0, 40), sanitizeParams(params));
  } catch {
    /* telemetry must never crash the game */
  }
}

/* ------------------------------ typed events ------------------------------ */

export function trackGameStart(mode: string, firstRun: boolean): void {
  trackEvent('game_start', { game_mode: mode, first_run: firstRun });
}

export function trackWaveStart(
  wave: number,
  eraNumber: number,
  eraName: string,
  mode: string
): void {
  trackEvent('wave_start', {
    wave,
    era_number: eraNumber,
    era_name: eraName,
    game_mode: mode,
  });
}

export function trackWaveComplete(
  wave: number,
  eraNumber: number,
  eraName: string,
  mode: string,
  stats: { kills: number; cashEarned: number; score: number }
): void {
  trackEvent('wave_complete', {
    wave,
    era_number: eraNumber,
    era_name: eraName,
    game_mode: mode,
    kills: stats.kills,
    cash_earned: stats.cashEarned,
    score: stats.score,
  });
}

export function trackWaveFail(wave: number, eraNumber: number, mode: string): void {
  trackEvent('wave_fail', { wave, era_number: eraNumber, game_mode: mode });
}

export function trackEraStart(
  eraNumber: number,
  eraName: string,
  mode: string,
  wave: number
): void {
  trackEvent('era_start', {
    era_number: eraNumber,
    era_name: eraName,
    game_mode: mode,
    wave,
  });
}

export function trackEraComplete(eraNumber: number, eraName: string, mode: string): void {
  trackEvent('era_complete', {
    era_number: eraNumber,
    era_name: eraName,
    game_mode: mode,
  });
}

export function trackBossSpawn(
  bossName: string,
  eraNumber: number,
  wave: number,
  mode: string
): void {
  trackEvent('boss_spawn', {
    boss_name: bossName,
    era_number: eraNumber,
    wave,
    game_mode: mode,
  });
}

export function trackBossDefeated(
  bossName: string,
  eraNumber: number,
  wave: number,
  mode: string
): void {
  trackEvent('boss_defeated', {
    boss_name: bossName,
    era_number: eraNumber,
    wave,
    game_mode: mode,
  });
}

export function trackGameOver(stats: {
  score: number;
  waveReached: number;
  eraNumber: number;
  eraName: string;
  kills: number;
  bossesDefeated: number;
  bestStreak: number;
  runDurationS: number;
  gemsEarned: number;
  cashEarned: number;
  mode: string;
  newHighScore: boolean;
}): void {
  trackEvent('game_over', {
    score: stats.score,
    wave_reached: stats.waveReached,
    era_number: stats.eraNumber,
    era_name: stats.eraName,
    kills: stats.kills,
    bosses_defeated: stats.bossesDefeated,
    best_streak: stats.bestStreak,
    run_duration_s: stats.runDurationS,
    gems_earned: stats.gemsEarned,
    cash_earned: stats.cashEarned,
    game_mode: stats.mode,
    new_high_score: stats.newHighScore,
  });
}

export function trackStoryComplete(pagesViewed: number, skipped: boolean): void {
  trackEvent('story_complete', {
    pages_viewed: pagesViewed,
    skipped,
    total_pages: 6,
  });
}

export function trackRevive(
  method: 'ad' | 'gems',
  wave: number,
  gemsSpent: number
): void {
  trackEvent('revive', { method, wave, gems_spent: gemsSpent });
}

export function trackRewardedAd(placement: string, earned: boolean): void {
  trackEvent('rewarded_ad', { placement, earned });
}

export function trackPurchase(
  item: string,
  cost: number,
  currency: 'cash' | 'gems' | 'cash+gems' | 'iap' | 'free',
  surface: string,
  level?: number
): void {
  trackEvent('purchase', {
    item,
    cost,
    currency,
    surface,
    ...(level !== undefined ? { level } : {}),
  });
}

export function trackPwaInstall(accepted: boolean): void {
  trackEvent('pwa_install', { accepted });
}
