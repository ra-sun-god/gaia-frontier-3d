'use client';

import React, { useState, useMemo } from 'react';
import { PlayerProfile, WeaponId, WeaponDef } from '@/lib/types';
import { sound } from '@/lib/audio';
import {
  getIdleCollectorStatus,
  getIdleUpgradeCost,
  HULL_REFIT_COST,
  getHullExtensionCost,
  getHullMaxHp,
  MAX_HULL_EXTENSION_STEPS,
  getWeaponUpgradeCost,
  getUpgradeSuggestions,
  weaponStatsAtTier,
  INITIAL_WEAPONS,
  ADRENALINE_STIM_COST,
  MAX_ADRENALINE_REFILL_STEPS,
  getAdrenalineRefillCost,
  getAdrenalineGainMultiplier,
} from '@/lib/storage';
import { X, Info, Syringe, Zap, Gauge } from 'lucide-react';
import { ModalDock } from './ModalDock';

interface ShopModalProps {
  profile: PlayerProfile;
  weapons: Record<WeaponId, WeaponDef>;
  /** Which weapon the live run is firing (advisor ranking). */
  activeWeaponId?: WeaponId;
  /** Live hull % while a run is active (drives the refit card read-out). */
  currentHp?: number;
  onBuyGems: (amount: number, priceLabel: string) => void;
  onUpgradeWeapon: (id: WeaponId, cost: number) => void;
  onUnlockWeapon?: (id: WeaponId, costCash: number, costGems: number) => void;
  /** Emergency Hull Refit — only provided while a run is live (needs the engine). */
  onBuyHullRefit?: () => void;
  /** Permanent +25% hull-ceiling reinforcement (profile upgrade, always available). */
  onBuyHullExtension?: () => void;
  /** Adrenaline stim — only provided while a run is live (needs the engine). */
  onBuyAdrenalineStim?: () => void;
  /** Combat Response Protocol — permanent adrenaline refill-speed upgrade
   *  (works menu-side too: next run starts with the purchased multiplier). */
  onBuyAdrenalineRefill?: () => void;
  onBuyStarterPack?: () => void;
  onUpgradeIdleCollector: () => void;
  onClaimIdleCash: () => void;
  onClose: () => void;
}

export const ShopModal: React.FC<ShopModalProps> = ({
  profile,
  weapons,
  activeWeaponId,
  currentHp,
  onBuyGems,
  onUpgradeWeapon,
  onUnlockWeapon,
  onBuyHullRefit,
  onBuyHullExtension,
  onBuyAdrenalineStim,
  onBuyAdrenalineRefill,
  onBuyStarterPack,
  onUpgradeIdleCollector,
  onClaimIdleCash,
  onClose,
}) => {
  const [tab, setTab] = useState<'bundles' | 'weapons' | 'base' | 'idle'>('bundles');
  const [showOddsModal, setShowOddsModal] = useState(false);

  const idleStatus = getIdleCollectorStatus(
    profile.lastIdleCollectedAt,
    profile.idleCollectorLevel
  );

  const idleUpgradeCost = getIdleUpgradeCost(profile.idleCollectorLevel);

  // Advisor ranking for the shop: which weapon deserves the next credit most?
  // Drives the RECOMMENDED badge so hesitant buyers get a concrete pointer.
  const recommendedWeaponId = useMemo(() => {
    const s = getUpgradeSuggestions({
      weapons,
      activeWeaponId: activeWeaponId ?? 'cannon',
      cash: profile.cash,
      currentHp: 1,
      maxHp: 1, // HP n/a in the shop — suppress repair suggestions
      nextWave: 1,
      empCharges: 1,
      orbitalCharges: 1, // suppress restock suggestions
      maxSuggestions: 1,
    }).find((x) => x.kind === 'weapon');
    return s?.weaponId;
  }, [weapons, activeWeaponId, profile.cash]);

  return (
    <div
      id="shop-modal-container"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop select-none animate-in fade-in"
    >
      {/* Top Header Row */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1">
        {/* Left Currency Pill: Gems */}
        <div className="flex items-center gap-1.5 bg-[#171B33] border-[2px] border-[#080E1E] px-3 py-1 rounded-full shadow-inner">
          <span className="text-sm">💎</span>
          <span className="text-xs font-black text-[#00D2FF] tabular-nums">
            {profile.gems}
          </span>
        </div>

        {/* Centered Sculpted Badge */}
        <div className="bg-[#1474E0] border-[2.5px] border-[#062349] rounded-full px-4 py-1 flex flex-col items-center shadow-[0_4px_0_#073B78,0_6px_10px_rgba(0,0,0,0.5)]">
          <span className="text-xs font-black text-white uppercase tracking-wider text-stroke-arcade">
            DEFENSE ARMORY
          </span>
        </div>

        {/* Right Close Button */}
        <button
          id="btn-close-shop"
          onClick={() => {
            sound.playUiClick();
            onClose();
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-4 flex flex-col gap-3 shadow-2xl max-h-[78vh] overflow-hidden relative my-auto">
        {/* Currency Strip for In-Game Cash */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-2xl bg-[#14182E] border-[2px] border-[#0A0E21] text-xs font-bold">
          <div className="flex items-center gap-1 text-[#FAC602]">
            <span>🪙 Cash:</span>
            <span className="font-black tabular-nums">${profile.cash.toLocaleString()}</span>
          </div>
          <button
            id="btn-show-odds-info"
            onClick={() => setShowOddsModal(true)}
            className="text-[10px] text-[#00D2FF] hover:text-white flex items-center gap-0.5 cursor-pointer font-bold"
          >
            <Info className="w-3 h-3" />
            <span>Odds</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="w-full tab-segmented-container grid grid-cols-4 p-1 gap-1">
          {(
            [
              { key: 'bundles', label: 'Bundles' },
              { key: 'weapons', label: 'Weapons' },
              { key: 'base', label: 'Citadel' },
              { key: 'idle', label: 'Satellites' },
            ] as const
          ).map((item) => {
            const isActive = tab === item.key;
            return (
              <button
                key={item.key}
                id={`shop-tab-${item.key}`}
                onClick={() => {
                  sound.playUiClick();
                  setTab(item.key);
                }}
                className={`py-1.5 px-1 rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                  isActive ? 'tab-segmented-active' : 'tab-segmented-inactive'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* --- Scrollable Content Body --- */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 max-h-[58vh]">
          {/* TAB 1: BUNDLES */}
          {tab === 'bundles' && (
            <div className="flex flex-col gap-3">
              {/* Card 0: One-time Terran Starter Pack (recruit grant) */}
              {!profile.hasPurchasedStarterPack && onBuyStarterPack && (
                <div className="earth-card-well p-3 flex items-center justify-between gap-2 relative shadow-md rounded-2xl border border-[#53CE17]/40">
                  <div className="flex items-center gap-2.5">
                    <div className="w-12 h-12 rounded-2xl bg-[#071d42] border border-[#53CE17]/60 flex items-center justify-center text-2xl shadow-inner">
                      🎖️
                    </div>
                    <div className="flex flex-col">
                      <span className="font-black text-sm text-white">Terran Starter Pack</span>
                      <span className="text-[10px] text-emerald-300/90 leading-tight">
                        80 💎 + Gatling Autocannon Mk2 + Neon Turret skin
                      </span>
                    </div>
                  </div>
                  <button
                    id="btn-buy-starter-pack"
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyStarterPack();
                    }}
                    className="btn-game-green py-2 px-4 rounded-full text-xs font-black shadow-md cursor-pointer select-none shrink-0"
                  >
                    FREE
                  </button>
                </div>
              )}

              {/* Card 1: Deal Dash */}
              <div className="earth-card-well p-3 flex flex-col gap-2 relative shadow-md rounded-2xl">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col items-center justify-center bg-[#071d42] rounded-2xl p-2 min-w-[85px] border border-cyan-400/40">
                    <div className="text-3xl filter drop-shadow">💎</div>
                    <div className="bg-[#041228] text-cyan-300 font-black text-xs px-2.5 py-0.5 rounded-full mt-1 border border-cyan-400/40">
                      1500
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 flex-1 bg-[#051733] p-2 rounded-2xl border border-cyan-400/20">
                    <div className="flex items-center gap-1 bg-[#09224c] p-1 rounded-lg border border-cyan-400/30">
                      <span className="text-sm">💥</span>
                      <span className="text-[10px] font-black text-cyan-200">x1</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#09224c] p-1 rounded-lg border border-cyan-400/30">
                      <span className="text-sm">🎁</span>
                      <span className="text-[10px] font-black text-cyan-200">x1</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#09224c] p-1 rounded-lg border border-cyan-400/30">
                      <span className="text-sm">🚀</span>
                      <span className="text-[10px] font-black text-cyan-200">x1</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-cyan-800/40">
                  <span className="font-black text-sm text-white">Orbital Supply Pack</span>
                  <button
                    id="btn-buy-deal-dash"
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyGems(1500, '5.55 USD');
                    }}
                    className="btn-game-gold py-1.5 px-4 rounded-full text-xs font-black shadow-md cursor-pointer select-none"
                  >
                    5.55 USD
                  </button>
                </div>
              </div>

              {/* Card 2: Galactic Stash */}
              <div className="earth-card-well p-3 flex flex-col gap-2 relative shadow-md rounded-2xl">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col items-center justify-center bg-[#071d42] rounded-2xl p-2 min-w-[85px] border border-cyan-400/40">
                    <div className="text-3xl filter drop-shadow">👑</div>
                    <div className="bg-[#041228] text-cyan-300 font-black text-xs px-2.5 py-0.5 rounded-full mt-1 border border-cyan-400/40">
                      2100
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 flex-1 bg-[#051733] p-2 rounded-2xl border border-cyan-400/20">
                    <div className="flex items-center gap-1 bg-[#09224c] p-1 rounded-lg border border-cyan-400/30">
                      <span className="text-sm">💥</span>
                      <span className="text-[10px] font-black text-cyan-200">x3</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#09224c] p-1 rounded-lg border border-cyan-400/30">
                      <span className="text-sm">🎁</span>
                      <span className="text-[10px] font-black text-cyan-200">x3</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#09224c] p-1 rounded-lg border border-cyan-400/30">
                      <span className="text-sm">🚀</span>
                      <span className="text-[10px] font-black text-cyan-200">x3</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-cyan-800/40">
                  <span className="font-black text-sm text-white">Commander Stash</span>
                  <button
                    id="btn-buy-bundle-quest"
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyGems(2100, '7.77 USD');
                    }}
                    className="btn-game-gold py-1.5 px-4 rounded-full text-xs font-black shadow-md cursor-pointer select-none"
                  >
                    7.77 USD
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: WEAPONS — unlimited Mk-tiers, exponential stat growth */}
          {tab === 'weapons' && (
            <div className="flex flex-col gap-2">
              {Object.entries(weapons).map(([id, w]) => {
                const wid = id as WeaponId;
                const isLocked = !w.unlocked;
                const upgradeCost = getWeaponUpgradeCost(w);
                const canAffordUpgrade = profile.cash >= upgradeCost;
                const canAffordUnlock = profile.cash >= w.unlockCostCash && profile.gems >= w.unlockCostGems;
                const isRecommended = wid === recommendedWeaponId;
                const nextStats = weaponStatsAtTier(
                  INITIAL_WEAPONS[wid].damage,
                  INITIAL_WEAPONS[wid].fireRate,
                  w.tier + 1
                );
                return (
                  <div
                    key={id}
                    className={`earth-card-well p-2.5 flex items-center justify-between rounded-2xl relative ${
                      isLocked ? 'opacity-75' : ''
                    } ${
                      isRecommended ? 'ring-1 ring-[#00D2FF]/60 shadow-[0_0_14px_rgba(0,210,255,0.18)]' : ''
                    }`}
                  >
                    {isRecommended && (
                      <span className="absolute -top-1.5 -right-1.5 bg-[#00D2FF] text-[#041228] text-[8px] font-black px-1.5 py-0.5 rounded-full border border-[#00D2FF]/60 shadow flex items-center gap-0.5 z-10">
                        <Zap className="w-2.5 h-2.5" /> ADVISOR PICK
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-[#071d42] border border-cyan-400/50 flex items-center justify-center text-xl shadow-inner">
                        {wid === 'cannon' && '💥'}
                        {wid === 'machinegun' && '🔫'}
                        {wid === 'laser' && '⚡'}
                        {wid === 'missiles' && '🚀'}
                        {wid === 'emp' && '💠'}
                        {wid === 'orbital' && '🛰️'}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-sm text-white">{w.name}</span>
                          <span className="text-[9px] font-black text-amber-300 bg-[#041228] px-1 rounded border border-amber-400/30">
                            {isLocked ? 'LOCKED' : `Mk${w.tier}`}
                          </span>
                        </div>
                        <span className="text-[10px] text-cyan-200/80">
                          {wid === 'emp'
                            ? 'Stuns in radius'
                            : wid === 'orbital'
                            ? 'Satellite laser strike'
                            : `DMG ${w.damage} • ${w.fireRate.toFixed(1)}/s`}
                        </span>
                        {!isLocked && (
                          <span className="text-[9px] text-emerald-300/90">
                            Next Mk{w.tier + 1}: DMG {nextStats.damage} • {nextStats.fireRate.toFixed(1)}/s
                          </span>
                        )}
                      </div>
                    </div>

                    {isLocked ? (
                      <button
                        id={`btn-unlock-weapon-${wid}`}
                        disabled={!canAffordUnlock}
                        onClick={() => {
                          if (!canAffordUnlock || !onUnlockWeapon) return;
                          sound.playUpgradeSuccess();
                          onUnlockWeapon(wid, w.unlockCostCash, w.unlockCostGems);
                        }}
                        className={`py-1.5 px-3 rounded-full text-xs font-black transition cursor-pointer ${
                          canAffordUnlock
                            ? 'btn-game-gold'
                            : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                        }`}
                      >
                        {w.unlockCostGems > 0 ? `${w.unlockCostGems} 💎` : `$${w.unlockCostCash}`}
                      </button>
                    ) : (
                      <button
                        id={`btn-upgrade-weapon-${wid}`}
                        disabled={!canAffordUpgrade}
                        onClick={() => {
                          if (!canAffordUpgrade) return;
                          sound.playUpgradeSuccess();
                          onUpgradeWeapon(wid, upgradeCost);
                        }}
                        className={`py-1.5 px-3 rounded-full text-xs font-black transition cursor-pointer shrink-0 ${
                          canAffordUpgrade
                            ? 'btn-game-gold'
                            : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                        }`}
                      >
                        <span className="flex flex-col items-center leading-tight">
                          <span>UPGRADE</span>
                          <span className="text-[9px] opacity-90 tabular-nums">${upgradeCost.toLocaleString()}</span>
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: CITADEL BASE (reinforcement, refit + Adrenaline Stim) */}
          {tab === 'base' && (
            <div className="flex flex-col gap-2">
              {/* HULL REINFORCEMENT (Hull Expansion Doctrine): a PERMANENT +25%
                  ceiling extension (100→125→150→175→…) — deliberately one of
                  the most expensive recurring purchases in the game so the
                  Citadel's spine stays a long-term savings goal. Buying it
                  mid-run welds the new plating on immediately as live hull. */}
              {onBuyHullExtension && (
                <div className="earth-card-well p-3 flex items-center justify-between rounded-2xl border border-cyan-400/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#071d42] border border-cyan-400/50 flex items-center justify-center text-xl">
                      ⛨
                    </div>
                    <div className="flex flex-col">
                      <span className="font-black text-sm text-white">Reinforced Hull Plating</span>
                      <span className="text-[11px] text-cyan-200/80">
                        {profile.hullExtensionSteps >= MAX_HULL_EXTENSION_STEPS ? (
                          'Citadel at maximum reinforcement'
                        ) : (
                          <>
                            +25% hull ceiling · {getHullMaxHp(profile.hullExtensionSteps)}% →{' '}
                            <span className="text-emerald-300 font-bold">
                              {getHullMaxHp(profile.hullExtensionSteps + 1)}%
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    id="btn-buy-hull-extension"
                    disabled={
                      profile.hullExtensionSteps >= MAX_HULL_EXTENSION_STEPS ||
                      profile.cash < getHullExtensionCost(profile.hullExtensionSteps)
                    }
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyHullExtension();
                    }}
                    className={`py-1.5 px-3 rounded-full text-[11px] font-black cursor-pointer shrink-0 ${
                      profile.hullExtensionSteps < MAX_HULL_EXTENSION_STEPS &&
                      profile.cash >= getHullExtensionCost(profile.hullExtensionSteps)
                        ? 'btn-game-gold'
                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    }`}
                  >
                    {profile.hullExtensionSteps >= MAX_HULL_EXTENSION_STEPS
                      ? 'MAX'
                      : `$${getHullExtensionCost(profile.hullExtensionSteps)}`}
                  </button>
                </div>
              )}

              {onBuyAdrenalineStim && (
                <div className="earth-card-well p-3 flex items-center justify-between rounded-2xl border border-rose-400/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#071d42] border border-rose-400/50 flex items-center justify-center">
                      <Syringe className="w-5 h-5 text-rose-300" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-black text-sm text-white">Adrenaline Combat Stim</span>
                      <span className="text-[11px] text-rose-200/80">+50 rush · Overdrive fast-reload at 100</span>
                    </div>
                  </div>
                  <button
                    id="btn-buy-adrenaline-stim"
                    disabled={profile.cash < ADRENALINE_STIM_COST}
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyAdrenalineStim();
                    }}
                    className={`py-1.5 px-3 rounded-full text-[11px] font-black cursor-pointer shrink-0 ${
                      profile.cash >= ADRENALINE_STIM_COST
                        ? 'btn-game-gold'
                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    }`}
                  >
                    ${ADRENALINE_STIM_COST}
                  </button>
                </div>
              )}

              {/* COMBAT RESPONSE PROTOCOL: PERMANENT adrenaline refill-speed
                  upgrade (+25% gain per level, max 4 = ×2.0). The stim above
                  is a one-shot instant fill; this is the lasting economy sink
                  that makes every future kill pay more rush. */}
              {onBuyAdrenalineRefill && (
                <div className="earth-card-well p-3 flex items-center justify-between rounded-2xl border border-cyan-400/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#071d42] border border-cyan-400/50 flex items-center justify-center">
                      <Gauge className="w-5 h-5 text-cyan-300" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-black text-sm text-white">
                        Combat Response Protocol
                        <span className="ml-1.5 text-[10px] font-bold text-cyan-300 tabular-nums">
                          Lv {Math.min(profile.adrenalineGainSteps, MAX_ADRENALINE_REFILL_STEPS)}/{MAX_ADRENALINE_REFILL_STEPS}
                        </span>
                      </span>
                      <span className="text-[11px] text-cyan-200/80">
                        {profile.adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS ? (
                          'Adrenaline refills at DOUBLE speed — maximum protocol'
                        ) : (
                          <>
                            Permanent +25% adrenaline refill · kills fill the rush meter ×
                            {getAdrenalineGainMultiplier(profile.adrenalineGainSteps).toFixed(2).replace(/\.?0+$/, '')} →{' '}
                            <span className="text-emerald-300 font-bold">
                              ×{getAdrenalineGainMultiplier(profile.adrenalineGainSteps + 1).toFixed(2).replace(/\.?0+$/, '')}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    id="btn-buy-adrenaline-refill-shop"
                    disabled={
                      profile.adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS ||
                      profile.cash < getAdrenalineRefillCost(profile.adrenalineGainSteps)
                    }
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyAdrenalineRefill();
                    }}
                    className={`py-1.5 px-3 rounded-full text-[11px] font-black cursor-pointer shrink-0 ${
                      profile.adrenalineGainSteps < MAX_ADRENALINE_REFILL_STEPS &&
                      profile.cash >= getAdrenalineRefillCost(profile.adrenalineGainSteps)
                        ? 'btn-game-gold'
                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    }`}
                  >
                    {profile.adrenalineGainSteps >= MAX_ADRENALINE_REFILL_STEPS
                      ? 'MAX'
                      : `$${getAdrenalineRefillCost(profile.adrenalineGainSteps)}`}
                  </button>
                </div>
              )}

              {/* EMERGENCY HULL REFIT (Hull Expansion Doctrine): fast full
                  restore of whatever the current reinforced ceiling allows —
                  one of the paid fast-repair paths (vs the slow free trickle). */}
              {onBuyHullRefit && (
                <div className="earth-card-well p-3 flex items-center justify-between rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#071d42] border border-emerald-400/50 flex items-center justify-center text-xl">
                      🛠️
                    </div>
                    <div className="flex flex-col">
                      <span className="font-black text-sm text-white">Emergency Hull Refit</span>
                      <span className="text-[11px] text-emerald-200/80">
                        Restore hull to {getHullMaxHp(profile.hullExtensionSteps)}% max · Hull: {Math.round(currentHp ?? 100)}%
                      </span>
                    </div>
                  </div>
                  <button
                    id="btn-buy-hull-refit"
                    disabled={
                      profile.cash < HULL_REFIT_COST ||
                      (currentHp ?? 100) >= getHullMaxHp(profile.hullExtensionSteps)
                    }
                    onClick={() => {
                      sound.playUpgradeSuccess();
                      onBuyHullRefit();
                    }}
                    className={`py-1.5 px-3 rounded-full text-[11px] font-black cursor-pointer ${
                      profile.cash >= HULL_REFIT_COST &&
                      (currentHp ?? 100) < getHullMaxHp(profile.hullExtensionSteps)
                        ? 'btn-game-gold'
                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                    }`}
                  >
                    ${HULL_REFIT_COST}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SATELLITES (IDLE HARVESTER) */}
          {tab === 'idle' && (
            <div className="earth-card-well p-4 flex flex-col gap-3 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#071d42] border border-cyan-400/50 flex items-center justify-center text-2xl shadow-sm">
                  🛰️
                </div>
                <div className="flex flex-col">
                  <span className="font-black text-sm text-white">Orbital Scavenger Array</span>
                  <span className="text-[11px] text-cyan-200/80">
                    Gathers cosmic debris while away • Level {profile.idleCollectorLevel}
                  </span>
                </div>
              </div>

              {idleStatus.amount > 0 && (
                <div className="bg-[#051c3d] border border-cyan-400/40 p-2.5 rounded-2xl flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300">
                    Harvested: <strong>+${idleStatus.amount}</strong>
                  </span>
                  <button
                    id="btn-claim-idle"
                    onClick={() => {
                      sound.playGoodie();
                      onClaimIdleCash();
                    }}
                    className="btn-game-gold py-1 px-3 rounded-full text-xs font-black cursor-pointer"
                  >
                    Claim
                  </button>
                </div>
              )}

              <button
                id="btn-upgrade-idle-harvester"
                disabled={profile.cash < idleUpgradeCost}
                onClick={() => {
                  sound.playUpgradeSuccess();
                  onUpgradeIdleCollector();
                }}
                className={`py-2 px-4 rounded-full text-xs font-black uppercase tracking-wide cursor-pointer ${
                  profile.cash >= idleUpgradeCost
                    ? 'btn-game-gold'
                    : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                }`}
              >
                Upgrade Array (${idleUpgradeCost})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Squircles Navigation Dock (shared) */}
      <ModalDock onClose={onClose} />

      {/* Disclosed Odds Modal */}
      {showOddsModal && (
        <div className="absolute inset-0 z-60 flex items-center justify-center p-4 bg-[#030d1e]/90 backdrop-blur-md">
          <div className="w-full max-w-xs game-dialog-card p-5 shadow-2xl flex flex-col gap-3 text-white">
            <h3 className="font-black text-sm uppercase">Orbital Cache Disclosed Odds</h3>
            <p className="text-xs text-slate-300">
              Fair monetization certified: Common (50%), Uncommon (25%), Rare (15%), Epic (8%),
              Legendary (2%).
            </p>
            <button
              onClick={() => setShowOddsModal(false)}
              className="btn-game-navy py-2 rounded-full text-xs font-black mt-2 cursor-pointer"
            >
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
