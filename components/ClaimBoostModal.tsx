'use client';

import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { sound } from '@/lib/audio';
import { haptics } from '@/lib/haptics';
import { Tv, X, Play, Coins, Sparkles, CheckCircle2, TrendingUp } from 'lucide-react';

/** What was just claimed (base payout, already credited by the page). */
export interface ClaimBoost {
  cash: number;
  gems: number;
  /** Where the claim came from — shown as the modal's context line. */
  label: string;
}

interface ClaimBoostModalProps {
  claim: ClaimBoost;
  /** True inside YouTube Playables: real rewarded ads exist, so the fake ad
   *  timer is skipped and the page awaits the platform ad instead. */
  nativeRewardedAds?: boolean;
  /** Watch-ad DOUBLE. The page plays the real ad (Playables) and credits the
   *  bonus; resolves false when the reward was not granted. On standalone web
   *  the modal simulates the sponsored feed first and calls this on
   *  completion — the page credits directly. */
  onDouble: () => boolean | void | Promise<boolean | void>;
  /** Free +50% of the base claim — the page credits instantly. */
  onTakeFifty: () => void;
  /** Keep the base payout as-is and close. */
  onClose: () => void;
}

/**
 * CLAIM BOOSTER — the post-claim engagement modal. Every currency claim in
 * the game (daily challenges, mystery box, battle pass tiers, daily streak,
 * idle collector) credits HALF the legacy payout and then shows this modal:
 *
 *   • WATCH AD → DOUBLE  : +100% of the base (restores the legacy value)
 *   • TAKE +50% FREE     : +50% of the base, no ad, one tap
 *
 * That is the claim-boost economy: base claims are 50% of the old values,
 * ad-watchers get the full old value back, and everyone else has a free
 * middle rung. The ad mechanics mirror GameOverModal: simulated ~4s sponsor
 * feed on the standalone site, REAL rewarded ad inside YouTube Playables —
 * and state updaters stay pure (all side effects fire in timer callbacks).
 */
export const ClaimBoostModal: React.FC<ClaimBoostModalProps> = ({
  claim,
  nativeRewardedAds = false,
  onDouble,
  onTakeFifty,
  onClose,
}) => {
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adProgress, setAdProgress] = useState(0);
  const [claimed, setClaimed] = useState<'double' | 'fifty' | null>(null);

  // Keep the simulated-ad interval in a ref so it can never fire the reward
  // after unmount, and mirror progress in a ref so the state updaters stay
  // pure (side effects live in the timer callback only).
  const adIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const adProgressRef = useRef(0);
  useEffect(() => {
    return () => {
      if (adIntervalRef.current) clearInterval(adIntervalRef.current);
    };
  }, []);

  const doubleCash = Math.floor(claim.cash);
  const doubleGems = Math.floor(claim.gems);
  const fiftyCash = Math.floor(claim.cash / 2);
  const fiftyGems = claim.gems > 0 ? Math.max(1, Math.round(claim.gems / 2)) : 0;

  const rewardLine = (cash: number, gems: number) => {
    const parts: string[] = [];
    if (cash > 0) parts.push(`+$${cash.toLocaleString()}`);
    if (gems > 0) parts.push(`+${gems} 💎`);
    return parts.join(' ');
  };

  const celebrateDouble = () => {
    setClaimed('double');
    sound.playWaveClear();
    haptics.success();
    confetti({ particleCount: 60, spread: 65, origin: { y: 0.6 } });
  };

  const handleWatchAdToDouble = () => {
    if (isWatchingAd || claimed) return;
    sound.playUiClick();

    // Inside YouTube Playables the REAL rewarded ad decides the payout: the
    // page plays it, credits the bonus and resolves whether it was granted.
    if (nativeRewardedAds) {
      setIsWatchingAd(true);
      setAdProgress(100);
      void Promise.resolve(onDouble()).then((granted) => {
        setIsWatchingAd(false);
        if (granted !== false) celebrateDouble();
        // Reward not earned / ad failed: the button stays usable for a retry.
      });
      return;
    }

    // Standalone web: simulated ~4s sponsored transmission, then credit.
    setIsWatchingAd(true);
    setAdProgress(0);
    adProgressRef.current = 0;

    const interval = setInterval(() => {
      adProgressRef.current = Math.min(100, adProgressRef.current + 10);
      setAdProgress(adProgressRef.current);
      if (adProgressRef.current >= 100) {
        clearInterval(interval);
        if (adIntervalRef.current === interval) adIntervalRef.current = null;
        setIsWatchingAd(false);
        void onDouble();
        celebrateDouble();
      }
    }, 400);
    adIntervalRef.current = interval;
  };

  const handleTakeFifty = () => {
    if (isWatchingAd || claimed) return;
    sound.playUiClick();
    onTakeFifty();
    setClaimed('fifty');
    haptics.success();
    sound.playUpgradeSuccess();
  };

  return (
    <div
      id="claim-boost-overlay"
      className="absolute inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 game-modal-backdrop select-none animate-in fade-in"
    >
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 sm:p-5 flex flex-col gap-3 shadow-2xl relative my-auto max-h-[86dvh] overflow-y-auto overscroll-contain">
        {/* Dismiss — keep the base payout */}
        <button
          id="btn-claim-boost-close"
          onClick={() => {
            if (isWatchingAd) return; // never abandon a live transmission
            sound.playUiClick();
            onClose();
          }}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-[#14182E] border border-[#2B3566] flex items-center justify-center text-slate-300 active:scale-90 cursor-pointer z-10"
          title="Keep base reward"
        >
          <X className="w-3.5 h-3.5 stroke-[3]" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-1.5 pr-8">
          <div className="w-12 h-12 rounded-2xl bg-[#0A2A1C] border-2 border-[#53CE17] flex items-center justify-center text-[#53CE17] shadow-[0_0_16px_rgba(83,206,23,0.4)]">
            <TrendingUp className="w-6 h-6 stroke-[2.5]" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-wider uppercase leading-none text-stroke-arcade drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
            CLAIM BOOSTER
          </h2>
          <span className="text-[10px] font-black text-[#53CE17] uppercase tracking-widest">
            {claim.label}
          </span>
        </div>

        {/* What you just banked */}
        <div className="bg-[#14182E] border-[2px] border-[#0A0E1E] rounded-2xl px-3 py-2.5 flex items-center justify-center gap-3 shadow-inner">
          <Coins className="w-4 h-4 text-[#FAC602] shrink-0" />
          <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">
            Banked
          </span>
          <span className="text-sm font-black text-white tabular-nums">
            {claim.cash > 0 && `$${claim.cash.toLocaleString()}`}
            {claim.cash > 0 && claim.gems > 0 && '  +  '}
            {claim.gems > 0 && `${claim.gems} 💎`}
          </span>
        </div>

        {/* Result banner after a boost */}
        {claimed && (
          <div
            className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-black tracking-wide ${
              claimed === 'double'
                ? 'bg-[#0A3D2E] border-[#53CE17]/40 text-[#53CE17]'
                : 'bg-[#0A2A4A] border-[#00D2FF]/40 text-[#00D2FF]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {claimed === 'double'
                ? `SPONSOR BOUNTY CONFIRMED: ${rewardLine(doubleCash, doubleGems)} ADDED!`
                : `BONUS COLLECTED: ${rewardLine(fiftyCash, fiftyGems)} ADDED!`}
            </span>
          </div>
        )}

        {/* Simulated sponsored transmission */}
        {isWatchingAd && !nativeRewardedAds && (
          <div className="p-3 rounded-2xl bg-[#14182E] border border-[#00D2FF]/60 flex flex-col items-center gap-2">
            <span className="text-xs font-black text-[#00D2FF] tracking-wide animate-pulse">
              SPONSORED TRANSMISSION — DO NOT CLOSE
            </span>
            <div className="w-full bg-[#0A0E21] h-2.5 rounded-full overflow-hidden border border-[#2B3566]">
              <div
                className="bg-gradient-to-r from-[#00D2FF] to-[#53CE17] h-full transition-all duration-300"
                style={{ width: `${adProgress}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400">Authenticating bounty credit...</span>
          </div>
        )}
        {isWatchingAd && nativeRewardedAds && (
          <div className="p-3 rounded-2xl bg-[#14182E] border border-[#00D2FF]/60 flex flex-col items-center gap-2">
            <span className="text-xs font-black text-[#00D2FF] tracking-wide animate-pulse">
              SPONSORED TRANSMISSION — DO NOT CLOSE
            </span>
            <span className="text-[10px] text-slate-400">
              Reward unlocks when the broadcast ends…
            </span>
          </div>
        )}

        {/* The two boost offers */}
        {!claimed && !isWatchingAd && (
          <div className="flex flex-col gap-2.5">
            {/* Primary: watch a rewarded ad to DOUBLE (restores the full
                legacy payout — the whole point of the claim-boost economy) */}
            <button
              id="btn-claim-boost-double"
              onClick={handleWatchAdToDouble}
              className="btn-game-gold w-full py-3 px-4 rounded-2xl flex items-center justify-center gap-2.5 select-none cursor-pointer shadow-lg active:scale-95 transition"
            >
              <Tv className="w-[18px] h-[18px] shrink-0" />
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[13px] font-black tracking-wider uppercase">
                  Watch Ad • Double Claim
                </span>
                <span className="text-[10px] font-bold text-black/70">
                  {rewardLine(doubleCash, doubleGems)} extra
                </span>
              </span>
            </button>

            {/* Secondary: free +50% — the no-ad middle rung */}
            <button
              id="btn-claim-boost-fifty"
              onClick={handleTakeFifty}
              className="w-full py-2.5 px-4 rounded-2xl bg-[#171B33] border-2 border-[#00D2FF]/50 hover:border-[#00D2FF] flex items-center justify-center gap-2.5 select-none cursor-pointer shadow-lg active:scale-95 transition"
            >
              <Sparkles className="w-4 h-4 text-[#00D2FF] shrink-0" />
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[12px] font-black tracking-wider uppercase text-cyan-200">
                  Take +50% Free
                </span>
                <span className="text-[10px] font-bold text-cyan-200/70">
                  {rewardLine(fiftyCash, fiftyGems)} extra — no ad needed
                </span>
              </span>
            </button>
          </div>
        )}

        {/* Done / keep-as-is */}
        <div className="flex items-center justify-center gap-2">
          {claimed ? (
            <button
              id="btn-claim-boost-done"
              onClick={() => {
                sound.playUiClick();
                onClose();
              }}
              className="btn-game-squircle px-8 py-2.5 rounded-full text-white font-black text-xs tracking-widest uppercase cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5 fill-white" />
                DONE
              </span>
            </button>
          ) : (
            <button
              id="btn-claim-boost-keep"
              onClick={() => {
                sound.playUiClick();
                onClose();
              }}
              className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-200 underline underline-offset-2 cursor-pointer px-3 py-1"
            >
              Keep base reward
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
