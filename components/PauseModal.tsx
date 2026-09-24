'use client';

import React, { useState, useMemo } from 'react';
import { sound } from '@/lib/audio';
import { haptics } from '@/lib/haptics';
import { WeaponId, WeaponDef } from '@/lib/types';
import { getUpgradeSuggestions, MAX_ADRENALINE_REFILL_STEPS, getAdrenalineRefillCost, getAdrenalineGainMultiplier } from '@/lib/storage';
import {
  Music,
  Volume2,
  RotateCcw,
  Play,
  Tv,
  ShoppingBag,
  Gift,
  Award,
  BrainCircuit,
  Wrench,
  Zap,
  Shield,
  Syringe,
  Bomb,
  Vibrate,
  Gauge,
} from 'lucide-react';

interface PauseModalProps {
  /** 'pause' = in-game pause screen; 'settings' = main-menu settings dialog */
  variant?: 'pause' | 'settings';
  crtEnabled?: boolean;
  onToggleCrt?: () => void;
  /** Pause variant: resume the run. Settings variant: close the dialog. */
  onResume: () => void;
  onRestart?: () => void;
  /** In-game quick access to Shop / Vault / Quests (shown while paused) */
  onOpenShop?: () => void;
  onOpenVault?: () => void;
  onOpenQuests?: () => void;

  // --- Tactical Advisor (pause variant): the same ranked upgrade offers the
  // wave intermission shows — pausing is ALSO a shopping moment.
  activeWeaponId?: WeaponId;
  weapons?: Record<WeaponId, WeaponDef>;
  cash?: number;
  currentHp?: number;
  maxHp?: number;
  nextWave?: number;
  empCharges?: number;
  orbitalCharges?: number;
  grenadeCharges?: number;
  onUpgradeWeapon?: (id: WeaponId) => void;
  onRepairBase?: () => void;
  onBuyAdrenalineStim?: () => void;
  /** Combat Response Protocol: permanent +25% adrenaline refill speed per
   *  level (max 4 → ×2.0). Bought while paused, applied to the live run. */
  adrenalineGainSteps?: number;
  onBuyAdrenalineRefill?: () => void;
  onBuySpecialCharge?: (type: 'emp' | 'orbital' | 'grenade') => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  variant = 'pause',
  crtEnabled = false,
  onToggleCrt,
  onResume,
  onRestart,
  onOpenShop,
  onOpenVault,
  onOpenQuests,
  activeWeaponId,
  weapons,
  cash = 0,
  currentHp = 100,
  maxHp = 100,
  nextWave = 1,
  empCharges = 0,
  orbitalCharges = 0,
  grenadeCharges = 0,
  onUpgradeWeapon,
  onRepairBase,
  onBuyAdrenalineStim,
  adrenalineGainSteps = 0,
  onBuyAdrenalineRefill,
  onBuySpecialCharge,
}) => {
  const [musicOn, setMusicOn] = useState(!sound.isMusicMuted());
  const [soundOn, setSoundOn] = useState(!sound.isSfxMuted());
  const [musicVolume, setMusicVolume] = useState(Math.round(sound.getMusicVolume() * 100));
  const [sfxVolume, setSfxVolume] = useState(Math.round(sound.getSfxVolume() * 100));
  const [hapticsOn, setHapticsOn] = useState(haptics.isEnabled());

  const handleToggleMusic = () => {
    sound.playUiClick();
    const next = !musicOn;
    setMusicOn(next);
    sound.setMusicMuted(!next);
  };

  const handleToggleSound = () => {
    sound.playUiClick();
    const next = !soundOn;
    setSoundOn(next);
    sound.setSfxMuted(!next);
  };

  // Click / drag on a volume bar — exact-position seek like a real slider.
  const handleVolumeSeek = (
    e: React.MouseEvent<HTMLDivElement>,
    apply: (pct: number) => void
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, Math.round((clickX / rect.width) * 100)));
    apply(pct);
  };

  const handleToggleHaptics = () => {
    sound.playUiClick();
    const next = !hapticsOn;
    setHapticsOn(next);
    haptics.setEnabled(next);
    if (next) haptics.tap(); // confirmation pulse
  };

  // Ranked one-tap upgrade suggestions (same engine as the intermission)
  const suggestions = useMemo(() => {
    if (variant !== 'pause' || !weapons || !activeWeaponId) return [];
    return getUpgradeSuggestions({
      weapons,
      activeWeaponId,
      cash,
      currentHp,
      maxHp,
      nextWave,
      empCharges,
      orbitalCharges,
      grenadeCharges,
      adrenalineGainSteps,
      maxSuggestions: 2,
    });
  }, [variant, weapons, activeWeaponId, cash, currentHp, maxHp, nextWave, empCharges, orbitalCharges, grenadeCharges, adrenalineGainSteps]);

  const applySuggestion = (kind: string, weaponId?: WeaponId) => {
    sound.playUiClick();
    if (kind === 'weapon' && weaponId) onUpgradeWeapon?.(weaponId);
    else if (kind === 'repair') onRepairBase?.();
    else if (kind === 'stim') onBuyAdrenalineStim?.();
    else if (kind === 'refill') onBuyAdrenalineRefill?.();
    else if (kind === 'emp') onBuySpecialCharge?.('emp');
    else if (kind === 'orbital') onBuySpecialCharge?.('orbital');
    else if (kind === 'grenade') onBuySpecialCharge?.('grenade');
  };

  return (
    <div
      id="pause-modal-overlay"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 game-modal-backdrop select-none animate-in fade-in"
    >
      <div className="w-full max-w-[320px] md:max-w-[26rem] lg:max-w-[30rem] max-h-[94%] overflow-y-auto game-dialog-card p-5 flex flex-col items-center gap-3.5 shadow-2xl relative">
        {/* Title */}
        <div className="flex flex-col items-center">
          <h2 className="text-2xl font-black text-white tracking-wider text-stroke-arcade uppercase drop-shadow-[0_3px_5px_rgba(0,0,0,0.8)]">
            {variant === 'settings' ? 'SETTINGS' : 'PAUSED'}
          </h2>
          <span className="text-[10px] font-black text-[#00D2FF] uppercase tracking-widest mt-0.5">
            {variant === 'settings' ? 'AUDIO & VISUAL CONFIG' : 'DEFENSE PROTOCOLS ON HOLD'}
          </span>
        </div>

        {/* Toggles Row: Music & Sound */}
        <div className="w-full flex items-center justify-between gap-2.5">
          {/* Music Toggle */}
          <div className="flex-1 flex items-center justify-between bg-[#14182E] border-[2px] border-[#0A0E21] rounded-full px-3 py-2">
            <Music className="w-4 h-4 text-[#00D2FF]" />
            <button
              id="btn-pause-toggle-music"
              onClick={handleToggleMusic}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide transition-all cursor-pointer ${
                musicOn
                  ? 'bg-[#53CE17] text-white shadow-[0_2px_0_#2B7F04]'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <span>{musicOn ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          {/* Sound Toggle */}
          <div className="flex-1 flex items-center justify-between bg-[#14182E] border-[2px] border-[#0A0E21] rounded-full px-3 py-2">
            <Volume2 className="w-4 h-4 text-[#00D2FF]" />
            <button
              id="btn-pause-toggle-sound"
              onClick={handleToggleSound}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide transition-all cursor-pointer ${
                soundOn
                  ? 'bg-[#53CE17] text-white shadow-[0_2px_0_#2B7F04]'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <span>{soundOn ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>

        {/* Haptics Toggle — vibration synced with screen shake & combat events */}
        <div className="w-full flex items-center justify-between bg-[#14182E] border-[2px] border-[#0A0E21] rounded-full px-3 py-2">
          <span className="text-[10px] font-black text-white uppercase tracking-wider flex items-center gap-1.5">
            <Vibrate className="w-4 h-4 text-[#00D2FF]" />
            Vibration FX
          </span>
          <button
            id="btn-pause-toggle-haptics"
            onClick={handleToggleHaptics}
            title="Syncs device vibration with screen shake, boss barrages and combat feedback"
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide transition-all cursor-pointer ${
              hapticsOn
                ? 'bg-[#53CE17] text-white shadow-[0_2px_0_#2B7F04]'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            <span>{hapticsOn ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* --- Independent volume mix: THEME MUSIC + FX sliders (separate
            control, per-channel — the player balances the score vs gunfire). --- */}
        <div className="w-full flex flex-col gap-2">
          {/* Music Volume Slider */}
          <div className="w-full flex items-center gap-2.5 bg-[#14182E] border-[2px] border-[#0A0E21] rounded-2xl p-2.5">
            <Music className="w-4 h-4 text-[#00D2FF] shrink-0" />
            <span className="text-[9px] font-black text-white uppercase tracking-wider w-11 shrink-0">
              Music
            </span>
            <div
              id="slider-music-volume"
              role="slider"
              aria-label="Theme music volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={musicVolume}
              tabIndex={0}
              className="flex-1 h-4 bg-[#0A0E21] rounded-full p-0.5 relative cursor-pointer overflow-hidden border border-[#2B3566]"
              onClick={(e) =>
                handleVolumeSeek(e, (pct) => {
                  setMusicVolume(pct);
                  sound.setMusicVolume(pct / 100);
                })
              }
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const delta = e.key === 'ArrowLeft' ? -5 : 5;
                setMusicVolume((v) => {
                  const next = Math.max(0, Math.min(100, v + delta));
                  sound.setMusicVolume(next / 100);
                  return next;
                });
              }}
            >
              <div
                className="h-full bg-gradient-to-r from-[#00D2FF] to-[#38bdf8] rounded-full"
                style={{ width: `${musicVolume}%` }}
              />
            </div>
            <span className="text-[10px] font-black text-[#00D2FF] tabular-nums w-7 text-right">
              {musicVolume}%
            </span>
          </div>

          {/* FX Volume Slider */}
          <div className="w-full flex items-center gap-2.5 bg-[#14182E] border-[2px] border-[#0A0E21] rounded-2xl p-2.5">
            <Volume2 className="w-4 h-4 text-[#FAC602] shrink-0" />
            <span className="text-[9px] font-black text-white uppercase tracking-wider w-11 shrink-0">
              FX
            </span>
            <div
              id="slider-sfx-volume"
              role="slider"
              aria-label="Sound effects volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={sfxVolume}
              tabIndex={0}
              className="flex-1 h-4 bg-[#0A0E21] rounded-full p-0.5 relative cursor-pointer overflow-hidden border border-[#2B3566]"
              onClick={(e) =>
                handleVolumeSeek(e, (pct) => {
                  setSfxVolume(pct);
                  sound.setSfxVolume(pct / 100);
                })
              }
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const delta = e.key === 'ArrowLeft' ? -5 : 5;
                setSfxVolume((v) => {
                  const next = Math.max(0, Math.min(100, v + delta));
                  sound.setSfxVolume(next / 100);
                  return next;
                });
              }}
            >
              <div
                className="h-full bg-gradient-to-r from-[#FAC602] to-[#fbbf24] rounded-full"
                style={{ width: `${sfxVolume}%` }}
              />
            </div>
            <span className="text-[10px] font-black text-[#FAC602] tabular-nums w-7 text-right">
              {sfxVolume}%
            </span>
          </div>
        </div>

        {/* CRT Scanlines Toggle (settings variant) — was a dead feature with no UI */}
        {variant === 'settings' && onToggleCrt && (
          <div className="w-full flex items-center justify-between bg-[#14182E] border-[2px] border-[#0A0E21] rounded-full px-3 py-2">
            <span className="text-[10px] font-black text-white uppercase tracking-wider flex items-center gap-1.5">
              <Tv className="w-4 h-4 text-[#00D2FF]" />
              CRT Scanlines
            </span>
            <button
              id="btn-settings-toggle-crt"
              onClick={() => {
                sound.playUiClick();
                onToggleCrt();
              }}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide transition-all cursor-pointer ${
                crtEnabled
                  ? 'bg-[#53CE17] text-white shadow-[0_2px_0_#2B7F04]'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <span>{crtEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        )}

        {/* --- TACTICAL ADVISOR (pause variant): suggest upgrades while paused. --- */}
        {variant === 'pause' && suggestions.length > 0 && (
          <div className="w-full flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <BrainCircuit className="w-3.5 h-3.5 text-[#00D2FF]" />
              <span className="text-[10px] font-black text-[#00D2FF] uppercase tracking-widest drop-shadow">
                Tactical Advisor
              </span>
              <span className="ml-auto text-[9px] font-bold text-slate-400">
                For Wave {nextWave}
              </span>
            </div>
            {suggestions.map((s) => {
              const affordable = cash >= s.cost;
              return (
                <button
                  key={s.key}
                  id={`btn-pause-advisor-${s.key}`}
                  disabled={!affordable}
                  onClick={() => applySuggestion(s.kind, s.weaponId)}
                  className={`w-full text-left p-2 rounded-2xl border flex items-center gap-2.5 transition active:scale-[0.98] cursor-pointer ${
                    affordable
                      ? 'bg-gradient-to-r from-[#0d1b3d] to-[#14182E] border-[#00D2FF]/45 shadow-[0_0_12px_rgba(0,210,255,0.15)]'
                      : 'bg-[#0d1226] border-slate-700/60 opacity-70 cursor-not-allowed'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#071d42] border border-[#00D2FF]/30 flex items-center justify-center shrink-0">
                    {s.kind === 'weapon' && <Zap className="w-[18px] h-[18px] text-[#FAC602]" />}
                    {s.kind === 'repair' && <Wrench className="w-[18px] h-[18px] text-emerald-300" />}
                    {s.kind === 'stim' && <Syringe className="w-[18px] h-[18px] text-rose-300" />}
                    {s.kind === 'refill' && <Gauge className="w-[18px] h-[18px] text-cyan-300" />}
                    {s.kind === 'emp' && <Zap className="w-[18px] h-[18px] text-[#c084fc]" />}
                    {s.kind === 'orbital' && <Shield className="w-[18px] h-[18px] text-[#ff7a9c]" />}
                    {s.kind === 'grenade' && <Bomb className="w-[18px] h-[18px] text-[#FAC602]" />}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[11px] font-black text-white truncate">{s.title}</span>
                    <span className="text-[9px] text-cyan-200/80 truncate">{s.detail}</span>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg border tabular-nums ${
                      affordable
                        ? 'text-[#FAC602] border-[#FAC602]/40 bg-[#0C1024]'
                        : 'text-slate-500 border-slate-700 bg-slate-900/60'
                    }`}
                  >
                    ${s.cost}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* --- COMBAT RESPONSE PROTOCOL (pause variant): the permanent
            adrenaline refill-speed upgrade — pausing is ALSO a shopping
            moment, same as the intermission. --- */}
        {variant === 'pause' && onBuyAdrenalineRefill && (
          <button
            id="btn-pause-buy-adrenaline-refill"
            disabled={
              adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS ||
              cash < getAdrenalineRefillCost(adrenalineGainSteps)
            }
            onClick={() => {
              sound.playUpgradeSuccess();
              onBuyAdrenalineRefill();
            }}
            className={`w-full text-left p-2 rounded-2xl border flex items-center gap-2.5 transition active:scale-[0.98] cursor-pointer ${
              adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS
                ? 'bg-[#0d1226] border-emerald-500/40 opacity-70 cursor-not-allowed'
                : cash >= getAdrenalineRefillCost(adrenalineGainSteps)
                ? 'bg-gradient-to-r from-[#0d1b3d] to-[#14182E] border-cyan-400/45 shadow-[0_0_12px_rgba(0,210,255,0.15)]'
                : 'bg-[#0d1226] border-slate-700/60 opacity-70 cursor-not-allowed'
            }`}
          >
            <div className="w-9 h-9 rounded-xl bg-[#071d42] border border-[#00D2FF]/30 flex items-center justify-center shrink-0">
              <Gauge className="w-[18px] h-[18px] text-cyan-300" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[11px] font-black text-white truncate">
                Adrenaline Refill Speed
                <span className="ml-1.5 text-[9px] font-bold text-cyan-300 tabular-nums">
                  Lv {Math.min(adrenalineGainSteps, MAX_ADRENALINE_REFILL_STEPS)}/{MAX_ADRENALINE_REFILL_STEPS} · ×
                  {getAdrenalineGainMultiplier(adrenalineGainSteps).toFixed(2).replace(/\.?0+$/, '')}
                </span>
              </span>
              <span className="text-[9px] text-cyan-200/80 truncate">
                {adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS
                  ? 'Maximum protocol — kills fill the meter at double speed'
                  : 'Permanent · rush meter fills 25% faster'}
              </span>
            </div>
            <span
              className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg border tabular-nums ${
                adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS
                  ? 'text-emerald-300 border-emerald-400/40 bg-[#0C1024]'
                  : cash >= getAdrenalineRefillCost(adrenalineGainSteps)
                  ? 'text-[#FAC602] border-[#FAC602]/40 bg-[#0C1024]'
                  : 'text-slate-500 border-slate-700 bg-slate-900/60'
              }`}
            >
              {adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS
                ? 'MAX'
                : `$${getAdrenalineRefillCost(adrenalineGainSteps)}`}
            </span>
          </button>
        )}

        {/* Mission Shortcuts: quick access to Shop / Vault / Quests while paused.
            Essential on phones & tablets where the HUD shortcut row is hidden. */}
        {variant === 'pause' && (onOpenShop || onOpenVault || onOpenQuests) && (
          <div className="w-full grid grid-cols-3 gap-2">
            {onOpenShop && (
              <button
                id="btn-pause-shop"
                onClick={() => {
                  sound.playUiClick();
                  onOpenShop();
                }}
                className="flex flex-col items-center justify-center gap-1 bg-[#14182E] border-[2px] border-[#0A0E21] hover:border-[#00D2FF]/60 rounded-2xl py-2.5 px-1 text-white select-none cursor-pointer transition active:scale-95"
              >
                <ShoppingBag className="w-4 h-4 text-[#00D2FF]" />
                <span className="text-[9px] font-black uppercase tracking-wider">Shop</span>
              </button>
            )}
            {onOpenVault && (
              <button
                id="btn-pause-vault"
                onClick={() => {
                  sound.playUiClick();
                  onOpenVault();
                }}
                className="flex flex-col items-center justify-center gap-1 bg-[#14182E] border-[2px] border-[#0A0E21] hover:border-[#00D2FF]/60 rounded-2xl py-2.5 px-1 text-white select-none cursor-pointer transition active:scale-95"
              >
                <Gift className="w-4 h-4 text-[#53CE17]" />
                <span className="text-[9px] font-black uppercase tracking-wider">Vault</span>
              </button>
            )}
            {onOpenQuests && (
              <button
                id="btn-pause-quests"
                onClick={() => {
                  sound.playUiClick();
                  onOpenQuests();
                }}
                className="flex flex-col items-center justify-center gap-1 bg-[#14182E] border-[2px] border-[#0A0E21] hover:border-[#00D2FF]/60 rounded-2xl py-2.5 px-1 text-white select-none cursor-pointer transition active:scale-95"
              >
                <Award className="w-4 h-4 text-[#FAC602]" />
                <span className="text-[9px] font-black uppercase tracking-wider">Quests</span>
              </button>
            )}
          </div>
        )}

        {/* Action Buttons: Resume & Restart */}
        <div className="w-full flex flex-col gap-2.5 mt-1">
          <button
            id={variant === 'settings' ? 'btn-settings-done' : 'btn-pause-resume'}
            onClick={() => {
              sound.playUiClick();
              onResume();
            }}
            className="btn-game-gold w-full py-3 px-6 rounded-full text-sm font-black tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{variant === 'settings' ? 'DONE' : 'RESUME MISSION'}</span>
          </button>

          {variant === 'pause' && onRestart && (
            <button
              id="btn-pause-restart"
              onClick={() => {
                sound.playUiClick();
                onRestart();
              }}
              className="btn-game-navy w-full py-2.5 px-4 rounded-full text-xs font-black tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 stroke-[2.5]" />
              <span>RESTART SECTOR</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
