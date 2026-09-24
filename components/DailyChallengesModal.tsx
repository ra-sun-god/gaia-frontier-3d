'use client';

import React, { useState } from 'react';
import { DailyChallenge } from '@/lib/types';
import { sound } from '@/lib/audio';
import { X, CheckCircle2, Zap } from 'lucide-react';
import { ModalDock } from './ModalDock';

interface DailyChallengesModalProps {
  challenges: DailyChallenge[];
  onClaim: (id: string) => void;
  onClose: () => void;
}

export const DailyChallengesModal: React.FC<DailyChallengesModalProps> = ({
  challenges,
  onClaim,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'daily' | 'additional'>('daily');

  // Additional campaign objectives (structural typing: keep DailyChallenge shape)
  // Values follow the claim-boost economy: half the legacy payout, doubled
  // back via the post-claim boost modal (watch ad) or +50% (free tap).
  const additionalChallenges: DailyChallenge[] = [
    {
      id: 'add_1',
      type: 'survive_waves',
      title: 'Orbital Supremacy',
      description: 'Defeat 15 elite boss dreadnoughts',
      current: 7,
      target: 15,
      completed: false,
      claimed: false,
      rewardCash: 600,
      rewardGems: 6,
    },
    {
      id: 'add_2',
      type: 'survive_waves',
      title: 'Plasma Overdrive',
      description: 'Deal 50,000 total plasma damage',
      current: 38200,
      target: 50000,
      completed: false,
      claimed: false,
      rewardCash: 1250,
      rewardGems: 10,
    },
  ];

  const currentList = activeTab === 'daily' ? challenges : additionalChallenges;

  return (
    <div
      id="daily-challenges-modal"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop animate-in fade-in select-none"
    >
      {/* Top Header Row with Title Pill & Close */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5 bg-[#171B33] border-[2px] border-[#080E1E] px-3 py-1 rounded-full shadow-inner">
          <Zap className="w-3.5 h-3.5 text-[#FAC602]" />
          <span className="text-[10px] font-black text-white uppercase tracking-wider">
            MISSION DIRECTIVES
          </span>
        </div>

        <button
          id="btn-close-challenges"
          onClick={() => {
            sound.playUiClick();
            onClose();
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      {/* Main Container Card */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 sm:p-5 flex flex-col gap-3.5 shadow-2xl relative my-auto max-h-[78vh] overflow-hidden">
        {/* =============================================================== */}
        {/* SEGMENTED PILL TABS (Reference: DAILY TASKS / ADDITIONAL TASKS)   */}
        {/* =============================================================== */}
        <div className="w-full tab-segmented-container grid grid-cols-2 p-1 gap-1">
          <button
            onClick={() => {
              sound.playUiClick();
              setActiveTab('daily');
            }}
            className={`py-2 text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer ${
              activeTab === 'daily' ? 'tab-segmented-active' : 'tab-segmented-inactive'
            }`}
          >
            DAILY TASKS
          </button>
          <button
            onClick={() => {
              sound.playUiClick();
              setActiveTab('additional');
            }}
            className={`py-2 text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer ${
              activeTab === 'additional' ? 'tab-segmented-active' : 'tab-segmented-inactive'
            }`}
          >
            ADDITIONAL TASKS
          </button>
        </div>

        {/* Challenges List */}
        <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[50vh] pr-1">
          {currentList.map((ch) => {
            const pct = Math.min(100, Math.round((ch.current / ch.target) * 100));

            return (
              <div
                key={ch.id}
                className="bg-[#14182E] border-[2.5px] border-[#0A0E21] p-3 rounded-2xl flex flex-col gap-2 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_4px_8px_rgba(0,0,0,0.4)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-black text-xs text-white uppercase tracking-wider text-stroke-arcade">
                    {ch.title}
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] font-black">
                    <span className="text-[#FAC602]">+${ch.rewardCash}</span>
                    <span className="text-[#00D2FF]">+{ch.rewardGems} 💎</span>
                  </div>
                </div>

                {/* Progress capsule */}
                <div className="w-full capsule-progress-track h-3 p-0.5 relative">
                  <div
                    className="h-full capsule-progress-fill-cyan rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="specular-gloss-stripe" />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-300">
                  <span>{ch.description}</span>
                  <span className="font-black text-[#FAC602] tabular-nums">
                    {ch.current} / {ch.target}
                  </span>
                </div>

                {/* Claim Button: completable objective that hasn't been paid out yet */}
                {ch.completed && !ch.claimed && (
                  <button
                    id={`btn-claim-challenge-${ch.id}`}
                    onClick={() => {
                      sound.playGoodie();
                      onClaim(ch.id);
                    }}
                    className="btn-game-gold py-2 px-4 rounded-full text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1 mt-1 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>CLAIM REWARD</span>
                  </button>
                )}

                {ch.claimed && (
                  <div className="flex items-center justify-center gap-1 text-[10px] font-black text-[#53CE17] bg-[#0E2413] border border-[#53CE17]/40 py-1.5 rounded-xl">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#53CE17]" />
                    <span>REWARD CLAIMED</span>
                  </div>
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

