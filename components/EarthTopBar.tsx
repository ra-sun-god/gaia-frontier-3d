'use client';

import React from 'react';
import { PlayerProfile } from '@/lib/types';
import { sound } from '@/lib/audio';
import { Plus } from 'lucide-react';

interface EarthTopBarProps {
  profile: PlayerProfile;
  onlineCount?: number;
  onOpenSettings?: () => void;
  onOpenStats?: () => void;
  onOpenShop?: () => void;
}

export const EarthTopBar: React.FC<EarthTopBarProps> = ({
  profile,
  onlineCount = 10,
  onOpenStats,
  onOpenShop,
}) => {
  const commanderRank = Math.max(1, profile.highestWave * 2 + Math.floor(profile.highScore / 5000));
  const rankDisplay = commanderRank < 10 ? `0${commanderRank}` : `${commanderRank}`;

  // Calculated energy stamina
  const currentEnergy = 100;
  const maxEnergy = 100;

  return (
    <header className="w-full flex flex-col gap-1.5 px-3 pt-2 pb-1 select-none z-30 pointer-events-auto">
      <div className="w-full flex items-center justify-between gap-2">
        {/* ================================================================= */}
        {/* 1. LEFT: ENERGY CAPSULE (Matching Inspiration Reference)          */}
        {/* ================================================================= */}
        <div
          id="bar-resource-energy"
          className="relative flex items-center bg-[#171B33] border-[2.5px] border-[#080E1E] rounded-full pl-7 pr-1 py-0.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8),0_4px_8px_rgba(0,0,0,0.4)]"
        >
          {/* Lightning Bolt 3D Icon Overhanging */}
          <div className="absolute -left-2 -top-1 w-9 h-9 flex items-center justify-center filter drop-shadow-[0_3px_2px_rgba(0,0,0,0.8)]">
            <svg viewBox="0 0 36 36" className="w-full h-full">
              <path
                d="M19 2L7 19h9l-3 15 16-19h-10l4-13z"
                fill="url(#lightningGrad)"
                stroke="#120A00"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient id="lightningGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#FFF275" />
                  <stop offset="50%" stopColor="#FAC602" />
                  <stop offset="100%" stopColor="#FF9100" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Value display: 100/100 */}
          <div className="px-2 py-0.5 min-w-[62px] text-center">
            <span className="text-[12px] font-black text-white tracking-wider tabular-nums text-stroke-arcade">
              {currentEnergy}/{maxEnergy}
            </span>
          </div>

          {/* Circular Green + Button */}
          <button
            id="btn-energy-plus"
            onClick={() => {
              sound.playUiClick();
              onOpenShop?.();
            }}
            className="w-5 h-5 rounded-full pill-resource-plus flex items-center justify-center cursor-pointer ml-1 active:scale-90 transition"
            title="Refill Energy"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3.5]" />
          </button>
        </div>

        {/* ================================================================= */}
        {/* 2. CENTER: DIAMOND GEMS CAPSULE (Matching Inspiration Reference)  */}
        {/* ================================================================= */}
        <div
          id="bar-resource-gems"
          className="relative flex items-center bg-[#171B33] border-[2.5px] border-[#080E1E] rounded-full pl-7 pr-1 py-0.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8),0_4px_8px_rgba(0,0,0,0.4)]"
        >
          {/* 3D Faceted Diamond Gem Icon Overhanging */}
          <div className="absolute -left-2 -top-1 w-9 h-9 flex items-center justify-center filter drop-shadow-[0_3px_2px_rgba(0,0,0,0.8)]">
            <svg viewBox="0 0 36 36" className="w-full h-full">
              {/* Diamond Outline & Facets */}
              <polygon
                points="18,3 32,12 18,33 4,12"
                fill="url(#gemGrad)"
                stroke="#041E3E"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <polygon points="18,3 25,12 18,33 11,12" fill="#38BDF8" opacity="0.75" />
              <polygon points="18,3 32,12 25,12" fill="#E0F2FE" opacity="0.9" />
              <polygon points="18,3 11,12 4,12" fill="#BAE6FD" opacity="0.6" />
              <defs>
                <linearGradient id="gemGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#BAE6FD" />
                  <stop offset="40%" stopColor="#00D2FF" />
                  <stop offset="100%" stopColor="#0284C7" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Value display */}
          <div className="px-2 py-0.5 min-w-[58px] text-center">
            <span className="text-[12px] font-black text-white tracking-wider tabular-nums text-stroke-arcade">
              {profile.gems}
            </span>
          </div>

          {/* Circular Green + Button */}
          <button
            id="btn-gems-plus"
            onClick={() => {
              sound.playUiClick();
              onOpenShop?.();
            }}
            className="w-5 h-5 rounded-full pill-resource-plus flex items-center justify-center cursor-pointer ml-1 active:scale-90 transition"
            title="Get Gems"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3.5]" />
          </button>
        </div>

        {/* ================================================================= */}
        {/* 3. RIGHT: PLAYER PROFILE & RANK (Matching Inspiration Reference)  */}
        {/* ================================================================= */}
        <div
          id="profile-status-badge"
          onClick={() => {
            sound.playUiClick();
            onOpenStats?.();
          }}
          className="flex items-center gap-1.5 cursor-pointer active:scale-95 transition shrink-0"
        >
          {/* Blue Hexagonal Gem / Profile Frame */}
          <div className="relative w-10 h-11 flex items-center justify-center filter drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]">
            <svg viewBox="0 0 40 44" className="w-full h-full">
              {/* Outer Dark Bevel */}
              <polygon
                points="20,2 38,12 38,32 20,42 2,32 2,12"
                fill="#072044"
                stroke="#040F22"
                strokeWidth="2"
              />
              {/* Primary Azure Blue Hexagon */}
              <polygon
                points="20,4 36,13 36,31 20,40 4,31 4,13"
                fill="url(#hexBlueGrad)"
              />
              {/* Specular White Highlight Dot */}
              <circle cx="11" cy="14" r="2.5" fill="#FFFFFF" opacity="0.85" />
              <defs>
                <linearGradient id="hexBlueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3C9BFF" />
                  <stop offset="45%" stopColor="#1474E0" />
                  <stop offset="100%" stopColor="#0B4E99" />
                </linearGradient>
              </defs>
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none">
              👨‍🚀
            </span>
          </div>

          {/* Name & Golden Rank Badge */}
          <div className="flex flex-col items-start leading-none gap-0.5">
            <span className="text-[13px] font-black text-white uppercase tracking-wider text-stroke-arcade">
              COMMANDER
            </span>
            <div className="flex items-center bg-[#07254C] border-[1.5px] border-[#0A3B78] rounded-full px-1.5 py-0.5 shadow-sm">
              <span className="text-[9px] font-black text-[#FAC602] tracking-wider uppercase">
                RANK <strong className="text-white ml-0.5">{rankDisplay}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-strip: Online Status pill & Cash balance */}
      <div className="w-full flex items-center justify-between px-1">
        {/* Online Status Pill (Reference: "🟢 ONLINE: 00") */}
        <div
          id="status-online-pill"
          className="pill-online-status px-2.5 py-0.5 flex items-center gap-1.5"
        >
          <div className="w-2 h-2 rounded-full bg-[#53CE17] animate-pulse shadow-[0_0_8px_#53CE17]" />
          <span className="text-[9px] font-black tracking-widest uppercase">
            ONLINE: <strong className="text-white">{onlineCount < 10 ? `0${onlineCount}` : onlineCount}</strong>
          </span>
        </div>

        {/* Tactical Credits / Cash display */}
        <div className="bg-[#171B33] border-[1.5px] border-[#080E1E] rounded-full px-2.5 py-0.5 flex items-center gap-1 shadow-inner">
          <span className="text-[10px]">🪙</span>
          <span className="text-[10px] font-black text-[#FAC602] tabular-nums tracking-wide">
            ${profile.cash.toLocaleString()}
          </span>
        </div>
      </div>
    </header>
  );
};

