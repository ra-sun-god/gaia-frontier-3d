/**
 * PWA install plumbing — the single seam between the game and the browser's
 * "install app" machinery.
 *
 * Responsibilities:
 *  - Capture the deferred `beforeinstallprompt` event the MOMENT the browser
 *    fires it (module-eval-time listener — earlier than React hydration, so a
 *    fast repeat visit with an already-active service worker can never lose
 *    the event before the menu mounts).
 *  - Track "already installed" state (display-mode standalone/fullscreen/
 *    minimal-ui, iOS navigator.standalone, or the `appinstalled` event).
 *  - Expose a `usePwaInstall()` React hook (useSyncExternalStore) so the
 *    Install button renders only for players who CAN and HAVE NOT installed.
 *  - Register the service worker (`/sw.js`) — top-level pages only, never
 *    inside YouTube Playables / the local iframe harness (their hosting and
 *    certification must stay byte-identical in behavior).
 *  - Ask the service worker to warm the music cache in the background so an
 *    installed game is fully playable (with soundtrack) offline.
 *
 * Everything degrades silently: no SW support, no manifest, insecure context,
 * or a browser without install support (iOS Safari never fires
 * beforeinstallprompt — it gets manual "Add to Home Screen" instructions
 * instead, see components/InstallAppButton.tsx).
 */

import { useSyncExternalStore } from 'react';
import { inPlayablesEnv } from './ytplayables';

/** The browser's deferred install prompt (not in standard TS DOM lib). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PwaInstallState {
  /** Render the install affordance at all (top-level page, not Playables, not installed). */
  canRender: boolean;
  /** Chrome/Edge/Android: the browser is offering a native install prompt right now. */
  canPrompt: boolean;
  /** iOS (no beforeinstallprompt): show manual Add-to-Home-Screen instructions. */
  needsManualInstructions: boolean;
  /** App is already running as an installed PWA. */
  installed: boolean;
}

const DEFAULT_STATE: PwaInstallState = {
  canRender: false,
  canPrompt: false,
  needsManualInstructions: false,
  installed: false,
};

let deferredPrompt: InstallPromptEvent | null = null;
let installed = false;
let initialized = false;
let snapshot: PwaInstallState = DEFAULT_STATE;
const listeners = new Set<() => void>();

/** iOS — every browser on iOS is WebKit and none fire beforeinstallprompt. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ masquerades as desktop Safari — unmask via touch points.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

/** True when the page is the top-level browsing context (not iframed). */
export function isTopLevelPage(): boolean {
  try {
    return typeof window !== 'undefined' && window.self === window.top;
  } catch {
    // Cross-origin iframe access throws — we ARE framed.
    return false;
  }
}

/** Running as an installed app? (covers Android/desktop display-modes + iOS) */
function isRunningStandalone(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const dm = window.matchMedia;
  const installedByDisplayMode =
    dm('(display-mode: standalone)').matches ||
    dm('(display-mode: fullscreen)').matches ||
    dm('(display-mode: minimal-ui)').matches;
  const iosStandalone =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installedByDisplayMode || iosStandalone;
}

/** The environment where offering "Install" makes sense at all. */
function canOfferInstallHere(): boolean {
  return isTopLevelPage() && !inPlayablesEnv();
}

function computeSnapshot(): PwaInstallState {
  const canRender = canOfferInstallHere() && !installed;
  return {
    canRender,
    canPrompt: canRender && deferredPrompt !== null,
    needsManualInstructions: canRender && deferredPrompt === null && isIosDevice(),
    installed,
  };
}

function emit(): void {
  snapshot = computeSnapshot();
  for (const listener of listeners) listener();
}

/**
 * Idempotent window-level listeners. Called at module-eval time on the client
 * (before hydration) and again on first hook subscription — both safe.
 */
export function initPwaInstallListeners(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  installed = isRunningStandalone();

  // The browser fires this once it decides the app is installable
  // (HTTPS + manifest + active service worker with a fetch handler).
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep our own button in charge of the UX
    deferredPrompt = event as InstallPromptEvent;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });

  // Installed PWAs can be launched either mode; catch runtime switches.
  try {
    const mq = window.matchMedia('(display-mode: fullscreen)');
    mq.addEventListener?.('change', () => {
      installed = isRunningStandalone();
      emit();
    });
  } catch {
    /* ancient browsers — the initial check already covers them */
  }

  emit();
}

/** Show the browser's native install dialog. 'unavailable' = no deferred prompt. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt;
  deferredPrompt = null; // a dismissed prompt can never be reused
  emit();
  if (!prompt) return 'unavailable';
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    return outcome;
  } catch {
    return 'unavailable';
  }
}

// --- React glue ------------------------------------------------------------

function subscribe(listener: () => void): () => void {
  initPwaInstallListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PwaInstallState {
  return snapshot;
}

function getServerSnapshot(): PwaInstallState {
  return DEFAULT_STATE;
}

/** Reactive install state for the Install button. */
export function usePwaInstall(): PwaInstallState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// --- Service worker ---------------------------------------------------------

/**
 * Registers /sw.js on top-level pages only. Inside YouTube Playables (and the
 * local iframe harness) the service worker stays out entirely so Playables
 * hosting/certification behavior is untouched.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!canOfferInstallHere()) return;

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[pwa] service worker registration failed:', err));
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/**
 * Asks the controlling service worker to prefetch every music track into the
 * offline cache (~2.3 MB total, opus). Fire-and-forget, delayed so it never
 * competes with the game's own chunk/music loading on slow connections.
 */
export function warmMusicCache(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!canOfferInstallHere()) return;
  const send = () => {
    try {
      if (navigator.onLine !== false) {
        navigator.serviceWorker.controller?.postMessage({ type: 'GAIA_WARM_MUSIC' });
      }
    } catch {
      /* SW not controlling yet — tracks still cache lazily as they play */
    }
  };
  navigator.serviceWorker.ready.then(
    () => setTimeout(send, 8000),
    () => {},
  );
}

// Capture the install event before React even hydrates (fast repeat visits
// with an already-active service worker can fire it within milliseconds).
initPwaInstallListeners();
