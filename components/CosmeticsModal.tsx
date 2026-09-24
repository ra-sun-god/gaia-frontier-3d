'use client';

import React from 'react';
import { PlayerProfile, SkinItem } from '@/lib/types';
import { sound } from '@/lib/audio';
import { COSMETIC_SKINS } from '@/lib/skins';
import { X, Sparkles, Check, Lock } from 'lucide-react';
import { ModalDock } from './ModalDock';

interface CosmeticsModalProps {
  profile: PlayerProfile;
  onEquipSkin: (type: 'cannon' | 'base' | 'projectile', skinId: string) => void;
  onBuySkin: (skin: SkinItem) => void;
  onClose: () => void;
}

// Skin registry now lives in lib/skins.ts (shared with the game engine)

export const CosmeticsModal: React.FC<CosmeticsModalProps> = ({
  profile,
  onEquipSkin,
  onBuySkin,
  onClose,
}) => {
  return (
    <div
      id="cosmetics-modal"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop animate-in fade-in select-none"
    >
      {/* Top Header Row with Title Pill & Close */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5 bg-[#171B33] border-[2px] border-[#080E1E] px-3 py-1 rounded-full shadow-inner">
          <Sparkles className="w-3.5 h-3.5 text-[#00D2FF]" />
          <span className="text-[10px] font-black text-white uppercase tracking-wider">
            FLEET CAMOUFLAGE
          </span>
        </div>

        <button
          id="btn-close-cosmetics"
          onClick={() => {
            sound.playUiClick();
            onClose();
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition cursor-pointer"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      {/* Main Dialog Card */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 sm:p-5 flex flex-col gap-3 shadow-2xl relative my-auto max-h-[78vh] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 rounded-2xl bg-[#14182E] border-[2px] border-[#0A0E21] text-xs font-bold">
          <span className="text-slate-300 text-[11px]">Equip Planetary Skins</span>
          <div className="flex items-center gap-1 text-[#00D2FF]">
            <span>💎 {profile.gems}</span>
          </div>
        </div>

        {/* Skins Grid */}
        <div className="grid grid-cols-1 gap-2.5 overflow-y-auto max-h-[55vh] pr-1">
          {COSMETIC_SKINS.map((skin) => {
            const isUnlocked = profile.unlockedSkins.includes(skin.id) || skin.costGems === 0;
            const isEquipped =
              (skin.type === 'cannon' && profile.equippedSkins.cannon === skin.id) ||
              (skin.type === 'base' && profile.equippedSkins.base === skin.id) ||
              (skin.type === 'projectile' && profile.equippedSkins.projectile === skin.id);

            return (
              <div
                key={skin.id}
                className={`bg-[#14182E] border-[2.5px] p-2.5 rounded-2xl flex items-center justify-between shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_4px_8px_rgba(0,0,0,0.4)] ${
                  isEquipped ? 'border-[#00D2FF] shadow-[0_0_10px_rgba(0,210,255,0.3)]' : 'border-[#0A0E21]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${skin.previewClass} border border-white/40 flex items-center justify-center shadow-sm shrink-0`}
                  >
                    {skin.type === 'cannon' ? '💥' : skin.type === 'base' ? '🛡️' : '⚡'}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="font-black text-xs text-white leading-tight uppercase">{skin.name}</span>
                    <span className="text-[10px] text-slate-300 uppercase font-semibold">
                      {skin.type}
                    </span>
                  </div>
                </div>

                <div>
                  {isEquipped ? (
                    <div className="flex items-center gap-1 bg-[#0A3D2E] border border-[#53CE17] px-2.5 py-1 rounded-full text-[10px] font-black text-[#53CE17]">
                      <Check className="w-3 h-3 text-[#53CE17]" />
                      <span>EQUIPPED</span>
                    </div>
                  ) : isUnlocked ? (
                    <button
                      id={`btn-equip-skin-${skin.id}`}
                      onClick={() => {
                        sound.playUiClick();
                        onEquipSkin(skin.type, skin.id);
                      }}
                      className="btn-game-navy py-1 px-3 rounded-full text-[11px] font-black uppercase tracking-wider cursor-pointer"
                    >
                      EQUIP
                    </button>
                  ) : (
                    <button
                      id={`btn-buy-skin-${skin.id}`}
                      disabled={profile.gems < skin.costGems}
                      onClick={() => {
                        sound.playUpgradeSuccess();
                        onBuySkin(skin);
                      }}
                      className={`py-1 px-3 rounded-full text-[11px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer ${
                        profile.gems >= skin.costGems
                          ? 'btn-game-gold'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                      <span>{skin.costGems} 💎</span>
                    </button>
                  )}
                </div>
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
