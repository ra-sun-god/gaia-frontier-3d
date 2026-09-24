import { PlayerProfile, DailyChallenge, WeaponDef, WeaponId, MysteryBoxReward } from './types';

const STORAGE_KEY = 'earth_defender_profile_v1';

// --- Day-stamp helpers (retention hooks: daily streak + daily boss rush) ---

/** Local calendar day as a YYYYMMDD integer (device timezone — a "day" is
 *  wherever the player is, which is the standard mobile-arcade convention). */
export function getTodayDayStamp(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Day stamp of the 24h BEFORE `stamp` (streak continuation window). */
function previousDayStamp(stamp: number): number {
  const d = new Date(Math.floor(stamp / 10000), Math.floor((stamp % 10000) / 100) - 1, stamp % 100);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** What the NEXT streak claim looks like (preview for the menu card). */
export function previewDailyStreak(profile: PlayerProfile): {
  streak: number;
  claimable: boolean;
  cash: number;
  gems: number;
  isJackpot: boolean;
  luckMultiplier: number;
} {
  const today = getTodayDayStamp();
  const claimable = profile.lastDailyClaimDay !== today;
  // Continuing streak: claimed yesterday → today continues; else restarts at 1.
  const streak = claimable
    ? profile.lastDailyClaimDay === previousDayStamp(today)
      ? profile.dailyStreak + 1
      : 1
    : profile.dailyStreak;
  const isJackpot = streak % 7 === 0;
  // Variable-reward roll: luck multiplies non-jackpot days (1×–3×, weighted).
  const luckRoll = Math.random();
  const luckMultiplier = isJackpot ? 2 : luckRoll < 0.55 ? 1 : luckRoll < 0.85 ? 1.5 : luckRoll < 0.97 ? 2 : 3;
  // CLAIM-BOOST ECONOMY: base streak payouts are HALF the legacy values —
  // the post-claim boost modal doubles them back (watch an ad) or adds +50%
  // (free tap). Tightened further: the streak is a retention hook, not an
  // income faucet.
  const cash = Math.round((isJackpot ? 170 + streak * 20 : 45 + streak * 15) * luckMultiplier);
  // Milestone days keep their 1-gem delight (halving to 0 would kill the
  // ritual); the jackpot day pays 4 (was 8).
  const gems = isJackpot ? 4 : streak % 3 === 0 || streak % 5 === 0 ? 1 : 0;
  return { streak, claimable, cash, gems, isJackpot, luckMultiplier };
}

/** Credit today's streak reward into the profile (idempotent per day). */
export function claimDailyStreak(
  profile: PlayerProfile,
  roll: ReturnType<typeof previewDailyStreak>
): PlayerProfile {
  const today = getTodayDayStamp();
  if (profile.lastDailyClaimDay === today) return profile; // already claimed
  return {
    ...profile,
    cash: profile.cash + roll.cash,
    gems: profile.gems + roll.gems,
    dailyStreak: roll.streak,
    lastDailyClaimDay: today,
  };
}

export const INITIAL_WEAPONS: Record<WeaponId, WeaponDef> = {
  cannon: {
    id: 'cannon',
    name: 'Standard Cannon',
    description: 'Precision single-shot kinetic cannon — barrels link up at higher marks.',
    bestAgainst: 'Weak/early threats',
    unlockCostCash: 0,
    unlockCostGems: 0,
    unlocked: true,
    tier: 1,
    fireRate: 2.2, // shots/sec (volley rate regardless of barrel count)
    damage: 28, // PER VOLLEY — 1 bullet at Mk1-2, twin barrels at Mk3+, triple at Mk6+ (per-bullet damage = damage / barrels)
    projectileSpeed: 600,
    color: '#38bdf8',
    upgradeCost: 250,
  },
  machinegun: {
    id: 'machinegun',
    name: 'Gatling Autocannon',
    description: 'High-rate rotary gun — extra barrels link up at higher marks.',
    bestAgainst: 'Fast/fragile threats & drones',
    unlockCostCash: 350,
    unlockCostGems: 0,
    unlocked: false,
    tier: 1,
    fireRate: 8.5, // volleys/sec (stream count grows with marks)
    damage: 12, // PER VOLLEY — 1 stream at Mk1-2, twin at Mk3+, triple at Mk6+ (per-bullet damage = damage / streams)
    projectileSpeed: 750,
    color: '#fbbf24',
    upgradeCost: 500,
  },
  laser: {
    id: 'laser',
    name: 'Piercing Beam',
    description: 'Sustained slicing laser — the beam splits at higher marks.',
    bestAgainst: 'Congested lines of enemies',
    unlockCostCash: 800,
    unlockCostGems: 0,
    unlocked: false,
    tier: 1,
    fireRate: 3.5, // volleys/sec (beam count grows with marks)
    damage: 38, // PER VOLLEY — 1 beam at Mk1-2, twin beams at Mk3+, triple at Mk6+ (per-beam damage = damage / beams, each beam pierces separately)
    projectileSpeed: 950,
    color: '#34d399',
    upgradeCost: 950,
  },
  missiles: {
    id: 'missiles',
    name: 'Homing Rockets',
    description: 'Target-seeking warheads with wide explosive blast radius.',
    bestAgainst: 'Splitters & armored tanks',
    unlockCostCash: 1500,
    unlockCostGems: 0,
    unlocked: false,
    tier: 1,
    fireRate: 1.4,
    damage: 75,
    projectileSpeed: 480,
    color: '#f87171',
    upgradeCost: 1600,
  },
  emp: {
    id: 'emp',
    name: 'EMP Shockwave',
    description: 'Electromagnetic disruptor that overloads shields and stuns.',
    bestAgainst: 'Shielded Troopers & Robot AI',
    unlockCostCash: 2400,
    unlockCostGems: 0,
    unlocked: false,
    tier: 1,
    fireRate: 1.0,
    damage: 45,
    projectileSpeed: 520,
    color: '#c084fc',
    upgradeCost: 2500,
    cooldown: 8,
  },
  orbital: {
    id: 'orbital',
    name: 'Orbital Strike',
    description: 'Defense satellite superweapon. Scorches the battlefield.',
    bestAgainst: 'Boss waves & screen clear',
    unlockCostCash: 0,
    unlockCostGems: 75,
    unlocked: false,
    tier: 1,
    fireRate: 0.2,
    damage: 450,
    projectileSpeed: 1200,
    color: '#f43f5e',
    upgradeCost: 3000,
    cooldown: 25,
  },
};

export const DEFAULT_PROFILE: PlayerProfile = {
  cash: 150,
  gems: 10,
  highScore: 0,
  highestWave: 1,
  bestStreak: 0,
  totalRuns: 0,
  bossesDefeated: 0,
  baseMaxHp: 100,
  storyIntroSeen: false,
  hullExtensionSteps: 0,
  equippedSkins: {
    cannon: 'cannon_standard',
    base: 'base_standard',
    projectile: 'proj_standard',
  },
  unlockedSkins: ['cannon_standard', 'base_standard', 'proj_standard'],
  weapons: {
    cannon: { unlocked: true, tier: 1 },
    machinegun: { unlocked: false, tier: 1 },
    laser: { unlocked: false, tier: 1 },
    missiles: { unlocked: false, tier: 1 },
    emp: { unlocked: false, tier: 1 },
    orbital: { unlocked: false, tier: 1 },
  },
  idleCollectorLevel: 1,
  lastIdleCollectedAt: 0,
  lastDailyBoxClaimedAt: 0,
  battlePassTier: 1,
  battlePassXp: 0,
  battlePassClaimedTiers: [],
  isBattlePassPremium: false,
  hasPurchasedStarterPack: false,
  dailyStreak: 0,
  lastDailyClaimDay: 0,
  lastBossRushDay: 0,
  bossRushBestStage: 0,
  endlessBestWave: 0,
  adrenalineGainSteps: 0,
};

// --- Shared economy constants (single source of truth for UI + handlers) ---

/**
 * EMERGENCY HULL REFIT — full hull restoration purchase (Hull Expansion
 * Doctrine: fast repair is a paid privilege; slow nano-repair is the only
 * free path). Buying it back is one of the legal repair paths, alongside
 * sky-dropped repair goodies and rewarded ads.
 */
export const HULL_REFIT_COST = 200;

// --- HULL EXPANSION DOCTRINE (Citadel reinforcement economy) -----------------

/** Each extension step adds +25% to the hull ceiling (100 → 125 → 150 → …). */
export const HULL_EXTENSION_STEP = 25;

/** Hull ceiling cap (steps × 25 + 100 = 600%). Costs gate this long before. */
export const MAX_HULL_EXTENSION_STEPS = 20;

/** Base price of the first extension (100% → 125%) — deliberately steep:
 * roughly two clean early runs of income, so the first reinforcement is a
 * mid-term goal, not an impulse buy. */
export const HULL_EXTENSION_BASE_COST = 1200;

/** Price growth per purchased step (×1.75 compounding → 1200, 2100, 3675,
 * 6431, 11250, …). Keeps every further +25% meaningfully more expensive. */
export const HULL_EXTENSION_COST_GROWTH = 1.75;

/** Hull ceiling for a given number of purchased extension steps. */
export function getHullMaxHp(steps: number): number {
  const s = Math.max(0, Math.min(MAX_HULL_EXTENSION_STEPS, Math.floor(steps) || 0));
  return 100 + s * HULL_EXTENSION_STEP;
}

/** Price of the NEXT hull extension (current steps → steps + 1). */
export function getHullExtensionCost(steps: number): number {
  const s = Math.max(0, Math.min(MAX_HULL_EXTENSION_STEPS, Math.floor(steps) || 0));
  const raw = HULL_EXTENSION_BASE_COST * Math.pow(HULL_EXTENSION_COST_GROWTH, s);
  return Math.max(100, Math.round(raw / 25) * 25);
}

/**
 * UNLIMITED weapon Mk-tiers — every weapon can be upgraded forever.
 *
 * Stat curve (weaponStatsAtTier): damage ×1.35 and fire rate ×1.20 per Mk
 * level (compounded) → ~1.62× DPS per level. Matches the old hardcoded Mk2/
 * Mk3 numbers exactly at tiers 2-3 (1.35 ≈ old ×1.35, 1.44 ≈ old ×1.4) and
 * keeps compounding afterwards, so upgrades keep mattering in high waves.
 *
 * Cost curve (getWeaponUpgradeCost): price ×1.85 per level (rounded to 25),
 * so each upgrade costs ~1.9× more but buys ~1.6× DPS — a healthy endless
 * treadmill funded by superlinear wave income.
 */
export const MAX_WEAPON_TIER = 99;

export function weaponStatsAtTier(
  baseDamage: number,
  baseFireRate: number,
  tier: number
): { damage: number; fireRate: number } {
  const t = Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(tier) || 1));
  return {
    damage: Math.max(1, Math.round(baseDamage * Math.pow(1.35, t - 1))),
    fireRate: Number((baseFireRate * Math.pow(1.2, t - 1)).toFixed(1)),
  };
}

/** Price of the NEXT upgrade (current tier → tier + 1). Repeatable forever. */
export function getWeaponUpgradeCost(w: WeaponDef): number {
  const t = Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(w.tier) || 1));
  const raw = w.upgradeCost * Math.pow(1.85, t - 1);
  return Math.max(25, Math.round(raw / 25) * 25);
}

/**
 * Adrenaline combat stim: purchasable mid-run boost for the Overdrive rush
 * (fast reload / triple fire). +50 adrenaline per shot; fills to 100 → the
 * engine auto-triggers Overdrive. Repeatable, no cap.
 */
export const ADRENALINE_STIM_COST = 250;
export const ADRENALINE_STIM_AMOUNT = 50;

// --- COMBAT RESPONSE PROTOCOL (adrenaline refill-speed upgrade) ------------

/** Each purchased step adds +25% adrenaline gain (kill payouts, crits, shield
 *  breaks, intercepts, stims, ad-rushes — the single increaseAdrenaline
 *  funnel). 4 steps cap the multiplier at ×2.0 so Overdrive stays a climb,
 *  not a subscription. */
export const ADRENALINE_REFILL_STEP = 0.25;
export const MAX_ADRENALINE_REFILL_STEPS = 4;

/** Escalating price curve in the hull-reinforcement tradition. */
const ADRENALINE_REFILL_COSTS = [400, 750, 1400, 2600];

export function getAdrenalineRefillCost(steps: number): number {
  const s = Math.max(0, Math.min(MAX_ADRENALINE_REFILL_STEPS, Math.floor(steps) || 0));
  return ADRENALINE_REFILL_COSTS[s] ?? Number.POSITIVE_INFINITY;
}

/** ×1.0 → ×1.25 → ×1.5 → ×1.75 → ×2.0 */
export function getAdrenalineGainMultiplier(steps: number): number {
  const s = Math.max(0, Math.min(MAX_ADRENALINE_REFILL_STEPS, Math.floor(steps) || 0));
  return 1 + ADRENALINE_REFILL_STEP * s;
}

// --- Economy balance (global income multipliers) ---------------------------

/**
 * Global kill-reward multiplier. Playtesting showed the economy was far too
 * generous (weapons maxed within a couple of eras, stims spammed every wave):
 * every threat kill now pays ~half its listed bounty. Combined with the
 * reduced orb / crate / challenge payouts below, credits stay scarce enough
 * that upgrade decisions actually matter — cash is NEVER overly generous.
 */
export const KILL_CASH_MULTIPLIER = 0.52;

/** Per-boss gem bounty (was 15/6, then 9/4 — gems must stay RARE: a full run
 *  of clean boss kills now banks roughly one-third of a gem revive). */
export const BOSS_GEM_REWARDS = { eraBoss: 5, miniBoss: 2 } as const;

/**
 * Gem revive pricing. Diamonds are the premium rarity currency, so the
 * instant (no-ad) revive must feel like a real spending decision: the base
 * price is 40 gems and every additional gem revive in the SAME run doubles
 * (40 → 80 → 160 → …). Ad revives stay the free path; gems buy urgency.
 */
export const REVIVE_COST_GEMS_BASE = 40;

export function getReviveCostGems(gemRevivesUsedThisRun: number): number {
  const n = Math.max(0, Math.floor(gemRevivesUsedThisRun) || 0);
  return REVIVE_COST_GEMS_BASE * Math.pow(2, Math.min(n, 12));
}

/**
 * Battle-pass reward table — the SINGLE source of truth for both the tier
 * list the modal renders and the payout handleClaimPassTier credits, so the
 * displayed rewards can never drift from the actual payout again. Gem values
 * are deliberately lean: the whole free track pays 20 gems, the elite track
 * 190 (the old flat credit silently paid 150 / 400 while advertising even more).
 *
 * CLAIM-BOOST ECONOMY: every tier below is listed at HALF the legacy payout —
 * the post-claim boost modal restores the full legacy value when the player
 * watches a rewarded ad (×2), or adds +50% for a free tap. Displayed values
 * always equal what a claim actually credits.
 */
export interface BattlePassTierDef {
  tier: number;
  xpReq: number;
  free: { label: string; cash: number; gems: number };
  premium: { label: string; cash: number; gems: number };
}

export const BATTLE_PASS_TIERS: BattlePassTierDef[] = [
  { tier: 1, xpReq: 0, free: { label: '+75 Cash', cash: 75, gems: 0 }, premium: { label: '+5 Gems + Neon Turret', cash: 0, gems: 5 } },
  { tier: 2, xpReq: 100, free: { label: '+125 Cash', cash: 125, gems: 0 }, premium: { label: '+7 Gems', cash: 0, gems: 7 } },
  { tier: 3, xpReq: 250, free: { label: 'Tactical Nuke Crate', cash: 110, gems: 0 }, premium: { label: '+375 Cash + Rare Skin', cash: 375, gems: 0 } },
  { tier: 4, xpReq: 450, free: { label: '+190 Cash', cash: 190, gems: 0 }, premium: { label: '+10 Gems', cash: 0, gems: 10 } },
  { tier: 5, xpReq: 700, free: { label: '+4 Gems', cash: 0, gems: 4 }, premium: { label: 'Orbital Battery Mk2 + 5 Gems', cash: 0, gems: 5 } },
  { tier: 6, xpReq: 1000, free: { label: '+275 Cash', cash: 275, gems: 0 }, premium: { label: '+15 Gems', cash: 0, gems: 15 } },
  { tier: 7, xpReq: 1400, free: { label: 'Mystery Crate', cash: 150, gems: 0 }, premium: { label: '+750 Cash', cash: 750, gems: 0 } },
  { tier: 8, xpReq: 1900, free: { label: '+375 Cash', cash: 375, gems: 0 }, premium: { label: 'Emerald Trail + 7 Gems', cash: 0, gems: 7 } },
  { tier: 9, xpReq: 2500, free: { label: '+6 Gems', cash: 0, gems: 6 }, premium: { label: '+20 Gems', cash: 0, gems: 20 } },
  { tier: 10, xpReq: 3200, free: { label: '★ Terran Champion Skin ★', cash: 0, gems: 0 }, premium: { label: '★ Titan Jackpot: +25 Gems + Skin ★', cash: 0, gems: 25 } },
];

// --- Proactive upgrade advisor ------------------------------------------------

export interface UpgradeSuggestion {
  key: string;
  kind: 'weapon' | 'repair' | 'stim' | 'refill' | 'emp' | 'orbital' | 'grenade';
  weaponId?: WeaponId;
  title: string;
  detail: string;
  cost: number;
  reason: string;
}

interface SuggestionOptions {
  weapons: Record<WeaponId, WeaponDef>;
  activeWeaponId: WeaponId;
  cash: number;
  currentHp: number;
  maxHp: number;
  nextWave: number;
  empCharges: number;
  orbitalCharges: number;
  grenadeCharges?: number;
  /** Combat Response Protocol steps already owned (advisor ranks the refill). */
  adrenalineGainSteps?: number;
  maxSuggestions?: number;
}

/**
 * Ranks what the player should buy next. Players were never OFFERED upgrades
 * — they had to find the shop themselves — so the wave intermission now shows
 * a ranked advisor card with one-tap purchase buttons.
 *
 * Ranking: critical repair > active-weapon upgrade > best damage-per-credit
 * weapon upgrade > adrenaline stim > special-charge restocks when dry.
 */
export function getUpgradeSuggestions(opts: SuggestionOptions): UpgradeSuggestion[] {
  const scored: Array<UpgradeSuggestion & { priority: number }> = [];
  const hpRatio = opts.maxHp > 0 ? opts.currentHp / opts.maxHp : 1;

  if (hpRatio < 0.9) {
    scored.push({
      key: 'repair',
      kind: 'repair',
      priority: hpRatio < 0.5 ? 100 : hpRatio < 0.75 ? 70 : 45,
      title: 'Repair the Citadel',
      detail: `Restore +35 hull (now ${Math.round(hpRatio * 100)}%)`,
      cost: 75,
      reason: 'Hull below safe margin for the next assault',
    });
  }

  (Object.keys(opts.weapons) as WeaponId[]).forEach((wid) => {
    const w = opts.weapons[wid];
    if (!w.unlocked || w.tier >= MAX_WEAPON_TIER) return;
    const cost = getWeaponUpgradeCost(w);
    const base = INITIAL_WEAPONS[wid];
    const cur = weaponStatsAtTier(base.damage, base.fireRate, w.tier);
    const next = weaponStatsAtTier(base.damage, base.fireRate, w.tier + 1);
    const dpsGain = next.damage * next.fireRate - cur.damage * cur.fireRate;
    const dmgPerCredit = dpsGain / Math.max(1, cost);
    const isActive = wid === opts.activeWeaponId;
    scored.push({
      key: `weapon-${wid}`,
      kind: 'weapon',
      weaponId: wid,
      priority:
        40 +
        (isActive ? 25 : 0) +
        Math.min(20, dmgPerCredit * 400) +
        Math.min(10, opts.nextWave),
      title: `${w.name} → Mk${w.tier + 1}`,
      detail: `DMG ${cur.damage}→${next.damage} • ${cur.fireRate.toFixed(1)}→${next.fireRate.toFixed(1)}/s`,
      cost,
      reason: isActive
        ? 'Your active weapon — biggest immediate power gain'
        : 'Best damage-per-credit upgrade you own',
    });
  });

  if (opts.nextWave >= 3) {
    scored.push({
      key: 'stim',
      kind: 'stim',
      priority: 35 + Math.min(10, opts.nextWave),
      title: 'Adrenaline Stim (+50)',
      detail: 'Fills the rush meter — auto-Overdrive at 100',
      cost: ADRENALINE_STIM_COST,
      reason: 'Emergency fast-reload burst for tougher waves',
    });
  }

  // COMBAT RESPONSE PROTOCOL — permanent refill-speed upgrade. Ranked above
  // the one-shot stim once the player has cash to spare (the permanent
  // multiplier compounds across every future run; the stim evaporates).
  const adrSteps = opts.adrenalineGainSteps ?? 0;
  if (adrSteps < MAX_ADRENALINE_REFILL_STEPS && opts.nextWave >= 4) {
    const refillCost = getAdrenalineRefillCost(adrSteps);
    scored.push({
      key: 'refill',
      kind: 'refill',
      priority: 36 + Math.min(8, opts.nextWave),
      title: `Adrenaline Refill +25% (Lv ${adrSteps + 1})`,
      detail: `Rush meter fills ×${getAdrenalineGainMultiplier(adrSteps).toFixed(2).replace(/\.?0+$/, '')} → ×${getAdrenalineGainMultiplier(adrSteps + 1).toFixed(2).replace(/\.?0+$/, '')} — permanent`,
      cost: refillCost,
      reason: 'Permanent multiplier: every kill pays more rush',
    });
  }

  if (opts.weapons.emp.unlocked && opts.empCharges <= 0) {
    scored.push({
      key: 'emp',
      kind: 'emp',
      title: 'Restock EMP Charge',
      detail: 'Stun + shield-break crowd control',
      cost: SPECIAL_CHARGE_COSTS.emp,
      reason: 'EMP dry — crowd control unavailable',
      priority: 30,
    });
  }

  if (opts.weapons.orbital.unlocked && opts.orbitalCharges <= 0) {
    scored.push({
      key: 'orbital',
      kind: 'orbital',
      title: 'Restock Orbital Charge',
      detail: 'Screen-clearing satellite strike',
      cost: SPECIAL_CHARGE_COSTS.orbital,
      reason: 'Orbital dry — no panic button for bosses',
      priority: 26,
    });
  }

  if ((opts.grenadeCharges ?? 0) <= 0 && opts.nextWave >= 2) {
    scored.push({
      key: 'grenade',
      kind: 'grenade',
      title: 'Restock Frag Grenades',
      detail: '+2 lobbed AoE blasts at your aim point',
      cost: SPECIAL_CHARGE_COSTS.grenade,
      reason: 'Grenade belt empty — cheap crowd clear',
      priority: 28,
    });
  }

  return scored
    .sort((a, b) => b.priority - a.priority)
    .slice(0, opts.maxSuggestions ?? 2)
    .map(({ priority: _priority, ...rest }) => rest);
}

/**
 * Free special-weapon charges granted at the start of EVERY combat run.
 * EMP is a crowd-control tool (4 free), Orbital is the screen-wiper (2 free),
 * and Frag Grenades are the cheap arc-AoE workhorse (2 free).
 * They never auto-refill mid-run: once spent, extra charges must be bought with cash.
 */
export const FREE_SPECIAL_CHARGES: { emp: number; orbital: number; grenade: number } = {
  emp: 4,
  orbital: 2,
  grenade: 2,
};

/**
 * Mid-run price to buy ONE extra special charge (repeatable, no cap).
 * Premium pricing: EMP ≈ ⅓ of an early wave's income, Orbital ≈ a full wave,
 * Grenades sit between — a deliberate economy sink, not a spammable consumable.
 */
export const SPECIAL_CHARGE_COSTS: { emp: number; orbital: number; grenade: number } = {
  emp: 150,
  orbital: 300,
  grenade: 200,
};

/** Idle collector upgrade cost curve: 150, 225, 338, ... (1.5x per level). */
export function getIdleUpgradeCost(level: number): number {
  return Math.round(150 * Math.pow(1.5, Math.max(1, level) - 1));
}

/** Idle harvest rate per hour per collector level (nerfed: 100 → 55 → 40 →
 * 20 — the passive faucet must never out-earn actually playing. The latest
 * halving is the CLAIM-BOOST economy: idle claims get the boost modal too,
 * so the base rate is half the legacy value and watching the ad doubles it). */
export const IDLE_CASH_PER_HOUR_PER_LEVEL = 20;

// CLAIM-BOOST ECONOMY: every challenge below pays HALF its legacy bounty —
// the post-claim boost modal offers ×2 (watch a rewarded ad) or +50% (free
// tap). Displayed values equal credited values, always.
export const DAILY_CHALLENGES_DATA: DailyChallenge[] = [
  {
    id: 'ch_scouts',
    title: 'Interception Protocol',
    description: 'Destroy 20 Alien Scout ships in combat runs',
    target: 20,
    current: 0,
    completed: false,
    claimed: false,
    rewardCash: 100,
    rewardGems: 2,
    type: 'kill_scouts',
  },
  {
    id: 'ch_combo',
    title: 'Precision Fire',
    description: 'Reach a continuous 15x Combo Streak without missing',
    target: 15,
    current: 0,
    completed: false,
    claimed: false,
    rewardCash: 75,
    rewardGems: 1,
    type: 'combo_streak',
  },
  {
    id: 'ch_survive',
    title: 'Terran Aegis',
    description: 'Survive to Wave 6 or beyond in a single run',
    target: 6,
    current: 0,
    completed: false,
    claimed: false,
    rewardCash: 150,
    rewardGems: 3,
    type: 'survive_waves',
  },
  {
    id: 'ch_orbital',
    title: 'Heavenly Wrath',
    description: 'Eliminate 30 threats with heavy or special weapons',
    target: 30,
    current: 0,
    completed: false,
    claimed: false,
    rewardCash: 110,
    rewardGems: 2,
    type: 'use_orbital',
  },
];

export function getStoredProfile(): PlayerProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PROFILE;

    // Deep-merge weapons so old/partial saves can never produce "Mk undefined"
    const weapons: PlayerProfile['weapons'] = { ...DEFAULT_PROFILE.weapons };
    if (parsed.weapons && typeof parsed.weapons === 'object') {
      (Object.keys(weapons) as WeaponId[]).forEach((wid) => {
        const saved = parsed.weapons[wid];
        if (saved && typeof saved === 'object') {
          weapons[wid] = {
            unlocked: Boolean(saved.unlocked),
            // Unlimited Mk-tiers: accept ANY sane integer >= 1 (cloud saves and
            // old Mk3-era saves both round-trip through here)
            tier:
              typeof saved.tier === 'number' && Number.isFinite(saved.tier)
                ? Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(saved.tier)))
                : 1,
          };
        }
      });
    }

    const safeNum = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      cash: Math.max(0, Math.floor(safeNum(parsed.cash, DEFAULT_PROFILE.cash))),
      gems: Math.max(0, Math.floor(safeNum(parsed.gems, DEFAULT_PROFILE.gems))),
      baseMaxHp: Math.max(100, Math.floor(safeNum(parsed.baseMaxHp, DEFAULT_PROFILE.baseMaxHp))),
      hullExtensionSteps: Math.max(
        0,
        Math.min(
          MAX_HULL_EXTENSION_STEPS,
          Math.floor(safeNum(parsed.hullExtensionSteps, 0))
        )
      ),
      battlePassXp: Math.max(0, Math.floor(safeNum(parsed.battlePassXp, 0))),
      weapons,
      unlockedSkins: Array.isArray(parsed.unlockedSkins)
        ? parsed.unlockedSkins.filter((s: unknown) => typeof s === 'string')
        : DEFAULT_PROFILE.unlockedSkins,
      battlePassClaimedTiers: Array.isArray(parsed.battlePassClaimedTiers)
        ? parsed.battlePassClaimedTiers.filter((t: unknown) => typeof t === 'number')
        : [],
      dailyStreak: Math.max(0, Math.floor(safeNum(parsed.dailyStreak, 0))),
      lastDailyClaimDay: Math.max(0, Math.floor(safeNum(parsed.lastDailyClaimDay, 0))),
      lastBossRushDay: Math.max(0, Math.floor(safeNum(parsed.lastBossRushDay, 0))),
      bossRushBestStage: Math.max(0, Math.floor(safeNum(parsed.bossRushBestStage, 0))),
      endlessBestWave: Math.max(0, Math.floor(safeNum(parsed.endlessBestWave, 0))),
      storyIntroSeen: Boolean(parsed.storyIntroSeen),
      adrenalineGainSteps: Math.max(
        0,
        Math.min(
          MAX_ADRENALINE_REFILL_STEPS,
          Math.floor(safeNum(parsed.adrenalineGainSteps, 0))
        )
      ),
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(profile: PlayerProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // quota exceeded or disabled
  }
}

export function getDailyChallenges(): DailyChallenge[] {
  if (typeof window === 'undefined') return DAILY_CHALLENGES_DATA;
  try {
    const raw = localStorage.getItem('earth_defender_challenges');
    if (!raw) return DAILY_CHALLENGES_DATA;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DAILY_CHALLENGES_DATA;
    // Merge against canonical definitions so renamed/new quests stay valid
    return DAILY_CHALLENGES_DATA.map((def) => {
      const saved = parsed.find((c: DailyChallenge) => c && c.id === def.id);
      if (!saved || typeof saved !== 'object') return { ...def };
      return {
        ...def,
        current: typeof saved.current === 'number' && Number.isFinite(saved.current)
          ? Math.max(0, Math.min(def.target, Math.floor(saved.current)))
          : 0,
        completed: Boolean(saved.completed),
        claimed: Boolean(saved.claimed),
      };
    });
  } catch {
    return DAILY_CHALLENGES_DATA;
  }
}

export function saveDailyChallenges(challenges: DailyChallenge[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('earth_defender_challenges', JSON.stringify(challenges));
  } catch {}
}

export function getIdleCollectorStatus(lastClaimAt?: number, level?: number): { amount: number; hours: number } {
  const now = Date.now();
  const last = lastClaimAt || now;
  const diffMs = Math.max(0, now - last);
  const hours = Math.min(24, diffMs / (1000 * 60 * 60));
  const basePerHour = IDLE_CASH_PER_HOUR_PER_LEVEL * (level || 1);
  const amount = Math.floor(hours * basePerHour);
  return { amount, hours: Number(hours.toFixed(1)) };
}

export function calculateIdleCash(profile: PlayerProfile): { amount: number; hours: number } {
  return getIdleCollectorStatus(profile.lastIdleCollectedAt, profile.idleCollectorLevel);
}

// Mystery Box Odds Table with transparent probabilities
// Common 50%, Uncommon 25%, Rare 15%, Epic 8%, Legendary 2%
// CLAIM-BOOST ECONOMY: payouts rolled at HALF the legacy values (the reveal
// card shows exactly what was credited — no bait-and-switch). The post-claim
// boost modal doubles the roll with a rewarded ad or adds +50% for free.
export function rollMysteryBox(): MysteryBoxReward {
  const roll = Math.random() * 100;
  if (roll < 50) {
    // Common 50%
    const cash = 30 + Math.floor(Math.random() * 30);
    return {
      rarity: 'Common',
      name: 'Planetary Supply Crate',
      description: `Emergency funds granted: +${cash} Cash`,
      cash,
    };
  } else if (roll < 75) {
    // Uncommon 25%
    const cash = 70 + Math.floor(Math.random() * 50);
    const gems = 1 + Math.floor(Math.random() * 2);
    return {
      rarity: 'Uncommon',
      name: 'Advanced Tactical Drop',
      description: `Valuable munitions: +${cash} Cash & +${gems} Gems`,
      cash,
      gems,
    };
  } else if (roll < 90) {
    // Rare 15% — pool widened with the new cosmetic families
    const skins = ['cannon_neon', 'base_aegis', 'proj_plasma', 'cannon_crimson', 'proj_ion', 'base_solar'];
    const skinId = skins[Math.floor(Math.random() * skins.length)];
    return {
      rarity: 'Rare',
      name: 'Cybernetic Tech Prototype',
      description: 'Exclusive vanity skin component unlocked!',
      skinId,
      gems: 3,
    };
  } else if (roll < 98) {
    // Epic 8%
    return {
      rarity: 'Epic',
      name: 'Orbital Core Overcharge',
      description: 'Armory Booster + 5 Gems + 210 Cash Cache!',
      cash: 210,
      gems: 5,
      special: 'Orbital Battery Primed',
    };
  } else {
    // Legendary 2%
    return {
      rarity: 'Legendary',
      name: '★ TITAN STELLAR JACKPOT ★',
      description: 'Cosmic Singularity Vault: +15 Gems & +600 Cash!',
      cash: 600,
      gems: 15,
      special: 'Legendary Gold Armor unlocked',
    };
  }
}
