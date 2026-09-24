'use client';

import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { MysteryBoxReward, GameMode } from '@/lib/types';
import { rollMysteryBox, REVIVE_COST_GEMS_BASE } from '@/lib/storage';
import { sound } from '@/lib/audio';
import { Trophy, Play, Gift, RefreshCw, Home, Shield, Sparkles, CheckCircle2, AlertOctagon, Skull } from 'lucide-react';

interface GameOverModalProps {
  stats: {
    score: number;
    waveReached: number;
    cashEarned: number;
    bestStreak: number;
    bossesDefeated: number;
    kills: number;
  };
  playerGems: number;
  /** Which cabinet the run died on (mode-specific record copy + wording). */
  gameMode?: GameMode;
  /** Deepest Boss Rush stage on record (shown when a rush run ends). */
  bossRushBestStage?: number;
  /** Deepest Endless wave on record (shown when a gauntlet run ends). */
  endlessBestWave?: number;
  /** NEAR-MISS hook: points short of the player's high score when the gap is
   *  small (≤500). The most powerful “one more run” trigger in arcade design. */
  nearMissPoints?: number;
  /** Diamond price of the instant (no-ad) revive — escalates per use within
   *  a run (40 → 80 → 160 …); the parent owns the per-run counter. */
  reviveCost?: number;
  /** Free revives left this run via the sponsored-ad simulation (0 = exhausted). */
  adRevivesRemaining?: number;
  /** True inside YouTube Playables: real rewarded ads exist, so the fake ad timer is skipped. */
  nativeRewardedAds?: boolean;
  /** Continue the CURRENT run from the wave where the player was defeated (free, ad-sponsored). Resolves true when the revive actually happened. */
  onAdRevive?: () => boolean | void | Promise<boolean | void>;
  onRevive: () => void;
  onPlayAgain: () => void;
  onReturnHome: () => void;
  /** Double-cash bonus. Inside Playables this awaits a REAL rewarded ad and
   *  resolves false when the reward was not granted (caller gates the credit). */
  onDoubleCashClaimed: (bonusCash: number) => boolean | void | Promise<boolean | void>;
  onMysteryBoxReward: (reward: MysteryBoxReward) => void;
  /** Native (Playables) mystery-box flow: page rolls + credits AFTER the real
   *  rewarded ad, resolving the reward (or null/false when not granted). */
  onMysteryBoxBonus?: () => Promise<MysteryBoxReward | null | false>;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  stats,
  playerGems,
  gameMode = 'campaign',
  bossRushBestStage = 0,
  endlessBestWave = 0,
  nearMissPoints,
  reviveCost = REVIVE_COST_GEMS_BASE,
  adRevivesRemaining = 0,
  nativeRewardedAds = false,
  onAdRevive,
  onRevive,
  onPlayAgain,
  onReturnHome,
  onDoubleCashClaimed,
  onMysteryBoxReward,
  onMysteryBoxBonus,
}) => {
  const [reviveCountdown, setReviveCountdown] = useState(8);
  const reviveExpired = reviveCountdown <= 0;

  const [hasClaimedBonus, setHasClaimedBonus] = useState(false);
  const [chosenBonusType, setChosenBonusType] = useState<'double' | 'box' | null>(null);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adProgress, setAdProgress] = useState(0);

  // Sponsored-ad revive flow state (separate from the end-of-run bonus ad)
  const [isWatchingReviveAd, setIsWatchingReviveAd] = useState(false);
  const [reviveAdProgress, setReviveAdProgress] = useState(0);
  const [adReviveDone, setAdReviveDone] = useState(false);

  const [revealedReward, setRevealedReward] = useState<MysteryBoxReward | null>(null);

  // Keep the fake-ad intervals in refs so they can never fire rewards after unmount
  const adIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reviveAdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Progress mirrors in refs: React state updaters must stay PURE — all side
  // effects (parent setStates, sounds, confetti) fire in the timer callback,
  // never inside setAdProgress/setReviveAdProgress updaters (that caused
  // "Cannot update a component while rendering a different component")
  const adProgressRef = useRef(0);
  const reviveAdProgressRef = useRef(0);
  useEffect(() => {
    return () => {
      if (adIntervalRef.current) clearInterval(adIntervalRef.current);
      if (reviveAdIntervalRef.current) clearInterval(reviveAdIntervalRef.current);
    };
  }, []);

  const canRevive = playerGems >= reviveCost && !reviveExpired;
  const canAdRevive = adRevivesRemaining > 0 && !!onAdRevive && !isWatchingReviveAd;

  // Gem-revive window: 8 seconds of urgency — but PAUSED while any ad plays
  // (bonus feed or revive ad). Before, the countdown kept burning while the
  // player was inside a 4-7s sponsored transmission, so by the time they got
  // back the instant-revive had expired — felt like the diamond revive was
  // simply broken.
  useEffect(() => {
    if (reviveCountdown <= 0) return;
    if (isWatchingAd || isWatchingReviveAd) return; // clock holds during ads
    const timer = setInterval(() => {
      setReviveCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [reviveCountdown, isWatchingAd, isWatchingReviveAd]);

  // Sponsored-ad simulation for the CONTINUE (revive) flow — ~4s feed, then resume the run.
  // Inside YouTube Playables a REAL rewarded ad plays instead (the platform
  // renders it), so the fake transmission is skipped and we just await the result.
  const handleWatchAdToContinue = () => {
    if (!canAdRevive || isWatchingReviveAd) return;
    sound.playUiClick();

    if (nativeRewardedAds) {
      setIsWatchingReviveAd(true);
      setReviveAdProgress(100);
      void Promise.resolve(onAdRevive?.()).then((revived) => {
        setIsWatchingReviveAd(false);
        if (revived === true) {
          setAdReviveDone(true);
          sound.playWaveClear();
        }
        // Reward not earned / ad failed: the button stays usable for a retry.
      });
      return;
    }

    setIsWatchingReviveAd(true);
    setReviveAdProgress(0);
    reviveAdProgressRef.current = 0;

    const interval = setInterval(() => {
      reviveAdProgressRef.current = Math.min(100, reviveAdProgressRef.current + 10);
      setReviveAdProgress(reviveAdProgressRef.current);
      if (reviveAdProgressRef.current >= 100) {
        clearInterval(interval);
        if (reviveAdIntervalRef.current === interval) reviveAdIntervalRef.current = null;
        setIsWatchingReviveAd(false);
        setAdReviveDone(true);
        sound.playWaveClear();
        onAdRevive?.();
      }
    }, 400);
    reviveAdIntervalRef.current = interval;
  };

  const handleWatchAd = (type: 'double' | 'box') => {
    if (hasClaimedBonus || isWatchingAd) return;
    sound.playUiClick();

    // Inside YouTube Playables: play the REAL rewarded ad, then let the page
    // decide whether the reward was granted before flipping to "claimed".
    if (nativeRewardedAds) {
      setIsWatchingAd(true);
      setChosenBonusType(type);
      setAdProgress(100);
      void (async () => {
        try {
          if (type === 'double') {
            const earned = await onDoubleCashClaimed(stats.cashEarned);
            if (earned !== false) {
              setHasClaimedBonus(true);
              sound.playWaveClear();
              confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
            }
          } else if (onMysteryBoxBonus) {
            const reward = await onMysteryBoxBonus();
            if (reward) {
              setHasClaimedBonus(true);
              setRevealedReward(reward);
              sound.playWaveClear();
              confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
            }
          } else {
            const reward = rollMysteryBox();
            setRevealedReward(reward);
            onMysteryBoxReward(reward);
            setHasClaimedBonus(true);
            sound.playWaveClear();
            confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
          }
        } finally {
          setIsWatchingAd(false);
        }
      })();
      return;
    }

    setIsWatchingAd(true);
    setChosenBonusType(type);
    setAdProgress(0);
    adProgressRef.current = 0;

    const interval = setInterval(() => {
      adProgressRef.current = Math.min(100, adProgressRef.current + 25);
      setAdProgress(adProgressRef.current);
      if (adProgressRef.current >= 100) {
        clearInterval(interval);
        if (adIntervalRef.current === interval) adIntervalRef.current = null;
        setIsWatchingAd(false);
        setHasClaimedBonus(true);
        sound.playWaveClear();

        if (type === 'double') {
          onDoubleCashClaimed(stats.cashEarned);
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
        } else {
          const reward = rollMysteryBox();
          setRevealedReward(reward);
          onMysteryBoxReward(reward);
          confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
        }
      }
    }, 350);
    adIntervalRef.current = interval;
  };

  return (
    <div
      id="game-over-overlay"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop select-none animate-in fade-in"
    >
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1 [@media(max-height:500px)]:hidden">
        <div className="flex items-center gap-1.5 bg-[#171B33] border-[2px] border-[#080E1E] px-3 py-1 rounded-full shadow-inner">
          <Skull className="w-3.5 h-3.5 text-[#E62E5C]" />
          <span className="text-[10px] font-black text-white uppercase tracking-wider">
            CITADEL DESTABILIZED
          </span>
        </div>
      </div>

      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 sm:p-5 flex flex-col gap-3 [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:p-3 shadow-2xl relative my-auto max-h-[86dvh] overflow-y-auto overscroll-contain">
        {/* Banner Header: Defeat Alert (hidden on short/landscape phones so
            the revive + stats + action buttons fit without deep scrolling) */}
        <div className="flex flex-col items-center text-center [@media(max-height:500px)]:hidden">
          <div className="w-12 h-12 rounded-2xl bg-[#3D0A1C] border-2 border-[#E62E5C] flex items-center justify-center text-[#E62E5C] mb-1.5 shadow-[0_0_16px_rgba(230,46,92,0.5)]">
            <Skull className="w-6 h-6 stroke-[2.5]" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wider uppercase leading-none text-stroke-arcade drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
            HULL BREACHED
          </h2>
          <span className="text-[10px] font-black text-[#E62E5C] uppercase tracking-widest mt-1">
            PLANETARY DEFENSE COMPROMISED
          </span>
        </div>

        {/* --- Continue From Defeat: sponsored ad (primary, no expiry) or gems (premium, 8s window) --- */}
        {/* Short/landscape screens: the revive offer and the stats grid sit
            side-by-side so the full action stack fits without deep scrolling. */}
        <div className="flex flex-col gap-3 [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-2 [@media(max-height:500px)]:items-start [@media(max-height:500px)]:gap-2 [@media(max-height:500px)]:-order-2">
        {(adRevivesRemaining > 0 || !reviveExpired) && (
          <div className="bg-[#14182E] border-[2.5px] border-[#FAC602] p-3 [@media(max-height:500px)]:p-2 rounded-2xl flex flex-col gap-2.5 [@media(max-height:500px)]:gap-2 shadow-[0_0_12px_rgba(250,198,2,0.2)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-left">
                <div className="w-8 h-8 rounded-xl bg-[#171B33] border border-[#FAC602]/60 text-[#FAC602] flex items-center justify-center text-sm shrink-0 animate-pulse">
                  ⚡
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black text-white leading-tight">CONTINUE FROM WAVE {stats.waveReached}</span>
                  <span className="text-[9px] text-[#FAC602] font-bold">
                    Restore 60% Hull • Keep score &amp; credits
                    {!reviveExpired ? ` • gem window ${reviveCountdown}s` : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Primary: free continue via sponsored ad simulation */}
            {isWatchingReviveAd ? (
              <div className="p-2.5 rounded-xl bg-[#0A0E21] border border-[#00D2FF]/60 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-black text-[#00D2FF] tracking-wide animate-pulse">
                  SPONSORED TRANSMISSION — DO NOT CLOSE
                </span>
                <div className="w-full bg-[#14182E] h-2 rounded-full overflow-hidden border border-[#2B3566]">
                  <div
                    className="bg-gradient-to-r from-[#00D2FF] to-[#53CE17] h-full transition-all duration-300"
                    style={{ width: `${reviveAdProgress}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-400">Rerouting emergency power...</span>
              </div>
            ) : adReviveDone ? (
              <div className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-[#0A3D2E] border border-[#53CE17]/40 text-[#53CE17] text-[10px] font-black tracking-wide">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#53CE17]" />
                <span>SPONSOR BOUNTY CONFIRMED — REDEPLOYING</span>
              </div>
            ) : adRevivesRemaining > 0 ? (
              <button
                id="btn-ad-revive"
                onClick={handleWatchAdToContinue}
                className="btn-game-gold w-full py-2.5 px-4 rounded-full text-[11px] font-black tracking-wider uppercase flex items-center justify-center gap-2 select-none cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Watch Ad • Continue Free</span>
                <span className="text-[9px] bg-[#226804] px-1.5 py-0.5 rounded-full border border-white/30 text-white font-bold">
                  {adRevivesRemaining} left
                </span>
              </button>
            ) : (
              <div className="text-center text-[9px] font-bold text-slate-400 py-1 bg-[#0A0E21] rounded-xl border border-slate-700">
                No sponsored revives left this run — gems only
              </div>
            )}

            {/* Secondary: instant gem revive (premium, skips the ad — 8s window) */}
            <button
              id="btn-revive-gameover"
              disabled={!canRevive}
              onClick={() => {
                sound.playUiClick();
                onRevive();
              }}
              className={`w-full py-1.5 px-3 rounded-full font-black text-[10px] select-none transition cursor-pointer flex items-center justify-center gap-1.5 ${
                canRevive
                  ? 'bg-[#171B33] border border-cyan-400/60 text-cyan-200 hover:bg-[#1c2754]'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-50'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>
                {reviveExpired
                  ? `INSTANT REVIVE EXPIRED — needed within 8s`
                  : `INSTANT REVIVE — ${reviveCost} 💎 (no ad)`}
              </span>
            </button>
          </div>
        )}

        {/* --- Combat Telemetry Stats Grid --- */}
        <div className="grid grid-cols-2 gap-2 bg-[#14182E] border-[2px] border-[#0A0E21] p-3 [@media(max-height:500px)]:p-2 [@media(max-height:500px)]:grid-cols-1 rounded-2xl text-center shadow-inner">
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase font-black tracking-wider text-slate-400">
              {gameMode === 'bossRush' ? 'Rush Stage Reached' : 'Wave Reached'}
            </span>
            <span className="text-2xl [@media(max-height:500px)]:text-base font-black text-[#00D2FF] tabular-nums">
              {stats.waveReached}
            </span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase font-black tracking-wider text-slate-400">Combat Score</span>
            <span className="text-2xl [@media(max-height:500px)]:text-base font-black text-[#FAC602] tabular-nums">
              {stats.score.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col items-center pt-2 border-t border-[#23294E]">
            <span className="text-[9px] uppercase font-black tracking-wider text-slate-400">Credits Harvested</span>
            <span className="text-base [@media(max-height:500px)]:text-sm font-black text-[#53CE17] tabular-nums">
              ${stats.cashEarned.toLocaleString()}
            </span>
          </div>

          <div className="flex flex-col items-center pt-2 border-t border-[#23294E]">
            <span className="text-[9px] uppercase font-black tracking-wider text-slate-400">Peak Combo Chain</span>
            <span className="text-base [@media(max-height:500px)]:text-sm font-black text-[#FAC602] tabular-nums">
              {stats.bestStreak}x
            </span>
          </div>
        </div>
        </div>

        {/* Mode record line — the mastery identity per cabinet */}
        {gameMode !== 'campaign' && (
          <div
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 border text-[10px] font-black uppercase tracking-wider ${
              gameMode === 'bossRush'
                ? 'bg-[#2a0714] border-rose-400/40 text-rose-200'
                : 'bg-[#170a2e] border-violet-400/40 text-violet-200'
            }`}
          >
            {gameMode === 'bossRush'
              ? `BOSS RUSH — STAGE ${stats.waveReached} · BEST STAGE ${Math.max(bossRushBestStage, stats.waveReached)}`
              : `ENDLESS GAUNTLET — WAVE ${stats.waveReached} · BEST WAVE ${Math.max(endlessBestWave, stats.waveReached)}`}
          </div>
        )}

        {/* NEAR-MISS banner — "so close" is the strongest replay trigger in
            arcade psychology (slot-machine near-miss research). */}
        {nearMissPoints !== undefined && nearMissPoints > 0 && !reviveExpired && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 bg-gradient-to-r from-[#3d2b00]/90 to-[#2d1f02]/90 border border-amber-400/50 animate-pulse [@media(max-height:500px)]:hidden">
            <Trophy className="w-3.5 h-3.5 text-amber-300" />
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-200">
              SO CLOSE — {nearMissPoints.toLocaleString()} PTS FROM YOUR RECORD. ONE MORE RUN?
            </span>
          </div>
        )}

        {/* --- Simulated Ad Watch Overlay --- */}
        {isWatchingAd && (
          <div className="p-3.5 rounded-2xl bg-[#14182E] border border-[#00D2FF]/60 flex flex-col items-center gap-2">
            <span className="text-xs font-black text-[#00D2FF] tracking-wide animate-pulse">
              SYNCING SPONSOR DATA FEED...
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

        {/* --- Revealed Mystery Box Card (if rolled) --- */}
        {revealedReward && (
          <div className="p-3.5 rounded-2xl bg-[#14182E] border-2 border-[#FAC602] flex flex-col items-center text-center gap-1.5 animate-in zoom-in-95">
            <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[#FAC602] bg-[#0A0E21] px-2.5 py-0.5 rounded-full border border-[#FAC602]/40">
              <Sparkles className="w-3 h-3" />
              {revealedReward.rarity} REWARD GRANTED!
            </div>
            <h3 className="text-base font-black text-white">{revealedReward.name}</h3>
            <p className="text-xs text-slate-300">{revealedReward.description}</p>
          </div>
        )}

        {/* --- End-of-Run Meaningful Reward Choice: EITHER Double Cash OR Mystery Box --- */}
        {!hasClaimedBonus && !isWatchingAd && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black text-slate-300 text-center uppercase tracking-widest [@media(max-height:500px)]:hidden">
              SELECT EMERGENCY BOUNTY SPONSORSHIP
            </span>

            <div className="grid grid-cols-2 gap-2">
              {/* Option A: Double Cash */}
              <button
                id="btn-ad-double-cash"
                onClick={() => handleWatchAd('double')}
                className="bg-[#14182E] border-[2.5px] border-[#0A0E21] hover:border-[#FAC602] flex flex-col items-center justify-center p-3 rounded-2xl text-white shadow-lg select-none cursor-pointer transition active:scale-95"
              >
                <div className="flex items-center gap-1 text-[#FAC602] font-black text-[10px] uppercase mb-0.5">
                  <Play className="w-3 h-3 fill-[#FAC602]" />
                  <span>SPONSOR FEED</span>
                </div>
                <span className="text-sm font-black tracking-wide leading-tight text-white uppercase">
                  2X CREDITS
                </span>
                <span className="text-[9px] font-bold text-[#FAC602] [@media(max-height:500px)]:hidden">
                  +${stats.cashEarned} Bonus
                </span>
              </button>

              {/* Option B: Mystery Box */}
              <button
                id="btn-ad-mystery-box"
                onClick={() => handleWatchAd('box')}
                className="bg-[#14182E] border-[2.5px] border-[#0A0E21] hover:border-[#00D2FF] flex flex-col items-center justify-center p-3 rounded-2xl text-white shadow-lg select-none cursor-pointer transition active:scale-95"
              >
                <div className="flex items-center gap-1 text-[#00D2FF] font-black text-[10px] uppercase mb-0.5">
                  <Gift className="w-3 h-3" />
                  <span>SPONSOR FEED</span>
                </div>
                <span className="text-sm font-black tracking-wide leading-tight text-white uppercase">
                  ORBITAL CRATE
                </span>
                <span className="text-[9px] font-bold text-[#00D2FF] [@media(max-height:500px)]:hidden">
                  Loot, Gems, Blueprints
                </span>
              </button>
            </div>
          </div>
        )}

        {hasClaimedBonus && !revealedReward && (
          <div className="flex items-center justify-center gap-2 p-2 rounded-xl bg-[#0A3D2E] border border-[#53CE17]/40 text-[#53CE17] text-xs font-black tracking-wide">
            <CheckCircle2 className="w-4 h-4 text-[#53CE17]" />
            <span>BOUNTY CONFIRMED: +${stats.cashEarned} CREDITS!</span>
          </div>
        )}

        {/* --- Primary Buttons: Play Again & Main Menu (above the optional
            sponsor bounties on short/landscape screens) --- */}
        <div className="flex items-center gap-2.5 pt-1 [@media(max-height:500px)]:-order-1">
          <button
            id="btn-play-again"
            onClick={() => {
              sound.playUiClick();
              onPlayAgain();
            }}
            className="btn-game-gold flex-1 py-3 px-6 rounded-full text-white font-black text-sm tracking-widest flex items-center justify-center gap-2 select-none uppercase shadow-xl cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 stroke-[2.5]" />
            <span>PLAY AGAIN</span>
          </button>

          <button
            id="btn-main-menu"
            onClick={() => {
              sound.playUiClick();
              onReturnHome();
            }}
            className="w-12 h-12 btn-game-squircle cursor-pointer"
            title="Return to Command Deck"
          >
            <Home className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
