/**
 * YouTube Playables SDK wrapper — the single integration seam between
 * Earth Defender and the `ytgame` global (https://www.youtube.com/game_api/v1).
 *
 * Design rules:
 *  - EVERY function is safe to call when the SDK failed to load (offline dev,
 *    standalone website build): the wrapper degrades to a no-op and returns
 *    a sentinel so callers can fall back to standalone-web behavior.
 *  - Every function is safe to call locally where the SDK runs as a no-op
 *    (IN_PLAYABLES_ENV === false) — YouTube's documented local dev mode.
 *  - Required integrations (per the Getting started guide):
 *      firstFrameReady → gameReady, onPause/onResume, isAudioEnabled +
 *      onAudioEnabledChange, loadData/saveData.
 */

// Global types (Window.ytgame, YtGame, ...) come from types/ytgame.d.ts.

/** Stable reward IDs for requestRewardedAd() — readable, no user data. */
export const REWARD_IDS = {
  /** Free continue after defeat (the "watch sponsored ad" revive). */
  reviveContinueRun: 'revive-continue-run',
  /** Mid-run combat rush: +60 adrenaline (auto-Overdrive at 100). */
  adrenalineBoost: 'adrenaline-rush-boost',
  /** Mid-run ordnance drop: +2 frag grenades. */
  grenadeBundle: 'frag-grenade-bundle',
  /** Mid-run tech cache: +1 EMP shockwave charge. */
  empCharge: 'emp-shockwave-charge',
  /** Mid-run field support: +40 hull repair drone. */
  repairDrone: 'field-repair-drone',
  /** Mid-run war funds: +$350 emergency cash. */
  warFunds: 'war-funds-cache',
  /** Game-over bonus: double the run's earned cash. */
  doubleCash: 'double-cash-bonus',
  /** Game-over bonus: free mystery box drop. */
  mysteryBox: 'bonus-mystery-box',
  /** Post-claim booster: double the just-claimed reward. */
  claimBoost: 'claim-boost-double',
} as const;

function getYtgame(): YtGame | undefined {
  return typeof window !== 'undefined' ? window.ytgame : undefined;
}

/** True only inside the real YouTube Playables runtime. */
export function inPlayablesEnv(): boolean {
  const yt = getYtgame();
  return typeof yt !== 'undefined' && yt.IN_PLAYABLES_ENV === true;
}

// ---------------------------------------------------------------------------
// Lifecycle (required)
// ---------------------------------------------------------------------------

/** Call once the game has painted its first frame. No-op locally. */
export function firstFrameReady(): void {
  try {
    getYtgame()?.game.firstFrameReady();
  } catch {
    /* SDK no-ops locally and never throws in-env; belt and braces */
  }
}

/** Call once the game is interactable (never during a loading screen). */
export function gameReady(): void {
  try {
    getYtgame()?.game.gameReady();
  } catch {}
}

// ---------------------------------------------------------------------------
// Cloud save (required) — YouTube's own storage, keyed to the YT account
// ---------------------------------------------------------------------------

/** Loads the player's YouTube cloud save; null when absent/unavailable. */
export async function loadPlayablesSave(): Promise<string | null> {
  const yt = getYtgame();
  if (!yt || !yt.IN_PLAYABLES_ENV) return null;
  try {
    const data = await yt.game.loadData();
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

/** Saves the envelope to YouTube cloud storage. Resolves false on failure. */
export async function savePlayablesSave(data: string): Promise<boolean> {
  const yt = getYtgame();
  if (!yt || !yt.IN_PLAYABLES_ENV) return false;
  try {
    await yt.game.saveData(data);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// System events (required): pause / resume / audio
// ---------------------------------------------------------------------------

export interface PlayablesLifecycleHandlers {
  /** Short window to save state; the game may be evicted afterwards. */
  onPause?: () => void;
  /** Deliberately NOT auto-resuming gameplay — the player decides. */
  onResume?: () => void;
  /** Audio toggled from YouTube's settings UI. */
  onAudioEnabledChange?: (enabled: boolean) => void;
}

/**
 * Registers system event callbacks. Safe before/without the SDK.
 *
 * NOTE: the audio-following callback is registered ONLY inside the real
 * Playables runtime. The SDK observable fires `onAudioEnabledChange(false)`
 * synchronously even on a standalone top-level page (verified against the
 * shipped game_api source), which used to mute the entire game on load —
 * the exact "no music on by default" bug. Outside Playables the game's own
 * defaults apply: music + FX ON.
 */
export function registerPlayablesLifecycle(handlers: PlayablesLifecycleHandlers): void {
  const yt = getYtgame();
  if (!yt) return;
  try {
    if (yt.IN_PLAYABLES_ENV) {
      if (handlers.onPause) yt.system.onPause(handlers.onPause);
      if (handlers.onResume) yt.system.onResume(handlers.onResume);
      if (handlers.onAudioEnabledChange) {
        yt.system.onAudioEnabledChange(handlers.onAudioEnabledChange);
      }
    } else {
      // Local/no-host mode: the SDK is present but inert. Pause/resume are
      // documented no-ops here, but registering them is harmless and keeps
      // dev parity; the audio callback is NOT registered (see note above).
      if (handlers.onPause) yt.system.onPause(handlers.onPause);
      if (handlers.onResume) yt.system.onResume(handlers.onResume);
    }
  } catch {}
}

/** Initial audio state from YouTube settings; null when SDK is absent. */
export function getPlayablesAudioEnabled(): boolean | null {
  const yt = getYtgame();
  if (!yt || !yt.IN_PLAYABLES_ENV) return null;
  try {
    return yt.system.isAudioEnabled();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Monetization (ads)
// ---------------------------------------------------------------------------

/**
 * Rewarded ad. Resolves:
 *   true  → reward earned
 *   false → ad flow completed but reward NOT earned / request failed
 *   null  → SDK unavailable (standalone web) → caller uses its own fallback
 */
export async function showRewardedAd(rewardId: string): Promise<boolean | null> {
  const yt = getYtgame();
  if (!yt || !yt.IN_PLAYABLES_ENV) return null;
  try {
    return await yt.ads.requestRewardedAd(rewardId);
  } catch {
    return false;
  }
}

/**
 * Interstitial ad at a natural breakpoint (game over → play again).
 * Resolves true when a request succeeded (ad may or may not have shown),
 * false on failure, null when the SDK is unavailable (standalone web —
 * callers should just continue without blocking).
 */
export async function showInterstitialAd(): Promise<boolean | null> {
  const yt = getYtgame();
  if (!yt || !yt.IN_PLAYABLES_ENV) return null;
  try {
    await yt.ads.requestInterstitialAd();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Engagement & health (recommended)
// ---------------------------------------------------------------------------

/** Sends the best score to YouTube (single consistent dimension: run score). */
export async function sendBestScore(value: number): Promise<void> {
  const yt = getYtgame();
  if (!yt || !yt.IN_PLAYABLES_ENV) return;
  const safe = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
  try {
    await yt.engagement.sendScore({ value: safe });
  } catch {}
}

/** Best-effort error report to YouTube's game health pipeline. */
export function reportErrorToPlayables(): void {
  try {
    getYtgame()?.health.logError();
  } catch {}
}

/** Installs window-level error reporting (only useful in Playables). */
export function installErrorReporting(): void {
  if (!inPlayablesEnv()) return;
  window.addEventListener('error', reportErrorToPlayables);
  window.addEventListener('unhandledrejection', reportErrorToPlayables);
}
