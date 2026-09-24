'use client';

/**
 * App-level PWA bootstrap. Mounted once at the page root, renders nothing:
 *  - registers /sw.js (top-level pages only — never inside YouTube Playables
 *    or the local iframe harness, so Playables hosting stays untouched);
 *  - primes the install-prompt listeners BEFORE any button mounts;
 *  - asks the service worker to warm the soundtrack cache once idle.
 */

import { useEffect } from 'react';
import {
  initPwaInstallListeners,
  registerServiceWorker,
  warmMusicCache,
} from '@/lib/pwa';

export function ServiceWorkerRegister() {
  useEffect(() => {
    initPwaInstallListeners();
    registerServiceWorker();
    warmMusicCache();
  }, []);

  return null;
}
