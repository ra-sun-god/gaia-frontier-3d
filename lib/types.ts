// Types and interfaces for Gaia Frontier: After Contact

export type WeaponId = 'cannon' | 'machinegun' | 'laser' | 'missiles' | 'emp' | 'orbital';

/** Run mode — the arcade cabinet's three cabinets-in-one. */
export type GameMode = 'campaign' | 'bossRush' | 'endless';

/**
 * Weapon mark level. UNLIMITED: any integer >= 1 (Mk4, Mk5, ... forever).
 * Stats and costs follow the shared exponential curves in lib/storage.ts
 * (weaponStatsAtTier / getWeaponUpgradeCost) so every upgrade keeps paying
 * off in high waves instead of hitting a hard Mk3 ceiling.
 */
export type WeaponTier = number;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  bestAgainst: string;
  unlockCostCash: number;
  unlockCostGems: number;
  unlocked: boolean;
  tier: WeaponTier;
  fireRate: number; // shots per second
  damage: number;
  projectileSpeed: number;
  color: string;
  /** Base price for the Mk1 → Mk2 upgrade; every further level multiplies
   *  the price by getWeaponUpgradeCost()'s growth factor (see storage.ts). */
  upgradeCost: number;
  cooldown?: number; // for special weapons like EMP / Orbital
  lastFired?: number;
}

export type ThreatType =
  // Environmental
  | 'gravity_well'
  | 'ice_comet'
  | 'fire_meteor'
  | 'emp_asteroid'
  | 'asteroid_large'
  | 'asteroid_small'
  | 'debris_junk'
  // Alien / Enemy
  | 'scout'
  | 'shielded_trooper'
  | 'swarm_pod'
  | 'mini_drone'
  | 'sniper_ship'
  | 'healer_ship'
  | 'phase_ghost'
  | 'magnet_drone'
  | 'alien_hoverbike'
  // Late-era hostiles (Eras 11-15)
  | 'plasma_raider'
  | 'chrono_wraith'
  | 'void_cruiser'
  // Boss ordnance
  | 'hypersonic_missile'
  // Advanced alien ordnance (munitions)
  | 'cluster_bomb'      // airburst cluster munition — defuse it before the split
  | 'cluster_bomblet'   // scattered submunition released by the airburst
  | 'mirv_warhead'      // guided MIRV parent — splits into 3 seekers
  | 'railgun_slug'      // hypervelocity kinetic dart — snap-shot intercept
  | 'plasma_torpedo'    // slow homing energy torpedo — leaves a plasma pool
  // Advanced alien tech
  | 'siege_carrier'     // drone-launching mothership — priority target
  | 'tesla_node'        // chain-lightning arc satellite — shocks the turret
  | 'hunter_killer'     // lock-on stalker — tracks, then boost-dives
  | 'mirror_shade'      // holographic decoy pair — spot the flicker tell
  // Special / Event
  | 'mini_boss'
  | 'era_boss'
  | 'stealth_threat'
  | 'kamikaze'
  // Deception
  | 'fake_goodie'
  | 'void_orb';

export interface AlienPilotInfo {
  name: string;
  title: string;
  species: string;
  avatarIcon: string;
  skinColor: string;
  eyeColor: string;
  shipTheme: string;
  dialogueEncounter: string;
  dialogueDefeated: string;
}

export interface Threat {
  /** Monotonic entity id (numeric — cheap to compare, zero string
   *  allocation per spawn; replaces Math.random().toString() ids whose
   *  per-spawn strings + per-frame parseFloat parses fed GC pressure). */
  id: number;
  type: ThreatType;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  shieldHp: number;
  maxShieldHp: number;
  damageToBase: number;
  cashReward: number;
  scoreReward: number;
  color: string;
  angle: number;
  rotationSpeed: number;
  isBoss?: boolean;
  bossPhase?: number;
  maxBossPhases?: number;
  bossEraNumber?: number;
  alienPilot?: AlienPilotInfo;
  specialTimer?: number;
  isPhasedOut?: boolean;
  isStealth?: boolean;
  isFrozen?: boolean;
  freezeTimer?: number;
  sniperCharge?: number;
  splitCount?: number;
  hoverbikeTilt?: number;
  /** Chrono wraith: charges a short-range blink teleport. */
  blinkTimer?: number;
  /** Void cruiser: bombardment charge while it lingers at range. */
  bombardCharge?: number;
  /** Evasive AI: cooldown until this craft can juke again (seconds). */
  dodgeCd?: number;
  /** Evasive AI: archetype base chance to dodge an incoming round (0-1).
   *  Effective dodge odds scale with the player's firepower level. */
  evasionSkill?: number;
  /** Hypersonic missile: phase offset of the terminal-guidance jink weave. */
  missileWeavePhase?: number;
  /** Cluster bomb: time remaining until the airburst scatters its bomblets. */
  clusterFuse?: number;
  /** Siege carrier: cooldown until it launches the next hangar drone. */
  launchCd?: number;
  /** Tesla node: charge accumulated toward the next turret arc-zap. */
  teslaCharge?: number;
  /** Hunter killer: seconds of lock-on tracking left before the dive. */
  lockOnTimer?: number;
  /** Hunter killer: committed to the terminal boost-dive. */
  isDiving?: boolean;
  /** Mirror shade: this copy is the holographic decoy (dies to one hit). */
  isHoloDecoy?: boolean;
  /**
   * ELITE champion modifier — rare golden variants of any hostile craft:
   * reinforced hull, hotter descent, triple bounty, guaranteed goodie drop.
   */
  isElite?: boolean;
  /** Timestamp (performance.now/1000) of the last damage taken — drives
   *  boss shield regeneration when left unmolested. */
  lastDamagedAt?: number;
  /** Precomputed per-craft random phase (0-10) for sine-weave motion.
   *  Replaces per-frame parseFloat(id) string parsing in the hot loop. */
  phaseSeed?: number;
}

export type GoodieType =
  | 'cash_orb'
  | 'shield'
  | 'fire_rate'
  | 'bomb'
  | 'repair'
  | 'auto_aim'
  | 'slow_mo';

export interface Goodie {
  id: number;
  type: GoodieType;
  x: number;
  y: number;
  vy: number;
  radius: number;
  color: string;
  glowColor: string;
  icon: string;
  name: string;
  duration: number; // in seconds if applicable
}

export interface ActiveBuff {
  type: GoodieType;
  expiresAt: number;
  duration: number;
}

export interface Projectile {
  id: number;
  weaponId: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierceRemaining: number;
  splashRadius: number;
  isEmp: boolean;
  isOrbital: boolean;
  color: string;
  length?: number;
  targetId?: number; // for homing missiles
  /** Frag grenade: lobbed ballistic arc that detonates at its target point. */
  isGrenade?: boolean;
  /** Gravity accel applied per second (grenade arc). */
  gravity?: number;
  /** Time-to-live before forced detonation (grenade fuse). */
  fuseTime?: number;
  /** Detonation blast radius (grenade). */
  blastRadius?: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  sparkle?: boolean;
}

export interface FloatingText {
  id: number;
  text: string;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  color: string;
  scale: number;
}

export interface GroundHazard {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
  maxDuration: number;
  dps: number;
}

export interface EraInfo {
  eraNumber: number;
  name: string;
  description: string;
  palette: {
    bgTop: string;
    bgBottom: string;
    starsColor: string;
    ambientGlow: string;
  };
  allowedThreats: ThreatType[];
}

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  target: number;
  current: number;
  completed: boolean;
  claimed: boolean;
  rewardCash: number;
  rewardGems: number;
  type: 'kill_scouts' | 'combo_streak' | 'survive_waves' | 'use_orbital' | 'perfect_wave';
}

export interface SkinItem {
  id: string;
  type: 'cannon' | 'base' | 'projectile';
  name: string;
  costGems: number;
  unlocked: boolean;
  color: string;
  previewClass: string;
}

export interface PlayerProfile {
  cash: number;
  gems: number;
  highScore: number;
  highestWave: number;
  bestStreak: number;
  totalRuns: number;
  bossesDefeated: number;
  /** LEGACY — superseded by hullExtensionSteps; kept only so old local/cloud
   *  saves round-trip without breaking. */
  baseMaxHp: number;
  /** True once the first-contact story intro has been watched (first PLAY). */
  storyIntroSeen: boolean;
  /**
   * HULL EXPANSION DOCTRINE — permanent Citadel reinforcement steps bought
   * with cash (expensive, escalating). Each step raises the hull ceiling by
   * 25%: 100 → 125 → 150 → 175 → … (see getHullMaxHp in storage.ts).
   * Hull only ever goes DOWN from impacts; it creeps back via slow field
   * nano-repair, and returns FAST only through rewarded ads or purchases.
   */
  hullExtensionSteps: number;
  equippedSkins: {
    cannon: string;
    base: string;
    projectile: string;
  };
  unlockedSkins: string[];
  weapons: Record<WeaponId, { unlocked: boolean; tier: WeaponTier }>;
  idleCollectorLevel: number;
  lastIdleCollectedAt: number;
  lastDailyBoxClaimedAt: number;
  battlePassTier: number;
  battlePassXp: number;
  battlePassClaimedTiers: number[];
  isBattlePassPremium: boolean;
  hasPurchasedStarterPack: boolean;
  /** Daily login-streak length (loss-aversion retention hook). */
  dailyStreak: number;
  /** Day stamp (YYYYMMDD) of the last claimed daily streak reward. */
  lastDailyClaimDay: number;
  /** Day stamp of the last free Daily Boss Rush entry. */
  lastBossRushDay: number;
  /** Deepest Boss Rush stage ever survived. */
  bossRushBestStage: number;
  /** Deepest wave ever reached in Endless Gauntlet mode. */
  endlessBestWave: number;
  /** COMBAT RESPONSE PROTOCOL — purchased adrenaline refill-speed steps
   *  (+25% gain each, max 4 → ×2.0). Persistent like hull reinforcement. */
  adrenalineGainSteps: number;
}

export type MysteryBoxRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

export interface MysteryBoxReward {
  rarity: MysteryBoxRarity;
  name: string;
  description: string;
  cash?: number;
  gems?: number;
  skinId?: string;
  special?: string;
}
