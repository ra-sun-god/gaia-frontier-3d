'use client';

import React, { useEffect, useRef, useState } from 'react';
import { sound } from '@/lib/audio';
import { haptics } from '@/lib/haptics';
import { Tv, X, Zap, Bomb, Wrench, Coins, Sparkles } from 'lucide-react';

/** Mid-run rewarded-ad offer kinds (page maps each to a REWARD_ID). */
export type AdOfferKind = 'adrenaline' | 'grenades' | 'emp' | 'repair' | 'funds';

export interface AdOffer {
  kind: AdOfferKind;
  title: string;
  detail: string;
  cta: string;
  icon: string;
  color: string;
}

interface RewardedAdOfferProps {
  offer: AdOffer;
  /** True while the ad itself is playing (overlay shows a "transmission" state). */
  isPlaying: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  /** Seconds before the offer auto-retracts. */
  autoHideSeconds?: number;
}

/**
 * Floating mid-combat rewarded-ad offer ("watch a sponsored transmission →
 * get a temp boost"). Rendered INSIDE the game overlay, above the playfield,
 * without blocking taps outside the card. The engine keeps running behind it
 * (it's a small toast, not a modal) — the page pauses the sim only while the
 * actual ad is playing.
 */
export const RewardedAdOffer: React.FC<RewardedAdOfferProps> = ({
  offer,
  isPlaying,
  onAccept,
  onDismiss,
  autoHideSeconds = 12,
}) => {
  // The parent keys this component on the offer kind, so every NEW offer
  // remounts it fresh — no effect-reset needed for the countdown.
  const [secondsLeft, setSecondsLeft] = useState(autoHideSeconds);
  // Keep dismiss in a ref so the countdown interval is not rebuilt per render
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  // Auto-retract countdown — frozen while the ad is playing
  useEffect(() => {
    if (isPlaying) return;
    if (secondsLeft <= 0) {
      dismissRef.current();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, isPlaying]);

  const icon = (() => {
    switch (offer.kind) {
      case 'adrenaline':
        return <Zap className="w-4 h-4 text-[#38bdf8]" />;
      case 'grenades':
        return <Bomb className="w-4 h-4 text-[#FAC602]" />;
      case 'emp':
        return <Sparkles className="w-4 h-4 text-[#c084fc]" />;
      case 'repair':
        return <Wrench className="w-4 h-4 text-emerald-300" />;
      case 'funds':
        return <Coins className="w-4 h-4 text-amber-300" />;
    }
  })();

  if (isPlaying) {
    // Sponsored transmission in progress (real YouTube rewarded ad or the
    // standalone-web simulated feed — the page owns the flow, we just show it)
    return (
      <div className="absolute inset-x-0 top-[38%] z-30 flex justify-center px-4 pointer-events-none">
        <div className="game-dialog-card px-5 py-3 flex items-center gap-3 shadow-2xl animate-in fade-in">
          <Tv className="w-5 h-5 text-[#00D2FF] animate-pulse" />
          <div className="flex flex-col">
            <span className="text-[11px] font-black text-white uppercase tracking-wider">
              SPONSORED TRANSMISSION
            </span>
            <span className="text-[9px] text-cyan-200/80">
              Reward unlocks when the broadcast ends…
            </span>
          </div>
          <div className="w-16 h-1.5 bg-[#0A0E21] rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-gradient-to-r from-[#00D2FF] to-[#53CE17] animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-[30%] z-30 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-[300px] game-dialog-card rounded-3xl p-3 shadow-2xl animate-in fade-in slide-in-from-top-2 relative overflow-hidden">
        {/* Auto-hide progress */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#0A0E21]">
          <div
            className="h-full bg-gradient-to-r from-[#00D2FF] to-[#53CE17] transition-all duration-1000 ease-linear"
            style={{ width: `${(secondsLeft / autoHideSeconds) * 100}%` }}
          />
        </div>

        <button
          id="btn-ad-offer-dismiss"
          onClick={() => {
            sound.playUiClick();
            onDismiss();
          }}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#14182E] border border-[#2B3566] flex items-center justify-center text-slate-300 active:scale-90 cursor-pointer"
          title="Not now"
        >
          <X className="w-3 h-3 stroke-[3]" />
        </button>

        <div className="flex items-center gap-3 pr-6">
          <div className="w-10 h-10 rounded-2xl bg-[#071d42] border-2 border-[#00D2FF]/40 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(0,210,255,0.3)]">
            {icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] font-black text-[#53CE17] uppercase tracking-widest leading-none mb-0.5">
              Free Field Support
            </span>
            <span className="text-[12px] font-black text-white leading-tight truncate">
              {offer.title}
            </span>
            <span className="text-[9px] text-cyan-200/80 leading-tight">{offer.detail}</span>
          </div>
        </div>

        <button
          id="btn-ad-offer-accept"
          onClick={() => {
            sound.playUiClick();
            haptics.tap();
            onAccept();
          }}
          className={`btn-game-gold w-full mt-2.5 py-2 px-4 rounded-full text-[11px] font-black tracking-wider uppercase flex items-center justify-center gap-1.5 cursor-pointer shadow-lg`}
        >
          <Tv className="w-3.5 h-3.5" />
          <span>{offer.cta}</span>
          <span className="text-[9px] bg-[#0A0E21]/40 px-1.5 py-0.5 rounded-full border border-white/20 font-bold">
            {secondsLeft}s
          </span>
        </button>
      </div>
    </div>
  );
};
