'use client';

import React from 'react';
import { PlayerProfile } from '@/lib/types';
import { sound } from '@/lib/audio';
import { BATTLE_PASS_TIERS } from '@/lib/storage';
import { X, Sparkles, CheckCircle2, Lock, Crown } from 'lucide-react';
import { ModalDock } from './ModalDock';

interface BattlePassModalProps {
  profile: PlayerProfile;
  onUpgradePremium: () => void;
  onClaimTier: (tier: number) => void;
  onClose: () => void;
}

export const BattlePassModal: React.FC<BattlePassModalProps> = ({
  profile,
  onUpgradePremium,
  onClaimTier,
  onClose,
}) => {
  // Single source of truth: the SAME table handleClaimPassTier pays from
  // (lib/storage). Displayed rewards == credited rewards, always.
  const tiers = BATTLE_PASS_TIERS;

  return (
    <div
      id="battle-pass-modal"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop animate-in fade-in select-none"
    >
      {/* Top Header Row with Title Pill & Close */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5 bg-[#171B33] border-[2px] border-[#080E1E] px-3 py-1 rounded-full shadow-inner">
          <Crown className="w-3.5 h-3.5 text-[#FAC602]" />
          <span className="text-[10px] font-black text-white uppercase tracking-wider">
            CONVERGENCE PASS
          </span>
        </div>

        <button
          id="btn-close-battlepass"
          onClick={() => {
            sound.playUiClick();
            onClose();
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      {/* Main Dialog Card */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 sm:p-5 flex flex-col gap-3 shadow-2xl relative my-auto max-h-[78vh] overflow-hidden">
        {/* Tier & XP Status Strip */}
        <div className="flex items-center justify-between px-3 py-2 rounded-2xl bg-[#14182E] border-[2px] border-[#0A0E21]">
          <div className="flex flex-col text-left">
            <span className="text-[11px] font-black text-white uppercase tracking-wider">
              SEASON 1 PASS
            </span>
            <span className="text-[9px] font-bold text-slate-300">
              {profile.battlePassXp} Combat XP Accumulated
            </span>
          </div>
          <span className="text-xs font-black text-[#FAC602] bg-[#0C1024] px-2.5 py-1 rounded-full border border-[#FAC602]/30">
            TIER {profile.battlePassTier}
          </span>
        </div>

        {/* Premium Upgrade Banner */}
        {!profile.isBattlePassPremium ? (
          <div className="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-[#3B1768] to-[#1E194D] border-[2px] border-[#FAC602] shadow-[0_0_12px_rgba(250,198,2,0.3)]">
            <div className="flex flex-col text-left">
              <span className="text-xs font-black text-[#FAC602] uppercase tracking-wider">
                UNLOCK ELITE PASS
              </span>
              <span className="text-[10px] text-slate-200">
                Double rewards + Titan skins
              </span>
            </div>
            <button
              id="btn-unlock-elite-pass"
              onClick={() => {
                sound.playUpgradeSuccess();
                onUpgradePremium();
              }}
              className="btn-game-gold py-1.5 px-3 rounded-full text-xs font-black shadow-md cursor-pointer"
            >
              50 💎 Unlock
            </button>
          </div>
        ) : (
          <div className="p-2.5 rounded-2xl bg-[#2A1647] border border-[#A855F7] text-[#C084FC] text-xs font-black flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-[#FAC602]" />
            <span>ELITE CONVERGENCE PASS ACTIVE</span>
          </div>
        )}

        {/* Tiers List */}
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[50vh] pr-1">
          {tiers.map((t) => {
            const isReached = profile.battlePassXp >= t.xpReq;
            const isClaimed = profile.battlePassClaimedTiers?.includes(t.tier);

            return (
              <div
                key={t.tier}
                className={`p-2.5 rounded-2xl border-[2px] flex items-center justify-between gap-2.5 ${
                  isReached
                    ? 'bg-[#14182E] border-[#00D2FF] shadow-[0_0_10px_rgba(0,210,255,0.2)]'
                    : 'bg-[#101427] border-[#0A0E21] opacity-70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#171B33] flex items-center justify-center font-black text-xs text-[#00D2FF] border border-[#2B3566]">
                    T{t.tier}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-black text-white">Free: {t.free.label}</span>
                    <span className="text-[10px] font-bold text-[#FAC602]">
                      Elite: {t.premium.label}
                    </span>
                  </div>
                </div>

                {isClaimed ? (
                  <div className="flex items-center gap-1 bg-emerald-950/70 border border-emerald-500/40 px-2.5 py-1 rounded-full text-[10px] font-black text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>CLAIMED</span>
                  </div>
                ) : isReached ? (
                  <button
                    id={`btn-claim-tier-${t.tier}`}
                    onClick={() => {
                      sound.playGoodie();
                      onClaimTier(t.tier);
                    }}
                    className="btn-game-green py-1.5 px-3 rounded-full text-xs font-black cursor-pointer"
                  >
                    Claim
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 font-mono font-bold flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    {t.xpReq} XP
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Squircles Navigation Dock (shared) */}
      <ModalDock onClose={onClose} />
    </div>
  );
};

