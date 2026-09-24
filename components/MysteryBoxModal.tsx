'use client';

import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { MysteryBoxReward } from '@/lib/types';
import { rollMysteryBox } from '@/lib/storage';
import { sound } from '@/lib/audio';
import { X, Sparkles, ArrowUp } from 'lucide-react';
import { ModalDock } from './ModalDock';

interface MysteryBoxModalProps {
  playerGems: number;
  lastDailyClaimedAt: number;
  onRewardClaimed: (reward: MysteryBoxReward, spentGems: number) => void;
  onClose: () => void;
}

export const MysteryBoxModal: React.FC<MysteryBoxModalProps> = ({
  playerGems,
  lastDailyClaimedAt,
  onRewardClaimed,
  onClose,
}) => {
  const [isOpening, setIsOpening] = useState(false);
  const [reward, setReward] = useState<MysteryBoxReward | null>(null);
  const [selectedRelic, setSelectedRelic] = useState<'voider' | 'zorgon' | 'nebula'>('nebula');
  const [relicLevels, setRelicLevels] = useState({
    voider: 5,
    zorgon: 5,
    nebula: 11,
  });
  const [showAllRelics, setShowAllRelics] = useState(false);
  // Mount-frozen on purpose: the parent remounts this modal via
  // key={lastDailyBoxClaimedAt} whenever a free daily is claimed, so the
  // gate immediately re-locks for 24h (no infinite farming, and no
  // Date.now() call during render).
  const [isDailyAvailable] = useState(() => Date.now() - lastDailyClaimedAt > 24 * 60 * 60 * 1000);

  const gemCost = 15;

  // Keep the reveal timeout ref so closing mid-roll can never double-grant a reward
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
    };
  }, []);

  const handleOpen = (isFreeDaily: boolean) => {
    if (isOpening) return;
    if (!isFreeDaily && playerGems < gemCost) return;

    sound.playUiClick();
    setIsOpening(true);
    setReward(null);

    openTimeoutRef.current = setTimeout(() => {
      const rolled = rollMysteryBox();
      setReward(rolled);
      setIsOpening(false);
      sound.playWaveClear();
      onRewardClaimed(rolled, isFreeDaily ? 0 : gemCost);

      confetti({
        particleCount: rolled.rarity === 'Legendary' ? 120 : 70,
        spread: 80,
        origin: { y: 0.55 },
      });
    }, 1000);
  };

  const handleLevelUpRelic = () => {
    sound.playPowerUp();
    setRelicLevels((prev) => ({
      ...prev,
      [selectedRelic]: prev[selectedRelic] + 1,
    }));
    confetti({
      particleCount: 45,
      spread: 60,
      origin: { y: 0.5 },
    });
  };

  return (
    <div
      id="mystery-box-modal"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop animate-in fade-in select-none"
    >
      {/* Top Header Row with Title Pill & Info */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5 bg-[#171B33] border-[2px] border-[#080E1E] px-3 py-1 rounded-full shadow-inner">
          <div className="w-2.5 h-2.5 rounded-full bg-[#53CE17] animate-pulse shadow-[0_0_8px_#53CE17]" />
          <span className="text-[10px] font-black text-white uppercase tracking-wider">
            COSMIC RELIC VAULT
          </span>
        </div>

        {/* Circular Close Button (Reference: #40436C Navy) */}
        <button
          id="btn-close-mystery-box"
          onClick={() => {
            sound.playUiClick();
            onClose();
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition"
          title="Close"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      {/* Main Vault Center Card */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 sm:p-5 flex flex-col items-center gap-3 relative my-auto">
        {/* Title Header */}
        <div className="flex flex-col items-center text-center leading-tight">
          <span className="text-[11px] font-black text-[#FAC602] tracking-widest uppercase text-stroke-arcade">
            ANCIENT TECH ARSENAL
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-wider text-stroke-arcade">
            VOID RELICS
          </h2>
        </div>

        {/* ================================================================= */}
        {/* 3 COLLECTIBLE CARDS (Exact match to Inspiration Reference Image)   */}
        {/* ================================================================= */}
        <div className="w-full grid grid-cols-3 gap-2">
          {/* Card 1: RELIC VOIDER (Purple/Cyan Cosmic Cube on Pedestal) */}
          <div
            id="card-relic-voider"
            onClick={() => {
              sound.playUiClick();
              setSelectedRelic('voider');
            }}
            className={`card-relic-container p-2 flex flex-col items-center justify-between text-center cursor-pointer transition ${
              selectedRelic === 'voider' ? 'ring-2 ring-[#00D2FF] scale-[1.02]' : ''
            }`}
          >
            {/* 3D Glowing Cube on Futuristic Pedestal */}
            <div className="relative my-1 flex flex-col items-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#A855F7] via-[#6366F1] to-[#3B82F6] p-0.5 shadow-[0_0_14px_rgba(168,85,247,0.7)] flex items-center justify-center animate-pulse">
                <div className="w-full h-full bg-[#141529] rounded-[10px] flex items-center justify-center">
                  <div className="w-5 h-5 bg-[#C084FC] rotate-45 shadow-[0_0_8px_#C084FC]" />
                </div>
              </div>
              {/* Pedestal Stand Base */}
              <div className="w-9 h-2 bg-[#6B21A8] rounded-full mt-1 opacity-90 border border-[#A855F7]/40" />
            </div>

            <span className="text-[8px] font-black text-[#A855F7] uppercase tracking-wider mt-1">
              RELIC
            </span>
            <span className="text-[11px] font-black text-white uppercase tracking-tight leading-none">
              VOIDER
            </span>

            {/* Purple Progress Bar 5/10 */}
            <div className="w-full mt-2 capsule-progress-track h-2.5 p-0.5">
              <div
                className="h-full bg-gradient-to-r from-[#A855F7] to-[#C084FC] rounded-full transition-all"
                style={{ width: `${Math.min(100, (relicLevels.voider / 10) * 100)}%` }}
              />
              <div className="specular-gloss-stripe" />
            </div>
            <span className="text-[9px] font-black text-slate-300 mt-0.5">
              {relicLevels.voider}/10
            </span>
          </div>

          {/* Card 2: TOKEN ZORGON (Copper Hexagon with Cute Alien & x2 Badge) */}
          <div
            id="card-token-zorgon"
            onClick={() => {
              sound.playUiClick();
              setSelectedRelic('zorgon');
            }}
            className={`card-relic-container p-2 flex flex-col items-center justify-between text-center cursor-pointer transition ${
              selectedRelic === 'zorgon' ? 'ring-2 ring-[#FAC602] scale-[1.02]' : ''
            }`}
          >
            {/* Copper Hexagonal Alien Crest */}
            <div className="relative my-1 flex flex-col items-center">
              <div className="w-12 h-13 token-frame-zorgon flex items-center justify-center">
                <span className="text-2xl filter drop-shadow">👽</span>
              </div>
              {/* x2 Badge */}
              <span className="absolute -bottom-1 -right-1 token-multiplier-badge">
                x2
              </span>
            </div>

            <span className="text-[8px] font-black text-[#F97316] uppercase tracking-wider mt-1">
              TOKEN
            </span>
            <span className="text-[11px] font-black text-white uppercase tracking-tight leading-none">
              ZORGON
            </span>

            {/* Golden Progress Bar 5/10 */}
            <div className="w-full mt-2 capsule-progress-track h-2.5 p-0.5">
              <div
                className="h-full capsule-progress-fill-gold rounded-full transition-all"
                style={{ width: `${Math.min(100, (relicLevels.zorgon / 10) * 100)}%` }}
              />
              <div className="specular-gloss-stripe" />
            </div>
            <span className="text-[9px] font-black text-slate-300 mt-0.5">
              {relicLevels.zorgon}/10
            </span>
          </div>

          {/* Card 3: TOKEN NEBULA (Silver-Blue Hexagon with Planet, x2 Badge, 11/10 & Green Arrow) */}
          <div
            id="card-token-nebula"
            onClick={() => {
              sound.playUiClick();
              setSelectedRelic('nebula');
            }}
            className={`card-relic-container p-2 flex flex-col items-center justify-between text-center cursor-pointer transition ${
              selectedRelic === 'nebula' ? 'ring-2 ring-[#53CE17] scale-[1.02]' : ''
            }`}
          >
            {/* Silver-Blue Hexagonal Ringed Planet */}
            <div className="relative my-1 flex flex-col items-center">
              <div className="w-12 h-13 token-frame-nebula flex items-center justify-center">
                <span className="text-2xl filter drop-shadow">🪐</span>
              </div>
              {/* x2 Badge */}
              <span className="absolute -bottom-1 -right-1 token-multiplier-badge">
                x2
              </span>
            </div>

            <span className="text-[8px] font-black text-[#38BDF8] uppercase tracking-wider mt-1">
              TOKEN
            </span>
            <span className="text-[11px] font-black text-white uppercase tracking-tight leading-none">
              NEBULA
            </span>

            {/* Green Ready Progress Bar 11/10 with Green Arrow */}
            <div className="w-full mt-2 capsule-progress-track h-2.5 p-0.5">
              <div className="h-full capsule-progress-fill-green rounded-full w-full animate-pulse" />
              <div className="specular-gloss-stripe" />
            </div>
            <div className="flex items-center justify-center gap-0.5 mt-0.5">
              <span className="text-[9px] font-black text-[#53CE17]">
                {relicLevels.nebula}/10
              </span>
              <ArrowUp className="w-2.5 h-2.5 text-[#53CE17] stroke-[4]" />
            </div>
          </div>
        </div>

        {/* Selected Relic Perks Box */}
        <div className="w-full p-2.5 bg-[#14182E] border-[2px] border-[#090E1F] rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#1B2245] border border-[#2B3566] flex items-center justify-center text-sm">
              {selectedRelic === 'voider' ? '🛡️' : selectedRelic === 'zorgon' ? '⚡' : '🚀'}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[11px] font-black text-white uppercase">
                {selectedRelic === 'voider'
                  ? 'Orbital Shield +15%'
                  : selectedRelic === 'zorgon'
                  ? 'Plasma Crit Rate +20%'
                  : 'Laser Orbit Speed +25%'}
              </span>
              <span className="text-[9px] font-black text-[#FAC602]">
                STATUS: READY TO UPGRADE
              </span>
            </div>
          </div>
          <span className="text-[10px] font-black text-slate-300 bg-[#0B0E1B] px-2 py-0.5 rounded-full border border-slate-700">
            LVL {relicLevels[selectedRelic]}
          </span>
        </div>

        {/* Revealed Mystery Box Reward Banner */}
        {reward && (
          <div className="w-full p-2.5 rounded-2xl bg-[#09224C] border-2 border-[#FAC602] flex items-center justify-between animate-in zoom-in-95">
            <div className="flex items-center gap-2">
              <span className="text-2xl">
                {reward.gems ? '💎' : reward.cash ? '🪙' : '⚡'}
              </span>
              <div className="text-left">
                <span className="text-xs font-black text-white block leading-tight">{reward.name}</span>
                <span className="text-[10px] font-bold text-[#FAC602]">{reward.rarity} Reward</span>
              </div>
            </div>
            <span className="text-xs font-black text-[#53CE17] bg-[#06152E] px-2 py-1 rounded-lg border border-[#53CE17]/40">
              UNLOCKED
            </span>
          </div>
        )}

        {/* ================================================================= */}
        {/* BUTTON ACTIONS (LEVEL UP, REMOVE GEAR/CANCEL, VIEW ALL)            */}
        {/* ================================================================= */}
        <div className="w-full flex flex-col gap-2 pt-1">
          {/* 1. Golden CTA: "LEVEL UP" (Reference: Juicy #FAC602 Button) */}
          <button
            id="btn-relic-level-up"
            onClick={handleLevelUpRelic}
            className="w-full py-3.5 px-6 rounded-full btn-game-gold text-base tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition"
          >
            <Sparkles className="w-5 h-5 fill-white text-white drop-shadow" />
            <span>LEVEL UP</span>
          </button>

          {/* Secondary Action Row: "REMOVE GEAR" (Navy #40436C) & "VIEW ALL" (Green #53CE17) */}
          <div className="w-full grid grid-cols-2 gap-2">
            <button
              id="btn-relic-cancel"
              onClick={() => {
                sound.playUiClick();
                handleOpen(isDailyAvailable);
              }}
              className="py-2.5 px-3 rounded-full btn-game-navy text-xs tracking-wider flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>{isDailyAvailable ? 'FREE VAULT' : `OPEN (${gemCost} 💎)`}</span>
            </button>

            <button
              id="btn-relic-view-all"
              onClick={() => {
                sound.playUiClick();
                setShowAllRelics(!showAllRelics);
              }}
              className="py-2.5 px-3 rounded-full btn-game-green text-xs tracking-wider flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>VIEW ALL</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Squircles Navigation Dock (shared) */}
      <ModalDock onClose={onClose} />
    </div>
  );
};

