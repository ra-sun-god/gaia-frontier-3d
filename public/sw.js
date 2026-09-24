/**
 * Gaia Frontier: After Contact — service worker.
 *
 * Makes the game a real installable PWA and keeps it fully playable offline:
 *   - Precaches the app shell (document, manifest, icons).
 *   - Network-first navigations (always the fresh document when online, the
 *     cached shell when offline).
 *   - Cache-first for Next.js immutable build chunks (production only — dev
 *     chunks are never cached, so hot-reload iteration can't go stale).
 *   - Stale-while-revalidate for public assets (music, icons) — instant from
 *     cache, refreshed in the background across releases.
 *   - Warms the full soundtrack into the cache on request (message from the
 *     page) so an installed copy has music with zero connectivity.
 *   - /api/* always goes to the network (cloud sync + leaderboard want live
 *     data; the game already degrades gracefully offline).
 *
 * UPDATE RULE: bump VERSION whenever sw.js logic or precached/public assets
 * change meaningfully — old caches are purged on activation.
 */

const VERSION = 'v1.1.0';
const SHELL_CACHE = `gaia-shell-${VERSION}`;
const ASSET_CACHE = `gaia-assets-${VERSION}`;

/** App shell — the document + install-prompt surface. */
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
];

/** Full soundtrack (opus masters, ~2.4 MB total) for offline play. */
const MUSIC_URLS = [
  '/music/manifest.json',
  '/music/intro.opus',
  '/music/menu.opus',
  '/music/battle1.opus',
  '/music/battle2.opus',
  '/music/battle3.opus',
  '/music/battle4.opus',
  '/music/battle5.opus',
  '/music/battle6.opus',
];

/** Public assets served straight from public/ (may evolve between releases). */
function isPublicAsset(pathname) {
  return (
    pathname.startsWith('/music/') ||
    pathname.startsWith('/icon-') ||
    pathname.startsWith('/apple-icon') ||
    pathname === '/favicon.ico' ||
    /\.(png|jpe?g|webp|gif|svg|ico|opus|m4a|mp3|ogg|wav|woff2?|ttf)$/i.test(pathname)
  );
}

/** Offline document substitute for the rare case even the cached shell is gone. */
function offlineFallback() {
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Gaia Frontier</title><style>body{background:#181B2E;color:#9FB6D9;' +
      "font-family:system-ui,sans-serif;display:flex;align-items:center;" +
      'justify-content:center;height:100vh;margin:0;text-align:center}' +
      'h2{color:#00D2FF;letter-spacing:.2em;margin:0 0 8px}small{opacity:.7}</style></head>' +
      '<body><div><h2>GAIA FRONTIER</h2><p>Reconnecting to the deep-space network&hellip;</p>' +
      '<small>This screen retries automatically.</small></div>' +
      '<script>setTimeout(function(){location.reload()},3000)</script></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individual adds (not addAll): one failed fetch must not abort install.
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn('[sw] shell precache miss:', url, err && err.message);
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('gaia-') && !key.endsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      // Take control of uncontrolled pages so GAIA_WARM_MUSIC works on the
      // very first visit (before the next navigation).
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'GAIA_WARM_MUSIC') {
    void (async () => {
      const cache = await caches.open(ASSET_CACHE);
      await Promise.all(
        MUSIC_URLS.map(async (url) => {
          if (await cache.match(url)) return; // already offline-ready
          try {
            const response = await fetch(url);
            if (response && response.ok) await cache.put(url, response);
          } catch {
            /* offline right now — retried on a later visit */
          }
        }),
      );
    })();
  }
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;
  // Live data only: cloud sync + leaderboard have their own offline handling.
  if (pathname.startsWith('/api/')) return;
  // Never intercept our own update path or the Playables dev harness.
  if (pathname === '/sw.js' || pathname === '/yt-iframe-harness.html') return;
  // Dev-only Next internals (HMR etc.) — production uses /_next/static only.
  if (pathname.startsWith('/_next/') && !pathname.startsWith('/_next/static/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (pathname.startsWith('/_next/static/') || isPublicAsset(pathname)) {
    event.respondWith(handleAsset(event));
    return;
  }
  // Everything else: plain network.
});

/** Network-first with cached-shell fallback (single-page game document). */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE);
      // Keyed at '/' — any navigation variant (query strings, referrals)
      // falls back to the same shell offline.
      cache.put('/', fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached =
      (await caches.match(request, { ignoreSearch: true })) || (await caches.match('/'));
    return cached || offlineFallback();
  }
}

/**
 * Cache-first asset strategy.
 *  - /_next/static/*: cached ONLY when the server marks it immutable
 *    (production hashed chunks). Dev files stay uncached → never stale.
 *  - public assets: stale-while-revalidate — serve cache instantly, refresh
 *    in the background so music/icon updates propagate across releases.
 *  - Range requests (e.g. a future <audio> streaming element): served by
 *    slicing the cached full copy; partial responses are never cached.
 */
async function handleAsset(event) {
  const request = event.request;
  const cache = await caches.open(ASSET_CACHE);

  const rangeHeader = request.headers.get('range');
  const cached = await cache.match(request);
  if (cached && rangeHeader) {
    return sliceRangeResponse(rangeHeader, cached);
  }
  if (cached) {
    if (isPublicAsset(new URL(request.url).pathname)) {
      event.waitUntil(refreshAsset(cache, request));
    }
    return cached;
  }

  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cacheControl = fresh.headers.get('cache-control') || '';
    const isNextChunk = new URL(request.url).pathname.startsWith('/_next/static/');
    const cacheable = isPublicAsset(new URL(request.url).pathname) ||
      (isNextChunk && cacheControl.includes('immutable'));
    if (cacheable && !request.headers.has('range')) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
  }
  return fresh;
}

async function refreshAsset(cache, request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) await cache.put(request, fresh.clone());
  } catch {
    /* offline — the stale copy we already returned stays for next time */
  }
}

/** Serves a 206 Partial Content response out of a cached full response. */
function sliceRangeResponse(rangeHeader, cachedResponse) {
  return cachedResponse.arrayBuffer().then((buffer) => {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader) || [];
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : buffer.byteLength - 1;
    const safeEnd = Math.min(end, buffer.byteLength - 1);
    const chunk = buffer.slice(start, safeEnd + 1);
    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': `bytes ${start}-${safeEnd}/${buffer.byteLength}`,
        'Accept-Ranges': 'bytes',
      },
    });
  });
}
