'use client';

import React from 'react';
import { WeaponId, WeaponDef, ActiveBuff, EraInfo, Threat, GameMode } from '@/lib/types';
import { getSectorProgress } from '@/lib/eras';
import { sound } from '@/lib/audio';
import {
  Pause,
  ShoppingBag,
  Gift,
  Award,
  Zap,
  Radio,
  ShieldAlert,
  Flame,
  Syringe,
  Bomb,
} from 'lucide-react';
import { SPECIAL_CHARGE_COSTS, ADRENALINE_STIM_COST } from '@/lib/storage';
import { haptics } from '@/lib/haptics';

interface HUDProps {
  score: number;
  cash: number;
  gems: number;
  currentHp: number;
  maxHp: number;
  shieldHp: number;
  maxShieldHp: number;
  comboStreak: number;
  comboMultiplier: number;
  currentWave: number;
  currentEra: EraInfo;
  /** Which cabinet is live — reshapes the wave badge (STG n / ×1.5 tag). */
  gameMode?: GameMode;
  activeWeaponId: WeaponId;
  weapons: Record<WeaponId, WeaponDef>;
  activeBuffs: ActiveBuff[];
  autoFireEnabled: boolean;
  empCooldown: number;
  orbitalCooldown: number;
  grenadeCooldown: number;
  /** Consumable ammo left this run — 0 turns the button into a mid-run BUY slot. */
  empCharges: number;
  orbitalCharges: number;
  grenadeCharges: number;
  onBuySpecialCharge: (type: 'emp' | 'orbital' | 'grenade') => void;
  isPaused: boolean;
  isMuted: boolean;
  activeBoss?: Threat | null;
  adrenaline?: number;
  isOverdrive?: boolean;
  /** Combat Response Protocol multiplier (×1.0–×2.0) — shown as a badge
   *  on the rush meter so the purchased refill speed is visible in combat. */
  adrenalineMultiplier?: number;
  onTriggerOverdrive?: () => void;
  /** Buy an adrenaline stim (+50 rush) mid-combat. Optional — hidden when absent. */
  onBuyAdrenalineStim?: () => void;
  onToggleAutoFire: () => void;
  onSwitchWeapon: (id: WeaponId) => void;
  onTriggerSpecial: (type: 'emp' | 'orbital' | 'grenade') => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onOpenShop: () => void;
  onOpenChallenges: () => void;
  onOpenBattlePass: () => void;
  onOpenMysteryBox: () => void;
  onOpenLeaderboard: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  score,
  cash,
  gems,
  currentHp,
  maxHp,
  shieldHp,
  maxShieldHp,
  comboStreak,
  comboMultiplier,
  currentWave,
  currentEra,
  gameMode,
  activeWeaponId,
  weapons,
  activeBuffs,
  autoFireEnabled,
  empCooldown,
  orbitalCooldown,
  grenadeCooldown,
  empCharges,
  orbitalCharges,
  grenadeCharges,
  onBuySpecialCharge,
  isPaused,
  isMuted,
  activeBoss,
  adrenaline = 0,
  isOverdrive = false,
  adrenalineMultiplier = 1,
  onTriggerOverdrive,
  onBuyAdrenalineStim,
  onToggleAutoFire,
  onSwitchWeapon,
  onTriggerSpecial,
  onTogglePause,
  onToggleMute,
  onOpenShop,
  onOpenChallenges,
  onOpenBattlePass,
  onOpenMysteryBox,
  onOpenLeaderboard,
}) => {
  const hpPercent = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
  const adrPercent = Math.max(0, Math.min(100, adrenaline));
  const sector = getSectorProgress(currentWave);
  const mode = gameMode ?? 'campaign';
  const weaponList: WeaponId[] = ['cannon', 'machinegun', 'laser', 'missiles'];

  const triggerHaptic = (ms: number = 10) => {
    haptics.buzz(ms);
  };

  return (
    <div
      id="game-hud-overlay"
      className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2 sm:p-2.5 select-none font-sans"
    >
      {/* ========================================================================= */}
      {/* TOP STATUS BAR (compact — maximizes visible play field)                    */}
      {/* On widescreen desktop the rows cap + center so the status cluster stays  */}
      {/* readable instead of smearing across the entire monitor width.            */}
      {/* ========================================================================= */}
      <div className="flex flex-col gap-1 pointer-events-auto w-full lg:max-w-[760px] lg:mx-auto xl:max-w-[860px]">
        {/* Row 1: Wave + Hull + Currency + Pause (essentials only) */}
        <div className="flex items-center justify-between gap-1.5">
          {/* Wave & Sector Pill Badge — mode-aware: Boss Rush counts STAGES,
              Endless wears its ×1.5 tag, Campaign shows the sector wave. */}
          <div
            id="hud-wave-badge"
            className={`border-2 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-lg shrink-0 ${
              mode === 'bossRush'
                ? 'bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 border-rose-300'
                : mode === 'endless'
                  ? 'bg-gradient-to-r from-violet-600 via-purple-600 to-violet-800 border-violet-300'
                  : 'bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-700 border-cyan-300'
            }`}
          >
            <span className="text-[11px] font-black text-white uppercase tracking-wider drop-shadow">
              {mode === 'bossRush' ? `STG ${currentWave}` : `W${currentWave}`}
            </span>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-white/60 ${
                mode === 'bossRush'
                  ? 'text-rose-950 bg-rose-200'
                  : mode === 'endless'
                    ? 'text-violet-950 bg-violet-200'
                    : 'text-cyan-950 bg-cyan-200'
              }`}
            >
              {mode === 'bossRush' ? 'RUSH ×2' : mode === 'endless' ? '×1.5 PTS' : `${sector.waveInEra}/5`}
            </span>
          </div>

          {/* Earth Planetary Defense Hull Bar */}
          <div className="flex-1 min-w-0 max-w-[130px] bg-[#071938]/90 border-2 border-cyan-400/50 rounded-full px-2 py-0.5 flex items-center gap-1.5 shadow-md">
            <span className="text-[11px] shrink-0">🌍</span>
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-center justify-between text-[8px] font-black text-white leading-none mb-0.5">
                <span className="text-cyan-200">HULL</span>
                {/* Raw hull % — with reinforcement steps this honestly reads
                    125% / 150% / 175% (the purchased ceiling), exactly as the
                    shop advertises. Color keys off the RATIO, not raw value. */}
                <span className={hpPercent <= 30 ? 'text-rose-400 animate-pulse' : 'text-emerald-300'}>
                  {Math.round(currentHp)}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#030d1e] rounded-full overflow-hidden p-0.5 border border-cyan-500/30">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    hpPercent <= 30 ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-400 to-teal-400'
                  }`}
                  style={{ width: `${hpPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Currency Badges & Pause Squircle */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Gems Pill */}
            <div className="bg-[#071938]/90 rounded-full px-2 py-0.5 flex items-center gap-1 shadow-sm border border-cyan-400/40">
              <span className="text-[11px]">💎</span>
              <span className="text-[11px] font-black text-cyan-300 tabular-nums">
                {gems}
              </span>
            </div>

            {/* Gold Cash Pill */}
            <div className="bg-[#071938]/90 rounded-full px-1.5 py-0.5 flex items-center gap-1 shadow-sm border border-amber-400/40">
              <span className="text-[11px]">🪙</span>
              <span className="text-[10px] font-black text-amber-300 tabular-nums">
                ${cash >= 1000 ? `${(cash / 1000).toFixed(1)}k` : cash}
              </span>
            </div>

            {/* Pause Squircle Button */}
            <button
              id="btn-hud-pause"
              onClick={() => {
                sound.playUiClick();
                triggerHaptic(12);
                onTogglePause();
              }}
              title="Pause Game"
              className="w-7 h-7 btn-game-squircle flex items-center justify-center text-white active:scale-90 select-none shadow-md cursor-pointer"
            >
              <Pause className="w-3 h-3 fill-white text-white drop-shadow" />
            </button>
          </div>
        </div>

        {/* Row 2: Compact Adrenaline meter + Score — slim single line */}
        <div className="flex items-center justify-between gap-2">
          {/* Adrenaline Rush / Overdrive Surge Meter (compact pill, not full width).
              Wrapped in a non-overflowing relative div so the Combat Response
              Protocol badge can perch above the pill without being clipped. */}
          <div className="relative w-[38%] max-w-[170px] shrink-0">
            <div
              id="hud-adrenaline-bar"
              onClick={() => {
                if (adrPercent >= 100 && onTriggerOverdrive) {
                  sound.playOverdrive();
                  onTriggerOverdrive();
                }
              }}
              className={`relative w-full h-3 rounded-full overflow-hidden border p-[2px] transition-all shadow-sm select-none cursor-pointer ${
                isOverdrive
                  ? 'bg-[#041630] border-cyan-300 shadow-[0_0_14px_rgba(56,189,248,0.8)] animate-pulse'
                  : adrPercent >= 100
                  ? 'bg-[#181102] border-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.7)]'
                  : 'bg-[#071938]/90 border-cyan-400/40'
              }`}
            >
              <div
                className={`h-full rounded-full transition-all duration-150 ${
                  isOverdrive
                    ? 'bg-gradient-to-r from-cyan-400 via-sky-300 to-white shadow-[0_0_10px_#38bdf8]'
                    : adrPercent >= 100
                    ? 'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 animate-pulse'
                    : 'bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400'
                }`}
                style={{ width: `${isOverdrive ? 100 : adrPercent}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[7px] font-black uppercase tracking-wider text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] flex items-center gap-0.5 whitespace-nowrap">
                  <Zap className={`w-2 h-2 ${isOverdrive ? 'text-cyan-200 fill-cyan-200 animate-bounce' : 'text-yellow-300'}`} />
                  {isOverdrive
                    ? 'OVERDRIVE ACTIVE'
                    : adrPercent >= 100
                    ? 'TAP TO ENGAGE'
                    : `${Math.round(adrPercent)}%`}
                </span>
              </div>
            </div>
            {/* Combat Response Protocol badge — purchased refill speed shows
                right on the meter (×1.25 … ×2.0) */}
            {adrenalineMultiplier > 1 && (
              <span
                title={`Combat Response Protocol: adrenaline refills ${(adrenalineMultiplier * 100 - 100).toFixed(0)}% faster`}
                className="absolute -right-1 -top-2 text-[7px] font-black text-cyan-950 bg-cyan-300 border border-cyan-100 rounded-full px-1 leading-tight shadow-sm tabular-nums"
              >
                ×{adrenalineMultiplier.toFixed(2).replace(/\.?0+$/, '')}
              </span>
            )}
          </div>

          {/* Adrenaline stim quick-buy: fills the rush meter mid-combat
              (purchasable fast-reload boost). Hidden once full/active. */}
          {onBuyAdrenalineStim && !isOverdrive && adrPercent < 100 && (
            <button
              id="btn-hud-buy-stim"
              onClick={() => {
                sound.playUiClick();
                onBuyAdrenalineStim();
              }}
              disabled={cash < ADRENALINE_STIM_COST}
              title={`Adrenaline Stim +50 ($${ADRENALINE_STIM_COST})`}
              className={`shrink-0 flex items-center gap-0.5 px-1.5 h-3 rounded-full border text-[7px] font-black whitespace-nowrap transition cursor-pointer active:scale-95 ${
                cash >= ADRENALINE_STIM_COST
                  ? 'bg-[#071938]/90 border-rose-400/60 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.35)]'
                  : 'bg-[#071938]/60 border-slate-600/60 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Syringe className="w-2 h-2" />
              ${ADRENALINE_STIM_COST}
            </button>
          )}

          {/* Combo Streak / Score badge */}
          {comboStreak >= 3 ? (
            <div className="flex items-center gap-1 bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 font-black px-2 py-0.5 rounded-full shadow-md border border-yellow-200 animate-bounce whitespace-nowrap">
              <Flame className="w-2.5 h-2.5 text-amber-950 fill-amber-950" />
              <span className="text-[9px]">{comboStreak}x COMBO ({comboMultiplier}x)</span>
            </div>
          ) : (
            <div className="bg-[#071938]/90 border border-cyan-400/40 px-2 py-0.5 rounded-full text-cyan-200 font-bold whitespace-nowrap">
              <span className="text-[9px]">
                Score: <strong className="text-white">{score.toLocaleString()}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Boss Mode strip — ADRENALINE-BAR PROPORTIONS (product feedback: even
            the slim full-width strip read as too long). Now the exact pill
            footprint of the rush meter: 38% width, 170px cap, h-3. One line:
            emblem, name, P3 tag (final phase only), live HP bar + shield
            overlay, % read-out. Purely informational — pointer-events off so
            taps pass straight through. */}
        {activeBoss && (
          <div
            id="hud-boss-bar-card"
            className="w-[38%] max-w-[170px] h-3 flex items-center gap-1 bg-[#051126]/95 border border-rose-500/80 rounded-full pl-1 pr-1.5 shadow-[0_0_14px_rgba(244,63,94,0.45)] backdrop-blur-md pointer-events-none select-none animate-in fade-in"
          >
            <span className="text-[8px] leading-none shrink-0 animate-pulse" title="Hostile flagship">
              {activeBoss.alienPilot ? '👽' : '💀'}
            </span>

            <span className="text-[7px] font-black text-rose-300 uppercase tracking-wide truncate max-w-[50px] shrink-0 leading-none">
              {activeBoss.alienPilot?.name || activeBoss.name}
            </span>

            {(activeBoss.bossPhase ?? 1) >= 3 && (
              <span className="text-[6px] font-black px-0.5 py-px rounded-full bg-rose-600 text-white uppercase animate-pulse border border-rose-300 shrink-0 leading-none">
                P3
              </span>
            )}

            {/* Segmented HP & Shield micro-bar */}
            <div className="flex-1 min-w-0 h-1 bg-[#030d1c] rounded-full overflow-hidden border border-rose-500/40 relative">
              <div
                className={`h-full rounded-full transition-all duration-150 ${
                  (activeBoss.bossPhase ?? 1) >= 3
                    ? 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-400 animate-pulse'
                    : 'bg-gradient-to-r from-rose-600 via-pink-500 to-rose-400'
                }`}
                style={{
                  width: `${Math.max(0, Math.min(100, (activeBoss.hp / activeBoss.maxHp) * 100))}%`,
                }}
              />
              {activeBoss.shieldHp > 0 && (
                <div
                  className="absolute top-0 left-0 bottom-0 bg-cyan-400/50 border-r border-cyan-300 pointer-events-none"
                  style={{
                    width: `${Math.min(100, (activeBoss.shieldHp / (activeBoss.maxShieldHp || 1)) * 100)}%`,
                  }}
                />
              )}
            </div>

            <span className="text-[7px] font-black text-rose-200 tabular-nums shrink-0 leading-none">
              {Math.max(0, Math.round((activeBoss.hp / activeBoss.maxHp) * 100))}%
            </span>
          </div>
        )}

        {/* Row 3: Modal shortcuts — DESKTOP ONLY. On phones/tablets these live in the Pause menu. */}
        <div className="hidden lg:flex items-center justify-end text-[10px]">
          <div className="flex items-center gap-1">
            <button
              id="btn-hud-armory"
              onClick={() => {
                sound.playUiClick();
                onOpenShop();
              }}
              className="bg-[#071938]/90 hover:bg-[#0c2754] border border-cyan-400/40 text-cyan-200 font-black px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 active:scale-95 cursor-pointer"
            >
              <ShoppingBag className="w-3 h-3 text-rose-300" />
              <span>Shop</span>
            </button>

            <button
              id="btn-hud-vault"
              onClick={() => {
                sound.playUiClick();
                onOpenMysteryBox();
              }}
              className="bg-[#071938]/90 hover:bg-[#0c2754] border border-cyan-400/40 text-cyan-200 font-black px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 active:scale-95 cursor-pointer"
            >
              <Gift className="w-3 h-3 text-cyan-300" />
              <span>Vault</span>
            </button>

            <button
              id="btn-hud-orders"
              onClick={() => {
                sound.playUiClick();
                onOpenChallenges();
              }}
              className="bg-[#071938]/90 hover:bg-[#0c2754] border border-cyan-400/40 text-cyan-200 font-black px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 active:scale-95 cursor-pointer"
            >
              <Award className="w-3 h-3 text-amber-300" />
              <span>Quests</span>
            </button>
          </div>
        </div>
      </div>

      {/* Clear Midfield (Space & Earth Defense Field) */}
      <div className="flex-1 pointer-events-none" />

      {/* ========================================================================= */}
      {/* BOTTOM WEAPON & SPECIALS DOCK (Tactile Mobile Gaming Controls)             */}
      {/* ========================================================================= */}
      <div className="pointer-events-auto w-full max-w-[460px] mx-auto">
        <div className="bg-[#14182E]/95 border-[2.5px] border-[#2B3566] rounded-3xl p-2 shadow-[0_10px_25px_rgba(0,0,0,0.7)] flex items-center justify-between gap-1.5 backdrop-blur-md">
          {/* Primary 4 Weapons */}
          <div className="grid grid-cols-4 gap-1.5 flex-1">
            {weaponList.map((id) => {
              const w = weapons[id];
              const isSelected = activeWeaponId === id;
              const isUnlocked = w && w.unlocked;

              const getWeaponIcon = (wid: WeaponId) => {
                switch (wid) {
                  case 'cannon':
                    return '💥';
                  case 'machinegun':
                    return '🔫';
                  case 'laser':
                    return '⚡';
                  case 'missiles':
                    return '🚀';
                  default:
                    return '🎯';
                }
              };

              const getWeaponName = (wid: WeaponId) => {
                switch (wid) {
                  case 'machinegun':
                    return 'Gatling';
                  case 'cannon':
                    return 'Cannon';
                  case 'laser':
                    return 'Laser';
                  case 'missiles':
                    return 'Missile';
                  default:
                    return wid;
                }
              };

              return (
                <button
                  key={id}
                  id={`btn-weapon-${id}`}
                  disabled={!isUnlocked}
                  onClick={() => {
                    sound.playWeaponSwitch();
                    triggerHaptic(15);
                    onSwitchWeapon(id);
                  }}
                  className={`relative flex flex-col items-center justify-center py-1 px-1 rounded-2xl transition-all select-none min-h-[48px] cursor-pointer ${
                    isSelected
                      ? 'bg-gradient-to-b from-[#00D2FF] to-[#0A58CA] border-[2.5px] border-[#FAC602] shadow-[0_0_12px_rgba(0,210,255,0.7),0_3px_0_#06367D] scale-105'
                      : isUnlocked
                      ? 'bg-[#1C2344] border border-[#2B3566] text-slate-200 hover:bg-[#232C55]'
                      : 'bg-slate-900/60 border border-slate-800 text-slate-600 cursor-not-allowed opacity-40'
                  }`}
                >
                  <span className="text-base leading-none mb-0.5">{getWeaponIcon(id)}</span>
                  <span className="text-[9px] font-black tracking-tight text-white leading-tight">
                    {getWeaponName(id)}
                  </span>
                  {isUnlocked && (
                    <span className="text-[8px] font-black text-[#FAC602] bg-[#0A0E21] px-1 rounded mt-0.5 border border-[#FAC602]/30">
                      Mk{w.tier}
                    </span>
                  )}
                  {isSelected && (
                    <div className="absolute -top-1 right-1 w-2 h-2 rounded-full bg-[#FAC602] shadow-[0_0_6px_#FAC602] animate-ping" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="w-[1.5px] h-9 bg-[#2B3566] self-center mx-0.5" />

          {/* Specials Bank: Auto-Fire Toggle + EMP + Orbital */}
          <div className="flex items-center gap-1">
            {/* Auto-Fire Toggle */}
            <button
              id="btn-auto-fire-toggle"
              onClick={() => {
                sound.playUiClick();
                triggerHaptic(12);
                onToggleAutoFire();
              }}
              title="Auto-Fire Radar"
              className={`flex flex-col items-center justify-center w-11 h-12 rounded-2xl border text-[8px] font-black transition-all cursor-pointer ${
                autoFireEnabled
                  ? 'bg-[#53CE17] border-[#226804] text-white shadow-[0_2px_0_#2B7F04]'
                  : 'bg-[#1C2344] border-[#2B3566] text-slate-300'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${autoFireEnabled ? 'animate-pulse text-white' : ''}`} />
              <span className="leading-tight mt-0.5 font-black">{autoFireEnabled ? 'AUTO' : 'MAN'}</span>
            </button>

            {/* EMP Shockwave — consumable charge; depleted slot becomes a mid-run BUY button.
                LOCKED stays TAPPABLE: the engine answers with a floating
                'EMP LOCKED — UNLOCK AT SHOP' hint instead of a dead button
                (a disabled control with no feedback reads as 'EMP is broken'). */}
            <button
              id="btn-special-emp"
              disabled={empCooldown > 0 && empCharges > 0}
              onClick={() => {
                triggerHaptic(25);
                if (empCharges > 0 || !weapons.emp.unlocked) onTriggerSpecial('emp');
                else onBuySpecialCharge('emp');
              }}
              title={
                !weapons.emp.unlocked
                  ? `EMP Shockwave — LOCKED: unlock at the shop for $${weapons.emp.unlockCostCash ?? 2400} (strips all shields + stuns everything)`
                  : empCharges > 0
                  ? `EMP Shockwave — ${empCharges} charge${empCharges === 1 ? '' : 's'} left. Strips ALL enemy shields + stuns the whole field`
                  : `Buy 1 EMP charge — $${SPECIAL_CHARGE_COSTS.emp}`
              }
              className={`relative flex flex-col items-center justify-center w-11 h-12 rounded-2xl border font-black transition-all cursor-pointer ${
                !weapons.emp.unlocked
                  ? 'bg-slate-900/70 border-slate-800 text-slate-500 opacity-60'
                  : empCharges > 0
                  ? weapons.emp.unlocked && empCooldown <= 0
                    ? 'bg-gradient-to-b from-[#00D2FF] to-[#0A58CA] border-[#00D2FF] text-white shadow-[0_2px_0_#06367D] active:translate-y-0.5'
                    : 'bg-slate-900/70 border-slate-800 text-slate-500 opacity-50 cursor-not-allowed'
                  : // Depleted → premium gold BUY slot (still tappable for a "need cash" hint)
                  cash >= SPECIAL_CHARGE_COSTS.emp
                  ? 'bg-gradient-to-b from-[#FAC602] to-[#B8860B] border-[#FAC602] text-[#0A0E21] shadow-[0_2px_0_#8B6914] active:translate-y-0.5 animate-pulse'
                  : 'bg-[#3a2a08] border-[#FAC602]/40 text-[#f87171] opacity-80'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-[#FAC602]" />
              <span className="text-[8px] mt-0.5">{empCharges > 0 ? 'EMP' : `$${SPECIAL_CHARGE_COSTS.emp}`}</span>
              {!weapons.emp.unlocked && (
                <span className="absolute -top-1 -right-1 text-[8px] leading-none bg-slate-800 border border-slate-600 rounded px-0.5 py-0.5">
                  🔒
                </span>
              )}
              {weapons.emp.unlocked && empCharges > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-black text-[#00D2FF] bg-[#0A0E21] px-1 rounded border border-[#00D2FF]/40 leading-tight">
                  ×{empCharges}
                </span>
              )}
              {empCooldown > 0 && empCharges > 0 && (
                <div className="absolute inset-0 bg-[#0A0E21]/95 rounded-2xl flex items-center justify-center text-[10px] font-black text-[#00D2FF]">
                  {Math.ceil(empCooldown)}s
                </div>
              )}
            </button>

              {/* Orbital Beam — consumable charge; depleted slot becomes a mid-run BUY button.
                  LOCKED stays tappable for the same explain-yourself feedback. */}
            <button
              id="btn-special-orbital"
              disabled={orbitalCooldown > 0 && orbitalCharges > 0}
              onClick={() => {
                triggerHaptic(30);
                if (orbitalCharges > 0 || !weapons.orbital.unlocked) onTriggerSpecial('orbital');
                else onBuySpecialCharge('orbital');
              }}
              title={
                !weapons.orbital.unlocked
                  ? `Orbital Laser Strike — LOCKED: ${weapons.orbital.unlockCostGems ?? 75} gems at the shop (screen-wiping beam)`
                  : orbitalCharges > 0
                  ? `Orbital Laser Strike — ${orbitalCharges} charge${orbitalCharges === 1 ? '' : 's'} left. Giant beam wipes the battlefield`
                  : `Buy 1 Orbital charge — $${SPECIAL_CHARGE_COSTS.orbital}`
              }
              className={`relative flex flex-col items-center justify-center w-11 h-12 rounded-2xl border font-black transition-all cursor-pointer ${
                !weapons.orbital.unlocked
                  ? 'bg-slate-900/70 border-slate-800 text-slate-500 opacity-60'
                  : orbitalCharges > 0
                  ? weapons.orbital.unlocked && orbitalCooldown <= 0
                    ? 'bg-gradient-to-b from-[#E62E5C] to-[#990A2E] border-[#E62E5C] text-white shadow-[0_2px_0_#660018] active:translate-y-0.5 animate-pulse'
                    : 'bg-slate-900/70 border-slate-800 text-slate-500 opacity-50 cursor-not-allowed'
                  : // Depleted → premium gold BUY slot (still tappable for a "need cash" hint)
                  cash >= SPECIAL_CHARGE_COSTS.orbital
                  ? 'bg-gradient-to-b from-[#FAC602] to-[#B8860B] border-[#FAC602] text-[#0A0E21] shadow-[0_2px_0_#8B6914] active:translate-y-0.5 animate-pulse'
                  : 'bg-[#3a2a08] border-[#FAC602]/40 text-[#f87171] opacity-80'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-white" />
              <span className="text-[8px] mt-0.5">{orbitalCharges > 0 ? 'ORBIT' : `$${SPECIAL_CHARGE_COSTS.orbital}`}</span>
              {!weapons.orbital.unlocked && (
                <span className="absolute -top-1 -right-1 text-[8px] leading-none bg-slate-800 border border-slate-600 rounded px-0.5 py-0.5">
                  🔒
                </span>
              )}
              {weapons.orbital.unlocked && orbitalCharges > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-black text-[#ff7a9c] bg-[#0A0E21] px-1 rounded border border-[#E62E5C]/40 leading-tight">
                  ×{orbitalCharges}
                </span>
              )}
              {orbitalCooldown > 0 && orbitalCharges > 0 && (
                <div className="absolute inset-0 bg-[#0A0E21]/95 rounded-2xl flex items-center justify-center text-[10px] font-black text-[#E62E5C]">
                  {Math.ceil(orbitalCooldown)}s
                </div>
              )}
            </button>

            {/* Frag Grenade — universal consumable (no unlock). Lobbed AoE at
                the aim point; depleted slot becomes a mid-run BUY button. */}
            <button
              id="btn-special-grenade"
              disabled={grenadeCooldown > 0 && grenadeCharges > 0}
              onClick={() => {
                triggerHaptic(22);
                if (grenadeCharges > 0) onTriggerSpecial('grenade');
                else onBuySpecialCharge('grenade');
              }}
              title={
                grenadeCharges > 0
                  ? `Frag Grenade — ${grenadeCharges} left. Lobs a grenade to your aim point; explodes for big AoE damage in a wide blast radius (also vaporizes starfall shards)`
                  : `Buy 1 Frag Grenade — $${SPECIAL_CHARGE_COSTS.grenade}. Lobs to your aim point, big AoE blast`
              }
              className={`relative flex flex-col items-center justify-center w-11 h-12 rounded-2xl border font-black transition-all cursor-pointer ${
                grenadeCharges > 0
                  ? grenadeCooldown <= 0
                    ? 'bg-gradient-to-b from-[#FAC602] to-[#B8860B] border-[#FAC602] text-white shadow-[0_2px_0_#8B6914] active:translate-y-0.5'
                    : 'bg-slate-900/70 border-slate-800 text-slate-500 opacity-50 cursor-not-allowed'
                  : cash >= SPECIAL_CHARGE_COSTS.grenade
                  ? 'bg-gradient-to-b from-[#FAC602] to-[#B8860B] border-[#FAC602] text-[#0A0E21] shadow-[0_2px_0_#8B6914] active:translate-y-0.5 animate-pulse'
                  : 'bg-[#3a2a08] border-[#FAC602]/40 text-[#f87171] opacity-80'
              }`}
            >
              <Bomb className="w-3.5 h-3.5 text-white" />
              <span className="text-[8px] mt-0.5">{grenadeCharges > 0 ? 'FRAG' : `$${SPECIAL_CHARGE_COSTS.grenade}`}</span>
              {grenadeCharges > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-black text-[#FAC602] bg-[#0A0E21] px-1 rounded border border-[#FAC602]/40 leading-tight">
                  ×{grenadeCharges}
                </span>
              )}
              {grenadeCooldown > 0 && grenadeCharges > 0 && (
                <div className="absolute inset-0 bg-[#0A0E21]/95 rounded-2xl flex items-center justify-center text-[10px] font-black text-[#FAC602]">
                  {Math.ceil(grenadeCooldown)}s
                </div>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
