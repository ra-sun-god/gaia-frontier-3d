'use client';

import React from 'react';
import { sound } from '@/lib/audio';
import { Undo2, X, Settings, Trophy, Zap } from 'lucide-react';

export type ActiveNavTab = 'home' | 'shop' | 'mystery' | 'challenges' | 'leaderboard' | 'cosmetics' | 'none';

interface EarthBottomDockProps {
  activeTab: ActiveNavTab;
  onNavigate: (tab: ActiveNavTab) => void;
  onBack?: () => void;
  showBack?: boolean;
  onOpenSettings?: () => void;
}

export const EarthBottomDock: React.FC<EarthBottomDockProps> = ({
  activeTab,
  onNavigate,
  onBack,
  showBack = false,
  onOpenSettings,
}) => {
  const triggerHaptic = (ms: number = 10) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(ms);
      }
    } catch {}
  };

  const handleAction = (tab: ActiveNavTab) => {
    sound.playUiClick();
    triggerHaptic(12);
    onNavigate(tab);
  };

  return (
    <nav className="w-full max-w-md mx-auto px-2 pb-3 select-none z-30 pointer-events-auto">
      <div className="flex items-center justify-between gap-1.5 px-3 py-2 bg-[#12162C]/95 border-[3px] border-[#070D1E] rounded-3xl shadow-[inset_0_2px_2px_rgba(255,255,255,0.2),0_8px_0_#070B18,0_12px_20px_rgba(0,0,0,0.6)] backdrop-blur-md">
        {/* =============================================================== */}
        {/* 1. CIRCULAR SLATE BACK ARROW (Reference: #40436C Curved Arrow)   */}
        {/* =============================================================== */}
        <button
          id="dock-btn-back"
          onClick={() => {
            sound.playUiClick();
            triggerHaptic(10);
            if (onBack) onBack();
            else onNavigate('home');
          }}
          className="w-11 h-11 rounded-full btn-game-navy flex items-center justify-center text-white shrink-0 active:scale-95 transition"
          title="Back / Home"
        >
          <Undo2 className="w-5 h-5 stroke-[3]" />
        </button>

        {/* =============================================================== */}
        {/* 2. HEXAGONAL SHOP STALL (Reference: Shop with Red/White Canopy)  */}
        {/* =============================================================== */}
        <button
          id="dock-btn-shop"
          onClick={() => handleAction('shop')}
          className={`relative w-12 h-13 flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition filter drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)] ${
            activeTab === 'shop' ? 'brightness-125' : ''
          }`}
          title="Armory Shop"
        >
          <svg viewBox="0 0 44 48" className="w-full h-full">
            {/* Hexagon Border & Shadow */}
            <polygon
              points="22,2 42,13 42,35 22,46 2,35 2,13"
              fill={activeTab === 'shop' ? '#00D2FF' : '#07254C'}
              stroke="#040F22"
              strokeWidth="2.5"
            />
            {/* Inner Face */}
            <polygon
              points="22,4 40,14 40,34 22,44 4,34 4,14"
              fill={activeTab === 'shop' ? 'url(#hexShopActiveGrad)' : 'url(#hexShopGrad)'}
            />
            <defs>
              <linearGradient id="hexShopGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3C9BFF" />
                <stop offset="50%" stopColor="#1474E0" />
                <stop offset="100%" stopColor="#0A4E9B" />
              </linearGradient>
              <linearGradient id="hexShopActiveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7EE6FF" />
                <stop offset="100%" stopColor="#00A7D4" />
              </linearGradient>
            </defs>
          </svg>

          {/* Cute Shop Stall Icon with Red & White Canopy */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -mt-0.5">
            <div className="w-6 h-3 rounded-t-sm flex overflow-hidden border border-[#061B35] shadow-sm">
              <div className="flex-1 bg-red-500" />
              <div className="flex-1 bg-white" />
              <div className="flex-1 bg-red-500" />
              <div className="flex-1 bg-white" />
              <div className="flex-1 bg-red-500" />
            </div>
            <div className="w-5 h-3 bg-[#FAC602] border-x border-b border-[#061B35] rounded-b-sm flex items-center justify-center text-[7px] font-black text-amber-950">
              $
            </div>
          </div>
        </button>

        {/* =============================================================== */}
        {/* 3. HEXAGONAL VAULT GIFT (Reference: Cyan Gift Box with Ribbons) */}
        {/* =============================================================== */}
        <button
          id="dock-btn-vault"
          onClick={() => handleAction('mystery')}
          className={`relative w-12 h-13 flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition filter drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)] ${
            activeTab === 'mystery' ? 'brightness-125' : ''
          }`}
          title="Cosmic Vault"
        >
          <svg viewBox="0 0 44 48" className="w-full h-full">
            <polygon
              points="22,2 42,13 42,35 22,46 2,35 2,13"
              fill={activeTab === 'mystery' ? '#FAC602' : '#07254C'}
              stroke="#040F22"
              strokeWidth="2.5"
            />
            <polygon
              points="22,4 40,14 40,34 22,44 4,34 4,14"
              fill={activeTab === 'mystery' ? 'url(#hexShopActiveGrad)' : 'url(#hexShopGrad)'}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xl">
            🎁
          </div>
        </button>

        {/* =============================================================== */}
        {/* 4. HEXAGONAL BATTLE PASS / DIRECTIVES                           */}
        {/* =============================================================== */}
        <button
          id="dock-btn-challenges"
          onClick={() => handleAction('challenges')}
          className={`relative w-12 h-13 flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition filter drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)] ${
            activeTab === 'challenges' ? 'brightness-125' : ''
          }`}
          title="Daily Directives"
        >
          <svg viewBox="0 0 44 48" className="w-full h-full">
            <polygon
              points="22,2 42,13 42,35 22,46 2,35 2,13"
              fill={activeTab === 'challenges' ? '#53CE17' : '#07254C'}
              stroke="#040F22"
              strokeWidth="2.5"
            />
            <polygon
              points="22,4 40,14 40,34 22,44 4,34 4,14"
              fill="url(#hexShopGrad)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xl">
            ⚡
          </div>
        </button>

        {/* =============================================================== */}
        {/* 5. TOP COMMANDERS TROPHY SQUIRCLE                                */}
        {/* =============================================================== */}
        <button
          id="dock-btn-leaderboard"
          onClick={() => handleAction('leaderboard')}
          className={`w-11 h-11 btn-game-squircle shrink-0 ${
            activeTab === 'leaderboard' ? 'active' : ''
          }`}
          title="Top Commanders"
        >
          <Trophy className="w-5 h-5 text-[#FAC602] stroke-[2.5]" />
        </button>

        {/* =============================================================== */}
        {/* 6. SETTINGS COG SQUIRCLE (Reference: Gear button)               */}
        {/* =============================================================== */}
        <button
          id="dock-btn-settings"
          onClick={() => {
            sound.playUiClick();
            onOpenSettings?.();
          }}
          className="w-11 h-11 btn-game-squircle shrink-0"
          title="Settings"
        >
          <Settings className="w-5 h-5 text-white stroke-[2.5]" />
        </button>
      </div>
    </nav>
  );
};

