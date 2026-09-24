'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { WeaponId, WeaponDef, EraInfo } from '@/lib/types';
import { sound } from '@/lib/audio';
import {
  SPECIAL_CHARGE_COSTS,
  ADRENALINE_STIM_COST,
  MAX_ADRENALINE_REFILL_STEPS,
  getAdrenalineRefillCost,
  getAdrenalineGainMultiplier,
  getWeaponUpgradeCost,
  getUpgradeSuggestions,
} from '@/lib/storage';
import { X, Sparkles, Wrench, Zap, Shield, BrainCircuit, Syringe, Bomb, Music4, Gauge } from 'lucide-react';

interface WaveIntermissionProps {
  currentWave: number;
  nextWave: number;
  nextEra: EraInfo;
  cash: number;
  currentHp: number;
  maxHp: number;
  activeWeaponId: WeaponId;
  weapons: Record<WeaponId, WeaponDef>;
  /** Consumable special ammo — for the armory restock row. */
  empCharges: number;
  orbitalCharges: number;
  grenadeCharges: number;
  onBuySpecialCharge: (type: 'emp' | 'orbital' | 'grenade') => void;
  onRepairBase: () => void;
  onUpgradeWeapon: (id: WeaponId) => void;
  /** Adrenaline stim (+50 rush, auto-Overdrive at 100). */
  onBuyAdrenalineStim: () => void;
  /** Combat Response Protocol: permanent +25% adrenaline refill speed per
   *  level (max 4). Applied live + persisted by the page handler. */
  adrenalineGainSteps: number;
  onBuyAdrenalineRefill: () => void;
  onStartNextWave: () => void;
}

export const WaveIntermission: React.FC<WaveIntermissionProps> = ({
  currentWave,
  nextWave,
  nextEra,
  cash,
  currentHp,
  maxHp,
  activeWeaponId,
  weapons,
  empCharges,
  orbitalCharges,
  grenadeCharges,
  onBuySpecialCharge,
  onRepairBase,
  onUpgradeWeapon,
  onBuyAdrenalineStim,
  adrenalineGainSteps,
  onBuyAdrenalineRefill,
  onStartNextWave,
}) => {
  const [countdown, setCountdown] = useState(8);
  const repairCost = 75;
  const canRepair = cash >= repairCost && currentHp < maxHp;
  const refillMaxed = adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS;
  const refillCost = getAdrenalineRefillCost(adrenalineGainSteps);
  const refillMult = getAdrenalineGainMultiplier(adrenalineGainSteps);
  const nextRefillMult = getAdrenalineGainMultiplier(adrenalineGainSteps + 1);

  // Keep the latest callback in a ref so the 1s interval is NOT torn down and
  // recreated on every parent re-render (that froze the countdown at 8s)
  const startNextWaveRef = useRef(onStartNextWave);
  useEffect(() => {
    startNextWaveRef.current = onStartNextWave;
  });

  const activeWeapon = weapons[activeWeaponId];
  // UNLIMITED tiers: there is always a next mark level and a next price
  const upgradeCost = activeWeapon ? getWeaponUpgradeCost(activeWeapon) : null;
  const canUpgrade = activeWeapon && upgradeCost !== null && cash >= upgradeCost;

  // Proactive advisor: ranked, affordable-aware suggestions the player can
  // one-tap buy. Users were never offered upgrades before — this surfaces them.
  const suggestions = useMemo(
    () =>
      getUpgradeSuggestions({
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
      }),
    [weapons, activeWeaponId, cash, currentHp, maxHp, nextWave, empCharges, orbitalCharges, grenadeCharges, adrenalineGainSteps]
  );

  const applySuggestion = (kind: string, weaponId?: WeaponId) => {
    sound.playUiClick();
    if (kind === 'weapon' && weaponId) onUpgradeWeapon(weaponId);
    else if (kind === 'repair') onRepairBase();
    else if (kind === 'stim') onBuyAdrenalineStim();
    else if (kind === 'refill') onBuyAdrenalineRefill();
    else if (kind === 'emp') onBuySpecialCharge('emp');
    else if (kind === 'orbital') onBuySpecialCharge('orbital');
    else if (kind === 'grenade') onBuySpecialCharge('grenade');
  };

  // Auto deploy timer if user is AFK
  useEffect(() => {
    if (countdown <= 0) {
      startNextWaveRef.current();
      return;
    }
    const timer = window.setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  return (
    <div
      id="wave-intermission-modal"
      className="absolute inset-0 z-40 flex items-center justify-center p-4 game-modal-backdrop select-none"
    >
      {/* Wrapper owns BOTH the floating badge and the close button so they sit
          OUTSIDE the card's overflow-y-auto scrollport. Previously the badge
          (-top-5) was clipped in half by the scroll container and scrolled away
          with the content — now it stays fully visible and pinned at all times. */}
      <div className="relative w-full max-w-[340px] md:max-w-[28rem] lg:max-w-[32rem] max-h-[92%] flex flex-col">
        {/* Floating Green Level/Wave Badge perched on top edge */}
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-[#53CE17] border-[2.5px] border-[#226804] px-6 py-1.5 rounded-full text-white font-black text-lg tracking-wider uppercase z-20 shadow-[0_4px_0_#2B7F04,0_6px_12px_rgba(0,0,0,0.6)] text-stroke-arcade whitespace-nowrap">
          Wave {currentWave} Clear
        </div>

        {/* Top-Right Circular Close Button (pinned — never scrolls away) */}
        <button
          id="btn-close-intermission"
          onClick={() => {
            sound.playUiClick();
            onStartNextWave();
          }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition cursor-pointer z-30"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>

        <div className="w-full min-h-0 overflow-y-auto game-dialog-card rounded-[36px] pt-8 pb-6 px-5 flex flex-col items-center gap-3.5 shadow-2xl">
          {/* Section 1: Achievements / Bounty */}
        <div className="w-full flex flex-col items-center mt-1">
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1.5 drop-shadow">
            Wave Completion Bounty
          </span>
          {/* Glowing Gem Card */}
          <div className="w-full bg-[#14182E] border-[2px] border-[#0A0E21] rounded-2xl p-3 flex flex-col items-center shadow-inner relative overflow-hidden">
            <div className="relative my-1 flex items-center justify-center">
              <div className="text-4xl filter drop-shadow">💎</div>
              <Sparkles className="w-4 h-4 text-[#00D2FF] absolute -top-1 -right-2 animate-spin" />
            </div>

            {/* Quantity Pill — mirrors the engine's actual wave bonus (120 + wave*32) */}
            <div className="bg-[#0C1024] border border-[#00D2FF]/40 px-5 py-0.5 rounded-full shadow-md text-[#00D2FF] font-black text-base tabular-nums tracking-wide mt-1">
              +{120 + currentWave * 32}
            </div>
            <span className="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-wider">
              Credits Awarded
            </span>
          </div>
        </div>

        {/* Section 1.25: NOW PLAYING — every era scores its own adrenaline track
            (name + tempo pulled live from the sound engine). */}
        <div className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0C1024]/80 border border-[#00D2FF]/25">
          <Music4 className="w-3.5 h-3.5 text-[#00D2FF] shrink-0 animate-pulse" />
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">
            Now Playing
          </span>
          <span className="text-[10px] font-black text-white truncate">
            {sound.getCurrentTrackName()}
          </span>
          <span className="ml-auto text-[9px] font-black text-[#00D2FF] tabular-nums shrink-0">
            {sound.getCurrentTrackBpm()} BPM
          </span>
        </div>

        {/* Section 1.5: TACTICAL ADVISOR — proactive ranked upgrade offers.
            Players never saw upgrade prompts before; this puts the two best
            purchases for the upcoming wave right at their thumb. */}
        {suggestions.length > 0 && (
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
                  id={`btn-advisor-${s.key}`}
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
                    <span className="text-[8px] text-slate-400 truncate italic">{s.reason}</span>
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

        {/* Section 2: Arsenal status */}
        <div className="w-full flex flex-col items-center">
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-2 drop-shadow">
            Defense Battery Status
          </span>

          <div className="w-full flex items-center justify-around gap-2">
            {/* Medallion 1: Cannon */}
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-[#14182E] border-[2px] border-[#0A0E21] flex items-center justify-center text-2xl relative shadow-md">
                <span>💥</span>
                <span className="absolute -bottom-1 -right-1 bg-[#0C1024] border border-[#FAC602] text-[#FAC602] text-[9px] font-black px-1.5 rounded-full shadow">
                  Mk{weapons.cannon?.tier || 1}
                </span>
              </div>
              <span className="text-[10px] font-black text-white mt-1">Cannon</span>
            </div>

            {/* Medallion 2: Laser */}
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-[#14182E] border-[2px] border-[#0A0E21] flex items-center justify-center text-2xl relative shadow-md">
                <span>⚡</span>
                <span className="absolute -bottom-1 -right-1 bg-[#0C1024] border border-[#FAC602] text-[#FAC602] text-[9px] font-black px-1.5 rounded-full shadow">
                  Mk{weapons.laser?.tier || 1}
                </span>
              </div>
              <span className="text-[10px] font-black text-white mt-1">Laser</span>
            </div>

            {/* Medallion 3: Missiles */}
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-[#14182E] border-[2px] border-[#0A0E21] flex items-center justify-center text-2xl relative shadow-md">
                <span>🚀</span>
                <span className="absolute -bottom-1 -right-1 bg-[#0C1024] border border-[#FAC602] text-[#FAC602] text-[9px] font-black px-1.5 rounded-full shadow">
                  Mk{weapons.missiles?.tier || 1}
                </span>
              </div>
              <span className="text-[10px] font-black text-white mt-1">Missiles</span>
            </div>
          </div>
        </div>

        {/* Quick Field Repair & Upgrade Sinks (unlimited tiers: never MAX) */}
        <div className="w-full flex items-center justify-between gap-2 bg-[#14182E] p-2 rounded-2xl border-[2px] border-[#0A0E21]">
          <button
            id="btn-quick-repair-intermission"
            disabled={!canRepair}
            onClick={() => {
              sound.playUiClick();
              onRepairBase();
            }}
            className={`flex-1 py-1.5 px-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer ${
              canRepair
                ? 'btn-game-green'
                : 'bg-slate-800 text-slate-500 opacity-60 cursor-not-allowed'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Repair (${repairCost})</span>
          </button>

          {activeWeapon && upgradeCost !== null && (
            <button
              id="btn-quick-upgrade-intermission"
              disabled={!canUpgrade}
              onClick={() => {
                sound.playUpgradeSuccess();
                onUpgradeWeapon(activeWeaponId);
              }}
              className={`flex-1 py-1.5 px-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer ${
                canUpgrade
                  ? 'btn-game-gold'
                  : 'bg-slate-800 text-slate-500 opacity-60 cursor-not-allowed'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="truncate">
                Upgrade Mk{activeWeapon.tier + 1} (${upgradeCost})
              </span>
            </button>
          )}
        </div>

        {/* Combat Response Protocol — PERMANENT adrenaline refill-speed
            upgrade. One full-width row between the weapon sinks and the
            consumable armory so it reads as the upgrade it is (not ammo). */}
        <button
          id="btn-buy-adrenaline-refill"
          disabled={refillMaxed || cash < refillCost}
          onClick={() => {
            sound.playUpgradeSuccess();
            onBuyAdrenalineRefill();
          }}
          title={`Kills, crits, shield breaks and stims all fill the rush meter ${(refillMult * 100 - 100).toFixed(0)}% faster`}
          className={`w-full py-1.5 px-2.5 rounded-2xl border flex items-center gap-2.5 transition active:scale-[0.98] cursor-pointer ${
            refillMaxed
              ? 'bg-[#0d1226] border-emerald-500/40 opacity-70 cursor-not-allowed'
              : cash >= refillCost
              ? 'bg-gradient-to-r from-[#0d1b3d] to-[#14182E] border-cyan-400/45 shadow-[0_0_12px_rgba(0,210,255,0.15)]'
              : 'bg-[#0d1226] border-slate-700/60 opacity-70 cursor-not-allowed'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-[#071d42] border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Gauge className="w-[18px] h-[18px] text-cyan-300" />
          </div>
          <div className="flex flex-col items-start min-w-0 flex-1">
            <span className="text-[11px] font-black text-white leading-tight">
              ADRENALINE REFILL SPEED
              <span className="ml-1.5 text-[9px] font-bold text-cyan-300 tabular-nums">
                Lv {Math.min(adrenalineGainSteps, MAX_ADRENALINE_REFILL_STEPS)}/{MAX_ADRENALINE_REFILL_STEPS} · ×
                {refillMult.toFixed(2).replace(/\.?0+$/, '')}
              </span>
            </span>
            <span className="text-[9px] text-cyan-200/80 leading-tight">
              {refillMaxed
                ? 'Maximum protocol — every kill fills the meter at double speed'
                : `Permanent · rush meter fills 25% faster · ×${refillMult.toFixed(2).replace(/\.?0+$/, '')} → ×${nextRefillMult.toFixed(2).replace(/\.?0+$/, '')}`}
            </span>
          </div>
          <span
            className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg border tabular-nums ${
              refillMaxed
                ? 'text-emerald-300 border-emerald-400/40 bg-[#0C1024]'
                : cash >= refillCost
                ? 'text-[#FAC602] border-[#FAC602]/40 bg-[#0C1024]'
                : 'text-slate-500 border-slate-700 bg-slate-900/60'
            }`}
          >
            {refillMaxed ? 'MAX' : `$${refillCost}`}
          </span>
        </button>

        {/* Emergency Armory: restock special charges + adrenaline stims between
            waves. Repeatable mid-run purchases (no cap). */}
        <div className="w-full flex items-center gap-2">
          <button
            id="btn-buy-adrenaline-intermission"
            disabled={cash < ADRENALINE_STIM_COST}
            onClick={() => {
              sound.playUiClick();
              onBuyAdrenalineStim();
            }}
            className={`flex-1 py-1.5 px-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer border ${
              cash >= ADRENALINE_STIM_COST
                ? 'bg-[#0C1024] border-rose-400/50 text-rose-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-500 opacity-60 cursor-not-allowed'
            }`}
          >
            <Syringe className="w-3.5 h-3.5" />
            <span>STIM +${ADRENALINE_STIM_COST}</span>
          </button>

          {weapons.emp.unlocked && (
            <button
              id="btn-buy-emp-intermission"
              disabled={cash < SPECIAL_CHARGE_COSTS.emp}
              onClick={() => {
                sound.playUiClick();
                onBuySpecialCharge('emp');
              }}
              className={`flex-1 py-1.5 px-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer border ${
                cash >= SPECIAL_CHARGE_COSTS.emp
                  ? 'bg-[#0C1024] border-[#00D2FF]/50 text-[#00D2FF]'
                  : 'bg-slate-800/60 border-slate-700 text-slate-500 opacity-60 cursor-not-allowed'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>EMP ×{empCharges}</span>
            </button>
          )}
          {weapons.orbital.unlocked && (
            <button
              id="btn-buy-orbital-intermission"
              disabled={cash < SPECIAL_CHARGE_COSTS.orbital}
              onClick={() => {
                sound.playUiClick();
                onBuySpecialCharge('orbital');
              }}
              className={`flex-1 py-1.5 px-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer border ${
                cash >= SPECIAL_CHARGE_COSTS.orbital
                  ? 'bg-[#0C1024] border-[#E62E5C]/50 text-[#ff7a9c]'
                  : 'bg-slate-800/60 border-slate-700 text-slate-500 opacity-60 cursor-not-allowed'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>ORBIT ×{orbitalCharges}</span>
            </button>
          )}
          <button
            id="btn-buy-grenade-intermission"
            disabled={cash < SPECIAL_CHARGE_COSTS.grenade}
            onClick={() => {
              sound.playUiClick();
              onBuySpecialCharge('grenade');
            }}
            className={`flex-1 py-1.5 px-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer border ${
              cash >= SPECIAL_CHARGE_COSTS.grenade
                ? 'bg-[#0C1024] border-[#FAC602]/50 text-[#FAC602]'
                : 'bg-slate-800/60 border-slate-700 text-slate-500 opacity-60 cursor-not-allowed'
            }`}
          >
            <Bomb className="w-3.5 h-3.5" />
            <span>FRAG ×{grenadeCharges}</span>
          </button>
        </div>

        {/* Big Juicy 3D Green "NEXT WAVE" Button */}
        <button
          id="btn-start-next-wave"
          onClick={() => {
            sound.playUiClick();
            onStartNextWave();
          }}
          className="btn-game-green w-full py-3 px-6 rounded-full text-lg font-black tracking-widest uppercase flex items-center justify-center gap-2 select-none mt-1 cursor-pointer"
        >
          <span>NEXT WAVE</span>
          <span className="text-[10px] bg-[#226804] px-2 py-0.5 rounded-full border border-white/30 text-white font-bold">
            {countdown}s
          </span>
        </button>
        </div>
      </div>
    </div>
  );
};
