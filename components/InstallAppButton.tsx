'use client';

/**
 * "Install App" affordance for the main-menu launch card — shown ONLY to
 * players who have not installed the game yet:
 *
 *  - Chrome / Edge / Android: the browser fires `beforeinstallprompt` once the
 *    service worker + manifest make the game installable; the button then
 *    triggers the native install dialog.
 *  - iOS (Safari & every other WebKit browser): no install prompt API exists,
 *    so the button opens short "Add to Home Screen" instructions instead.
 *  - Hidden when: already installed (standalone/fullscreen display-mode or
 *    navigator.standalone), running inside YouTube Playables / any iframe,
 *    or the browser simply never offered installation.
 *
 * After a successful install the button disappears on its own
 * (`appinstalled` / display-mode change re-evaluates the store).
 */

import React, { useState } from 'react';
import { Download, Share, PlusCircle, Rocket, X } from 'lucide-react';
import { usePwaInstall, promptInstall, isIosDevice } from '@/lib/pwa';
import { sound } from '@/lib/audio';
import { haptics } from '@/lib/haptics';
import { trackPwaInstall } from '@/lib/analytics';

export function InstallAppButton() {
  const { canRender, canPrompt, needsManualInstructions } = usePwaInstall();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [justAccepted, setJustAccepted] = useState(false);

  if (!canRender) return null;
  // Nothing to offer yet: browser hasn't fired the prompt and it's not iOS.
  if (!canPrompt && !needsManualInstructions && !justAccepted) return null;

  const handleClick = () => {
    sound.playUiClick();
    haptics.light();

    if (isIosDevice()) {
      setIosHelpOpen(true);
      return;
    }
    void promptInstall().then((outcome) => {
      if (outcome === 'accepted') {
        trackPwaInstall(true); // GA: install funnel conversion
        setJustAccepted(true); // brief confirmation; appinstalled then hides us
      } else {
        trackPwaInstall(false);
      }
    });
  };

  if (justAccepted) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-emerald-400/50 bg-[#0a221084] px-4 py-3 select-none">
        <Rocket className="w-5 h-5 text-emerald-300" aria-hidden />
        <span className="text-xs font-black uppercase tracking-widest text-emerald-200">
          Added to home screen
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        id="btn-install-app"
        onClick={handleClick}
        className="w-full rounded-2xl px-4 py-3 flex items-center justify-center gap-2 border-[2.5px] border-cyan-200/80 bg-gradient-to-b from-[#0EA5E9] via-[#0284C7] to-[#075985] hover:border-white hover:brightness-110 active:scale-95 transition cursor-pointer select-none shadow-[0_5px_0_#0C4A6E,0_10px_22px_rgba(0,210,255,0.35)] group animate-pulse-glow"
        title="Install Gaia Frontier on this device — full screen, works offline"
      >
        <Download className="w-5 h-5 text-white shrink-0 group-hover:animate-bounce drop-shadow" aria-hidden />
        <span className="text-sm font-black uppercase tracking-widest text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
          Install App
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-100/90">
          · Full screen · Offline
        </span>
      </button>

      {/* iOS Add-to-Home-Screen walkthrough (no install prompt API there) */}
      {iosHelpOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setIosHelpOpen(false)}
        >
          <div
            className="game-dialog-card w-full max-w-xs p-4 flex flex-col gap-3 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#23294E] pb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-white">
                Install on iPhone / iPad
              </span>
              <button
                onClick={() => setIosHelpOpen(false)}
                className="text-slate-400 hover:text-white transition cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="flex flex-col gap-2.5 text-left">
              <li className="flex items-center gap-2.5 bg-[#0A0E21]/80 border border-[#23294E] rounded-xl px-2.5 py-2">
                <span className="w-7 h-7 rounded-full bg-[#00D2FF]/15 border border-cyan-400/40 flex items-center justify-center shrink-0">
                  <Share className="w-3.5 h-3.5 text-cyan-300" aria-hidden />
                </span>
                <span className="text-[10px] font-bold text-slate-200 leading-snug">
                  Tap the <span className="text-cyan-300">Share</span> button in the
                  browser toolbar
                </span>
              </li>
              <li className="flex items-center gap-2.5 bg-[#0A0E21]/80 border border-[#23294E] rounded-xl px-2.5 py-2">
                <span className="w-7 h-7 rounded-full bg-[#00D2FF]/15 border border-cyan-400/40 flex items-center justify-center shrink-0">
                  <PlusCircle className="w-3.5 h-3.5 text-cyan-300" aria-hidden />
                </span>
                <span className="text-[10px] font-bold text-slate-200 leading-snug">
                  Scroll down and tap{' '}
                  <span className="text-cyan-300">&ldquo;Add to Home Screen&rdquo;</span>
                </span>
              </li>
              <li className="flex items-center gap-2.5 bg-[#0A0E21]/80 border border-[#23294E] rounded-xl px-2.5 py-2">
                <span className="w-7 h-7 rounded-full bg-[#00D2FF]/15 border border-cyan-400/40 flex items-center justify-center shrink-0">
                  <Rocket className="w-3.5 h-3.5 text-cyan-300" aria-hidden />
                </span>
                <span className="text-[10px] font-bold text-slate-200 leading-snug">
                  Launch from your home screen —{' '}
                  <span className="text-cyan-300">full screen</span>, works offline
                </span>
              </li>
            </ol>

            <button
              onClick={() => {
                sound.playUiClick();
                setIosHelpOpen(false);
              }}
              className="btn-game-gold w-full py-2 px-4 rounded-full text-xs font-black tracking-widest uppercase flex items-center justify-center gap-1.5 cursor-pointer select-none active:scale-95 transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
