import {
  WeaponId,
  WeaponDef,
  Threat,
  ThreatType,
  Goodie,
  GoodieType,
  Projectile,
  Particle,
  FloatingText,
  GroundHazard,
  ActiveBuff,
  EraInfo,
  PlayerProfile,
  GameMode,
} from './types';
import { sound } from './audio';
import { haptics } from './haptics';
import { getEraInfo } from './eras';
import { getEraBossConfig } from './bossData';
import {
  INITIAL_WEAPONS,
  FREE_SPECIAL_CHARGES,
  weaponStatsAtTier,
  MAX_WEAPON_TIER,
  KILL_CASH_MULTIPLIER,
  BOSS_GEM_REWARDS,
  getHullMaxHp,
  getAdrenalineGainMultiplier,
} from './storage';
import { renderEnemyAsset, drawDangerTelegraphs, setRenderQuality, qBlur } from './enemyRenderer';
import { getSkinColor } from './skins';
import { CANVAS_CONTEXT_OPTS } from './utils';

/**
 * Archetype dodge aptitude (0-1). Piloted craft juke incoming rounds —
 * rocks, pods and hulks just plow straight. The EFFECTIVE odds also scale
 * with the player's firepower (see updateEvasion): a Mk1 cannon faces
 * near-clumsy pilots, a maxed arsenal faces ace fliers.
 */
const EVASION_SKILL: Partial<Record<ThreatType, number>> = {
  plasma_raider: 0.9,
  alien_hoverbike: 0.85,
  scout: 0.8,
  chrono_wraith: 0.75,
  hunter_killer: 0.78,
  mini_drone: 0.7,
  stealth_threat: 0.65,
  kamikaze: 0.6,
  mirror_shade: 0.7,
  phase_ghost: 0.5,
  shielded_trooper: 0.5,
  sniper_ship: 0.35,
  tesla_node: 0.3,
  healer_ship: 0.3,
  plasma_torpedo: 0.25,
  void_cruiser: 0.2,
  siege_carrier: 0.12,
};

/**
 * Firing-volley geometry — hoisted module constants. Every shot used to
 * allocate a fresh offsets array PLUS a forEach closure per barrel stream
 * (auto-fire calls tryShoot every single frame, so that was a steady
 * allocation stream for the GC). These tables are shared and immutable.
 */
const OD_SPREAD = [-0.14, 0, 0.14];
const VOLLEY_OFFSETS = {
  /** cannon: linked barrels at ±8px */
  cannon: { 1: [0], 2: [-8, 8], 3: [-8, 0, 8] } as Record<number, number[]>,
  /** gatling: stream spread at ±6px */
  machinegun: { 1: [0], 2: [-6, 6], 3: [-6, 0, 6] } as Record<number, number[]>,
  /** laser: parallel beams at ±7px */
  laser: { 1: [0], 2: [-7, 7], 3: [-7, 0, 7] } as Record<number, number[]>,
};

export interface GameEngineCallbacks {
  onScoreUpdate: (score: number) => void;
  onCashUpdate: (cashEarned: number, totalCash: number) => void;
  onGemsUpdate: (gemsEarned: number, totalGems: number) => void;
  onHealthUpdate: (current: number, max: number, shield: number) => void;
  onWaveComplete: (wave: number, waveStats: { cashEarned: number; kills: number }) => void;
  onGameOver: (stats: {
    score: number;
    waveReached: number;
    cashEarned: number;
    /** Total gems earned across the run (GA game_over report). */
    gemsEarned: number;
    bestStreak: number;
    bossesDefeated: number;
    kills: number;
    /** Which cabinet the run played on (mode-specific record keeping). */
    gameMode?: GameMode;
  }) => void;
  onComboUpdate: (combo: number, multiplier: number) => void;
  onBuffsUpdate: (buffs: ActiveBuff[]) => void;
  onEraChange: (era: EraInfo) => void;
  onBossEncounter: (boss: Threat | null) => void;
  /** GA telemetry: fires at the exact instant a boss dies (before the
   *  encounter-clear) so the shell can report boss_defeated precisely —
   *  onBossEncounter(null) alone can't distinguish death from wave reset. */
  onBossDefeated?: (info: { bossName: string; eraNumber: number; wave: number }) => void;
  onThreatKilled?: (threatType: ThreatType) => void;
  onAdrenalineUpdate?: (adrenaline: number, isOverdrive: boolean) => void;
  /**
   * Combat-drive heartbeat (5 Hz) feeding the soundtrack's adrenaline
   * intensity: rush meter, overdrive, boss phase, hull ratio. The era track
   * escalates through RUSH/SURGE/OVERDRIVE tiers as the fight heats up.
   */
  onCombatDrive?: (state: {
    adrenaline: number;
    overdrive: boolean;
    bossPhase: number;
    bossActive: boolean;
    hpRatio: number;
  }) => void;
  /** Fired on every wave setup so the React shell can track the live wave number. */
  onWaveChange?: (wave: number) => void;
  /**
   * ADAPTIVE QUALITY GOVERNOR (GPU optimization): fires when the sustained
   * frame-time budget slips (level 1 = glow-reduced, 2 = minimal) or recovers
   * back to 0 (full detail). The shell reacts by re-scaling the canvas DPR so
   * weak GPUs stop falling behind the mouse.
   */
  onQualityLevel?: (level: number) => void;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: GameEngineCallbacks;

  // Logical coordinate space — adaptive full-bleed viewport.
  // Base playfield is 450x800 (mobile portrait standard); taller screens
  // gain logical height, wider screens gain logical width (true
  // shape-of-device). Updated via setViewport(); hostile traffic is
  // additionally confined to the combat corridor below on wide fields.
  public L_WIDTH = 450;
  public L_HEIGHT = 800;

  // -----------------------------------------------------------------------
  // COMBAT CORRIDOR — widescreen gameplay containment. The starfield and
  // the planetary horizon still span the FULL logical width (true
  // shape-of-device fullscreen), but on wide screens (desktops, laptops,
  // landscape tablets) all hostile traffic is confined to a centered band
  // comfortably inside the globe's crown. The turret is a FIXED emplacement
  // at field center: on a ~1400-logical-wide desktop field, far-flank
  // spawns forced endless re-aiming at unreachable angles. The corridor is
  // the full field width on phones/tablets (min(450..640, 640)) and caps at
  // 640 logical px on any wider display — roughly the classic cabinet feel,
  // scaled up. See corridorX()/clampCorridor() for every spawn/drift clamp.
  // -----------------------------------------------------------------------
  public corridorHalf = 225;

  // Game state
  public isRunning: boolean = false;
  public isPaused: boolean = false;
  public currentWave: number = 1;
  public score: number = 0;
  public runCashEarned: number = 0;
  public runGemsEarned: number = 0;
  public runKills: number = 0;
  public runBossesDefeated: number = 0;
  /** Run-total snapshots taken at wave start so onWaveComplete can report
   *  true per-wave deltas (the callback contract) instead of run totals. */
  private waveStartCash: number = 0;
  private waveStartKills: number = 0;

  // Player & Base stats
  public maxBaseHp: number = 100;
  public currentBaseHp: number = 100;
  public currentShieldHp: number = 0;
  /** Seconds since the hull last took damage — gates the slow nano-repair. */
  private hullGraceTimer: number = 0;
  /** Last hull integer broadcast (throttles nano-repair HUD updates). */
  private lastBroadcastHullInt: number = -1;
  public maxShieldHp: number = 100;
  public isCannonFrozen: boolean = false;
  public freezeTimer: number = 0;
  public empJamTimer: number = 0;
  /** Tesla arc-zap status: turret circuits stunned (firing disabled). */
  public shockTimer: number = 0;

  /**
   * Consumable ammo for the special weapons. Refilled ONLY at run start
   * with the free starting allowance — never auto-refilled mid-run. Extra
   * charges are bought with cash via addSpecialCharge() (see page/HUD), or
   * earned via rewarded ads (see page RewardedAdOffer).
   */
  public specialCharges: { emp: number; orbital: number; grenade: number } = { ...FREE_SPECIAL_CHARGES };
  public voidFogTimer: number = 0;

  /** Low-HP alarm latch — fires the haptic warning once per dangerous dip. */
  private lowHpAlarmFired: boolean = false;

  // Cannon Aim & Firing
  public cannonX: number = 225;
  public cannonY: number = 615;
  public aimAngle: number = -Math.PI / 2; // facing straight up
  public autoFireEnabled: boolean = true;
  private lastFireTime: number = 0;
  public recoilOffset: number = 0;

  // Active Weapon & Inventory
  public activeWeaponId: WeaponId = 'cannon';
  public weapons: Record<WeaponId, WeaponDef>;
  public specialCooldowns: { emp: number; orbital: number; grenade: number } = { emp: 0, orbital: 0, grenade: 0 };

  // Combo Streak
  public comboStreak: number = 0;
  public bestStreakInRun: number = 0;

  // Adrenaline Rush & Overdrive State
  public adrenaline: number = 0; // 0 to 100
  public isOverdrive: boolean = false;
  public overdriveTimer: number = 0;
  public hitStopTimer: number = 0;
  /** 5 Hz throttle for the onCombatDrive soundtrack heartbeat. */
  private combatDriveTimer: number = 0;

  /**
   * ADRENALINE REFILL SPEED — permanent purchasable upgrade (Combat Response
   * Protocol, +25% gain per level, max ×2.0). Multiplies every adrenaline
   * event through the single increaseAdrenaline funnel: kills, crits, shield
   * breaks, intercepts, stims and rewarded-ad rushes all fill faster.
   */
  public adrenalineGainMultiplier: number = 1;

  // Entities
  // Entity arrays — public read access for the external 3D renderer
  // (lib/three/world.ts), which paints these same simulation objects.
  public threats: Threat[] = [];
  public goodies: Goodie[] = [];
  public projectiles: Projectile[] = [];
  public floatingTexts: FloatingText[] = [];
  public groundHazards: GroundHazard[] = [];
  private activeBuffs: Map<GoodieType, ActiveBuff> = new Map();
  private lastBuffsSignature = '';

  // -----------------------------------------------------------------------
  // PARTICLE POOL — the mobile RAM/GC governor. Late-run screens once
  // queued 800-1200 LIVE particles: every one a fresh heap allocation,
  // removal was splice churn, and the SIMULATION (not just the render)
  // iterated all of them — the GC spiral behind the wave-21+ input lag.
  // The pool preallocates a fixed block; spawn recycles slots (round-robin
  // eviction when full, so bursts always land), death compacts in place.
  // Zero allocations, zero splices in the per-frame path.
  // -----------------------------------------------------------------------
  public particles: Particle[] = []; // retained as the pool storage
  public pLive = 0; // live particle count (particles[0..pLive) are active)
  private pEvict = 0; // round-robin cursor when the pool is at cap
  private particleCap = 520; // scaled by quality tier (see setQualityLevel)
  /** Monotonic entity id source — every threat/projectile/goodie/hazard/
   *  floating-text gets a number from here. Replaces the old
   *  Math.random().toString() ids: those allocated a fresh string per spawn
   *  (constant GC chatter under auto-fire) and forced parseFloat parses in
   *  per-frame movement code. Numeric ids compare in one instruction. */
  private nextEntityId = 1;
  /** Projectile object pool — fired rounds are recycled instead of dropped
   *  for the GC to sweep. With auto-fire running every frame this keeps the
   *  hot path allocation-free (steady state reuses the same few dozen
   *  objects no matter how long the run lasts). */
  private projFree: Projectile[] = [];
  /** Buffs signature is only rebuilt when the buff set actually changes
   *  (add / expire) or twice a second for countdown display — it used to
   *  allocate Array.from + map + joined strings EVERY frame. */
  private buffsDirty = true;
  private buffsSigTimer = 0;
  /** Gravity wells / void orbs on the field, refreshed once per frame —
   *  projectile attraction reads this tiny list instead of a closure-scan
   *  over every threat for every projectile. */
  private activeWells: Threat[] = [];

  // Wave Spawner State
  public waveThreatsTotal: number = 12;
  public waveThreatsSpawned: number = 0;
  public isWaveIntermission: boolean = false;
  private spawnTimer: number = 0;
  private nextSpawnInterval: number = 1.2;
  public currentEra: EraInfo;
  public activeBoss: Threat | null = null;
  private isSupplyDropWave: boolean = false;

  // -----------------------------------------------------------------------
  // RUN MODES — three cabinets in one arcade:
  //   campaign : the classic 15-era invasion road with supply drops.
  //   bossRush : DAILY gauntlet — every wave is an era-boss stage, double
  //              score, double boss gem bounty. Short, violent, leaderboard
  //              catnip (variable-reward + mastery replay loops).
  //   endless  : Endless Gauntlet — compressed pacing, near-constant field
  //              mutators, +25% bodies, ×1.5 score. The “one more run” mode.
  // -----------------------------------------------------------------------
  public gameMode: GameMode = 'campaign';
  /** Score & wave-bonus multiplier granted by the run mode (1 / 2 / 1.5). */
  public scoreMultiplier: number = 1;

  // -----------------------------------------------------------------------
  // STARFALL CATASTROPHE — the fake-orb betrayal. Shooting the deception
  // core detonates it into a dozen white-hot shooting stars that arc up,
  // then rain back down on Gaia at terminal velocity. Every shard that
  // lands burns the hull, shakes the screen and vibrates the phone — the
  // deception must HURT so players learn to read the tell (fear → mastery
  // loop) while the spectacle stays gorgeous enough to be "worth it".
  // -----------------------------------------------------------------------
  public starfallShards: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Homing pull toward a randomized splash band on the planet. */
    targetX: number;
    /** Y coordinate where the shard hits the atmosphere band. */
    impactY: number;
    /** Seconds until the shard starts its terminal plunge. */
    fuse: number;
    /** Accumulating plunge speed (accelerates to ~660 px/s). */
    plungeSpeed: number;
  }> = [];

  // -----------------------------------------------------------------------
  // Field variety system — anti-boredom machinery.
  // ELITE champions: rare golden variants of regular hostiles (reinforced
  // hull, hotter descent, TRIPLE bounty + guaranteed goodie) so every spawn
  // roll carries a jackpot chance (variable-reward psychology).
  // Wave mutators: non-boss waves can roll SWARM / ELITE HUNT / BLITZ to
  // change the texture of a wave instead of only its numbers.
  // -----------------------------------------------------------------------
  public waveMutator: 'none' | 'swarm' | 'elite' | 'blitz' = 'none';
  private eliteChance: number = 0.06;

  // Visuals & Parallax
  private stars: Array<{ x: number; y: number; size: number; speed: number; alpha: number }> = [];
  public screenShake: number = 0;
  private lastTime: number = 0;
  private animFrameId: number | null = null;
  private profile: PlayerProfile;

  // -------------------------------------------------------------------------
  // ADAPTIVE QUALITY GOVERNOR — the "mouse lags sometimes" fix.
  //
  // The threat renderer's shadowBlur rasterization + per-frame gradient
  // construction is the heaviest GPU load in the game; during crowded waves
  // the render loop overshoots the 16.7ms 60Hz budget, input events queue up
  // behind the long frames and the turret aim visibly trails the cursor.
  //
  // The governor samples a rolling average of rAF frame intervals every
  // frame and walks a 3-step quality ladder with hysteresis + cooldown:
  //   level 0  full detail (legacy look — shadowBlur glows, all particles)
  //   level 1  glow-reduced (all shadowBlur flattened via qBlur(), particle
  //            render cap halved) — the visual delta is subtle, the GPU
  //            cost collapses
  //   level 2  minimal (crisis: tighter particle cap AND the shell drops the
  //            canvas backing-store DPR to ~1.3 so fill cost shrinks ~2.3x)
  // Recovery is deliberately lazier than degradation (8s of healthy frames
  // vs 1.2s of struggling) so the tier never oscillates mid-firefight.
  // -------------------------------------------------------------------------
  public renderQuality: number = 0;
  private frameAvgMs: number = 16.7;
  /** Running estimate of the display's refresh interval (snaps down to the
   *  fastest observed frames, drifts back up slowly) — a 30Hz phone must not
   * be misread as a struggling 60Hz machine. */
  private refreshMs: number = 16.7;
  private qualityHoldUntil: number = 0; // performance.now() timestamp
  private qualityUpStreak: number = 0;

  // Pre-rendered sky layers (rebuilt only on era / viewport change):
  //   bgCache    : the full-viewport era gradient — one fillRect of a cached
  //                bitmap instead of a per-frame createLinearGradient + fill
  //   starTiles  : two parallax starfield tiles (far/near) — classic scrolling
  //                wrap via 4 drawImage calls instead of ~240 per-star
  //                globalAlpha+fillRect state changes every frame
  private bgCache: HTMLCanvasElement | null = null;
  private bgCacheKey = '';
  private starTiles: Array<{ canvas: HTMLCanvasElement; speed: number; offset: number }> = [];

  // Resolved cosmetic skin colors — equipped skins now actually render
  public skinColors: { cannon: string; base: string; projectile: string };

  // ---------------------------------------------------------------------------
  // Planet artwork cache — the bottom-of-screen globe is composited from
  // offscreen layers so the per-frame cost is a handful of drawImage calls:
  //   surface strip  : ocean + procedural continents + polar cap (rotates)
  //   cloud strip    : soft cloud puffs (drifts slightly faster — parallax)
  //   shade overlay  : fixed spherical shading — limb darkening + terminator
  //   glint overlay  : fixed specular ocean highlight + lit-pole brightening
  //   cities         : night-side city lights riding the rotating surface
  // Rebuilt only when the viewport geometry (or skin tint) changes.
  // ---------------------------------------------------------------------------
  private planetArtKey = '';
  private planetArt: {
    surface: HTMLCanvasElement;
    clouds: HTMLCanvasElement;
    shade: HTMLCanvasElement;
    glint: HTMLCanvasElement;
    stripW: number;
    stripH: number;
    cities: Array<{ sx: number; sy: number; phase: number; speed: number; size: number }>;
  } | null = null;

  /** Deterministic PRNG so Earth looks identical every run (it's "home"). */
  private mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Trace one smooth irregular landmass blob (quadratic curves through
   * edge midpoints → organic coastline). `scale` > 1 grows the blob for the
   * coastal-shelf halo pass.
   */
  private traceBlobPath(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    pts: Array<{ a: number; r: number }>,
    scale: number
  ) {
    const n = pts.length;
    const px = (i: number) => cx + Math.cos(pts[i % n].a) * pts[i % n].r * scale;
    const py = (i: number) => cy + Math.sin(pts[i % n].a) * pts[i % n].r * scale;
    ctx.beginPath();
    ctx.moveTo((px(0) + px(1)) / 2, (py(0) + py(1)) / 2);
    for (let i = 1; i <= n; i++) {
      const midX = (px(i) + px(i + 1)) / 2;
      const midY = (py(i) + py(i + 1)) / 2;
      ctx.quadraticCurveTo(px(i), py(i), midX, midY);
    }
    ctx.closePath();
  }

  /** Build every offscreen planet layer for the current geometry. */
  private buildPlanetArt(earthR: number) {
    const rand = this.mulberry32(0x1a2b3c4d);
    const SW = Math.ceil(earthR * 4);
    // Only the top ~190px of the sphere is ever on screen (the rest is below
    // the canvas bottom edge), so the strips stop shortly past that band.
    // Radial gradients below use sphere-relative centers (which may lie OUTSIDE
    // the canvas) so the fixed overlays still align with the full sphere.
    const SH = Math.min(Math.ceil(earthR * 2), 250);

    const mkCanvas = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };

    // --- Surface strip: vertical ocean gradient (horizontal wrap safe) ---
    const surface = mkCanvas(SW, SH);
    const sctx = surface.getContext('2d')!;
    const ocean = sctx.createLinearGradient(0, 0, 0, SH);
    ocean.addColorStop(0, '#1279b3');
    ocean.addColorStop(0.45, '#0b619b');
    ocean.addColorStop(1, '#073b63');
    sctx.fillStyle = ocean;
    sctx.fillRect(0, 0, SW, SH);

    // Procedural continents — 6 landmasses with coastal shelves, distributed
    // along the strip (each also drawn at ±SW so the wrap is seamless).
    const blobs: Array<{
      x: number;
      y: number;
      pts: Array<{ a: number; r: number }>;
      cities: Array<{ dx: number; dy: number; size: number }>;
    }> = [];
    for (let i = 0; i < 6; i++) {
      const cx = (i / 6) * SW + rand() * (SW / 10);
      const cy = 16 + rand() * (earthR * 0.42);
      const base = earthR * (0.16 + rand() * 0.2);
      const n = 11 + Math.floor(rand() * 5);
      const pts: Array<{ a: number; r: number }> = [];
      for (let v = 0; v < n; v++) {
        pts.push({ a: (v / n) * Math.PI * 2 + rand() * 0.35, r: base * (0.55 + rand() * 0.6) });
      }
      const cities: Array<{ dx: number; dy: number; size: number }> = [];
      const cityCount = 3 + Math.floor(rand() * 3);
      for (let c = 0; c < cityCount; c++) {
        const a = rand() * Math.PI * 2;
        const d = base * (0.25 + rand() * 0.45);
        cities.push({
          dx: Math.cos(a) * d,
          dy: Math.sin(a) * d * 0.8,
          size: 1.7 + rand() * 1.9,
        });
      }
      blobs.push({ x: cx, y: cy, pts, cities });
    }

    for (const offsets of [0, -SW, SW]) {
      for (const b of blobs) {
        // Coastal shelf halo (shallow water tint) under each landmass
        this.traceBlobPath(sctx, b.x + offsets, b.y, b.pts, 1.22);
        sctx.fillStyle = 'rgba(94, 197, 214, 0.30)';
        sctx.fill();
        // Landmass — two-stop vertical green gradient reads lush after shading
        const land = sctx.createLinearGradient(0, b.y - earthR * 0.35, 0, b.y + earthR * 0.35);
        land.addColorStop(0, '#4caf6d');
        land.addColorStop(1, '#1f7a40');
        this.traceBlobPath(sctx, b.x + offsets, b.y, b.pts, 1);
        sctx.fillStyle = land;
        sctx.fill();
        sctx.strokeStyle = 'rgba(8, 74, 52, 0.55)';
        sctx.lineWidth = 1.5;
        sctx.stroke();
        // Interior highlands hint
        this.traceBlobPath(sctx, b.x + offsets, b.y, b.pts, 0.55);
        sctx.fillStyle = 'rgba(124, 204, 128, 0.28)';
        sctx.fill();
      }
    }

    // Polar ice cap across the top of the strip (irregular soft edge)
    const cap = sctx.createLinearGradient(0, 0, 0, earthR * 0.34);
    cap.addColorStop(0, 'rgba(240, 250, 255, 0.95)');
    cap.addColorStop(0.55, 'rgba(228, 244, 255, 0.7)');
    cap.addColorStop(1, 'rgba(228, 244, 255, 0)');
    sctx.fillStyle = cap;
    sctx.fillRect(0, 0, SW, earthR * 0.34);
    for (let i = 0; i < 18; i++) {
      const x = (i / 18) * SW;
      sctx.beginPath();
      sctx.arc(x, earthR * 0.13, earthR * (0.06 + rand() * 0.08), 0, Math.PI * 2);
      sctx.fillStyle = 'rgba(238, 250, 255, 0.6)';
      sctx.fill();
    }

    // --- Cloud strip: soft multi-lobe puffs, seamless wrap ---
    const clouds = mkCanvas(SW, SH);
    const cctx = clouds.getContext('2d')!;
    for (let i = 0; i < 16; i++) {
      const x = (i / 16) * SW + rand() * 60;
      // Start below the polar cap so the ice always reads clearly
      const y = earthR * 0.15 + rand() * earthR * 0.5;
      const lobes = 3 + Math.floor(rand() * 3);
      for (const offsets of [0, -SW, SW]) {
        for (let l = 0; l < lobes; l++) {
          const lx = x + offsets + (rand() - 0.5) * earthR * 0.34;
          const ly = y + (rand() - 0.5) * earthR * 0.1;
          const lr = earthR * (0.07 + rand() * 0.11);
          const puff = cctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
          puff.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
          puff.addColorStop(0.6, 'rgba(255, 255, 255, 0.16)');
          puff.addColorStop(1, 'rgba(255, 255, 255, 0)');
          cctx.fillStyle = puff;
          cctx.beginPath();
          cctx.arc(lx, ly, lr, 0, Math.PI * 2);
          cctx.fill();
        }
      }
    }

    // --- Fixed spherical shade (multiplied over the rotating surface) ---
    // Gradient centers are SPHERE-relative (strip top = sphere apex), so they
    // stay correctly aligned with the planet even though the strip itself is
    // only the visible top band.
    const shade = mkCanvas(SW, SH);
    const shctx = shade.getContext('2d')!;
    const cxS = SW / 2;
    // Light pole at the crest (space side — where the threats come from):
    // brightest at the apex, falling off hard toward the left/right limbs
    // (the sphere-curvature cue) and into the lower terminator band.
    const limb = shctx.createRadialGradient(
      cxS,
      earthR * 0.35,
      earthR * 0.12,
      cxS,
      earthR * 0.35,
      earthR * 1.05
    );
    limb.addColorStop(0, 'rgba(255, 255, 255, 0)');
    limb.addColorStop(0.55, 'rgba(16, 42, 74, 0.10)');
    limb.addColorStop(0.8, 'rgba(8, 22, 48, 0.38)');
    limb.addColorStop(1, 'rgba(3, 10, 28, 0.82)');
    shctx.fillStyle = limb;
    shctx.fillRect(0, 0, SW, SH);

    // --- Fixed specular glint (screened on top — sun glinting off the ocean) ---
    const glint = mkCanvas(SW, SH);
    const gctx = glint.getContext('2d')!;
    const gx = cxS - earthR * 0.28;
    const gy = earthR * 0.38;
    const spec = gctx.createRadialGradient(gx, gy, 0, gx, gy, earthR * 0.75);
    spec.addColorStop(0, 'rgba(190, 232, 255, 0.34)');
    spec.addColorStop(0.35, 'rgba(150, 216, 250, 0.16)');
    spec.addColorStop(1, 'rgba(150, 216, 250, 0)');
    gctx.fillStyle = spec;
    gctx.fillRect(0, 0, SW, SH);

    // --- City lights riding the surface strip coordinates ---
    const cities: Array<{ sx: number; sy: number; phase: number; speed: number; size: number }> = [];
    for (const b of blobs) {
      for (const c of b.cities) {
        cities.push({
          sx: b.x + c.dx,
          sy: b.y + c.dy,
          phase: rand() * Math.PI * 2,
          speed: 1.5 + rand() * 2.5,
          size: c.size,
        });
      }
    }

    this.planetArt = { surface, clouds, shade, glint, stripW: SW, stripH: SH, cities };
  }

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: GameEngineCallbacks,
    profile: PlayerProfile
  ) {
    this.canvas = canvas;
    // Same attributes as GameCanvas's call (first call wins) — opaque +
    // desynchronized for the lowest possible input-to-photon latency
    const context = canvas.getContext('2d', CANVAS_CONTEXT_OPTS);
    if (!context) throw new Error('Cannot get 2d context');
    this.ctx = context;
    this.callbacks = callbacks;
    this.profile = profile;

    // Resolve equipped cosmetic skins into live render colors
    this.skinColors = {
      cannon: getSkinColor(profile.equippedSkins?.cannon, 'cannon', '#38bdf8'),
      base: getSkinColor(profile.equippedSkins?.base, 'base', '#0284c7'),
      projectile: getSkinColor(profile.equippedSkins?.projectile, 'projectile', '#38bdf8'),
    };

    // Clone weapons from definitions and apply profile unlocks / tiers
    this.weapons = JSON.parse(JSON.stringify(INITIAL_WEAPONS));
    Object.keys(this.weapons).forEach((id) => {
      const wid = id as WeaponId;
      if (profile.weapons[wid]) {
        this.weapons[wid].unlocked = profile.weapons[wid].unlocked;
        this.weapons[wid].tier = profile.weapons[wid].tier;
        this.applyTierStats(this.weapons[wid]);
      }
    });

    this.currentEra = getEraInfo(1);

    // HULL EXPANSION DOCTRINE (product spec v2):
    //   • The hull ceiling starts at 100% and is raised permanently via
    //     expensive shop-bought reinforcement steps (+25% each: 100 → 125 →
    //     150 → 175 → … — see applyHullExtension / getHullMaxHp).
    //   • Impacts only ever drive it DOWN — and every hit lands hard (×1.55
    //     HULL_STRESS) so defenders genuinely die (ad-revive economy).
    //   • SLOW field nano-repair creeps hull back (+0.8%/s after 4s clean) —
    //     deliberately glacial. FAST repair stays a paid/ad privilege:
    //     rewarded ads, Emergency Hull Refit, intermission repair, goodies.
    this.maxBaseHp = getHullMaxHp(profile.hullExtensionSteps);
    this.currentBaseHp = this.maxBaseHp;
    this.hullGraceTimer = 0;
    this.lastBroadcastHullInt = Math.round(this.currentBaseHp);

    // Combat Response Protocol: purchased adrenaline-gain steps carry into
    // every new run (like hull reinforcement steps)
    this.adrenalineGainMultiplier = getAdrenalineGainMultiplier(profile.adrenalineGainSteps || 0);

    this.initStars();
  }

  /**
   * Adapt the logical playfield to the physical canvas aspect (full-bleed, no
   * letterbox, TRUE shape-of-device). Wider-than-9:16 screens — tablets in
   * portrait, laptops, desktop monitors, landscape phones, ultrawides — gain
   * logical width without any cap, so the universe spans the entire screen.
   * Taller screens gain logical height. The cannon and Earth stay anchored to
   * the bottom edge and the planet widens with the field (see widthScale),
   * so gameplay balance (vertical descent timing) is preserved on every
   * aspect ratio while every pixel of the screen is used.
   */
  public setViewport(logicalW: number, logicalH: number) {
    const w = Math.max(450, logicalW);
    const h = Math.max(800, logicalH);
    if (w === this.L_WIDTH && h === this.L_HEIGHT) return;
    this.L_WIDTH = w;
    this.L_HEIGHT = h;
    this.cannonX = Math.round(w / 2);
    this.cannonY = h - 185;
    this.syncCorridor();
    // Re-seed the starfield so parallax covers the new logical area
    this.initStars();
    // Migrate any live traffic into the new corridor so a mid-run window
    // resize never strands hostiles out in the dead wings.
    this.threats.forEach((t) => {
      t.x = this.clampCorridor(t.x, t.radius);
    });
    this.goodies.forEach((g) => {
      g.x = this.clampCorridor(g.x, g.radius);
    });
    this.starfallShards.forEach((s) => {
      s.targetX = this.clampCorridor(s.targetX, 24);
    });
  }

  /** Recompute the combat corridor half-width for the current field. */
  private syncCorridor() {
    this.corridorHalf = Math.min(this.L_WIDTH, 640) / 2;
  }

  /** Random x INSIDE the combat corridor (margin from each edge). */
  private corridorX(margin = 35): number {
    const half = Math.max(margin, this.corridorHalf - margin);
    return this.L_WIDTH / 2 - half + Math.random() * half * 2;
  }

  /** Clamp an x into the combat corridor (margin from each edge). */
  private clampCorridor(x: number, margin = 0): number {
    const c = this.L_WIDTH / 2;
    return Math.max(c - this.corridorHalf + margin, Math.min(c + this.corridorHalf - margin, x));
  }

  /**
   * Recompute a weapon's live stats from its INITIAL_WEAPONS base for ANY
   * tier (unlimited Mk levels). Damage ×1.35 / fireRate ×1.20 compound per
   * level — identical to the old hardcoded Mk2/Mk3 values at tiers 2-3 and
   * scaling forever after, so upgrades keep helping in high waves.
   * Always recomputed from base (never incrementally) so it is idempotent —
   * safe to call repeatedly, e.g. on every mid-run upgrade.
   */
  private applyTierStats(w: WeaponDef) {
    const base = INITIAL_WEAPONS[w.id];
    if (!base) return;
    const stats = weaponStatsAtTier(base.damage, base.fireRate, w.tier);
    w.damage = stats.damage;
    w.fireRate = stats.fireRate;
  }

  // ---------------------------------------------------------------------------
  // ADAPTIVE DIFFICULTY — "the arsenal ladder"
  //
  // The invasion force studies the defender: powerFactor is the player's
  // best-gun DPS measured in Mk1-cannon units (28 dmg × 2.2/s ≈ 61.6 DPS →
  // factor 1.0). Because weapon marks compound EXPONENTIALLY (damage ×1.35
  // and fire rate ×1.20 per Mk), hostiles scale against the DPS ratio — not a
  // flat tier count — or a maxed gun would still melt every encounter
  // (the classic "boss dies in four seconds" failure mode).
  //
  // What it scales (see call sites):
  //   • threat HP/shields   ×(1 + 0.24·Δ)   (cap ×4.0)
  //   • threat descent speed ×(1 + 0.10·Δ) (cap ×1.8)
  //   • threat impact damage ×(1 + 0.05·Δ) (cap ×1.35)
  //   • evasive-dodge odds  — clumsy at Mk1, ace fliers by ~5× firepower
  //   • boss HP ×(1 + 0.75·Δ) era / ×0.62 mini (caps ×16 / ×13)
  //   • boss attack cadence up to ~2.6× faster; richer barrage patterns,
  //     bigger hypersonic volleys
  //
  // EMPOWERMENT DOCTRINE (product): the slopes above were DOUBLED vs the
  // original regime — every weapon mark the defender buys visibly hardens
  // the ENTIRE invasion (thicker hulls, hotter descents, heavier impacts),
  // so an upgraded arsenal never buys an easy field.
  // ---------------------------------------------------------------------------
  private powerCache = -1;

  /** Recompute the firepower read-out from the live weapon inventory. */
  private refreshPower() {
    let best = 0;
    (Object.keys(this.weapons) as WeaponId[]).forEach((id) => {
      const w = this.weapons[id];
      if (w && w.unlocked) best = Math.max(best, w.damage * w.fireRate);
    });
    // Reference: the fresh Mk1 Standard Cannon volley. factor 1.0 = starting
    // kit; 5.0 = the best gun hits five times harder than day one.
    this.powerCache = Math.max(1, best / 61.6);
  }

  /** Current adversary-response multiplier (1.0 for a fresh Mk1 cannon). */
  public get powerFactor(): number {
    if (this.powerCache < 0) this.refreshPower();
    return Math.min(this.powerCache, 30);
  }

  /**
   * Mid-run weapon upgrade (unlimited tiers): clamps, recomputes stats from
   * the shared curve, and surfaces the new mark level in-game. The React shell
   * calls this after persisting the new tier into the profile.
   */
  public setWeaponTier(id: WeaponId, tier: number) {
    const w = this.weapons[id];
    if (!w) return;
    const next = Math.max(1, Math.min(MAX_WEAPON_TIER, Math.floor(tier) || 1));
    if (next === w.tier) return;
    w.tier = next;
    this.applyTierStats(w);
    this.refreshPower(); // adversaries immediately respond to the new mark
    this.addFloatingText(`${w.name.toUpperCase()} MK${next} ONLINE`, this.cannonX, this.cannonY - 70, '#FAC602', 1.2);
  }

  private initStars() {
    this.stars = [];
    // Star count scales with logical area (density constant) so widescreen
    // desktop fields keep the same rich starfield instead of going sparse.
    const count = Math.min(240, Math.round(80 * (this.L_WIDTH * this.L_HEIGHT) / (450 * 800)));
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * this.L_WIDTH,
        y: Math.random() * this.L_HEIGHT,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 25 + 15,
        alpha: Math.random() * 0.7 + 0.3,
      });
    }
    this.buildStarTiles();
  }

  /**
   * Bake the starfield into two wrap-around parallax tiles (far = small/dim/
   * slow, near = brighter/faster). Render then blits each tile twice per
   * frame — 4 drawImage calls total — instead of touching ~240 individual
   * stars with per-star globalAlpha changes (the old path was one of the
   * per-frame state-change storms). Density, sizes, brightness distribution
   * and per-layer parallax speeds are all preserved.
   */
  private buildStarTiles() {
    const w = Math.max(1, Math.round(this.L_WIDTH));
    const h = Math.max(1, Math.round(this.L_HEIGHT));
    const color = this.currentEra.palette.starsColor;
    const far: Array<{ x: number; y: number; size: number; alpha: number }> = [];
    const near: Array<{ x: number; y: number; size: number; alpha: number }> = [];
    for (const s of this.stars) {
      if (s.size < 1.5 && s.alpha < 0.65) far.push(s);
      else near.push(s);
    }

    const makeTile = (layer: typeof far, defaultAlpha: number) => {
      const tile = document.createElement('canvas');
      tile.width = w;
      tile.height = h;
      const g = tile.getContext('2d');
      if (g) {
        g.fillStyle = color;
        for (const s of layer) {
          g.globalAlpha = Math.min(1, s.alpha * defaultAlpha);
          g.fillRect(Math.round(s.x), Math.round(s.y), Math.max(1, s.size), Math.max(1, s.size));
        }
      }
      return tile;
    };

    this.starTiles = [
      { canvas: makeTile(far, 0.85), speed: 18, offset: 0 }, // far layer drift
      { canvas: makeTile(near, 1.0), speed: 34, offset: 0 }, // near layer drift
    ];
  }

  // --- Game Lifecycle ---

  public startNewRun(mode: GameMode = 'campaign') {
    this.gameMode = mode;
    this.scoreMultiplier = mode === 'bossRush' ? 2 : mode === 'endless' ? 1.5 : 1;
    this.currentWave = 1;
    this.score = 0;
    this.runCashEarned = 0;
    this.runGemsEarned = 0;
    this.runKills = 0;
    this.runBossesDefeated = 0;
    this.currentBaseHp = this.maxBaseHp;
    this.currentShieldHp = 0;
    this.comboStreak = 0;
    this.bestStreakInRun = 0;
    this.isCannonFrozen = false;
    this.freezeTimer = 0;
    this.empJamTimer = 0;
    this.voidFogTimer = 0;
    this.shockTimer = 0;
    this.waveMutator = 'none';
    this.eliteChance = 0.06;
    this.starfallShards = [];
    // Fresh consumable allowance every run + clear stale cooldowns from a previous run
    this.specialCharges = { ...FREE_SPECIAL_CHARGES };
    this.specialCooldowns = { emp: 0, orbital: 0, grenade: 0 };
    this.activeBoss = null;
    this.adrenaline = 0;
    this.isOverdrive = false;
    this.overdriveTimer = 0;
    this.hitStopTimer = 0;
    this.lowHpAlarmFired = false;
    this.hullGraceTimer = 0;
    this.lastBroadcastHullInt = Math.round(this.currentBaseHp);
    this.combatDriveTimer = 0; // first soundtrack heartbeat fires immediately
    this.callbacks.onAdrenalineUpdate?.(0, false);

    this.threats = [];
    this.goodies = [];
    // Return any live rounds to the pool, then reassign the live array
    this.poolAllProjectiles();
    this.projectiles = [];
    // Particle POOL reset: keep the preallocated storage, rewind the cursor
    // (replacing the array would orphan the pool and re-leak allocations).
    this.pLive = 0;
    this.pEvict = 0;
    this.floatingTexts = [];
    this.groundHazards = [];
    this.activeWells.length = 0;
    this.activeBuffs.clear();
    this.buffsDirty = true; // run start: emit the empty buff set promptly

    this.setupWave(1);
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();

    sound.startMusic(this.currentEra.eraNumber);
    this.broadcastState();

    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.loop = this.loop.bind(this);
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  public revivePlayer() {
    // Re-entry guard: a double invoke (gem-revive racing the ad-revive path)
    // would queue a SECOND requestAnimationFrame chain — two loops running
    // means double dt integration, double spawns and double economy events.
    if (this.isRunning && this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
    this.currentBaseHp = Math.round(this.maxBaseHp * 0.6);
    this.currentShieldHp = 50;
    this.isRunning = true;
    this.isPaused = false;
    this.threats = []; // clear immediate board for safety
    this.poolAllProjectiles();
    this.projectiles = [];
    // The dead flagship is gone with the cleared board — drop the stale
    // reference too, or the !activeBoss spawn gate would block the boss
    // from ever (re)spawning for the rest of the wave AND the HUD would
    // keep rendering a health bar for a boss that no longer exists.
    this.activeBoss = null;
    this.callbacks.onBossEncounter(null);
    this.triggerNuke();
    this.addFloatingText('REVIVED! SHIELD ONLINE', this.L_WIDTH / 2, this.L_HEIGHT / 2, '#38bdf8', 1.5);
    this.broadcastState();
    this.lastTime = performance.now();
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    if (!this.isRunning) return;
    this.isPaused = false;
    this.lastTime = performance.now();
  }

  public stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    sound.stopMusic();
  }

  // --- Wave Setup & Scaling ---

  /**
   * CENTRAL impact pipeline: every screen-shake event in the game routes
   * through here so the device ALSO vibrates in sync (haptics.shakeSync,
   * disableable in Settings). Chaos moments — boss barrages, orbital strikes,
   * enrage phase-flips, base impacts — are now FELT, not just seen.
   */
  private shake(magnitude: number) {
    this.screenShake = Math.max(this.screenShake, magnitude);
    haptics.shakeSync(magnitude);
  }

  public setupWave(waveNumber: number) {
    this.currentWave = waveNumber;
    this.callbacks.onWaveChange?.(waveNumber);
    // Per-wave delta baselines (see onWaveComplete)
    this.waveStartCash = this.runCashEarned;
    this.waveStartKills = this.runKills;

    // ---------------------------------------------------------------------
    // BOSS RUSH — every stage is a Dreadnought climax. Stage n pits the
    // player against era ((n-1) % 15)+1's flagship: a tight escort screen,
    // no supply drops, no mutators. Era mapping: stage 1 → the wave-5 era-1
    // boss, stage 2 → era 2's flagship, … stage 16 wraps to era 1 again
    // (Convergence difficulty keeps climbing via the wave HP scale).
    // ---------------------------------------------------------------------
    if (this.gameMode === 'bossRush') {
      const eraWave = ((waveNumber - 1) % 15) * 5 + 5; // boss wave of target era
      this.currentEra = getEraInfo(eraWave);
      this.buildStarTiles(); // era palette changed — rebake the starfield
      sound.setEra(this.currentEra.eraNumber);
      this.callbacks.onEraChange(this.currentEra);
      this.refreshPower();
      this.isSupplyDropWave = false;
      this.eliteChance = Math.min(0.14, 0.08 + waveNumber * 0.002);
      this.waveMutator = 'none';
      this.waveThreatsTotal = 8 + Math.floor(waveNumber * 0.5); // slim escort screen
      this.waveThreatsSpawned = 0;
      this.isWaveIntermission = false;
      this.spawnTimer = 0;
      this.nextSpawnInterval = Math.max(0.4, 1.0 - waveNumber * 0.02);
      this.activeBoss = null;
      this.callbacks.onBossEncounter(null);
      sound.playBossAlarm();
      this.shake(15);
      const cfg = getEraBossConfig(this.currentEra.eraNumber);
      this.addFloatingText(
        `★ BOSS RUSH — STAGE ${waveNumber}: ${cfg.bossName} ★`,
        this.L_WIDTH / 2,
        200,
        cfg.color,
        1.5
      );
      return;
    }

    this.currentEra = getEraInfo(waveNumber);
    this.buildStarTiles(); // era palette changed — rebake the starfield
    sound.setEra(this.currentEra.eraNumber);
    this.callbacks.onEraChange(this.currentEra);

    // Refresh the firepower read-out every wave — catches unlocks bought in
    // the intermission shop (page mutates engine.weapons directly) so the
    // adaptive-difficulty ladder never runs on a stale value.
    this.refreshPower();

    // Supply drop wave every 5th wave before boss (e.g. wave 4, 9, 14, 19)
    this.isSupplyDropWave = waveNumber % 5 === 4;

    // ---------------------------------------------------------------------
    // FIELD VARIETY — anti-boredom mutators. Non-boss waves can roll a
    // texture change instead of just bigger numbers. Elite odds also creep
    // up with the wave so champions stay a steady heartbeat in late runs.
    // ENDLESS GAUNTLET: mutators roll on nearly every wave and the field
    // runs ~25% hotter — the compressed “one more run” pressure cooker.
    // ---------------------------------------------------------------------
    const isBossWave = waveNumber % 5 === 0 || waveNumber % 5 === 3;
    this.eliteChance =
      Math.min(0.1, 0.05 + waveNumber * 0.001) + (this.gameMode === 'endless' ? 0.03 : 0);
    this.waveMutator = 'none';
    if (!isBossWave && !this.isSupplyDropWave && waveNumber >= 2) {
      // Campaign: 42% of waves roll a texture change. Endless: EVERY non-boss
      // wave mutates (evenly spread across the three flavors) — the gauntlet.
      const mutRoll = Math.random();
      if (this.gameMode === 'endless') {
        if (mutRoll < 0.34) this.waveMutator = 'swarm';
        else if (mutRoll < 0.67) this.waveMutator = 'elite';
        else this.waveMutator = 'blitz';
      } else {
        if (mutRoll < 0.16) this.waveMutator = 'swarm';
        else if (mutRoll < 0.3) this.waveMutator = 'elite';
        else if (mutRoll < 0.42) this.waveMutator = 'blitz';
      }
    }
    if (this.waveMutator === 'elite') {
      this.eliteChance = 0.3;
    }

    // Substantial arcade wave pacing with proper enemy volume:
    // Wave 1: 22 threats, Wave 5: 34 threats, Wave 10: 48 threats, etc.
    // Mutators reshape the wave: SWARM = +35% bodies (lighter mix),
    // BLITZ = compressed intensity (faster spawns, slightly fewer bodies).
    const baseCount = this.isSupplyDropWave ? 18 : 22;
    let waveCount = baseCount + Math.floor((waveNumber - 1) * 3);
    if (this.gameMode === 'endless') waveCount = Math.round(waveCount * 1.25);
    if (this.waveMutator === 'swarm') waveCount = Math.round(waveCount * 1.35);
    else if (this.waveMutator === 'blitz') waveCount = Math.round(waveCount * 0.85);
    this.waveThreatsTotal = Math.min(90, waveCount);
    this.waveThreatsSpawned = 0;
    this.isWaveIntermission = false;
    this.spawnTimer = 0;
    this.nextSpawnInterval =
      Math.max(0.38, 1.1 - Math.min(0.6, waveNumber * 0.025)) * (this.gameMode === 'endless' ? 0.85 : 1);
    this.activeBoss = null;
    this.callbacks.onBossEncounter(null);

    // Check if this wave features an Era Boss (wave 5, 10, 15...) or Mini-Boss (wave 3, 8, 13...)
    const isEraBossWave = waveNumber % 5 === 0;
    const isMiniBossWave = waveNumber % 5 === 3;

    if (isEraBossWave || isMiniBossWave) {
      sound.playBossAlarm();
      this.shake(15);
      const title = isEraBossWave ? `★ ERA ${this.currentEra.eraNumber} DREADNOUGHT CLIMAX! ★` : '⚠ WARNING: VANGUARD DESTROYER!';
      this.addFloatingText(title, this.L_WIDTH / 2, 200, '#f43f5e', 1.4);
    } else if (this.isSupplyDropWave) {
      this.addFloatingText('★ ORBITAL SUPPLY DROP WAVE ★', this.L_WIDTH / 2, 200, '#fbbf24', 1.4);
      sound.playGoodie();
    } else if (this.waveMutator === 'swarm') {
      this.addFloatingText('🐝 SWARM ASSAULT — OVERWHELMING NUMBERS!', this.L_WIDTH / 2, 220, '#a3e635', 1.3);
      sound.playBossAlarm();
    } else if (this.waveMutator === 'elite') {
      this.addFloatingText('👑 ELITE HUNT — CHAMPIONS ON THE FIELD!', this.L_WIDTH / 2, 220, '#fbbf24', 1.3);
      sound.playBossAlarm();
    } else if (this.waveMutator === 'blitz') {
      this.addFloatingText('🔥 BLITZ ONSLAUGHT — RAPID DEPLOYMENT!', this.L_WIDTH / 2, 220, '#f87171', 1.3);
      sound.playBossAlarm();
    } else {
      const waveInSector = ((waveNumber - 1) % 5) + 1;
      const modeTag = this.gameMode === 'endless' ? ' • ENDLESS GAUNTLET' : '';
      this.addFloatingText(
        `SECTOR ${this.currentEra.eraNumber} • WAVE ${waveInSector}/5${modeTag}`,
        this.L_WIDTH / 2,
        220,
        '#38bdf8',
        1.2
      );
    }
  }

  public nextWave() {
    this.setupWave(this.currentWave + 1);
  }

  // --- Player Actions ---

  public setAim(targetX: number, targetY: number) {
    const dx = targetX - this.cannonX;
    const dy = targetY - this.cannonY;

    let angle = Math.atan2(dy, dx);
    // Clamp cannon aim between -162 deg and -18 deg (smooth upwards hemisphere).
    // Taps at/below the cannon line simply resolve to a near-horizontal aim on
    // the tapped side — the turret always points where the player intended.
    const minAngle = -Math.PI * 0.91;
    const maxAngle = -Math.PI * 0.09;
    angle = Math.max(minAngle, Math.min(maxAngle, angle));
    this.aimAngle = angle;
  }

  /**
   * Rotate the turret by `delta` radians (keyboard steering: hold ←/→ to
   * sweep, ↑/↓ to pull toward vertical / horizontal). Clamped to the exact
   * same upward-hemisphere range as touch & mouse aim.
   */
  public rotateAim(delta: number) {
    const minAngle = -Math.PI * 0.91;
    const maxAngle = -Math.PI * 0.09;
    this.aimAngle = Math.max(minAngle, Math.min(maxAngle, this.aimAngle + delta));
  }

  /**
   * Aim the turret DIRECTLY at a stick angle in radians (screen space:
   * -PI..0 spans the upward hemisphere). The virtual joystick calls this
   * on every pointermove — one atan2 in the component, one clamp here, and
   * the turret snaps instantly. There is deliberately NO turn-rate cap and
   * NO virtual-cursor indirection (the old joystick steered a cursor at
   * 760px/s and let setAim chase it — a full-field sweep took ~0.6s, which
   * read as laggy controls on touch devices).
   */
  public setAimAngle(angle: number) {
    const minAngle = -Math.PI * 0.91;
    const maxAngle = -Math.PI * 0.09;
    this.aimAngle = Math.max(minAngle, Math.min(maxAngle, angle));
  }

  public toggleAutoFire(): boolean {
    this.autoFireEnabled = !this.autoFireEnabled;
    return this.autoFireEnabled;
  }

  public switchWeapon(id: WeaponId) {
    if (this.weapons[id] && this.weapons[id].unlocked) {
      this.activeWeaponId = id;
      return true;
    }
    return false;
  }

  public triggerSpecial(type: 'emp' | 'orbital' | 'grenade'): boolean {
    if (this.empJamTimer > 0) {
      this.addFloatingText(
        `SPECIALS JAMMED (${Math.ceil(this.empJamTimer)}s) — EMP ASTEROID!`,
        this.cannonX,
        this.cannonY - 60,
        '#f87171',
        1.1
      );
      return false;
    }

    if (type === 'emp') {
      const empDef = this.weapons.emp;
      // LOCKED / COOLDOWN states must never fail silently — a dead button with
      // zero feedback reads as "EMP is broken". Every gate explains itself.
      if (!empDef.unlocked) {
        this.addFloatingText(
          `EMP LOCKED — UNLOCK AT SHOP ($${empDef.unlockCostCash})`,
          this.L_WIDTH / 2,
          400,
          '#f87171',
          1.1
        );
        return false;
      }
      if (this.specialCooldowns.emp > 0) {
        this.addFloatingText(
          `EMP RECHARGING — ${Math.ceil(this.specialCooldowns.emp)}s`,
          this.L_WIDTH / 2,
          400,
          '#c084fc',
          1.0
        );
        return false;
      }
      if (this.specialCharges.emp <= 0) {
        this.addFloatingText('NO EMP CHARGES — TAP $ TO BUY', this.L_WIDTH / 2, 420, '#f87171', 1.0);
        return false;
      }

      this.specialCharges.emp -= 1;
      this.specialCooldowns.emp = empDef.cooldown || 10;
      sound.playShoot('emp');
      this.shake(12);

      // Create shockwave effect
      this.createShockwave(this.cannonX, this.cannonY, '#c084fc');

      // EMP strips all enemy shields and stuns (snapshot iteration —
      // dealDamageToThreat can kill + remove entries mid-pulse)
      const empTargets = this.threats.slice();
      for (let ei = 0; ei < empTargets.length; ei++) {
        const t = empTargets[ei];
        if (t.shieldHp > 0) {
          t.shieldHp = 0;
          this.addFloatingText('SHIELD OVERLOAD!', t.x, t.y, '#c084fc', 1.1);
        }
        t.isFrozen = true;
        t.freezeTimer = 3.5;
        this.dealDamageToThreat(t, 45, true);
      }

      this.addFloatingText('EMP PULSE DISCHARGED', this.L_WIDTH / 2, 400, '#c084fc', 1.3);
      return true;
    } else if (type === 'orbital') {
      const orbDef = this.weapons.orbital;
      if (!orbDef.unlocked) {
        this.addFloatingText(
          orbDef.unlockCostGems > 0
            ? `ORBITAL LOCKED — ${orbDef.unlockCostGems} GEMS AT SHOP`
            : 'ORBITAL LOCKED — UNLOCK AT SHOP',
          this.L_WIDTH / 2,
          400,
          '#f87171',
          1.1
        );
        return false;
      }
      if (this.specialCooldowns.orbital > 0) {
        this.addFloatingText(
          `ORBITAL RECHARGING — ${Math.ceil(this.specialCooldowns.orbital)}s`,
          this.L_WIDTH / 2,
          400,
          '#f43f5e',
          1.0
        );
        return false;
      }
      if (this.specialCharges.orbital <= 0) {
        this.addFloatingText('NO ORBITAL CHARGES — TAP $ TO BUY', this.L_WIDTH / 2, 420, '#f87171', 1.0);
        return false;
      }

      this.specialCharges.orbital -= 1;
      this.specialCooldowns.orbital = orbDef.cooldown || 25;
      sound.playShoot('orbital');
      this.shake(24);

      // Giant vertical beam wiping threats
      const beamX = this.aimAngle ? this.cannonX + Math.cos(this.aimAngle) * 200 : this.L_WIDTH / 2;
      this.triggerOrbitalBeam(beamX);
      return true;
    } else if (type === 'grenade') {
      // Frag grenade: lobbed AoE blast at the current aim point. Universal
      // consumable (no weapon unlock needed) — the cheap panic button.
      if (this.specialCooldowns.grenade > 0) {
        this.addFloatingText(
          `FRAG COOKING — ${Math.ceil(this.specialCooldowns.grenade)}s`,
          this.L_WIDTH / 2,
          400,
          '#fbbf24',
          1.0
        );
        return false;
      }
      if (this.specialCharges.grenade <= 0) {
        this.addFloatingText('NO GRENADES — TAP $ TO BUY', this.L_WIDTH / 2, 420, '#f87171', 1.0);
        return false;
      }

      this.specialCharges.grenade -= 1;
      this.specialCooldowns.grenade = 5;
      sound.playShoot('cannon');
      this.throwGrenade();
      return true;
    }
    return false;
  }

  /**
   * Buy ONE extra charge mid-run (repeatable, no cap). Cash is deducted by the
   * caller (page) — the engine only arms the ammo and confirms visually.
   */
  public addSpecialCharge(type: 'emp' | 'orbital' | 'grenade'): void {
    this.specialCharges[type] += 1;
    const label = type === 'emp' ? 'EMP' : type === 'orbital' ? 'ORBITAL' : 'GRENADE';
    const color = type === 'emp' ? '#c084fc' : type === 'orbital' ? '#f43f5e' : '#fbbf24';
    this.addFloatingText(`${label} CHARGE ARMED (${this.specialCharges[type]})`, this.L_WIDTH / 2, 420, color, 1.1);
  }

  /** Direct grant used by rewarded ads (no cash cost). */
  public grantSpecialCharges(type: 'emp' | 'orbital' | 'grenade', count: number): void {
    this.specialCharges[type] += Math.max(1, Math.floor(count));
    const label = type === 'emp' ? 'EMP' : type === 'orbital' ? 'ORBITAL' : 'GRENADE';
    const color = type === 'emp' ? '#c084fc' : type === 'orbital' ? '#f43f5e' : '#fbbf24';
    this.addFloatingText(`+${Math.max(1, Math.floor(count))} ${label} AIR-DROPPED`, this.L_WIDTH / 2, 420, color, 1.2);
  }

  /** Frag grenade lob: ballistic arc from the cannon toward the aim point. */
  private throwGrenade() {
    const dist = 300;
    const targetX = Math.max(30, Math.min(this.L_WIDTH - 30, this.cannonX + Math.cos(this.aimAngle) * dist));
    const targetY = Math.max(70, this.cannonY + Math.sin(this.aimAngle) * dist);
    const flightTime = 0.8;
    const gravity = 900;
    const vx = (targetX - this.cannonX) / flightTime;
    const vy = (targetY - this.cannonY) / flightTime - 0.5 * gravity * flightTime;

    const p = this.acquireProjectile();
    p.id = this.newId();
    p.weaponId = 'cannon'; // rendering special-cases isGrenade
    p.x = this.cannonX;
    p.y = this.cannonY - 18;
    p.vx = vx;
    p.vy = vy;
    p.radius = 7;
    p.damage = Math.round(130 + this.currentWave * 4);
    p.pierceRemaining = 1;
    p.splashRadius = 0; // grenade uses blastRadius instead (fused detonation, not on-hit splash)
    p.color = '#fbbf24';
    p.isGrenade = true;
    p.gravity = gravity;
    p.fuseTime = flightTime;
    p.blastRadius = 115;
    this.projectiles.push(p);
    this.addFloatingText('FRAG OUT!', this.cannonX, this.cannonY - 60, '#fbbf24', 1.1);
  }

  /** Grenade detonation: big AoE + lingering fire hazard at the blast site. */
  private detonateGrenade(x: number, y: number, damage: number, radius: number) {
    sound.playExplosion(true);
    this.shake(18);
    this.createExplosion(x, y, radius * 0.85, '#f97316');
    this.createShockwave(x, y, '#fbbf24', radius);

    this.threats.slice().forEach((t) => {
      if (t.isPhasedOut) return;
      const dx = t.x - x;
      const dy = t.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < radius * radius) {
        const d = Math.sqrt(dSq);
        const falloff = 1 - d / radius;
        const dmg = Math.round(damage * Math.max(0.5, falloff));
        this.dealDamageToThreat(t, dmg, true);
      }
    });

    // Frag blasts also vaporize starfall shards caught in the radius — a
    // well-timed grenade is the definitive answer to a full deception volley.
    for (let sIdx = this.starfallShards.length - 1; sIdx >= 0; sIdx--) {
      const s = this.starfallShards[sIdx];
      const sdx = s.x - x;
      const sdy = s.y - y;
      const srr = radius + 10;
      if (sdx * sdx + sdy * sdy < srr * srr) {
        this.starfallShards[sIdx] = this.starfallShards[this.starfallShards.length - 1];
        this.starfallShards.pop();
        this.interceptStarfallShard(s.x, s.y);
      }
    }

    // Scorch the landing zone — brief ground hazard chases campers
    this.groundHazards.push({
      id: this.newId(),
      x: x - 34,
      y: Math.min(y, this.cannonY - 10),
      width: 68,
      height: 26,
      duration: 2.5,
      maxDuration: 2.5,
      dps: 0, // visual-only flame bed (damage would double-dip the blast)
    });

    this.addFloatingText('💥 FRAG DETONATED 💥', x, y - 20, '#fbbf24', 1.3);
  }

  private triggerOrbitalBeam(beamTargetX: number) {
    // Blast all threats within wide corridor (snapshot — kills mid-beam)
    const beamRadius = 140;
    this.threats.slice().forEach((t) => {
      const dist = Math.abs(t.x - beamTargetX);
      if (dist < beamRadius) {
        this.dealDamageToThreat(t, 450, true);
      }
    });

    // Spawn massive beam particles
    for (let i = 0; i < 70; i++) {
      this.spawnParticle({
        x: beamTargetX + (Math.random() - 0.5) * beamRadius * 1.5,
        y: Math.random() * this.L_HEIGHT,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        radius: Math.random() * 5 + 2,
        color: Math.random() > 0.4 ? '#f43f5e' : '#fbbf24',
        alpha: 1,
        life: 0,
        maxLife: Math.random() * 0.6 + 0.4,
        sparkle: true,
      });
    }
    this.addFloatingText('★ ORBITAL ANNIHILATION ★', beamTargetX, 300, '#f43f5e', 1.4);
  }

  public triggerNuke() {
    sound.playExplosion(true);
    this.shake(20);
    this.createShockwave(this.L_WIDTH / 2, this.L_HEIGHT / 2, '#fbbf24');
    // Wipe all regular threats (snapshot: onThreatDefeated mutates the
    // live array mid-iteration). Bosses eat 250 damage and only SURVIVE
    // into the rebuilt list if they're still standing afterwards — a
    // lethal blast no longer resurrects a dead flagship as a zombie.
    const survivors: Threat[] = [];
    const field = this.threats.slice();
    for (let ni = 0; ni < field.length; ni++) {
      const t = field[ni];
      if (t.isBoss) {
        this.dealDamageToThreat(t, 250, true);
        if (t.hp > 0) survivors.push(t);
      } else {
        this.createExplosion(t.x, t.y, t.radius * 1.5, t.color);
        this.onThreatDefeated(t, false);
      }
    }
    this.threats = survivors;
    // The blast wave also sweeps any falling starfall shards out of the sky.
    for (let si = 0; si < this.starfallShards.length; si++) {
      this.createExplosion(this.starfallShards[si].x, this.starfallShards[si].y, 12, '#fbbf24');
    }
    this.starfallShards = [];
    this.addFloatingText('TACTICAL NUKE DETONATED!', this.L_WIDTH / 2, 350, '#fbbf24', 1.4);
  }

  public repairBase(amount: number = 30) {
    this.currentBaseHp = Math.min(this.maxBaseHp, this.currentBaseHp + amount);
    this.lastBroadcastHullInt = Math.round(this.currentBaseHp);
    sound.playGoodie();
    this.addFloatingText(`+${amount} BASE HP`, this.cannonX, this.cannonY - 30, '#4ade80', 1.2);
    this.callbacks.onHealthUpdate(this.currentBaseHp, this.maxBaseHp, this.currentShieldHp);
  }

  /**
   * HULL EXPANSION — permanently raise the Citadel's hull ceiling to the
   * purchased reinforcement steps (100 → 125 → 150 → …). Bought mid-run, the
   * fresh ablative plating is welded on immediately: the new capacity is
   * granted as LIVE hull, so the upgrade is felt on the very next impact.
   */
  public applyHullExtension(steps: number) {
    const nextMax = getHullMaxHp(steps);
    if (nextMax <= this.maxBaseHp) return;
    const delta = nextMax - this.maxBaseHp;
    this.maxBaseHp = nextMax;
    this.currentBaseHp = Math.min(this.maxBaseHp, this.currentBaseHp + delta);
    this.lastBroadcastHullInt = Math.round(this.currentBaseHp);
    this.addFloatingText(
      `⛨ HULL REINFORCED ${Math.round(this.currentBaseHp)}%/${nextMax}%`,
      this.cannonX,
      this.cannonY - 40,
      '#4ade80',
      1.3
    );
    this.createShockwave(this.cannonX, this.cannonY, '#4ade80', 90);
    this.callbacks.onHealthUpdate(this.currentBaseHp, this.maxBaseHp, this.currentShieldHp);
  }

  // --- Main Game Loop ---

  private loop(currentTime: number) {
    if (!this.isRunning) return;

    const rawDtMs = currentTime - this.lastTime;
    const dt = Math.min(0.1, rawDtMs / 1000);
    this.lastTime = currentTime;

    // ADAPTIVE QUALITY GOVERNOR — rolling frame-interval average with
    // hysteresis, measured against the DISPLAY's own refresh budget (a 30Hz
    // phone rendering 33ms frames is healthy, not overloaded). A sustained
    // average beyond ~125% of the refresh budget steps quality DOWN; a ~8s
    // streak at-budget frames steps it back up. The 1.5s hold stops a tier
    // flip from immediately re-triggering itself. Samples from
    // clamped/stalled frames (tab switches, GC pauses) are skipped — the
    // governor must only react to SUSTAINED render load.
    if (rawDtMs > 0 && rawDtMs < 50) {
      // Fastest-frames refresh estimate: snap down, drift up
      this.refreshMs = Math.min(this.refreshMs + 0.08, rawDtMs);
      this.frameAvgMs = this.frameAvgMs * 0.92 + rawDtMs * 0.08;
      const slowThreshold = Math.max(19.5, this.refreshMs * 1.25);
      const healthyMax = Math.max(16.0, this.refreshMs * 1.08);
      const now = performance.now();
      if (now >= this.qualityHoldUntil) {
        if (this.frameAvgMs > slowThreshold && this.renderQuality < 2) {
          this.setQualityLevel(this.renderQuality + 1);
          this.qualityHoldUntil = now + 1500;
          this.qualityUpStreak = 0;
        } else if (this.frameAvgMs < healthyMax) {
          this.qualityUpStreak += 1;
          // ~8s of healthy frames (at 60Hz) before climbing back up
          if (this.qualityUpStreak >= 480 && this.renderQuality > 0) {
            this.setQualityLevel(this.renderQuality - 1);
            this.qualityHoldUntil = now + 1500;
            this.qualityUpStreak = 0;
          }
        } else {
          this.qualityUpStreak = 0;
        }
      }
    }

    // Hit-stop freeze frame for high-impact cinematic feedback
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      this.render(currentTime / 1000);
      this.animFrameId = requestAnimationFrame(this.loop);
      return;
    }

    if (!this.isPaused) {
      this.update(dt, currentTime / 1000);
    }

    this.render(currentTime / 1000);
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  /** Apply a new quality tier: renderer gate + shell notification. */
  private setQualityLevel(level: number) {
    const next = Math.max(0, Math.min(2, Math.floor(level)));
    if (next === this.renderQuality) return;
    this.renderQuality = next;
    setRenderQuality(next); // enemyRenderer + own qBlur() sites
    // Simulation budget follows the visual tier: fewer live particles to
    // update (not just draw) when the device is struggling.
    this.particleCap = next === 2 ? 180 : next === 1 ? 320 : 520;
    if (this.pLive > this.particleCap) this.pLive = this.particleCap;
    if (this.pEvict > this.particleCap) this.pEvict = 0;
    if (next === 1) this.addFloatingText('PERFORMANCE MODE', this.L_WIDTH / 2, 300, '#94a3b8', 1.0);
    else if (next === 2) this.addFloatingText('LOW-DETAIL MODE', this.L_WIDTH / 2, 300, '#94a3b8', 1.0);
    this.callbacks.onQualityLevel?.(next);
  }

  /**
   * Manual quality override for tests/debug: also resets the governor's
   * hysteresis window so it doesn't immediately stomp the requested tier.
   */
  public forceQualityLevel(level: number) {
    this.setQualityLevel(level);
    this.qualityHoldUntil = performance.now() + 60_000;
    this.frameAvgMs = 16.7;
  }

  // --- Update Mechanics ---

  private update(dt: number, timeSec: number) {
    // Overdrive adrenaline countdown & aura emissions
    if (this.isOverdrive) {
      this.overdriveTimer -= dt;
      this.adrenaline = Math.max(0, (this.overdriveTimer / 8.5) * 100);
      this.callbacks.onAdrenalineUpdate?.(this.adrenaline, true);

      // Overdrive electric aura particles around cannon
      if (Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * 32 + 10;
        this.spawnParticle({
          x: this.cannonX + Math.cos(ang) * dist,
          y: this.cannonY + Math.sin(ang) * dist,
          vx: -Math.cos(ang) * 45,
          vy: -Math.sin(ang) * 45,
          radius: Math.random() * 2.5 + 1.5,
          color: Math.random() > 0.4 ? '#38bdf8' : '#fbbf24',
          alpha: 1,
          life: 0,
          maxLife: 0.35,
          sparkle: true,
        });
      }

      if (this.overdriveTimer <= 0) {
        this.isOverdrive = false;
        this.adrenaline = 0;
        this.callbacks.onAdrenalineUpdate?.(0, false);
        this.addFloatingText('OVERDRIVE DEPLETED', this.cannonX, this.cannonY - 40, '#94a3b8', 1.0);
      }
    }

    // Soundtrack adrenaline heartbeat — the music tracks the fight's heat
    // (rush meter, overdrive, boss phase, hull danger) at a cheap 5 Hz.
    this.combatDriveTimer -= dt;
    if (this.combatDriveTimer <= 0) {
      this.combatDriveTimer = 0.2;
      let boss: Threat | undefined;
      for (let bi = 0; bi < this.threats.length; bi++) {
        if (this.threats[bi].isBoss) {
          boss = this.threats[bi];
          break;
        }
      }
      this.callbacks.onCombatDrive?.({
        adrenaline: this.adrenaline,
        overdrive: this.isOverdrive,
        bossPhase: boss?.bossPhase ?? 0,
        bossActive: !!boss,
        hpRatio: this.maxBaseHp > 0 ? this.currentBaseHp / this.maxBaseHp : 1,
      });
    }

    // SLOW FIELD NANO-REPAIR — hull creeps back at +0.8%/s, but only after
    // FOUR SECONDS of taking no hull damage (any impact resets the clock).
    // Deliberately glacial: a 50-point hole takes a full minute to close, so
    // death stays a real threat while the slowly-climbing bar advertises the
    // fast repair paths — rewarded ads, Emergency Hull Refit, field repair.
    if (this.currentBaseHp > 0 && this.currentBaseHp < this.maxBaseHp) {
      this.hullGraceTimer += dt;
      if (this.hullGraceTimer >= 4) {
        this.currentBaseHp = Math.min(this.maxBaseHp, this.currentBaseHp + 0.8 * dt);
        const hullInt = Math.round(this.currentBaseHp);
        if (hullInt !== this.lastBroadcastHullInt) {
          this.lastBroadcastHullInt = hullInt;
          this.callbacks.onHealthUpdate(this.currentBaseHp, this.maxBaseHp, this.currentShieldHp);
        }
      }
    }

    // Screen shake decay
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 25);
    }
    if (this.recoilOffset > 0) {
      this.recoilOffset = Math.max(0, this.recoilOffset - dt * 25);
    }

    // Freeze & Jams timers
    if (this.isCannonFrozen) {
      this.freezeTimer -= dt;
      if (this.freezeTimer <= 0) {
        this.isCannonFrozen = false;
        this.addFloatingText('CANNON THAWED!', this.cannonX, this.cannonY - 40, '#38bdf8', 1.0);
      }
    }
    if (this.empJamTimer > 0) this.empJamTimer -= dt;
    if (this.voidFogTimer > 0) this.voidFogTimer -= dt;
    // Tesla shock — turret circuits stunned; recovers with a reboot blip
    if (this.shockTimer > 0) {
      this.shockTimer -= dt;
      if (this.shockTimer <= 0) {
        this.shockTimer = 0;
        this.addFloatingText('⚡ TURRET REBOOTED!', this.cannonX, this.cannonY - 40, '#facc15', 1.0);
      }
    }

    // Special Cooldowns
    if (this.specialCooldowns.emp > 0) this.specialCooldowns.emp = Math.max(0, this.specialCooldowns.emp - dt);
    if (this.specialCooldowns.orbital > 0) this.specialCooldowns.orbital = Math.max(0, this.specialCooldowns.orbital - dt);
    if (this.specialCooldowns.grenade > 0) this.specialCooldowns.grenade = Math.max(0, this.specialCooldowns.grenade - dt);

    // Active Buffs — countdown sweep in SIMULATED seconds (tiny Map, ≤5 entries).
    // Simulated dt means a pause freezes the remaining buff time — the old
    // wall-clock expiry silently ate buffs while the game sat paused.
    this.activeBuffs.forEach((buff, type) => {
      buff.duration -= dt;
      if (buff.duration <= 0) {
        this.activeBuffs.delete(type);
        this.buffsDirty = true;
      }
    });

    // Emit only when the buff set actually changes. The old code rebuilt
    // Array.from + .map + a joined signature EVERY frame (~180 small
    // allocations per second for a set that changes a few times a minute);
    // now it rebuilds on add/expire (dirty flag) plus a 2Hz tick that keeps
    // the countdown display honest — the HUD re-render rate is unchanged.
    this.buffsSigTimer += dt;
    if (this.buffsDirty || this.buffsSigTimer >= 0.5) {
      this.buffsDirty = false;
      this.buffsSigTimer = 0;
      const buffs = Array.from(this.activeBuffs.values());
      const buffsSignature = buffs.map((b) => `${b.type}:${Math.ceil(b.duration)}`).join('|');
      if (buffsSignature !== this.lastBuffsSignature) {
        this.lastBuffsSignature = buffsSignature;
        this.callbacks.onBuffsUpdate(buffs);
      }
    }

    // Parallax stars — scroll the pre-rendered tiles (per-layer offsets;
    // the per-star position array is now the bake source, not a live sim)
    for (const layer of this.starTiles) {
      layer.offset = (layer.offset + layer.speed * dt) % this.L_HEIGHT;
    }

    // Auto-fire / manual shooting (shock stuns fire control like freeze)
    if (this.autoFireEnabled && !this.isCannonFrozen && this.shockTimer <= 0) {
      this.tryShoot(timeSec);
    }

    // Refresh the projectile-bending well list ONCE per frame (gravity wells
    // and void orbs are rare) — per-projectile scans of every threat used to
    // allocate a closure per projectile per frame.
    this.activeWells.length = 0;
    for (let wi = 0; wi < this.threats.length; wi++) {
      const wt = this.threats[wi];
      if (wt.type === 'gravity_well' || wt.type === 'void_orb') this.activeWells.push(wt);
    }

    // Spawning threats & goodies
    this.updateSpawning(dt);

    // Update Ground Hazards (backwards + swap-pop)
    for (let i = this.groundHazards.length - 1; i >= 0; i--) {
      const h = this.groundHazards[i];
      h.duration -= dt;
      // Hazard deals small dps to base if burning
      this.damageBase(h.dps * dt * 0.4);
      if (h.duration <= 0) {
        this.groundHazards[i] = this.groundHazards[this.groundHazards.length - 1];
        this.groundHazards.pop();
      }
    }

    // Update Projectiles
    this.updateProjectiles(dt);

    // Update Threats
    this.updateThreats(dt, timeSec);

    // Update Starfall Catastrophe shards (fake-orb betrayal)
    this.updateStarfall(dt);

    // Update Goodies
    this.updateGoodies(dt);

    // Update Particles — pool compaction: dead particles are overwritten by
    // the last live one (swap-with-last inside a backwards walk). No splice,
    // no allocation, O(live) per frame.
    for (let i = this.pLive - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
      if (p.life >= p.maxLife) {
        this.particles[i] = this.particles[this.pLive - 1];
        this.pLive--;
      }
    }

    // Update Floating Text
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= dt * 0.8;
      if (ft.alpha <= 0) {
        this.floatingTexts[i] = this.floatingTexts[this.floatingTexts.length - 1];
        this.floatingTexts.pop();
      }
    }

    // Check Wave Completion
    if (
      this.waveThreatsSpawned >= this.waveThreatsTotal &&
      this.threats.length === 0 &&
      !this.isWaveIntermission
    ) {
      this.handleWaveWon();
    }
  }

  // --- Firing & Weapons ---

  public tryShoot(timeSec: number = performance.now() / 1000) {
    if (this.isCannonFrozen || this.shockTimer > 0) return;

    const weapon = this.weapons[this.activeWeaponId];
    if (!weapon || !weapon.unlocked) return;

    // Buff modifier: Fire-rate boost doubles fire rate
    let effectiveFireRate = weapon.fireRate;
    if (this.activeBuffs.has('fire_rate')) {
      effectiveFireRate *= 1.8;
    }
    if (this.isOverdrive) {
      effectiveFireRate *= 2.2;
    }

    const fireInterval = 1 / effectiveFireRate;
    if (timeSec - this.lastFireTime < fireInterval) return;

    this.lastFireTime = timeSec;
    this.recoilOffset = this.isOverdrive ? 6.5 : 4.5;
    sound.playShoot(weapon.id);

    // Auto-Aim Buff: bend projectile toward nearest threat
    let shootAngle = this.aimAngle;
    if (this.activeBuffs.has('auto_aim') && this.threats.length > 0) {
      const nearest = this.getNearestThreat();
      if (nearest) {
        shootAngle = Math.atan2(nearest.y - this.cannonY, nearest.x - this.cannonX);
      }
    }

    const barrelLength = 34;
    const spawnX = this.cannonX + Math.cos(shootAngle) * barrelLength;
    const spawnY = this.cannonY + Math.sin(shootAngle) * barrelLength;

    if (this.isOverdrive) {
      // Overdrive: Triple electric spread shot with high pierce
      for (let si = 0; si < 3; si++) {
        const ang = shootAngle + OD_SPREAD[si];
        const p = this.acquireProjectile();
        p.id = this.newId();
        p.weaponId = weapon.id;
        p.x = spawnX;
        p.y = spawnY;
        p.vx = Math.cos(ang) * weapon.projectileSpeed * 1.3;
        p.vy = Math.sin(ang) * weapon.projectileSpeed * 1.3;
        p.radius = 5.5;
        p.damage = Math.round(weapon.damage * 1.5);
        p.pierceRemaining = 2;
        p.splashRadius = weapon.id === 'missiles' ? 80 : 0;
        p.color = this.skinColors.projectile;
        p.length = weapon.id === 'laser' ? 32 : undefined;
        this.projectiles.push(p);
      }
    } else if (weapon.id === 'cannon') {
      // Barrel count grows with mark level: ONE precision bullet from Mk1
      // (core skill is aimed shooting), twin linked barrels at Mk3, triple
      // battery at Mk6. Per-bullet damage is divided so the full volley
      // always sums to the cannon's listed damage — DPS climbs smoothly
      // with marks instead of jumping when a barrel is added.
      const barrels = weapon.tier >= 6 ? 3 : weapon.tier >= 3 ? 2 : 1;
      const perBullet = Math.max(6, Math.round(weapon.damage / barrels));
      const perp = shootAngle + Math.PI / 2;
      const offsets = VOLLEY_OFFSETS.cannon[barrels];
      for (let bi = 0; bi < offsets.length; bi++) {
        const off = offsets[bi];
        const p = this.acquireProjectile();
        p.id = this.newId();
        p.weaponId = 'cannon';
        p.x = spawnX + Math.cos(perp) * off;
        p.y = spawnY + Math.sin(perp) * off;
        p.vx = Math.cos(shootAngle) * weapon.projectileSpeed;
        p.vy = Math.sin(shootAngle) * weapon.projectileSpeed;
        p.radius = barrels === 1 ? 5.5 : 5;
        p.damage = perBullet;
        p.pierceRemaining = 1;
        p.splashRadius = 0;
        p.color = this.skinColors.projectile;
        this.projectiles.push(p);
      }
    } else if (weapon.id === 'machinegun') {
      // Rotary barrels link up with marks — twin streams at Mk3, triple at
      // Mk6 (same volley-damage-split rule as the cannon: the listed damage
      // is PER VOLLEY, divided across the streams, so DPS climbs smoothly
      // with marks while coverage & hit-probability jump when a barrel is
      // added — exactly what a swarm-shredder wants).
      const barrels = weapon.tier >= 6 ? 3 : weapon.tier >= 3 ? 2 : 1;
      const perBullet = Math.max(4, Math.round(weapon.damage / barrels));
      const perp = shootAngle + Math.PI / 2;
      const offsets = VOLLEY_OFFSETS.machinegun[barrels];
      for (let bi = 0; bi < offsets.length; bi++) {
        const off = offsets[bi];
        // Each stream keeps the classic gatling jitter.
        const spread = (Math.random() - 0.5) * 0.12;
        const angle = shootAngle + spread;
        const p = this.acquireProjectile();
        p.id = this.newId();
        p.weaponId = 'machinegun';
        p.x = spawnX + Math.cos(perp) * off;
        p.y = spawnY + Math.sin(perp) * off;
        p.vx = Math.cos(angle) * weapon.projectileSpeed;
        p.vy = Math.sin(angle) * weapon.projectileSpeed;
        p.radius = 3.5;
        p.damage = perBullet;
        p.pierceRemaining = 1;
        p.splashRadius = 0;
        p.color = this.skinColors.projectile;
        this.projectiles.push(p);
      }
    } else if (weapon.id === 'laser') {
      // Beam splitter marks — one beam at Mk1-2, twin parallel beams at Mk3,
      // triple at Mk6. Per-beam damage divides so the volley total stays on
      // the upgrade curve, while each beam keeps its OWN pierce budget: a
      // triple Mk6 volley can carve through up to 3x the enemy column.
      const beams = weapon.tier >= 6 ? 3 : weapon.tier >= 3 ? 2 : 1;
      const perBeam = Math.max(10, Math.round(weapon.damage / beams));
      const perp = shootAngle + Math.PI / 2;
      const offsets = VOLLEY_OFFSETS.laser[beams];
      for (let bi = 0; bi < offsets.length; bi++) {
        const off = offsets[bi];
        const p = this.acquireProjectile();
        p.id = this.newId();
        p.weaponId = 'laser';
        p.x = spawnX + Math.cos(perp) * off;
        p.y = spawnY + Math.sin(perp) * off;
        p.vx = Math.cos(shootAngle) * weapon.projectileSpeed;
        p.vy = Math.sin(shootAngle) * weapon.projectileSpeed;
        p.radius = weapon.tier >= 3 ? Math.min(7 + (weapon.tier - 3) * 0.5, 10) : 4.5;
        p.damage = perBeam;
        p.pierceRemaining = weapon.tier >= 3 ? Math.min(6 + (weapon.tier - 3), 10) : 4;
        p.splashRadius = 0;
        p.color = weapon.color;
        p.length = 26;
        this.projectiles.push(p);
      }
    } else if (weapon.id === 'missiles') {
      const nearest = this.getNearestThreat();
      const p = this.acquireProjectile();
      p.id = this.newId();
      p.weaponId = 'missiles';
      p.x = spawnX;
      p.y = spawnY;
      p.vx = Math.cos(shootAngle) * weapon.projectileSpeed;
      p.vy = Math.sin(shootAngle) * weapon.projectileSpeed;
      p.radius = 6;
      p.damage = weapon.damage;
      p.pierceRemaining = 1;
      p.splashRadius = weapon.tier >= 3 ? Math.min(85 + (weapon.tier - 3) * 10, 140) : 60;
      p.color = weapon.color;
      p.targetId = nearest?.id;
      this.projectiles.push(p);
    }
  }

  private getNearestThreat(): Threat | null {
    let bestDistSq = Infinity;
    let best: Threat | null = null;
    for (let gi = 0; gi < this.threats.length; gi++) {
      const t = this.threats[gi];
      const dx = t.x - this.cannonX;
      const dy = t.y - this.cannonY;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = t;
      }
    }
    return best;
  }

  // --- Projectile Physics & Collisions ---

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      // Gravity Well attraction physics — reads the per-frame well cache
      // (plain loop, no closure per projectile).
      const wells = this.activeWells;
      for (let wi = 0; wi < wells.length; wi++) {
        const t = wells[wi];
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 32400 && distSq > 100) {
          // 180px pull radius; 10px event horizon (squared: 32400 / 100)
          const dist = Math.sqrt(distSq);
          const force = (180 - dist) * 2.5;
          p.vx += (dx / dist) * force * dt;
          p.vy += (dy / dist) * force * dt;
        }
      }

      // Homing missiles guidance — plain id scan (no find() closure)
      if (p.weaponId === 'missiles' && p.targetId) {
        let target: Threat | undefined;
        for (let k = 0; k < this.threats.length; k++) {
          if (this.threats[k].id === p.targetId) {
            target = this.threats[k];
            break;
          }
        }
        if (target) {
          const desiredAngle = Math.atan2(target.y - p.y, target.x - p.x);
          const currentSpeed = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(desiredAngle) * currentSpeed;
          p.vy = Math.sin(desiredAngle) * currentSpeed;
        }
      }

      // Frag grenade: gravity arc + burning fuse spark trail
      if (p.isGrenade) {
        p.vy += (p.gravity ?? 900) * dt;
        if (p.fuseTime !== undefined) {
          p.fuseTime -= dt;
        }
        if (Math.random() < 0.6) {
          this.spawnParticle({
            x: p.x + (Math.random() - 0.5) * 4,
            y: p.y - 4,
            vx: (Math.random() - 0.5) * 30,
            vy: -30,
            radius: Math.random() * 2 + 1,
            color: Math.random() > 0.5 ? '#fbbf24' : '#f97316',
            alpha: 1,
            life: 0,
            maxLife: 0.3,
            sparkle: true,
          });
        }
        // Fused detonation: explodes when the fuse burns out OR it drops to
        // the defense line — never silently despawns off-screen.
        if ((p.fuseTime ?? 0) <= 0 || p.y >= this.cannonY - 12) {
          this.detonateGrenade(p.x, Math.min(p.y, this.cannonY - 12), p.damage, p.blastRadius ?? 115);
          this.releaseProjectile(p);
          this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
          this.projectiles.pop();
          continue;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Rocket exhaust particles
      if (p.weaponId === 'missiles' && Math.random() < 0.4) {
        this.spawnParticle({
          x: p.x,
          y: p.y,
          vx: (Math.random() - 0.5) * 20,
          vy: 40,
          radius: 2.5,
          color: '#f97316',
          alpha: 0.8,
          life: 0,
          maxLife: 0.25,
        });
      }

      // Check collision with Threats — squared-distance compare (no hypot
      // in the inner loop; fast ordnance keeps its proximity-fuse margin).
      let hitSomething = false;
      for (let j = 0; j < this.threats.length; j++) {
        const t = this.threats[j];
        if (t.isPhasedOut) continue; // Phased out ghost is intangible

        const cdx = p.x - t.x;
        const cdy = p.y - t.y;
        // Hypersonic-class rounds move so fast the per-frame step can
        // tunnel a small hitbox — give fast ordnance a proximity-fuse
        // margin so a clean intercept shot never passes straight through.
        const fusePad =
          t.type === 'hypersonic_missile' || t.type === 'mirv_warhead' || t.type === 'railgun_slug'
            ? 12
            : t.type === 'hunter_killer' && t.isDiving
              ? 10
              : 0;
        const rr = p.radius + t.radius + fusePad;
        if (cdx * cdx + cdy * cdy < rr * rr) {
          hitSomething = true;
          if (p.isGrenade) {
            // Grenades detonate ON CONTACT — instant AoE, no pierce
            this.detonateGrenade(p.x, p.y, p.damage, p.blastRadius ?? 115);
            p.pierceRemaining = 0;
            break;
          }
          this.onProjectileHit(p, t);
          p.pierceRemaining--;
          if (p.pierceRemaining <= 0) break;
        }
      }

      // STARFALL INTERCEPT — the deception fire-rain is SHOOTABLE: any round
      // that catches a falling shard vaporizes it mid-flight, preventing its
      // hull impact entirely (skill = survival — the mastery payoff for
      // players who learned to read the fake-orb tell).
      if (this.starfallShards.length > 0) {
        for (let sIdx = this.starfallShards.length - 1; sIdx >= 0; sIdx--) {
          const s = this.starfallShards[sIdx];
          const sdx = p.x - s.x;
          const sdy = p.y - s.y;
          const srr = p.radius + 15;
          // Generous pad: shards streak fast, so the intercept window is
          // lenient — the counter-play should feel heroic, not pixel-perfect.
          if (sdx * sdx + sdy * sdy < srr * srr) {
            this.starfallShards[sIdx] = this.starfallShards[this.starfallShards.length - 1];
            this.starfallShards.pop();
            this.interceptStarfallShard(s.x, s.y);
            hitSomething = true;
            p.pierceRemaining--;
            if (p.pierceRemaining <= 0) break;
          }
        }
      }

      // Check collision with Goodies (player can shoot goodies to collect them!)
      for (let k = this.goodies.length - 1; k >= 0; k--) {
        const g = this.goodies[k];
        const gdx = p.x - g.x;
        const gdy = p.y - g.y;
        const grr = p.radius + g.radius + 6;
        if (gdx * gdx + gdy * gdy < grr * grr) {
          this.collectGoodie(g);
          this.goodies[k] = this.goodies[this.goodies.length - 1];
          this.goodies.pop();
          p.pierceRemaining--;
          if (p.pierceRemaining <= 0) break;
        }
      }

      // Out of bounds
      if (p.pierceRemaining <= 0 || p.x < -30 || p.x > this.L_WIDTH + 30 || p.y < -40 || p.y > this.L_HEIGHT + 30) {
        // If bullet left screen without hitting any threat, it resets the combo streak!
        if (!hitSomething && (p.y < -30 || p.x < -20 || p.x > this.L_WIDTH + 20)) {
          this.resetCombo();
        }
        this.releaseProjectile(p);
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
      }
    }
  }

  private onProjectileHit(p: Projectile, t: Threat) {
    sound.playHit();

    // Increment combo streak on hit!
    this.incrementCombo();

    if (p.splashRadius > 0) {
      // Missile splash damage — plain loop, squared-distance early-out
      sound.playExplosion(false);
      this.createShockwave(p.x, p.y, '#f97316', p.splashRadius);
      const splashSq = p.splashRadius * p.splashRadius;
      for (let si = 0; si < this.threats.length; si++) {
        const other = this.threats[si];
        const odx = other.x - p.x;
        const ody = other.y - p.y;
        const dSq = odx * odx + ody * ody;
        if (dSq < splashSq) {
          const d = Math.sqrt(dSq);
          const falloff = 1 - d / p.splashRadius;
          const dmg = Math.round(p.damage * Math.max(0.4, falloff));
          this.dealDamageToThreat(other, dmg, false);
        }
      }
    } else {
      this.dealDamageToThreat(t, p.damage, false);
    }
  }

  public increaseAdrenaline(amount: number) {
    if (this.isOverdrive) return;
    // Combat Response Protocol: refill-speed upgrade scales every gain event
    const gain = amount * this.adrenalineGainMultiplier;
    this.adrenaline = Math.min(100, this.adrenaline + gain);
    if (this.adrenaline >= 100) {
      this.triggerOverdrive();
    } else {
      this.callbacks.onAdrenalineUpdate?.(this.adrenaline, false);
    }
  }

  /**
   * Mid-run purchase hook for the Combat Response Protocol: applies the new
   * permanent refill-speed level to the LIVE run (bought mid-run it takes
   * effect on the very next kill — exactly like a weapon mark upgrade).
   */
  public applyAdrenalineGainSteps(steps: number) {
    const mult = getAdrenalineGainMultiplier(steps);
    if (mult === this.adrenalineGainMultiplier) return;
    this.adrenalineGainMultiplier = mult;
    this.addFloatingText(
      `ADRENALINE REFILL ×${mult.toFixed(2).replace(/\.?0+$/, '')}`,
      this.cannonX,
      this.cannonY - 70,
      '#38bdf8',
      1.25
    );
  }

  public triggerOverdrive() {
    this.isOverdrive = true;
    this.overdriveTimer = 8.5;
    this.adrenaline = 100;
    sound.playOverdrive();
    this.shake(16);
    haptics.heavy();
    this.createShockwave(this.cannonX, this.cannonY, '#38bdf8', 140);
    this.addFloatingText('⚡ ADRENALINE OVERDRIVE! ⚡', this.L_WIDTH / 2, 360, '#38bdf8', 1.6);
    this.callbacks.onAdrenalineUpdate?.(100, true);
  }

  private dealDamageToThreat(t: Threat, damage: number, isDirect: boolean = false) {
    // Intangible craft (phase ghosts mid-cycle, a flagship riding the Void
    // Weaver's dimensional shift) take NO damage from anything — rounds,
    // splash, even orbital pulses pass through the seam.
    if (t.isPhasedOut) return;

    // Timestamp for the boss shield-regeneration gate (see update: bosses
    // regen void shields once left unmolested for ~4.5s)
    t.lastDamagedAt = performance.now() / 1000;

    // ABLATIVE FLAGSHIP PLATING: bosses shrug off 38% of ALL incoming damage
    // — rounds, splash, even orbital beams — so the fight demands sustained,
    // deliberate fire instead of one burst of overdrive crits. (Crit rolls are
    // also tamed to ×1.6 vs bosses below.)
    if (t.isBoss) {
      damage = Math.max(1, Math.round(damage * 0.62));
    }

    // Shield logic
    if (t.shieldHp > 0) {
      t.shieldHp -= damage;
      this.increaseAdrenaline(1.0);
      this.addFloatingText(`${damage} (SHIELD)`, t.x, t.y - 12, '#38bdf8', 0.9);
      if (t.shieldHp <= 0) {
        t.shieldHp = 0;
        this.createShockwave(t.x, t.y, '#38bdf8', 35);
        this.addFloatingText('SHIELD BROKEN!', t.x, t.y - 20, '#67e8f9', 1.1);
        sound.playCrit();
        this.shake(4);
      }
      return;
    }

    // Critical Hit Roll (16% base, 100% in Overdrive, or high combo bonus).
    // Vs bosses the multiplier is tamed (×1.6) — a lucky crit string must
    // never delete a flagship that is supposed to be a five-phase duel.
    const isCrit = this.isOverdrive || Math.random() < 0.16 || this.comboStreak >= 12;
    const finalDamage = isCrit ? Math.round(damage * (t.isBoss ? 1.6 : 2.4)) : damage;

    t.hp -= finalDamage;

    if (isCrit) {
      sound.playCrit();
      this.shake(5);
      this.addFloatingText(`💥 CRIT! -${finalDamage}`, t.x, t.y - 14, '#fbbf24', 1.35);
      this.increaseAdrenaline(4.0);
      // Extra burst sparks
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2;
        this.spawnParticle({
          x: t.x,
          y: t.y,
          vx: Math.cos(ang) * (Math.random() * 110 + 40),
          vy: Math.sin(ang) * (Math.random() * 110 + 40),
          radius: Math.random() * 3 + 1.5,
          color: '#fbbf24',
          alpha: 1,
          life: 0,
          maxLife: 0.3,
        });
      }
    } else {
      this.addFloatingText(`-${finalDamage}`, t.x, t.y - 10, isDirect ? '#f43f5e' : '#fde047', 0.9);
      this.increaseAdrenaline(1.5);
    }

    // Spark particles
    for (let i = 0; i < 4; i++) {
      this.spawnParticle({
        x: t.x,
        y: t.y,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        radius: 2,
        color: t.color,
        alpha: 1,
        life: 0,
        maxLife: 0.25,
      });
    }

    if (t.hp <= 0) {
      this.onThreatDefeated(t, true);
    }
  }

  // --- Threat Management & AI ---

  private updateThreats(dt: number, timeSec: number) {
    // Slow-Mo Buff
    let speedMult = 1.0;
    if (this.activeBuffs.has('slow_mo')) {
      speedMult = 0.4;
    }

    for (let i = this.threats.length - 1; i >= 0; i--) {
      const t = this.threats[i];

      // Frozen status
      if (t.isFrozen) {
        t.freezeTimer = (t.freezeTimer || 0) - dt;
        if (t.freezeTimer <= 0) {
          t.isFrozen = false;
        } else {
          continue; // skip movement while frozen
        }
      }

      t.angle += t.rotationSpeed * dt;

      // --- Evasive AI: piloted craft read incoming rounds and juke them.
      // Dodge odds climb with the player's firepower — smarter weapons,
      // smarter pilots. Rocks, pods, bosses and missiles don't juke. ---
      if (!t.isBoss && t.evasionSkill && t.type !== 'hypersonic_missile') {
        this.updateEvasion(t, dt);
      }

      // Type-specific behaviors
      if (t.type === 'scout') {
        // Erratic horizontal swoop
        t.x += Math.sin(timeSec * 4 + (t.phaseSeed ?? 0)) * 90 * dt;
      } else if (t.type === 'phase_ghost') {
        // Cyclically intangible
        const phaseCycle = (timeSec * 2 + (t.phaseSeed ?? 0)) % 4;
        t.isPhasedOut = phaseCycle > 2.0;
      } else if (t.type === 'stealth_threat') {
        // Phantom Stalker: 3s visible / 2s cloaked (invulnerable while cloaked), weaving approach
        t.specialTimer = (t.specialTimer || 0) + dt;
        t.isPhasedOut = t.specialTimer % 5 > 3;
        t.x += Math.sin(timeSec * 2.2 + (t.phaseSeed ?? 0)) * 55 * dt;
      } else if (t.type === 'healer_ship') {
        // Periodically heals adjacent enemies
        t.specialTimer = (t.specialTimer || 0) + dt;
        if (t.specialTimer > 2.2) {
          t.specialTimer = 0;
          this.createShockwave(t.x, t.y, '#22c55e', 90);
          for (let hi = 0; hi < this.threats.length; hi++) {
            const other = this.threats[hi];
            if (other.id !== t.id) {
              const hdx = other.x - t.x;
              const hdy = other.y - t.y;
              if (hdx * hdx + hdy * hdy < 8100) {
                other.hp = Math.min(other.maxHp, other.hp + 20);
                this.addFloatingText('+20 HP', other.x, other.y, '#4ade80', 0.8);
              }
            }
          }
        }
      } else if (t.type === 'sniper_ship') {
        // Hovers at top edge, charges laser shot
        if (t.y < 120) {
          t.vy = 20;
        } else {
          t.vy = 0;
          t.sniperCharge = (t.sniperCharge || 0) + dt;
          if (t.sniperCharge >= 3.5) {
            // Fire charged shot at base
            t.sniperCharge = 0;
            this.damageBase(22);
            sound.playBaseDamage();
            this.shake(8);
            this.addFloatingText('SNIPER SHOT IMPACT!', this.L_WIDTH / 2, 700, '#ef4444', 1.2);
          }
        }
      } else if (t.type === 'magnet_drone') {
        // Pulls and steals falling goodies (plain loop, no closure)
        for (let mi = 0; mi < this.goodies.length; mi++) {
          const g = this.goodies[mi];
          const dx = t.x - g.x;
          const dy = t.y - g.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 19600) {
            const dist = Math.sqrt(distSq) || 1;
            g.x += (dx / dist) * 110 * dt;
            g.y += (dy / dist) * 110 * dt;
            if (dist < t.radius + g.radius) {
              // Stolen! Remove the goodie HERE — teleporting it below the
              // defense line made updateGoodies() auto-collect it for the
              // player the very same frame (a steal that gifts the reward).
              this.addFloatingText('GOODIE STOLEN!', t.x, t.y, '#f87171', 1.0);
              this.goodies[mi] = this.goodies[this.goodies.length - 1];
              this.goodies.pop();
              mi--; // re-check the goodie swapped into this slot
            }
          }
        }
      } else if (t.type === 'fire_meteor') {
        // Emits fire trail
        if (Math.random() < 0.3) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 10,
            y: t.y,
            vx: (Math.random() - 0.5) * 15,
            vy: -40,
            radius: 3.5,
            color: '#ea580c',
            alpha: 0.9,
            life: 0,
            maxLife: 0.4,
          });
        }
      } else if (t.type === 'kamikaze') {
        if (t.y > 220 && Math.random() < 0.05) {
          sound.playKamikazeScream();
        }
        if (Math.random() < 0.5) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 6,
            y: t.y - t.radius,
            vx: (Math.random() - 0.5) * 16,
            vy: -90,
            radius: Math.random() * 3 + 1.5,
            color: Math.random() > 0.4 ? '#f97316' : '#facc15',
            alpha: 1,
            life: 0,
            maxLife: 0.3,
          });
        }
      } else if (t.type === 'alien_hoverbike') {
        // Fast agile lateral slalom weave
        t.x += Math.sin(timeSec * 5.5 + (t.phaseSeed ?? 0)) * 130 * dt;
        // Hover repulsor particle discharge
        if (Math.random() < 0.35) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 10,
            y: t.y + t.radius * 0.4,
            vx: (Math.random() - 0.5) * 30,
            vy: 40,
            radius: Math.random() * 2.5 + 1,
            color: '#22d3ee',
            alpha: 0.8,
            life: 0,
            maxLife: 0.25,
          });
        }
      } else if (t.type === 'plasma_raider') {
        // Solar raider (Era 11+): aggressive slalom + dripping plasma exhaust
        t.x += Math.sin(timeSec * 6.5 + (t.phaseSeed ?? 0)) * 165 * dt;
        if (Math.random() < 0.6) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 8,
            y: t.y + t.radius * 0.5,
            vx: (Math.random() - 0.5) * 24,
            vy: 55,
            radius: Math.random() * 3 + 1.5,
            color: Math.random() > 0.4 ? '#fbbf24' : '#fb923c',
            alpha: 0.9,
            life: 0,
            maxLife: 0.35,
            sparkle: true,
          });
        }
      } else if (t.type === 'chrono_wraith') {
        // Temporal wraith (Era 13+): blink-teleports toward Earth every ~2.4s,
        // leaving a shimmering afterimage. Freezes don't stop its clock.
        t.blinkTimer = (t.blinkTimer ?? 0) + dt;
        t.isPhasedOut = (t.blinkTimer ?? 0) > 2.1; // intangible right before the blink
        if ((t.blinkTimer ?? 0) >= 2.4) {
          t.blinkTimer = 0;
          t.isPhasedOut = false;
          this.createShockwave(t.x, t.y, '#fef08a', 42);
          t.x = this.clampCorridor(t.x + (Math.random() - 0.5) * 170, t.radius);
          t.y += 85;
          sound.playCrit();
          this.addFloatingText('TEMPORAL BLINK', t.x, t.y - 18, '#eab308', 0.9);
        }
      } else if (t.type === 'void_cruiser') {
        // Void cruiser (Era 14+): slow tank that lingers at the top and
        // bombards the base with void shells — kill it before it locks on.
        if (t.y < 160) {
          t.vy = 26;
        } else {
          t.vy = Math.sin(timeSec * 1.8) * 8;
        }
        t.bombardCharge = (t.bombardCharge ?? 0) + dt;
        if ((t.bombardCharge ?? 0) >= 4.2 && t.y > 60) {
          t.bombardCharge = 0;
          this.createShockwave(t.x, t.y, t.color, 60);
          this.damageBase(26);
          sound.playBaseDamage();
          this.shake(10);
          this.addFloatingText('VOID SHELL IMPACT!', this.L_WIDTH / 2, 700, '#fb7185', 1.2);
        }
      } else if (t.type === 'hypersonic_missile') {
        // Terminal-velocity dive with proportional guidance on the turret,
        // plus a jink weave so point-defense has to LEAD the shot instead of
        // just parking the reticle on it. Interception pays adrenaline —
        // the defensive skill feeds the rush loop (see onThreatDefeated).
        const maxVy = 430 + 120 * Math.min(1.4, this.powerFactor - 1);
        t.vy = Math.min(maxVy, t.vy + 340 * dt);
        t.missileWeavePhase = (t.missileWeavePhase ?? 0) + dt * 6.5;
        const steer = Math.max(-1, Math.min(1, (this.cannonX - t.x) / 110));
        t.vx += steer * 430 * dt + Math.sin(t.missileWeavePhase) * 70 * dt;
        t.vx = Math.max(-200, Math.min(200, t.vx));
        t.angle = Math.atan2(t.vy, t.vx); // nose aligns with the flight path
        // Hypersonic shock contrail
        if (Math.random() < 0.95) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 4,
            y: t.y - 6,
            vx: (Math.random() - 0.5) * 26 - t.vx * 0.05,
            vy: -60,
            radius: Math.random() * 3 + 1.5,
            color: Math.random() > 0.5 ? '#f43f5e' : '#fb923c',
            alpha: 0.9,
            life: 0,
            maxLife: 0.3,
          });
        }
      } else if (t.type === 'cluster_bomb') {
        // Cluster munition: armed once on screen, burns its fuse, then
        // AIRBURSTS into a fan of bomblets. Killing it early = defusal.
        if (t.y > 60) {
          t.clusterFuse = (t.clusterFuse ?? 3.4) - dt;
          if ((t.clusterFuse ?? 0) <= 0) {
            this.detonateClusterBomb(t);
            this.threats[i] = this.threats[this.threats.length - 1];
            this.threats.pop();
            continue;
          }
        }
        // Fuse spark sputters faster as the airburst nears
        if (Math.random() < 0.5) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 6,
            y: t.y - t.radius * 0.9,
            vx: (Math.random() - 0.5) * 20,
            vy: -30,
            radius: Math.random() * 2.5 + 1,
            color: (t.clusterFuse ?? 3) < 1 ? '#fde047' : '#fb923c',
            alpha: 1,
            life: 0,
            maxLife: 0.22,
            sparkle: true,
          });
        }
      } else if (t.type === 'cluster_bomblet') {
        // Tumbling submunition with a thin smoke trail
        if (Math.random() < 0.4) {
          this.spawnParticle({
            x: t.x,
            y: t.y - t.radius,
            vx: (Math.random() - 0.5) * 12,
            vy: -25,
            radius: Math.random() * 2 + 0.8,
            color: 'rgba(253, 186, 116, 0.8)',
            alpha: 0.7,
            life: 0,
            maxLife: 0.3,
          });
        }
      } else if (t.type === 'mirv_warhead') {
        // Guided MIRV bus: steady descent with a lateral drift correction
        // toward the turret's column, then SEPARATION into 3 seekers.
        t.missileWeavePhase = (t.missileWeavePhase ?? 0) + dt * 2.2;
        const steer = Math.max(-1, Math.min(1, (this.cannonX - t.x) / 160));
        t.vx += steer * 60 * dt + Math.sin(t.missileWeavePhase) * 26 * dt;
        t.vx = Math.max(-70, Math.min(70, t.vx));
        if (t.y >= 430) {
          this.splitMirvWarhead(t);
          this.threats[i] = this.threats[this.threats.length - 1];
          this.threats.pop();
          continue;
        }
        if (Math.random() < 0.7) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 5,
            y: t.y - 6,
            vx: (Math.random() - 0.5) * 20,
            vy: -50,
            radius: Math.random() * 2.5 + 1,
            color: Math.random() > 0.5 ? '#fb7185' : '#fda4af',
            alpha: 0.9,
            life: 0,
            maxLife: 0.28,
          });
        }
      } else if (t.type === 'railgun_slug') {
        // Charge phase: slides to the firing altitude, holds and charges
        // (visible aim line), then SNAPS down the bore at hypervelocity.
        // Intercept during the charge (easy) or during flight (a snap-shot).
        if (t.y < 36) {
          t.vy = 34; // approach the firing altitude
        } else if (t.vy < 100) {
          // Holding the bore line & charging — ONE-SHOT latch: once the dart
          // has fired (vy jumps to ~700), never re-enter this branch, or the
          // shot sound / floating text / haptic would re-fire every frame for
          // the whole flight.
          t.vy = 0; // hold the bore line
          t.specialTimer = (t.specialTimer ?? 0) + dt; // charge only at altitude
          if ((t.specialTimer ?? 0) >= 0.9) {
            t.vy = 700 + 90 * Math.min(1.6, this.powerFactor - 1);
            sound.playRailgunShot();
            this.addFloatingText('⚡ RAILGUN! ⚡', t.x, t.y + 30, '#22d3ee', 1.1);
            haptics.tap();
          }
        }
        // In flight (vy >= 100): pure hypervelocity descent — no re-charge.
        // Ionized bore streak while the dart is in flight
        if (t.vy > 100 && Math.random() < 0.9) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 4,
            y: t.y - 10,
            vx: (Math.random() - 0.5) * 14,
            vy: -80,
            radius: Math.random() * 2 + 1,
            color: Math.random() > 0.4 ? '#22d3ee' : '#a5f3fc',
            alpha: 0.9,
            life: 0,
            maxLife: 0.22,
          });
        }
      } else if (t.type === 'plasma_torpedo') {
        // Slow homing torpedo — lazily steers its column toward the turret
        const steer = Math.max(-1, Math.min(1, (this.cannonX - t.x) / 130));
        t.vx += steer * 46 * dt;
        t.vx = Math.max(-52, Math.min(52, t.vx));
        t.angle = Math.atan2(t.vy, t.vx);
        if (Math.random() < 0.5) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * 8,
            y: t.y - t.radius * 0.6,
            vx: (Math.random() - 0.5) * 18,
            vy: -35,
            radius: Math.random() * 3 + 1.5,
            color: Math.random() > 0.5 ? '#d946ef' : '#f0abfc',
            alpha: 0.85,
            life: 0,
            maxLife: 0.35,
            sparkle: true,
          });
        }
      } else if (t.type === 'siege_carrier') {
        // Mothership: parks in the upper sector and keeps launching hangar
        // drones — a sustained pressure source the defender must prioritize.
        if (t.y < 150) {
          t.vy = 24;
        } else {
          t.vy = Math.sin(timeSec * 1.6) * 6;
        }
        t.launchCd = (t.launchCd ?? 2) - dt;
        if ((t.launchCd ?? 0) <= 0 && t.y > 90 && this.threats.length < 46) {
          t.launchCd = 2.9;
          const drone = this.createSpecificThreat('mini_drone', t.x + (Math.random() - 0.5) * 30, t.y + t.radius * 0.7);
          this.threats.push(drone);
          this.createShockwave(t.x, t.y + t.radius * 0.5, '#38bdf8', 36);
          this.addFloatingText('HANGAR LAUNCH', t.x, t.y + t.radius + 14, '#7dd3fc', 0.8);
        }
      } else if (t.type === 'tesla_node') {
        // Arc satellite: parks, charges, then shocks the turret circuits —
        // firing disabled ~1.4s. The counterplay is to kill it fast.
        if (t.y < 150) {
          t.vy = 24;
        } else {
          t.vy = Math.sin(timeSec * 2.0) * 7;
        }
        t.teslaCharge = (t.teslaCharge ?? 0) + dt;
        if ((t.teslaCharge ?? 0) >= 3.4 && t.y > 90) {
          t.teslaCharge = 0;
          this.fireTeslaArc(t);
        }
      } else if (t.type === 'hunter_killer') {
        if (!t.isDiving) {
          // Tracking phase: prowls the upper field painting its lock-on
          if (t.y < 190) {
            t.vy = 52;
          } else {
            t.vy = 0;
          }
          t.x += Math.sin(timeSec * 3.2 + (t.phaseSeed ?? 0)) * 110 * dt;
          t.lockOnTimer = (t.lockOnTimer ?? 2) - dt;
          if ((t.lockOnTimer ?? 0) <= 0) {
            t.isDiving = true;
            t.vy = 140;
            sound.playKamikazeScream();
            this.addFloatingText('🎯 LOCKED ON!', t.x, t.y + 24, '#ef4444', 1.0);
          }
        } else {
          // Terminal dive: proportional guidance + jink, like a slower but
          // earlier-arriving cousin of the hypersonic missile.
          const maxVy = 370 + 55 * Math.min(1.4, this.powerFactor - 1);
          t.vy = Math.min(maxVy, t.vy + 300 * dt);
          t.missileWeavePhase = (t.missileWeavePhase ?? 0) + dt * 5.2;
          const steer = Math.max(-1, Math.min(1, (this.cannonX - t.x) / 110));
          t.vx += steer * 330 * dt + Math.sin(t.missileWeavePhase) * 55 * dt;
          t.vx = Math.max(-190, Math.min(190, t.vx));
          t.angle = Math.atan2(t.vy, t.vx);
          if (Math.random() < 0.8) {
            this.spawnParticle({
              x: t.x + (Math.random() - 0.5) * 5,
              y: t.y - 6,
              vx: (Math.random() - 0.5) * 24,
              vy: -70,
              radius: Math.random() * 2.5 + 1,
              color: Math.random() > 0.5 ? '#ef4444' : '#fb923c',
              alpha: 0.9,
              life: 0,
              maxLife: 0.26,
            });
          }
        }
      } else if (t.type === 'mirror_shade') {
        // Gentle synchronized weave — the pair moves like one reflection
        t.x += Math.sin(timeSec * 2.6 + (t.phaseSeed ?? 0)) * 70 * dt;
        if (t.isHoloDecoy && Math.random() < 0.35) {
          // Hologram scanline glitch sparks — the subtle tell
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * t.radius * 1.6,
            y: t.y + (Math.random() - 0.5) * t.radius * 1.6,
            vx: (Math.random() - 0.5) * 24,
            vy: (Math.random() - 0.5) * 24,
            radius: Math.random() * 1.8 + 0.8,
            color: '#c4b5fd',
            alpha: 0.8,
            life: 0,
            maxLife: 0.2,
          });
        }
      } else if (t.isBoss) {
        // Upper orbital sector cruise
        if (t.y < 155) {
          t.vy = 18;
        } else {
          t.vy = Math.sin(timeSec * 2.5) * 6;
        }

        // DIMENSIONAL PHASE-SHIFT (Void Weaver doctrine): mid-shift flagships
        // are intangible — rounds and pulses pass straight through — while
        // they drift toward the next rift anchor, then re-form with a pair
        // of phase ghosts slipping through the closing seam.
        if (t.isPhasedOut) {
          t.blinkTimer = (t.blinkTimer ?? 0) - dt;
          if ((t.blinkTimer ?? 0) <= 0) {
            t.isPhasedOut = false;
            t.blinkTimer = 0;
            t.vx = (Math.random() > 0.5 ? 1 : -1) * 60;
            this.createShockwave(t.x, t.y, '#c026d3', 100);
            sound.playTeslaZap();
            this.addFloatingText('RIFT RE-FORMED!', t.x, t.y - t.radius - 12, '#e879f9', 1.0);
            for (let i = 0; i < 2; i++) {
              this.threats.push(
                this.createSpecificThreat('phase_ghost', this.clampCorridor(t.x + (i === 0 ? -60 : 60), 16), t.y + 14)
              );
            }
          }
        }

        // Phase 2 Enraged at 55% hull — the hurt starts EARLIER now
        if (t.hp <= t.maxHp * 0.55 && t.bossPhase === 1) {
          t.bossPhase = 2;
          sound.playBossAlert();
          this.shake(20);
          haptics.alarm();
          this.createShockwave(t.x, t.y, '#ef4444', 130);
          this.addFloatingText('🚨 BOSS ENRAGED: PHASE 2! 🚨', t.x, t.y - 45, '#ef4444', 1.5);
          t.vx = (t.vx > 0 ? 1 : -1) * 60;

          // Summon 3 Alien Hoverbike raiders as escorts!
          this.threats.push(this.createSpecificThreat('alien_hoverbike', this.clampCorridor(t.x - 110, 30), t.y + 10));
          this.threats.push(this.createSpecificThreat('alien_hoverbike', t.x, t.y + 10));
          this.threats.push(this.createSpecificThreat('alien_hoverbike', this.clampCorridor(t.x + 110, 30), t.y + 10));
        }

        // Phase 3 — Doomsday Protocol at 25% hull: the cornered flagship
        // scrambles everything it has left and attacks in a panic rhythm —
        // kamikaze flights AND live cluster ordnance straight onto the grid.
        if (t.bossPhase === 2 && t.hp <= t.maxHp * 0.25) {
          t.bossPhase = 3;
          sound.playBossAlarm();
          this.shake(26);
          haptics.alarm();
          this.createShockwave(t.x, t.y, '#fb7185', 180);
          this.addFloatingText('⚠️ DOOMSDAY PROTOCOL: FINAL PHASE ⚠️', this.L_WIDTH / 2, t.y - 45, '#fb7185', 1.6);
          t.vx = (t.vx > 0 ? 1 : -1) * 105;
          this.threats.push(this.createSpecificThreat('kamikaze', this.clampCorridor(t.x - 90, 30), t.y + 14));
          this.threats.push(this.createSpecificThreat('kamikaze', t.x, t.y + 14));
          this.threats.push(this.createSpecificThreat('kamikaze', this.clampCorridor(t.x + 90, 30), t.y + 14));
          // PANIC ORDNANCE: two live cluster bombs dumped onto the defense
          // grid — defuse them mid-air or eat the airburst.
          this.threats.push(this.createSpecificThreat('cluster_bomb', this.clampCorridor(t.x - 55, 45), t.y + 14));
          this.threats.push(this.createSpecificThreat('cluster_bomb', this.clampCorridor(t.x + 55, 45), t.y + 14));
        }

        // Regenerating flagship shielding — anti-burst armor. A maxed weapon
        // front-loading damage and then idling watches the void shields knit
        // back at 5%/s after just 4s of silence; only SUSTAINED fire keeps
        // them down.
        if (
          t.maxShieldHp > 0 &&
          t.shieldHp < t.maxShieldHp &&
          timeSec - (t.lastDamagedAt ?? -99) > 4
        ) {
          t.shieldHp = Math.min(t.maxShieldHp, t.shieldHp + t.maxShieldHp * 0.05 * dt);
        }

        // Periodic boss weapon barrage — cadence tightens per phase AND per
        // the defender's firepower (a maxed arsenal faces a hastier flagship).
        t.specialTimer = (t.specialTimer || 0) + dt;
        const haste = Math.max(0.38, 1 / (1 + 0.32 * (this.powerFactor - 1)));
        const baseInterval = t.bossPhase === 3 ? 1.8 : t.bossPhase === 2 ? 2.6 : 4.0;
        if (t.specialTimer >= baseInterval * haste && t.y > 60 && !t.isPhasedOut) {
          t.specialTimer = 0;
          this.executeBossAttack(t);
        }

        if (Math.random() < 0.4) {
          this.spawnParticle({
            x: t.x + (Math.random() - 0.5) * t.radius * 1.2,
            y: t.y - t.radius * 0.7,
            vx: (Math.random() - 0.5) * 20,
            vy: -90,
            radius: Math.random() * 4 + 2,
            color: t.bossPhase === 3 ? '#fb7185' : t.bossPhase === 2 ? '#ef4444' : t.color,
            alpha: 1,
            life: 0,
            maxLife: 0.35,
          });
        }
      }

      t.x += t.vx * dt * speedMult;
      t.y += t.vy * dt * speedMult;

      // Keep inside horizontal bounds — the COMBAT CORRIDOR, not the full
      // logical width: on widescreen desktops hostiles stay over the globe
      // where the fixed center turret can always engage them.
      const cLo = this.L_WIDTH / 2 - this.corridorHalf;
      const cHi = this.L_WIDTH / 2 + this.corridorHalf;
      if (t.x < cLo + t.radius) {
        t.x = cLo + t.radius;
        t.vx = Math.abs(t.vx);
      } else if (t.x > cHi - t.radius) {
        t.x = cHi - t.radius;
        t.vx = -Math.abs(t.vx);
      }

      // Threat reaches Earth Base!
      if (t.y + t.radius >= this.cannonY) {
        this.onThreatReachedBase(t);
        this.threats[i] = this.threats[this.threats.length - 1];
        this.threats.pop();
      }
    }
  }

  /**
   * Threatening-round check → evasive jink. Craft roll their archetype
   * skill (boosted by the player's firepower — smarter weapons, smarter
   * pilots); on success they throw a lateral burn perpendicular to the
   * round's line of flight, with an afterburner flare for readability.
   */
  private updateEvasion(t: Threat, dt: number) {
    t.dodgeCd = (t.dodgeCd ?? 0) - dt;
    if (t.dodgeCd > 0 || this.projectiles.length === 0) return;

    // Find the round on a collision course with the soonest intercept
    // (squared-speed early-out; sqrt only for the finalist — hypot in this
    // T×P loop was a late-run frame eater)
    let menace: Projectile | null = null;
    let menaceTc = Infinity;
    for (let pi = 0; pi < this.projectiles.length; pi++) {
      const p = this.projectiles[pi];
      const speedSq = p.vx * p.vx + p.vy * p.vy;
      if (speedSq < 6400) continue;
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const dot = dx * p.vx + dy * p.vy;
      if (dot <= 0) continue; // moving away from us
      const tc = dot / speedSq; // seconds to closest approach
      if (tc > 0.5) continue; // not immediate enough to react
      const miss = Math.abs(dx * p.vy - dy * p.vx) / Math.sqrt(speedSq); // perpendicular miss distance
      if (miss > t.radius + p.radius + 9) continue; // will miss anyway
      if (tc < menaceTc) {
        menaceTc = tc;
        menace = p;
      }
    }
    if (!menace) return;

    const skill = (t.evasionSkill ?? 0) * Math.min(1, 0.25 + 0.75 * ((this.powerFactor - 1) / 4.2));
    if (Math.random() >= skill) {
      t.dodgeCd = 0.3; // failed the read — brief window before re-checking
      return;
    }

    // Lateral burn away from the round's flight line
    const mSpeed = Math.hypot(menace.vx, menace.vy) || 1;
    const nx = -menace.vy / mSpeed;
    const ny = menace.vx / mSpeed;
    const cross = (t.x - menace.x) * menace.vy - (t.y - menace.y) * menace.vx;
    const side = cross >= 0 ? -1 : 1;
    const impulse = 220 + 100 * Math.min(1, (this.powerFactor - 1) / 4.2);
    t.vx += nx * side * impulse;
    t.vy += ny * side * impulse * 0.4;
    t.vx = Math.max(-250, Math.min(250, t.vx));
    t.vy = Math.max(-40, Math.min(320, t.vy));
    t.dodgeCd = 0.85 + Math.random() * 0.5;

    // Afterburner flare so the juke reads clearly
    for (let i = 0; i < 6; i++) {
      this.spawnParticle({
        x: t.x - nx * side * t.radius * 0.6,
        y: t.y - ny * side * t.radius * 0.6,
        vx: -nx * side * (60 + Math.random() * 90),
        vy: -ny * side * (60 + Math.random() * 90) * 0.4,
        radius: Math.random() * 2.5 + 1,
        color: Math.random() > 0.5 ? '#fbbf24' : '#fb923c',
        alpha: 1,
        life: 0,
        maxLife: 0.28,
      });
    }
    if (Math.random() < 0.22) {
      this.addFloatingText('EVADED!', t.x, t.y - t.radius - 8, '#fbbf24', 0.8);
    }
  }

  /**
   * Boss attack pattern roller — now a SIGNATURE DOCTRINE engine.
   *
   * Every flagship fights with the signature ability from its era registry
   * entry (lib/bossData.ts): Krag'Tor hurls splitting drill-slabs, Ignis
   * rains sweeping meteor curtains, Xylar blink-strikes, Vex recharges his
   * Aegis barriers, Rustjaw bends your gunfire with a scrap vortex — one
   * distinct doctrine per era, all fifteen counter-playable. A slim shared
   * ordnance pool keeps cadence texture between signature casts, still
   * scaling with phase and the defender's firepower.
   */
  private executeBossAttack(t: Threat) {
    const phase = t.bossPhase ?? 1;
    const pf = this.powerFactor;

    const pool: Array<{ w: number; run: () => void }> = [];

    // Signature doctrine — the flagship's own ability, dominant weight and
    // climbing with each enrage phase so the fight is DEFINED by it.
    const eraSig = ((t.bossEraNumber ?? 1) - 1) % 15 + 1;
    pool.push({ w: 62 + phase * 10, run: () => this.executeSignatureAttack(t, eraSig, phase) });

    // Shared ordnance texture between signature casts
    pool.push({ w: 16, run: () => this.bossKamikazeDrop(t, phase) });
    pool.push({
      w: 18,
      run: () => this.launchHypersonicVolley(t, this.hypersonicVolleyCount(phase, pf), t.type === 'era_boss'),
    });
    pool.push({
      w: phase >= 3 ? 14 : phase === 2 ? 12 : 8,
      run: () => this.bossClusterBombardment(t, phase),
    });
    if (phase >= 2) {
      pool.push({ w: 10, run: () => this.bossEscortWing(t, phase) });
    }
    if (phase >= 2 || pf > 1.8) {
      // RAILGUN VOLLEY — hypervelocity snap-shot duels
      pool.push({ w: 9, run: () => this.bossRailgunVolley(phase) });
    }
    if (phase >= 3 || pf > 2.4) {
      // MIRV STRIKE — a separable warhead bus
      pool.push({ w: 10, run: () => this.bossMirvStrike(t) });
    }
    if (phase >= 2 && pf > 2.2 && !this.threats.some((o) => o.type === 'siege_carrier')) {
      // SIEGE DEPLOY — launch a drone carrier (one at a time)
      pool.push({ w: 8, run: () => this.bossSiegeDeploy(t) });
    }

    const total = pool.reduce((sum, p) => sum + p.w, 0);
    let roll = Math.random() * total;
    for (const p of pool) {
      roll -= p.w;
      if (roll <= 0) {
        p.run();
        return;
      }
    }
    this.executeSignatureAttack(t, eraSig, phase);
  }

  private hypersonicVolleyCount(phase: number, pf: number): number {
    const baseCount = phase === 1 ? 1 : phase === 2 ? 2 : 3;
    const extra = pf > 2.5 ? 1 : 0;
    return Math.min(4, baseCount + extra);
  }

  // --- Signature doctrines (one per era flagship) ---------------------------
  // Each doctrine is the flagship's registered specialAbility made real:
  // distinct spawns, distinct counter-play, phase-scaled intensity.

  /** Dispatch the flagship's era signature ability. eraSig is normalized 1-15. */
  private executeSignatureAttack(t: Threat, eraSig: number, phase: number) {
    switch (eraSig) {
      case 1:
        return this.doctrineSeismicShatter(t, phase);
      case 2:
        return this.doctrineMeteorCurtain(t, phase);
      case 3:
        return this.doctrineQuantumBlink(t, phase);
      case 4:
        return this.doctrineAegisBarrier(t, phase);
      case 5:
        return this.doctrineScrapVortex(t, phase);
      case 6:
        return this.doctrineSwarmReplicator(t, phase);
      case 7:
        return this.doctrinePhaseShift(t, phase);
      case 8:
        return this.doctrineFreezeCannon(t, phase);
      case 9:
        return this.doctrineBroodInfestation(t, phase);
      case 10:
        return this.doctrineSingularityCollapse(t, phase);
      case 11:
        return this.doctrineCoronalEjection(t, phase);
      case 12:
        return this.doctrineSpawnReef(t, phase);
      case 13:
        return this.doctrineTemporalBarrage(t, phase);
      case 14:
        return this.doctrineVoidSiege(t, phase);
      default:
        return this.doctrineCascadeOverload(t, phase);
    }
  }

  /** Boss blink-teleport: warp-out implosion, corridor reposition, warp-in flash. */
  private bossBlinkShift(t: Threat, color: string, label: string) {
    // Warp-out implosion at the old anchor
    this.createShockwave(t.x, t.y, color, 70);
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      this.spawnParticle({
        x: t.x + Math.cos(ang) * t.radius,
        y: t.y + Math.sin(ang) * t.radius,
        vx: -Math.cos(ang) * 120,
        vy: -Math.sin(ang) * 120,
        radius: Math.random() * 3 + 1.5,
        color,
        alpha: 1,
        life: 0,
        maxLife: 0.32,
      });
    }
    // Re-materialize at a distant corridor anchor
    t.x = this.clampCorridor(t.x + (Math.random() > 0.5 ? 1 : -1) * (150 + Math.random() * 130), t.radius + 12);
    t.vx = (t.x > this.L_WIDTH / 2 ? -1 : 1) * (48 + Math.random() * 30);
    this.createShockwave(t.x, t.y, color, 95);
    sound.playTeslaZap();
    this.shake(6);
    this.addFloatingText(label, t.x, t.y - t.radius - 12, color, 1.05);
  }

  /**
   * KRAG'TOR — Seismic Rock Shatter (Era 1): armored drill-slab volley.
   * Every slab SPLITS into fragments when destroyed — shatter them high and
   * the workload doubles; let them land and the grid eats the impact.
   */
  private doctrineSeismicShatter(t: Threat, phase: number) {
    this.addFloatingText('🪨 SEISMIC ROCK SHATTER! 🪨', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#10b981', 1.25);
    sound.playBossAlarm();
    this.shake(11);
    haptics.medium();
    this.createShockwave(t.x, t.y, t.color, 90);
    const slabs = [2, 3, 4][phase - 1];
    for (let i = 0; i < slabs; i++) {
      const slab = this.createSpecificThreat(
        'asteroid_large',
        this.clampCorridor(t.x + (i - (slabs - 1) / 2) * 64, 26),
        t.y + t.radius + 10
      );
      slab.vy = 85 + (phase - 1) * 12; // slammed down, not drifted
      slab.vx = (i - (slabs - 1) / 2) * 22;
      this.threats.push(slab);
    }
    // Seismic tremor flecks shaken loose by the slam
    const flecks = phase >= 2 ? 3 : 2;
    for (let i = 0; i < flecks; i++) {
      this.threats.push(
        this.createSpecificThreat('debris_junk', this.clampCorridor(t.x + (Math.random() - 0.5) * 200, 16), t.y + t.radius + 24)
      );
    }
  }

  /**
   * IGNIS — Solar Flare Meteor Shower (Era 2): a SWEEPING curtain of fire
   * meteors marching across the corridor in sequence — a rolling solar
   * front, center hottest, edges trailing.
   */
  private doctrineMeteorCurtain(t: Threat, phase: number) {
    this.addFloatingText('🔥 SOLAR FLARE METEOR SHOWER! 🔥', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#f97316', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(8);
    const count = [5, 6, 8][phase - 1];
    const dir = Math.random() > 0.5 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const mx = this.clampCorridor(this.L_WIDTH / 2 + dir * (frac - 0.5) * 2 * (this.corridorHalf - 30), 20);
      const m = this.createSpecificThreat('fire_meteor', mx, t.y + t.radius + 6 + i * 4);
      m.vy = 70 + (1 - Math.abs(frac - 0.5) * 2) * 55 + (phase - 1) * 14;
      m.vx = dir * 16;
      this.threats.push(m);
    }
  }

  /**
   * XYLAR — Quantum Teleport Blaster (Era 3): the saucer BLINKS to a new
   * corridor anchor and instantly fires an aimed salvo of homing plasma
   * torpedoes. The defender has to re-acquire the flagship fast.
   */
  private doctrineQuantumBlink(t: Threat, phase: number) {
    this.bossBlinkShift(t, '#5eead4', 'QUANTUM BLINK!');
    const shots = [2, 3, 4][phase - 1];
    for (let i = 0; i < shots; i++) {
      this.threats.push(
        this.createSpecificThreat('plasma_torpedo', this.clampCorridor(t.x + (i - (shots - 1) / 2) * 26, 14), t.y + t.radius + 10)
      );
    }
  }

  /**
   * VEX — Multi-Barrier Aegis Shield (Era 4): emergency barrier RECHARGE —
   * broken void shields knit back in one dramatic pulse (+35% of max, +50%
   * in Doomsday) while shielded escorts materialize alongside. Only
   * SUSTAINED fire keeps the Aegis down; burst damage gets undone.
   */
  private doctrineAegisBarrier(t: Threat, phase: number) {
    if (t.maxShieldHp > 0 && t.shieldHp < t.maxShieldHp * 0.999) {
      const restore = Math.round(t.maxShieldHp * (phase === 3 ? 0.5 : 0.35));
      t.shieldHp = Math.min(t.maxShieldHp, t.shieldHp + restore);
      this.addFloatingText('🛡 AEGIS RECHARGE! 🛡', t.x, t.y - t.radius - 14, '#38bdf8', 1.25);
      sound.playCrit();
      this.createShockwave(t.x, t.y, '#38bdf8', 120);
      this.shake(7);
      const escorts = phase >= 2 ? 2 : 1;
      for (let i = 0; i < escorts; i++) {
        this.threats.push(
          this.createSpecificThreat('shielded_trooper', this.clampCorridor(t.x + (i === 0 ? -70 : 70), 22), t.y + 16)
        );
      }
    } else {
      // Barriers already standing — project a fresh escort wall instead
      this.addFloatingText('KINETIC BARRIERS TO MAXIMUM!', t.x, t.y - t.radius - 14, '#a78bfa', 1.15);
      sound.playBossAlarm();
      const escorts = phase >= 2 ? 3 : 2;
      for (let i = 0; i < escorts; i++) {
        this.threats.push(
          this.createSpecificThreat('shielded_trooper', this.clampCorridor(t.x + (i - (escorts - 1) / 2) * 62, 22), t.y + 16)
        );
      }
    }
  }

  /**
   * RUSTJAW — Magnetic Scrap Vortex (Era 5): a vortex WELL drops onto the
   * lane and bends every projectile that passes near it — the defender's
   * aim literally curves. Shoot around it, or shatter the well itself.
   * Hurled scrap chunks ride the distortion in.
   */
  private doctrineScrapVortex(t: Threat, phase: number) {
    this.addFloatingText('🧲 MAGNETIC SCRAP VORTEX! 🧲', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#f59e0b', 1.25);
    sound.playBossAlarm();
    haptics.medium();
    this.shake(9);
    const well = this.createSpecificThreat('gravity_well', this.clampCorridor(t.x, 30), t.y + t.radius + 26);
    well.vy = 26; // slow creep — the hazard lingers
    this.threats.push(well);
    const chunks = [3, 4, 5][phase - 1];
    for (let i = 0; i < chunks; i++) {
      const j = this.createSpecificThreat('debris_junk', this.clampCorridor(t.x + (i - (chunks - 1) / 2) * 58, 16), t.y + t.radius + 12);
      j.vx = (i - (chunks - 1) / 2) * 34;
      this.threats.push(j);
    }
  }

  /**
   * SYNTH-PRIME 09 — Drone Swarm Replicator (Era 6): replicator pods that
   * each SHATTER into three drones when destroyed. Kill the pods and the
   * swarm MULTIPLIES; ignore them and they slam the grid whole. The
   * defender chooses which poison to drink.
   */
  private doctrineSwarmReplicator(t: Threat, phase: number) {
    if (this.threats.length > 40) return; // pressure cap
    this.addFloatingText('💠 DRONE SWARM REPLICATOR! 💠', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#34d399', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    const pods = [2, 3, 4][phase - 1];
    for (let i = 0; i < pods; i++) {
      this.threats.push(
        this.createSpecificThreat('swarm_pod', this.clampCorridor(t.x + (i - (pods - 1) / 2) * 72, 24), t.y + t.radius + 10)
      );
    }
    if (phase >= 2) {
      for (let i = 0; i < 3; i++) {
        this.threats.push(
          this.createSpecificThreat('mini_drone', this.clampCorridor(t.x + (Math.random() - 0.5) * 160, 12), t.y + t.radius + 22)
        );
      }
    }
  }

  /**
   * NYX — Dimensional Phase Shift (Era 7): the flagship steps BETWEEN
   * dimensions — fully intangible while she drifts to her next rift anchor
   * (rounds and pulses pass through the seam), then re-forms and releases a
   * pair of phase ghosts. Burst her during the tangible windows.
   */
  private doctrinePhaseShift(t: Threat, phase: number) {
    if (t.isPhasedOut) return; // already mid-shift
    this.addFloatingText('🔮 DIMENSIONAL PHASE SHIFT! 🔮', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#e879f9', 1.25);
    sound.playTeslaZap();
    haptics.medium();
    this.createShockwave(t.x, t.y, '#c026d3', 110);
    t.isPhasedOut = true;
    t.blinkTimer = phase === 3 ? 1.1 : 1.6; // Doomsday: shorter but frequent shifts
    t.vx = (Math.random() > 0.5 ? 1 : -1) * 120;
  }

  /**
   * GLACIUS — Sub-Zero Freeze Cannon (Era 8): a volley of freeze lances —
   * any comet that reaches the grid flash-freezes the turret for 2.5s.
   * Intercept them mid-air or lose the firing line entirely.
   */
  private doctrineFreezeCannon(t: Threat, phase: number) {
    this.addFloatingText('❄️ SUB-ZERO FREEZE CANNON! ❄️', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#7dd3fc', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(8);
    const lances = [2, 3, 4][phase - 1];
    for (let i = 0; i < lances; i++) {
      const c = this.createSpecificThreat('ice_comet', this.clampCorridor(t.x + (i - (lances - 1) / 2) * 58, 20), t.y + t.radius + 10);
      c.vx = (i - (lances - 1) / 2) * 18;
      this.threats.push(c);
    }
  }

  /**
   * XOL'ZARA — Parasitic Brood Infestation (Era 9): lock-on broodlings that
   * paint the turret, stalk, then boost-dive. Phase 2+ deploys a Bio Healer
   * that knits the brood back — kill the healer FIRST or fight a tanking swarm.
   */
  private doctrineBroodInfestation(t: Threat, phase: number) {
    if (this.threats.length > 40) return; // pressure cap
    this.addFloatingText('🪲 PARASITIC BROOD INFESTATION! 🪲', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#f472b6', 1.25);
    sound.playBossAlarm();
    haptics.medium();
    const brood = [3, 4, 5][phase - 1];
    for (let i = 0; i < brood; i++) {
      this.threats.push(
        this.createSpecificThreat('hunter_killer', this.clampCorridor(t.x + (i - (brood - 1) / 2) * 56, 18), t.y + t.radius + 12)
      );
    }
    if (phase >= 2 && !this.threats.some((o) => o.type === 'healer_ship')) {
      this.threats.push(this.createSpecificThreat('healer_ship', this.clampCorridor(t.x + (Math.random() - 0.5) * 120, 22), t.y + 8));
    }
  }

  /**
   * SOVEREIGN — Gravitational Singularity Collapse (Era 10): paired
   * singularities warp every projectile's flight path — gunfire curls into
   * the wells — while a MIRV bus rides the distortion in behind them.
   */
  private doctrineSingularityCollapse(t: Threat, phase: number) {
    this.addFloatingText('🌌 GRAVITATIONAL SINGULARITY COLLAPSE! 🌌', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#818cf8', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(12);
    const wells = phase >= 3 ? 3 : 2;
    for (let i = 0; i < wells; i++) {
      const well = this.createSpecificThreat('gravity_well', this.clampCorridor(t.x + (i - (wells - 1) / 2) * 150, 28), t.y + t.radius + 30);
      well.vy = 22;
      this.threats.push(well);
    }
    this.threats.push(this.createSpecificThreat('mirv_warhead', this.clampCorridor(t.x, 20), t.y + t.radius + 8));
  }

  /**
   * HELIOS PRIME — Coronal Mass Ejection (Era 11): a full-width WALL of
   * coronal fire marching down as one simultaneous front with a single gap
   * seam. Everything that lands burns the grid — thin the wall fast.
   */
  private doctrineCoronalEjection(t: Threat, phase: number) {
    this.addFloatingText('☀️ CORONAL MASS EJECTION! ☀️', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#fbbf24', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(14);
    const slots = [7, 8, 9][phase - 1];
    const gapIdx = Math.floor(Math.random() * slots);
    const span = (this.corridorHalf - 34) * 2;
    for (let i = 0; i < slots; i++) {
      if (i === gapIdx) continue; // the seam
      const m = this.createSpecificThreat(
        'fire_meteor',
        this.clampCorridor(this.L_WIDTH / 2 - span / 2 + (i / (slots - 1)) * span, 18),
        t.y + t.radius + 8
      );
      m.vy = 88 + (phase - 1) * 16; // the whole wall marches as one
      m.radius = Math.max(15, m.radius - 3); // leaner fronts, but MANY
      this.threats.push(m);
    }
  }

  /**
   * ABYSSUS MAW — Bioluminescent Spawn Reef (Era 12): a living reef takes
   * root — arc nodes park and SHOCK the turret circuits while lure-light
   * orbs drift in front. Shatter the nodes before the stuns stack.
   */
  private doctrineSpawnReef(t: Threat, phase: number) {
    this.addFloatingText('🐋 BIOLUMINESCENT REEF RISES! 🐋', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#22d3ee', 1.25);
    sound.playBossAlarm();
    haptics.medium();
    this.shake(9);
    const nodes = phase >= 2 ? 2 : 1;
    if (!this.threats.some((o) => o.type === 'tesla_node')) {
      for (let i = 0; i < nodes; i++) {
        this.threats.push(
          this.createSpecificThreat('tesla_node', this.clampCorridor(t.x + (i - (nodes - 1) / 2) * 150, 24), t.y + t.radius + 22)
        );
      }
    }
    for (let i = 0; i < 2; i++) {
      this.threats.push(
        this.createSpecificThreat('void_orb', this.clampCorridor(t.x + (i - 0.5) * 130, 22), t.y + t.radius + 12)
      );
    }
  }

  /**
   * CHRONARCH ZETA — Temporal Blink Barrage (Era 13): the flagship stutters
   * through time — blink, echo wraiths that teleport alongside it, and a
   * railgun snap-shot volley down the bores. Track the TRUE flagship.
   */
  private doctrineTemporalBarrage(t: Threat, phase: number) {
    this.addFloatingText('⏳ TEMPORAL BLINK BARRAGE! ⏳', this.L_WIDTH / 2, Math.max(90, t.y + 30), '#eab308', 1.25);
    this.bossBlinkShift(t, '#fef08a', 'TEMPORAL BLINK!');
    const wraiths = phase >= 2 ? 2 : 1;
    for (let i = 0; i < wraiths; i++) {
      this.threats.push(
        this.createSpecificThreat('chrono_wraith', this.clampCorridor(t.x + (i === 0 ? -120 : 120), 18), t.y + 10)
      );
    }
    this.bossRailgunVolley(phase);
  }

  /**
   * NOX — Void Legion Orbital Siege (Era 14): legion cruisers park at range
   * and SHELL the grid from orbit while void orbs screen their approach.
   * Doomsday adds an EMP asteroid that jams the special-weapons bank —
   * "the light of your sun has been withdrawn from service."
   */
  private doctrineVoidSiege(t: Threat, phase: number) {
    this.addFloatingText('👑 VOID LEGION ORBITAL SIEGE! 👑', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#fb7185', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(11);
    const cruisers = phase >= 2 ? 2 : 1;
    if (!this.threats.some((o) => o.type === 'void_cruiser')) {
      for (let i = 0; i < cruisers; i++) {
        this.threats.push(
          this.createSpecificThreat('void_cruiser', this.clampCorridor(t.x + (i - (cruisers - 1) / 2) * 160, 24), t.y + 6)
        );
      }
    }
    for (let i = 0; i < 2; i++) {
      this.threats.push(this.createSpecificThreat('void_orb', this.clampCorridor(t.x + (i - 0.5) * 130, 22), t.y + t.radius + 12));
    }
    if (phase >= 3 && !this.threats.some((o) => o.type === 'emp_asteroid')) {
      this.threats.push(this.createSpecificThreat('emp_asteroid', this.clampCorridor(t.x, 20), t.y + t.radius + 18));
    }
  }

  /**
   * OMEGA PRIME — Multiversal Cascade Overload (Era 15): the Convergence
   * fires doctrines from TWO earlier eras simultaneously (three in
   * Doomsday) — a cascade of every ending the defender has already
   * survived — with mirror-shade decoys flickering in behind the surge.
   */
  private doctrineCascadeOverload(t: Threat, phase: number) {
    this.addFloatingText('✨ MULTIVERSAL CASCADE OVERLOAD! ✨', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#c4b5fd', 1.3);
    sound.playBossAlarm();
    haptics.violent();
    this.shake(16);
    const picks = new Set<number>();
    const pickCount = phase >= 3 ? 3 : 2;
    while (picks.size < pickCount) {
      picks.add(1 + Math.floor(Math.random() * 14)); // eras 1-14 only — never itself
    }
    picks.forEach((era) => this.executeSignatureAttack(t, era, phase));
    if (phase >= 2 && this.threats.length < 40) {
      const real = this.createSpecificThreat('mirror_shade', this.clampCorridor(t.x - 80, 18), t.y + 16);
      const decoy = this.createSpecificThreat('mirror_shade', this.clampCorridor(t.x + 80, 18), t.y + 16);
      decoy.isHoloDecoy = true;
      decoy.hp = 1;
      decoy.maxHp = 1;
      decoy.damageToBase = 6;
      decoy.cashReward = 6;
      decoy.scoreReward = 30;
      this.threats.push(real, decoy);
    }
  }

  // --- Boss pattern implementations -----------------------------------------

  private bossKamikazeDrop(t: Threat, phase: number) {
    this.createShockwave(t.x, t.y, t.color, 50);
    sound.playCrit();
    this.addFloatingText('BARRAGE INCOMING!', t.x, t.y + 24, '#f43f5e', 1.1);
    const drones = phase >= 2 ? 2 : 1;
    for (let i = 0; i < drones; i++) {
      this.threats.push(
        this.createSpecificThreat('kamikaze', t.x + (i - (drones - 1) / 2) * 30, t.y + t.radius + 12)
      );
    }
  }

  private bossEscortWing(t: Threat, phase: number) {
    this.addFloatingText('ESCORT WING DEPLOYED!', t.x, t.y + 26, '#f43f5e', 1.1);
    sound.playCrit();
    this.createShockwave(t.x, t.y, t.color, 50);
    const escorts = phase >= 3 ? 3 : 2;
    for (let i = 0; i < escorts; i++) {
      const ex = this.clampCorridor(t.x + (i - (escorts - 1) / 2) * 70, 26);
      this.threats.push(this.createSpecificThreat('alien_hoverbike', ex, t.y + 12));
    }
  }

  /** CLUSTER BOMBARDMENT — the flagship carpets the grid with airburst ordnance. */
  private bossClusterBombardment(t: Threat, phase: number) {
    this.addFloatingText('💣 CLUSTER BOMBARDMENT! 💣', this.L_WIDTH / 2, Math.max(110, t.y + 40), '#f97316', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(9);
    // Escalating carpet: 2 bombs (phase 1) → 3 (phase 2) → 4 (phase 3).
    const bombs = phase >= 3 ? 4 : phase === 2 ? 3 : 2;
    for (let b = 0; b < bombs; b++) {
      const bx = this.clampCorridor(t.x + (b - (bombs - 1) / 2) * 76 + (Math.random() - 0.5) * 24, 30);
      this.threats.push(this.createSpecificThreat('cluster_bomb', bx, t.y + t.radius + 8));
    }
  }

  /** RAILGUN VOLLEY — kinetic slugs charge at the muzzle line then snap down. */
  private bossRailgunVolley(phase: number) {
    this.addFloatingText('⚡ RAILGUN VOLLEY! ⚡', this.L_WIDTH / 2, 96, '#22d3ee', 1.2);
    haptics.tap();
    const slugs = phase >= 3 ? 3 : 2;
    for (let s = 0; s < slugs; s++) {
      const sx = this.clampCorridor(this.cannonX + (s - (slugs - 1) / 2) * 46 + (Math.random() - 0.5) * 18, 24);
      const slug = this.createSpecificThreat('railgun_slug', sx, -26 - s * 14);
      // Stagger the charges so the shots come in sequence, not simultaneously
      slug.specialTimer = -s * 0.45;
      this.threats.push(slug);
    }
  }

  /** MIRV STRIKE — a separable warhead bus that blooms into 3 seekers. */
  private bossMirvStrike(t: Threat) {
    this.addFloatingText('🚀 MIRV STRIKE DETECTED! 🚀', this.L_WIDTH / 2, Math.max(100, t.y + 40), '#fb7185', 1.25);
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(8);
    this.threats.push(this.createSpecificThreat('mirv_warhead', t.x, t.y + t.radius + 8));
  }

  /** SIEGE DEPLOY — the flagship launches a drone carrier. */
  private bossSiegeDeploy(t: Threat) {
    this.addFloatingText('🛸 SIEGE CARRIER DEPLOYED! 🛸', this.L_WIDTH / 2, Math.max(120, t.y + 40), '#38bdf8', 1.2);
    sound.playBossAlarm();
    this.shake(10);
    this.createShockwave(t.x, t.y, '#38bdf8', 70);
    const carrier = this.createSpecificThreat(
      'siege_carrier',
      this.clampCorridor(t.x < this.L_WIDTH / 2 ? this.L_WIDTH - 80 : 80, 40),
      t.y + 6
    );
    this.threats.push(carrier);
  }

  /**
   * Launch a volley of hypersonic cruise missiles. They dive at terminal
   * velocity with proportional guidance on the turret and can (must!) be
   * shot down — intercepting one pays adrenaline, feeding the rush loop.
   */
  private launchHypersonicVolley(boss: Threat, count: number, isEra: boolean) {
    this.addFloatingText(
      '🚀 HYPERSONIC MISSILES INBOUND 🚀',
      this.L_WIDTH / 2,
      Math.max(90, boss.y + 40),
      '#fb7185',
      1.25
    );
    sound.playBossAlarm();
    haptics.alarm();
    this.shake(8);
    for (let i = 0; i < count; i++) {
      const mx = this.clampCorridor(boss.x + (i - (count - 1) / 2) * 30, 20);
      this.threats.push(this.createHypersonicMissile(mx, boss.y + boss.radius + 10, isEra));
    }
  }

  private createHypersonicMissile(x: number, y: number, isEra: boolean): Threat {
    // Warhead toughness tracks the defender's arsenal so point-defense
    // can't trivially erase the volley even from a maxed cannon.
    const hpScale = Math.min(3.2, 1 + (this.powerFactor - 1) * 0.3);
    const hp = Math.round((isEra ? 36 : 26) * hpScale);
    return {
      id: this.newId(),
      type: 'hypersonic_missile',
      name: 'Hypersonic Cruise Missile',
      x,
      y,
      vx: (x < this.cannonX ? 1 : -1) * 30,
      vy: 150,
      radius: 9,
      hp,
      maxHp: hp,
      shieldHp: 0,
      maxShieldHp: 0,
      damageToBase: isEra ? 16 : 11,
      cashReward: 30,
      scoreReward: 260,
      color: '#f43f5e',
      angle: Math.PI / 2,
      rotationSpeed: 0,
      missileWeavePhase: Math.random() * Math.PI * 2,
      evasionSkill: 0,
    };
  }

  /**
   * Cluster bomb AIRBURST: the parent scatters a fan of tumbling bomblets
   * that pepper a wide footprint. Destroying the parent before the fuse
   * burns out skips all of this (see onThreatDefeated) — defusal pays.
   */
  private detonateClusterBomb(t: Threat) {
    sound.playClusterAirburst();
    this.shake(12);
    haptics.medium();
    this.createShockwave(t.x, t.y, '#f97316', 110);
    this.createExplosion(t.x, t.y, 40, '#f97316');
    this.addFloatingText('💣 CLUSTER AIRBURST! 💣', t.x, t.y + 26, '#f97316', 1.25);
    // Richer scatter (product: more cluster bombs) — 7 tumbling bomblets
    // baseline, +1 past 2× firepower, +1 more past 3.5× (up to 9).
    const bomblets = 7 + (this.powerFactor > 2 ? 1 : 0) + (this.powerFactor > 3.5 ? 1 : 0);
    for (let b = 0; b < bomblets; b++) {
      const spread = (b - (bomblets - 1) / 2) * 36 + (Math.random() - 0.5) * 20;
      const bt = this.createSpecificThreat(
        'cluster_bomblet',
        this.clampCorridor(t.x + spread, 14),
        t.y + 6
      );
      bt.vx = spread * 1.6 + (Math.random() - 0.5) * 30;
      bt.vy = 70 + Math.random() * 70;
      this.threats.push(bt);
    }
    this.damageBase(6); // airburst concussive spillover at altitude
  }

  /**
   * MIRV SEPARATION: the guided bus blooms into 3 independent re-entry
   * seekers (interceptable hypersonic children). Killing the bus before
   * this moment cancels the entire volley — the highest-leverage defusal.
   */
  private splitMirvWarhead(t: Threat) {
    sound.playMirvSeparation();
    this.shake(10);
    haptics.medium();
    this.createShockwave(t.x, t.y, '#fb7185', 90);
    this.addFloatingText('🚀 MIRV SEPARATION — 3 SEEKERS! 🚀', this.L_WIDTH / 2, t.y + 40, '#fb7185', 1.25);
    for (let s = 0; s < 3; s++) {
      const child = this.createHypersonicMissile(
        this.clampCorridor(t.x + (s - 1) * 34, 16),
        t.y,
        false
      );
      // Children are lighter warheads than a boss-fired barrage missile
      child.hp = Math.max(10, Math.round(child.hp * 0.45));
      child.maxHp = child.hp;
      child.damageToBase = 9;
      child.radius = 7;
      child.vy = 130;
      this.threats.push(child);
    }
  }

  /**
   * Tesla arc-zap: a jagged lightning bolt grounds out on the turret and
   * stuns its fire control for ~1.4s (analogous to the ice-comet freeze,
   * but energy-themed). The bolt is drawn as a particle jag so the strike
   * itself is legible even after the node is destroyed.
   */
  private fireTeslaArc(t: Threat) {
    sound.playTeslaZap();
    haptics.medium();
    this.shake(9);
    this.shockTimer = 1.4;
    this.damageBase(6);
    this.addFloatingText('⚡ TURRET SHOCKED! ⚡', this.cannonX, this.cannonY - 52, '#facc15', 1.2);
    // Jagged bolt path: node → turret with random lateral jitter
    const steps = 9;
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      const bx = t.x + (this.cannonX - t.x) * p + (Math.random() - 0.5) * 36 * (s > 0 && s < steps ? 1 : 0.2);
      const by = t.y + (this.cannonY - t.y) * p;
      for (let k = 0; k < 2; k++) {
        this.spawnParticle({
          x: bx + (Math.random() - 0.5) * 6,
          y: by + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 30,
          vy: (Math.random() - 0.5) * 30,
          radius: Math.random() * 2.6 + 1.2,
          color: Math.random() > 0.4 ? '#fde047' : '#fef08a',
          alpha: 1,
          life: 0,
          maxLife: 0.3,
          sparkle: true,
        });
      }
    }
    this.createShockwave(this.cannonX, this.cannonY - 20, '#facc15', 60);
  }

  private onThreatReachedBase(t: Threat) {
    this.createExplosion(t.x, this.cannonY, t.radius * 1.5, t.color);
    sound.playBaseDamage();

    // Hypersonic warheads hit like a hammer — extra screenshake + haptics
    if (t.type === 'hypersonic_missile') {
      this.shake(20);
      haptics.heavy();
      this.addFloatingText('💥 HYPERSONIC IMPACT!', t.x, this.cannonY - 70, '#fb7185', 1.3);
      this.createShockwave(t.x, this.cannonY, '#fb7185', 90);
    } else if (t.type === 'railgun_slug') {
      // Kinetic penetrator: the screen PUNCHES
      this.shake(18);
      haptics.heavy();
      this.addFloatingText('⚡ RAILGUN IMPACT!', t.x, this.cannonY - 70, '#22d3ee', 1.3);
      this.createShockwave(t.x, this.cannonY, '#22d3ee', 70);
    } else if (t.type === 'cluster_bomb') {
      // Un-airbursted dud still cooks off on impact
      this.addFloatingText('💣 CLUSTER DETONATION!', t.x, this.cannonY - 70, '#f97316', 1.3);
      this.createShockwave(t.x, this.cannonY, '#f97316', 100);
    }
    this.shake(14);

    // Type hazards on base contact
    if (t.type === 'ice_comet') {
      this.isCannonFrozen = true;
      this.freezeTimer = 2.5;
      this.addFloatingText('CANNON FROZEN!', this.cannonX, this.cannonY - 50, '#38bdf8', 1.2);
    } else if (t.type === 'emp_asteroid') {
      this.empJamTimer = 6.0;
      this.addFloatingText('SPECIAL WEAPONS JAMMED!', this.cannonX, this.cannonY - 50, '#c084fc', 1.2);
    } else if (t.type === 'fire_meteor') {
      this.groundHazards.push({
        id: this.newId(),
        x: t.x - 30,
        y: this.cannonY - 10,
        width: 60,
        height: 25,
        duration: 4.0,
        maxDuration: 4.0,
        dps: 6,
      });
    } else if (t.type === 'plasma_torpedo') {
      // Plasma torpedo impact leaves a burning energy pool on the defense line
      this.groundHazards.push({
        id: this.newId(),
        x: t.x - 38,
        y: this.cannonY - 10,
        width: 76,
        height: 26,
        duration: 4.5,
        maxDuration: 4.5,
        dps: 8,
      });
      this.addFloatingText('🔥 PLASMA POOL SPREADING!', t.x, this.cannonY - 60, '#d946ef', 1.2);
      this.createShockwave(t.x, this.cannonY, '#d946ef', 80);
    } else if (t.type === 'void_orb') {
      this.voidFogTimer = 6.0;
      this.addFloatingText('VOID SHADOW EXPANDING!', this.L_WIDTH / 2, 450, '#a855f7', 1.2);
    }

    this.damageBase(t.damageToBase);
    this.resetCombo();
  }

  private damageBase(amount: number) {
    // Any impact interrupts field nano-repair — the grace clock restarts.
    this.hullGraceTimer = 0;
    // HULL STRESS: every impact now hits 55% harder (product: hull damage was
    // too slow — the Citadel must actually FALL, and the ad-revive / refit
    // economy depends on defenders genuinely dying). Stacked with the slow
    // nano-repair trickle, hull stays a scarce, tense resource.
    const stressed = amount * 1.55;
    if (this.currentShieldHp > 0) {
      if (this.currentShieldHp >= stressed) {
        this.currentShieldHp -= stressed;
        this.addFloatingText(`-${Math.round(stressed)} SHIELD`, this.cannonX, this.cannonY - 40, '#38bdf8', 1.0);
      } else {
        const overflow = stressed - this.currentShieldHp;
        this.currentShieldHp = 0;
        this.currentBaseHp = Math.max(0, this.currentBaseHp - overflow);
        this.addFloatingText(`-${Math.round(overflow)} HULL`, this.cannonX, this.cannonY - 40, '#ef4444', 1.1);
      }
    } else {
      this.currentBaseHp = Math.max(0, this.currentBaseHp - stressed);
      this.addFloatingText(`-${Math.round(stressed)} HULL`, this.cannonX, this.cannonY - 40, '#ef4444', 1.1);
    }

    // Near-death heartbeat: one urgent buzz each time hull dips critical
    // (re-arms once repaired above 45% — pulses, never spams).
    const hpRatio = this.maxBaseHp > 0 ? this.currentBaseHp / this.maxBaseHp : 1;
    if (this.currentBaseHp > 0 && hpRatio < 0.3) {
      if (!this.lowHpAlarmFired) {
        this.lowHpAlarmFired = true;
        haptics.alarm();
        this.addFloatingText('⚠ CRITICAL HULL ⚠', this.L_WIDTH / 2, 330, '#ef4444', 1.5);
      }
    } else if (hpRatio >= 0.45) {
      this.lowHpAlarmFired = false;
    }

    this.callbacks.onHealthUpdate(this.currentBaseHp, this.maxBaseHp, this.currentShieldHp);

    if (this.currentBaseHp <= 0) {
      this.handleGameOver();
    }
  }

  private onThreatDefeated(t: Threat, byPlayer: boolean) {
    // Remove the threat from the field FIRST — the early-return deception
    // branch below used to skip the trailing splice, leaving the "dead" orb
    // in the array where EVERY subsequent projectile hit re-triggered the
    // full death effects (pre-existing double-kill bug: fake orbs drained
    // the hull once per extra bullet that passed through the corpse).
    // Plain backwards scan + swap-pop: no findIndex closure, no splice shift.
    for (let ri = this.threats.length - 1; ri >= 0; ri--) {
      if (this.threats[ri].id === t.id) {
        this.threats[ri] = this.threats[this.threats.length - 1];
        this.threats.pop();
        break;
      }
    }

    sound.playExplosion(t.isBoss || t.radius > 26);
    this.createExplosion(t.x, t.y, t.radius * 1.6, t.color);
    this.runKills++;
    this.callbacks.onThreatKilled?.(t.type);

    if (byPlayer) {
      this.increaseAdrenaline(5.5);
      // If it was a Deception Threat (Fake Goodie) — STARFALL CATASTROPHE:
      // the scam core bursts into a dozen fire shooting stars that rain
      // down on Gaia at terminal velocity. Hull burns, funds siphon, the
      // phone rattles. (Product brief: deception must be spectacular AND
      // painful — fear today, mastery tomorrow.)
      if (t.type === 'fake_goodie') {
        // Deception also drains FUNDS (the scammer siphons the defense budget).
        const penalty = Math.min(250, 40 + this.currentWave * 6);
        const before = this.runCashEarned;
        this.runCashEarned = Math.max(0, this.runCashEarned - penalty);
        // Report the ACTUAL deduction, not the nominal penalty: the shell
        // applies this delta straight to the player's banked cash, and the
        // unclamped value drained the wallet while the run-cash HUD/stat
        // (also clamped at 0) claimed nothing happened — displayed earnings
        // and the real wallet change permanently diverged.
        const siphoned = before - this.runCashEarned;
        if (siphoned > 0) {
          this.callbacks.onCashUpdate(-siphoned, this.runCashEarned);
          this.addFloatingText(`-$${siphoned} FUNDS SIPHONED`, t.x, t.y + 14, '#ef4444', 1.1);
        }
        haptics.violent();
        this.resetCombo();
        this.spawnStarfallCatastrophe(t.x, t.y);
        this.addFloatingText('✶ DECEPTION CORE — STARFALL! ✶', t.x, t.y - 16, '#fb923c', 1.4);
        return;
      }

      // Split mechanics: Asteroid Large splits into two Asteroid Small
      if (t.type === 'asteroid_large') {
        for (let i = 0; i < 2; i++) {
          this.threats.push(this.createSpecificThreat('asteroid_small', t.x + (i === 0 ? -16 : 16), t.y));
        }
      } else if (t.type === 'swarm_pod') {
        for (let i = 0; i < 3; i++) {
          this.threats.push(this.createSpecificThreat('mini_drone', t.x + (i - 1) * 18, t.y));
        }
      }

      // Calculate Cash & Score with Combo Multiplier
      // KILL_CASH_MULTIPLIER: global economy nerf (storage.ts) — threat bounties
      // paid out at ~62% so credits stay scarce and upgrades matter.
      // Run-mode score multiplier: Boss Rush ×2 / Endless ×1.5 / Campaign ×1.
      const multiplier = this.getComboMultiplier();
      const earnedCash = Math.round(t.cashReward * multiplier * KILL_CASH_MULTIPLIER);
      const earnedScore = Math.round(t.scoreReward * multiplier * this.scoreMultiplier);

      this.score += earnedScore;
      this.runCashEarned += earnedCash;
      this.addFloatingText(`+$${earnedCash}`, t.x, t.y - 12, '#22c55e', 1.0);

      // NEAR-MISS SAVE (retention psychology: last-second wins are the most
      // memorable kind). A kill landed deep in the terminal pocket pays a
      // +25% courage bonus and a tick of adrenaline — rewarding exactly the
      // high-wire defense that makes runs feel heroic.
      if (t.y > this.cannonY - 90 && !t.isBoss) {
        const nearMissBonus = Math.round(earnedCash * 0.25);
        if (nearMissBonus > 0) {
          this.runCashEarned += nearMissBonus;
          this.callbacks.onCashUpdate(nearMissBonus, this.runCashEarned);
          this.increaseAdrenaline(2);
          this.addFloatingText(`⚔ CLOSE-CALL SAVE +$${nearMissBonus}`, t.x, t.y - 30, '#fde047', 0.95);
        }
      }

      this.callbacks.onScoreUpdate(this.score);
      this.callbacks.onCashUpdate(earnedCash, this.runCashEarned);

      // Boss Defeated
      if (t.isBoss) {
        sound.playHitstopSlowMo();
        this.hitStopTimer = 0.18;
        this.shake(26);
        haptics.success();
        this.createShockwave(t.x, t.y, '#f43f5e', 180);
        this.runBossesDefeated++;
        // Boss Rush pays DOUBLE the already-rare gem bounty — the daily
        // gauntlet's jackpot moment.
        const rushMult = this.gameMode === 'bossRush' ? 2 : 1;
        const gemsReward =
          (t.type === 'era_boss' ? BOSS_GEM_REWARDS.eraBoss : BOSS_GEM_REWARDS.miniBoss) * rushMult;
        this.runGemsEarned += gemsReward;
        this.callbacks.onGemsUpdate(gemsReward, this.runGemsEarned);
        const pilotName = t.alienPilot?.name || t.name;
        this.addFloatingText(`💥 ${pilotName} DEFEATED! +${gemsReward} GEMS! 💥`, t.x, t.y - 30, '#a855f7', 1.5);
        this.activeBoss = null;
        this.callbacks.onBossEncounter(null);
        this.callbacks.onBossDefeated?.({
          bossName: pilotName,
          eraNumber: this.currentEra.eraNumber,
          wave: this.currentWave,
        });
      }

      // Hypersonic intercept — shooting down an inbound warhead is the
      // highest-skill defensive play in the game, so it pays a fat
      // adrenaline spike that feeds the rush/overdrive loop.
      if (t.type === 'hypersonic_missile') {
        this.increaseAdrenaline(6);
        this.addFloatingText('🛡 MISSILE INTERCEPTED! +ADR', t.x, t.y - 14, '#fde047', 1.05);
        this.createShockwave(t.x, t.y, '#fde047', 46);
      }

      // --- Advanced-ordnance defusal payoffs -------------------------------
      // Every advanced munition carries a "prevent the worst" bonus: kill it
      // early and the counter-play pays adrenaline, feeding the rush loop.
      if (t.type === 'cluster_bomb') {
        this.increaseAdrenaline(6);
        this.addFloatingText('🛡 BOMB DEFUSED! +ADR', t.x, t.y - 14, '#fde047', 1.05);
        this.createShockwave(t.x, t.y, '#fde047', 46);
      } else if (t.type === 'mirv_warhead') {
        this.increaseAdrenaline(7);
        this.addFloatingText('🛡 MIRV NEUTRALIZED! +ADR', t.x, t.y - 14, '#fde047', 1.1);
        this.createShockwave(t.x, t.y, '#fde047', 52);
      } else if (t.type === 'railgun_slug') {
        this.increaseAdrenaline(5);
        this.addFloatingText('🛡 SLUG SHATTERED! +ADR', t.x, t.y - 14, '#22d3ee', 1.05);
        this.createShockwave(t.x, t.y, '#22d3ee', 46);
      } else if (t.type === 'siege_carrier') {
        this.increaseAdrenaline(6);
        this.addFloatingText('🛸 CARRIER DESTROYED!', t.x, t.y - 18, '#38bdf8', 1.2);
        this.createShockwave(t.x, t.y, '#38bdf8', 90);
        this.spawnGoodie(t.x, t.y); // carrier wreck always drops salvage
      } else if (t.type === 'mirror_shade' && t.isHoloDecoy) {
        sound.playHoloShatter();
        this.increaseAdrenaline(2);
        this.addFloatingText('✨ HOLOGRAM! ✨', t.x, t.y - 12, '#c4b5fd', 1.0);
        for (let s = 0; s < 10; s++) {
          const ang = Math.random() * Math.PI * 2;
          this.spawnParticle({
            x: t.x,
            y: t.y,
            vx: Math.cos(ang) * (Math.random() * 130 + 50),
            vy: Math.sin(ang) * (Math.random() * 130 + 50),
            radius: Math.random() * 2.4 + 1,
            color: Math.random() > 0.4 ? '#c4b5fd' : '#e9d5ff',
            alpha: 1,
            life: 0,
            maxLife: 0.35,
            sparkle: true,
          });
        }
      }

      // --- ELITE champion kill: the jackpot moment -------------------------
      if (t.isElite) {
        this.increaseAdrenaline(5);
        sound.playCrit();
        this.shake(8);
        this.createShockwave(t.x, t.y, '#fbbf24', 80);
        this.addFloatingText('👑 ELITE KILL! +ADR 👑', t.x, t.y - 26, '#fbbf24', 1.3);
        this.spawnGoodie(t.x, t.y); // champions ALWAYS drop salvage
      }

      // Pack intelligence — witnesses of a nearby kill burn with a
      // vengeance rush (bounded so it can never snowball into unfair).
      if (!t.isBoss && t.type !== 'hypersonic_missile') {
        for (let ai = 0; ai < this.threats.length; ai++) {
          const other = this.threats[ai];
          if (other.id === t.id || other.isBoss || other.type === 'hypersonic_missile') continue;
          const adx = other.x - t.x;
          const ady = other.y - t.y;
          if (adx * adx + ady * ady < 22500 && Math.random() < 0.3) {
            other.vy = Math.min(other.vy * 1.28, 300);
            if (Math.random() < 0.25) {
              this.addFloatingText('AVENGING RUSH!', other.x, other.y - 10, '#f97316', 0.85);
            }
          }
        }
      }

      // Chance to drop a Goodie
      const dropChance = this.isSupplyDropWave ? 0.45 : t.isBoss ? 1.0 : 0.14;
      if (Math.random() < dropChance) {
        this.spawnGoodie(t.x, t.y);
      }
    }
  }

  // --- Starfall Catastrophe (fake-orb betrayal) ---

  /**
   * Detonate a deception core: ~12 white-hot shards burst upward in a wide
   * fan, hang for a beat, then home onto a randomized splash band across
   * Gaia's atmosphere and plunge at terminal velocity. Each landing burns
   * the hull, kicks the screen and rattles the phone — BUT every shard is
   * interceptable mid-flight (bullets, frag blasts, nukes), so a sharp
   * defender can shoot the fire-rain out of the sky and walk away clean.
   */
  private spawnStarfallCatastrophe(x: number, y: number) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const spread = (i / (count - 1) - 0.5) * 2; // -1 .. 1 evenly fanned
      const targetX = this.clampCorridor(
        x + spread * (this.corridorHalf * 1.1) + (Math.random() - 0.5) * 60,
        24
      );
      this.starfallShards.push({
        x,
        y,
        vx: spread * (140 + Math.random() * 90),
        vy: -(320 + Math.random() * 220), // violent upward burst
        targetX,
        impactY: this.L_HEIGHT - 132 - Math.random() * 26, // atmosphere band
        fuse: 0.28 + Math.random() * 0.22, // hang-time before the plunge
        plungeSpeed: 300,
      });
    }
    // Launch spectacle: core flash + rising shock ring + whoosh + shake.
    this.createExplosion(x, y, 42, '#fb923c');
    this.createShockwave(x, y, '#fbbf24', 60);
    sound.playStarfallLaunch();
    sound.playBossAlarm();
    this.shake(16);
    // Immediate sting so the betrayal registers even before shards land.
    this.damageBase(6);
  }

  /** A starfall shard shot out of the sky: small firework, skill bounty, rush. */
  private interceptStarfallShard(x: number, y: number) {
    this.createExplosion(x, y, 13, '#fbbf24');
    sound.playHit();
    haptics.tap();
    this.increaseAdrenaline(2);
    const bounty = 5; // intercept skill pays — but modestly (tight economy)
    this.runCashEarned += bounty;
    this.callbacks.onCashUpdate(bounty, this.runCashEarned);
    this.addFloatingText('✧ SHOT DOWN +$5', x, y - 10, '#fde047', 0.9);
  }

  /** Per-frame starfall physics + impact resolution. */
  private updateStarfall(dt: number) {
    for (let i = this.starfallShards.length - 1; i >= 0; i--) {
      const s = this.starfallShards[i];
      if (s.fuse > 0) {
        // Burst phase: ballistically decelerate upward, then flip to plunge.
        s.fuse -= dt;
        s.vy += 1150 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 1 - 1.6 * dt; // air drag kills lateral burst speed
      } else {
        // Plunge phase: home onto the splash target, accelerating hard —
        // terminal fire crossing a screen-height in ~1.1s. Capped below the
        // old 760 so a defender sweeping the sky can realistically clip a few
        // shards out of the volley (partial mitigation = skill expression).
        s.plungeSpeed = Math.min(660, s.plungeSpeed + 560 * dt);
        const dx = s.targetX - s.x;
        const dy = s.impactY - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        s.x += (dx / dist) * s.plungeSpeed * dt;
        s.y += (dy / dist) * s.plungeSpeed * dt;
        // Fire trail embers
        if (Math.random() < 0.85) {
          this.spawnParticle({
            x: s.x + (Math.random() - 0.5) * 4,
            y: s.y + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 26,
            vy: -Math.random() * 40,
            radius: Math.random() * 2.6 + 1.2,
            color: Math.random() > 0.5 ? '#fb923c' : Math.random() > 0.5 ? '#fbbf24' : '#f87171',
            alpha: 1,
            life: 0,
            maxLife: 0.3 + Math.random() * 0.25,
          });
        }
      }

      // Impact: the shard hits Gaia's atmosphere band.
      if (s.fuse <= 0 && s.y >= s.impactY) {
        this.starfallShards[i] = this.starfallShards[this.starfallShards.length - 1];
        this.starfallShards.pop();
        this.damageBase(2.2);
        this.shake(7);
        haptics.impactTick();
        sound.playStarfallImpact();
        this.createExplosion(s.x, s.impactY, 16, '#fb923c');
        if (Math.random() < 0.4) {
          this.addFloatingText('☄', s.x, s.impactY - 18, '#fb923c', 1.2);
        }
        continue;
      }
    }
  }

  /** Render the shooting-star streaks (called inside the shaken transform). */
  private renderStarfall(ctx: CanvasRenderingContext2D) {
    const shardBlur = this.renderQuality === 0 ? qBlur(12) : 0;
    for (let si = 0; si < this.starfallShards.length; si++) {
      const s = this.starfallShards[si];
      // Motion direction (burst phase = ballistic velocity; plunge = homing dir)
      let mvx: number;
      let mvy: number;
      if (s.fuse > 0) {
        mvx = s.vx;
        mvy = s.vy;
      } else {
        const dx = s.targetX - s.x;
        const dy = s.impactY - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        mvx = dx / dist;
        mvy = dy / dist;
      }
      const mag = Math.hypot(mvx, mvy) || 1;
      const len = s.fuse > 0 ? 14 : 32; // streak stretches during the plunge
      const tx = s.x - (mvx / mag) * len;
      const ty = s.y - (mvy / mag) * len;

      ctx.save();
      // Hot head
      ctx.shadowColor = '#fb923c';
      ctx.shadowBlur = shardBlur;
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      // Fire streak tail
      const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, 'rgba(251, 146, 60, 0.95)');
      grad.addColorStop(0.45, 'rgba(249, 115, 22, 0.55)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Spawner Mechanics ---

  private updateSpawning(dt: number) {
    if (this.waveThreatsSpawned >= this.waveThreatsTotal) return;

    this.spawnTimer += dt;
    // BLITZ waves deploy at ~half the interval — compressed violence.
    const mutatorPace = this.waveMutator === 'blitz' ? 0.55 : this.waveMutator === 'swarm' ? 0.78 : 1;
    if (this.spawnTimer >= this.nextSpawnInterval * mutatorPace) {
      this.spawnTimer = 0;
      this.nextSpawnInterval = Math.max(0.4, 1.3 - this.currentWave * 0.035) + (Math.random() - 0.5) * 0.3;

      // Spawn next threat
      this.spawnNextWaveThreat();
      this.waveThreatsSpawned++;

      // In supply drop waves, also spawn a free goodie directly
      if (this.isSupplyDropWave && Math.random() < 0.5) {
        this.spawnGoodie(this.corridorX(30), -20);
      }
    }
  }

  private spawnNextWaveThreat() {
    // BOSS RUSH: every stage deploys its Dreadnought after a brief vanguard
    // beat (2 escorts) — then only the escort trickle continues.
    if (this.gameMode === 'bossRush') {
      if (!this.activeBoss && this.waveThreatsSpawned >= 2) {
        this.spawnBoss(true);
        return;
      }
    }

    const isEraBossWave = this.currentWave % 5 === 0;
    const isMiniBossWave = this.currentWave % 5 === 3;

    // If it's a boss wave and boss hasn't spawned yet, spawn boss once initial vanguard appears
    if ((isEraBossWave || isMiniBossWave) && !this.activeBoss && this.waveThreatsSpawned >= 4) {
      this.spawnBoss(isEraBossWave);
      return;
    }

    // Pick from allowed threats of current era. SWARM mutator waves bias the
    // mix toward light fast craft (overwhelming numbers, not brute mass).
    let allowed = this.currentEra.allowedThreats;
    if (this.waveMutator === 'swarm') {
      const swarmy = allowed.filter((type) =>
        ['mini_drone', 'kamikaze', 'scout', 'asteroid_small', 'debris_junk', 'alien_hoverbike'].includes(type)
      );
      if (swarmy.length > 0) allowed = swarmy;
    }

    let type = allowed[Math.floor(Math.random() * allowed.length)];
    // One siege carrier on the field at a time — they compound otherwise
    if (type === 'siege_carrier' && this.threats.some((t) => t.type === 'siege_carrier')) {
      type = allowed.find((tt) => tt !== 'siege_carrier') ?? type;
    }

    const x = this.corridorX(35);
    const threat = this.createSpecificThreat(type, x, -30);

    // ELITE champion roll — rare golden variants (jackpot spawns). ELITE
    // HUNT mutator waves crank the odds way up.
    this.tryMakeElite(threat);
    this.threats.push(threat);

    // Mirror shades always arrive as a PAIR — one real, one hologram.
    // The decoy flickers harder and shatters for pocket change.
    if (type === 'mirror_shade') {
      const decoy = this.createSpecificThreat(
        'mirror_shade',
        this.clampCorridor(x + (Math.random() > 0.5 ? 30 : -30), 20),
        -30
      );
      decoy.isHoloDecoy = true;
      decoy.hp = 1;
      decoy.maxHp = 1;
      decoy.damageToBase = 6;
      decoy.cashReward = 6;
      decoy.scoreReward = 30;
      this.threats.push(decoy);
    }

    // HYPERSONIC STRIKE PACKAGE: a rolled cruise missile never travels
    // alone — it arrives as a small volley (2, or 3 past wave 25) with the
    // same inbound alarm + shake the boss volleys use. Interception pays
    // adrenaline, so the point-defense drama feeds the rush loop.
    if (type === 'hypersonic_missile') {
      const count = this.currentWave >= 25 ? 3 : 2;
      for (let m = 1; m < count; m++) {
        this.threats.push(
          this.createSpecificThreat(
            'hypersonic_missile',
            this.clampCorridor(x + (m - (count - 1) / 2) * 34, 20),
            -30 - m * 24
          )
        );
      }
      this.addFloatingText('🚀 MISSILES INBOUND 🚀', this.L_WIDTH / 2, 110, '#fb7185', 1.15);
      sound.playBossAlarm();
      haptics.alarm();
      this.shake(6);
    }

    // PANIC ORDNANCE PAIR: from wave 6 on, a rolled cluster bomb sometimes
    // dumps a live twin alongside it — carpet instead of craters.
    if (type === 'cluster_bomb' && this.currentWave >= 6 && Math.random() < 0.4) {
      this.threats.push(
        this.createSpecificThreat('cluster_bomb', this.clampCorridor(x + 70, 45), -64)
      );
    }
  }

  /**
   * ELITE champion modifier: rare golden variants of any hostile CRAFT
   * (rocks, pods, decoys and ordnance never promote). Reinforced hull,
   * hotter descent, TRIPLE bounty — and a guaranteed goodie + adrenaline
   * bonus on kill. The variable-reward jackpot that keeps spawns exciting.
   */
  private tryMakeElite(t: Threat) {
    if (this.currentWave < 2) return;
    const eligibleCraft =
      !t.isBoss &&
      t.type !== 'fake_goodie' &&
      t.type !== 'cluster_bomb' &&
      t.type !== 'cluster_bomblet' &&
      t.type !== 'mirv_warhead' &&
      t.type !== 'railgun_slug' &&
      t.type !== 'plasma_torpedo' &&
      t.type !== 'hypersonic_missile' &&
      !t.isHoloDecoy;
    if (!eligibleCraft) return;

    if (Math.random() >= this.eliteChance) return;

    t.isElite = true;
    t.name = `ELITE ${t.name}`;
    t.hp = Math.round(t.hp * 1.8);
    t.maxHp = Math.round(t.maxHp * 1.8);
    if (t.maxShieldHp > 0) {
      t.shieldHp = Math.round(t.shieldHp * 1.6);
      t.maxShieldHp = Math.round(t.maxShieldHp * 1.6);
    }
    t.vy = Math.min(t.vy * 1.22, t.vy + 60);
    t.cashReward = Math.round(t.cashReward * 3);
    t.scoreReward = Math.round(t.scoreReward * 3);
    this.addFloatingText('👑 ELITE CONTACT!', t.x, Math.max(70, t.y + 40), '#fbbf24', 1.15);
  }

  /**
   * QA/debug handle (window.__earthDefender.engine): force-spawn any threat
   * type at a logical position. Mirror shades spawn their decoy twin too,
   * exactly like the natural spawner. No-ops while paused or not running.
   */
  public qaSpawn(type: ThreatType, x?: number, y?: number, eraNumber?: number): Threat | null {
    if (!this.isRunning || this.isPaused) return null;
    const px = Math.max(20, Math.min(this.L_WIDTH - 20, x ?? 60 + Math.random() * (this.L_WIDTH - 120)));
    const py = y ?? -30;
    // Era flagship QA spawn: renders + behaves like the real encounter
    // (pilot, hull theme, phases) without wiring the full boss-fight loop.
    // eraNumber lets a QA harness preview ANY of the 15 flagship designs.
    if (type === 'era_boss') {
      const eraNum = Math.min(15, Math.max(1, eraNumber ?? this.currentEra.eraNumber));
      const cfg = getEraBossConfig(eraNum);
      const maxHp = cfg.maxHpBase; // full hull: survives long enough to inspect
      const t: Threat = {
        id: this.newId(),
        type: 'era_boss',
        name: cfg.bossName,
        x: px,
        y: py,
        vx: 30,
        vy: 14,
        radius: cfg.radius,
        hp: maxHp,
        maxHp,
        shieldHp: 0,
        maxShieldHp: 0,
        damageToBase: 0, // QA preview: never hurts the base
        cashReward: 0,
        scoreReward: 0,
        color: cfg.color,
        angle: 0,
        rotationSpeed: 0.15,
        isBoss: true,
        bossPhase: 1,
        maxBossPhases: 3,
        bossEraNumber: eraNum,
        alienPilot: cfg.pilot,
      };
      this.threats.push(t);
      return t;
    }
    const t = this.createSpecificThreat(type, px, py);
    this.threats.push(t);
    if (type === 'mirror_shade') {
      const decoy = this.createSpecificThreat('mirror_shade', Math.max(20, Math.min(this.L_WIDTH - 20, px + 30)), py);
      decoy.isHoloDecoy = true;
      decoy.hp = 1;
      decoy.maxHp = 1;
      decoy.damageToBase = 6;
      decoy.cashReward = 6;
      decoy.scoreReward = 30;
      this.threats.push(decoy);
    }
    return t;
  }

  /** QA/debug: shallow snapshot of live threat identities + key state. */
  public qaList(): Array<Pick<Threat, 'id' | 'type' | 'name' | 'x' | 'y' | 'hp' | 'isElite' | 'isHoloDecoy' | 'isDiving' | 'clusterFuse' | 'teslaCharge' | 'lockOnTimer'>> {
    return this.threats.map((t) => ({
      id: t.id,
      type: t.type,
      name: t.name,
      x: Math.round(t.x),
      y: Math.round(t.y),
      hp: Math.round(t.hp),
      isElite: !!t.isElite,
      isHoloDecoy: !!t.isHoloDecoy,
      isDiving: !!t.isDiving,
      clusterFuse: t.clusterFuse,
      teslaCharge: t.teslaCharge,
      lockOnTimer: t.lockOnTimer,
    }));
  }

  private spawnBoss(isEraBoss: boolean) {
    const x = this.L_WIDTH / 2;
    const y = -60;

    // Wave ramp × arsenal-response: flagship armor is explicitly tuned
    // against the player's best-gun DPS, so a maxed cannon can never melt
    // the encounter that used to die in four seconds.
    // MEAN-FLAGSHIP OVERHAUL (product): bosses were STILL folding. Hulls now
    // mount ~2.6× armor, the DPS-response curve is much steeper (0.75 vs
    // 0.65) with a higher ceiling (16× vs 13×), every round that connects is
    // blunted by heavier ablative plating (see dealDamageToThreat), cadence
    // is meaner (see the boss update loop), and Phase 3 dumps LIVE cluster
    // ordnance onto the grid. If the player upgrades, the flagship upgrades
    // HARDER — escalation is the point.
    const pf = this.powerFactor;
    const bossPowerScale = Math.min(isEraBoss ? 16 : 13, 1 + (pf - 1) * (isEraBoss ? 0.75 : 0.62));
    const hpScale = (1 + 0.12 * this.currentWave) * bossPowerScale;
    const CHALLENGE_MULT = isEraBoss ? 2.6 : 2.3;
    const eraNum = this.currentEra.eraNumber;
    const cfg = getEraBossConfig(eraNum);

    const maxHp = isEraBoss
      ? Math.round(cfg.maxHpBase * hpScale * CHALLENGE_MULT)
      : Math.round(380 * hpScale * CHALLENGE_MULT);
    const shieldHp = isEraBoss
      ? Math.round(cfg.shieldHpBase * hpScale * CHALLENGE_MULT)
      : Math.round(150 * hpScale * CHALLENGE_MULT);

    const boss: Threat = {
      id: this.newId(),
      type: isEraBoss ? 'era_boss' : 'mini_boss',
      name: isEraBoss ? cfg.bossName : 'VANGUARD DESTROYER',
      x,
      y,
      vx: 36,
      vy: 18,
      radius: isEraBoss ? cfg.radius : 32,
      hp: maxHp,
      maxHp,
      shieldHp,
      maxShieldHp: shieldHp,
      damageToBase: isEraBoss ? 95 : 55,
      cashReward: isEraBoss ? 1100 : 320,
      scoreReward: isEraBoss ? 5200 : 1300,
      color: isEraBoss ? cfg.color : '#e11d48',
      angle: 0,
      rotationSpeed: 0.15,
      isBoss: true,
      bossPhase: 1,
      maxBossPhases: 3,
      bossEraNumber: eraNum,
      alienPilot: isEraBoss ? cfg.pilot : undefined,
    };

    this.activeBoss = boss;
    this.threats.push(boss);

    // If it's an Era Boss, spawn 2 Little Alien Hoverbike escort raiders with it!
    if (isEraBoss) {
      this.threats.push(this.createSpecificThreat('alien_hoverbike', x - 95, y - 20));
      this.threats.push(this.createSpecificThreat('alien_hoverbike', x + 95, y - 20));
    }

    this.callbacks.onBossEncounter(boss);
    sound.playBossAlert();
    this.shake(20);
    haptics.alarm();
    this.addFloatingText(
      isEraBoss ? `🚨 BOSS MODE: ${cfg.bossName} 🚨` : '⚠️ WARNING: VANGUARD DESTROYER ⚠️',
      this.L_WIDTH / 2,
      220,
      isEraBoss ? cfg.color : '#ef4444',
      1.8
    );
  }

  private createSpecificThreat(type: ThreatType, x: number, y: number): Threat {
    const t = this.buildBaseThreat(type, x, y);

    // --- Arsenal-response conditioning (adaptive difficulty) ---------------
    // Every hostile is briefed on the defender's firepower: hulls are
    // reinforced and descent profiles burn hotter as the player's marks
    // climb, so the field never goes soft just because the shop was visited.
    const pf = this.powerFactor;
    if (pf > 1) {
      // EMPOWERMENT DOCTRINE: hulls reinforced ×(1+0.24·Δ) up to ×4.0,
      // descent profiles ×(1+0.10·Δ) up to ×1.8, impact loads ×(1+0.05·Δ)
      // up to ×1.35 — the invasion force climbs the SAME ladder the player
      // does, one mark at a time.
      const hpScale = Math.min(4.0, 1 + (pf - 1) * 0.24);
      const speedScale = Math.min(1.8, 1 + (pf - 1) * 0.1);
      const impactScale = Math.min(1.35, 1 + (pf - 1) * 0.05);
      t.hp = Math.round(t.hp * hpScale);
      t.maxHp = Math.round(t.maxHp * hpScale);
      if (t.maxShieldHp > 0) {
        t.shieldHp = Math.round(t.shieldHp * hpScale);
        t.maxShieldHp = Math.round(t.maxShieldHp * hpScale);
      }
      t.vy = Math.round(t.vy * speedScale);
      t.damageToBase = Math.max(1, Math.round(t.damageToBase * impactScale));
    }

    // Evasive piloting aptitude by archetype (actual dodge odds also scale
    // with the player's firepower — see updateEvasion).
    t.evasionSkill = EVASION_SKILL[type] ?? 0;
    // Precomputed sine-weave phase — kills per-frame parseFloat(id) parses
    // in the movement hot loop (scout / ghost / stalker / hoverbike / raider).
    t.phaseSeed = Math.random() * 10;
    return t;
  }

  private buildBaseThreat(type: ThreatType, x: number, y: number): Threat {
    const waveMult = 1 + 0.08 * this.currentWave;
    const baseVy = 40 + Math.min(75, this.currentWave * 2.8);

    switch (type) {
      case 'alien_hoverbike':
        return {
          id: this.newId(),
          type,
          name: 'Alien Hoverbike Raider',
          x,
          y,
          vx: (Math.random() > 0.5 ? 1 : -1) * (55 + Math.random() * 35),
          vy: baseVy * 1.4,
          radius: 17,
          hp: Math.round(36 * waveMult),
          maxHp: Math.round(36 * waveMult),
          shieldHp: Math.round(15 * waveMult),
          maxShieldHp: Math.round(15 * waveMult),
          damageToBase: 12,
          cashReward: 65,
          scoreReward: 180,
          color: '#06b6d4',
          angle: 0,
          rotationSpeed: 0.2,
          hoverbikeTilt: 0,
        };
      case 'scout':
        return {
          id: this.newId(),
          type,
          name: 'Alien Scout',
          x,
          y,
          vx: (Math.random() - 0.5) * 70,
          vy: baseVy * 1.5,
          radius: 14,
          hp: Math.round(30 * waveMult),
          maxHp: Math.round(30 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 10,
          cashReward: 25,
          scoreReward: 70,
          color: '#2dd4bf',
          angle: 0,
          rotationSpeed: 0.5,
        };
      case 'shielded_trooper':
        return {
          id: this.newId(),
          type,
          name: 'Shielded Trooper',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 0.85,
          radius: 20,
          hp: Math.round(55 * waveMult),
          maxHp: Math.round(55 * waveMult),
          shieldHp: Math.round(45 * waveMult),
          maxShieldHp: Math.round(45 * waveMult),
          damageToBase: 18,
          cashReward: 45,
          scoreReward: 140,
          color: '#38bdf8',
          angle: 0,
          rotationSpeed: 0.3,
        };
      case 'swarm_pod':
        return {
          id: this.newId(),
          type,
          name: 'Swarm Pod',
          x,
          y,
          vx: (Math.random() - 0.5) * 40,
          vy: baseVy * 0.9,
          radius: 22,
          hp: Math.round(65 * waveMult),
          maxHp: Math.round(65 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 16,
          cashReward: 50,
          scoreReward: 150,
          color: '#a855f7',
          angle: 0,
          rotationSpeed: 0.8,
        };
      case 'mini_drone':
        return {
          id: this.newId(),
          type,
          name: 'Swarm Drone',
          x,
          y,
          vx: (Math.random() - 0.5) * 90,
          vy: baseVy * 1.6,
          radius: 9,
          hp: Math.round(15 * waveMult),
          maxHp: Math.round(15 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 6,
          cashReward: 15,
          scoreReward: 40,
          color: '#c084fc',
          angle: 0,
          rotationSpeed: 2.0,
        };
      case 'fire_meteor':
        return {
          id: this.newId(),
          type,
          name: 'Fire Meteor',
          x,
          y,
          vx: (Math.random() - 0.5) * 35,
          vy: baseVy * 1.25,
          radius: 19,
          hp: Math.round(45 * waveMult),
          maxHp: Math.round(45 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 22,
          cashReward: 40,
          scoreReward: 120,
          color: '#ea580c',
          angle: 0,
          rotationSpeed: 1.2,
        };
      case 'ice_comet':
        return {
          id: this.newId(),
          type,
          name: 'Ice Comet',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 1.1,
          radius: 21,
          hp: Math.round(55 * waveMult),
          maxHp: Math.round(55 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 18,
          cashReward: 45,
          scoreReward: 130,
          color: '#38bdf8',
          angle: 0,
          rotationSpeed: 0.6,
        };
      case 'gravity_well':
        return {
          id: this.newId(),
          type,
          name: 'Gravity Well',
          x,
          y,
          vx: 0,
          vy: baseVy * 0.6,
          radius: 26,
          hp: Math.round(90 * waveMult),
          maxHp: Math.round(90 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 25,
          cashReward: 65,
          scoreReward: 200,
          color: '#6366f1',
          angle: 0,
          rotationSpeed: -2.0,
        };
      case 'kamikaze':
        return {
          id: this.newId(),
          type,
          name: 'Kamikaze Drone',
          x,
          y,
          vx: 0,
          vy: baseVy * 2.0,
          radius: 13,
          hp: Math.round(22 * waveMult),
          maxHp: Math.round(22 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 25,
          cashReward: 35,
          scoreReward: 110,
          color: '#ef4444',
          angle: 0,
          rotationSpeed: 1.5,
        };
      case 'phase_ghost':
        return {
          id: this.newId(),
          type,
          name: 'Phase Ghost',
          x,
          y,
          vx: (Math.random() - 0.5) * 50,
          vy: baseVy * 0.9,
          radius: 17,
          hp: Math.round(40 * waveMult),
          maxHp: Math.round(40 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 15,
          cashReward: 40,
          scoreReward: 125,
          color: '#d946ef',
          angle: 0,
          rotationSpeed: 0.4,
        };
      case 'fake_goodie':
        return {
          id: this.newId(),
          type,
          name: 'Deception Core',
          x,
          y,
          vx: 0,
          vy: baseVy * 0.8,
          radius: 16,
          hp: 1,
          maxHp: 1,
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 15,
          cashReward: 0,
          scoreReward: 0,
          color: '#facc15', // mimics goodie yellow
          angle: 0,
          rotationSpeed: 0.5,
        };
      case 'plasma_raider':
        // Era 11+: blistering corona raider — fast, lightly shielded, weaves hard
        return {
          id: this.newId(),
          type,
          name: 'Plasma Raider',
          x,
          y,
          vx: (Math.random() > 0.5 ? 1 : -1) * (70 + Math.random() * 40),
          vy: baseVy * 1.5,
          radius: 16,
          hp: Math.round(40 * waveMult),
          maxHp: Math.round(40 * waveMult),
          shieldHp: Math.round(14 * waveMult),
          maxShieldHp: Math.round(14 * waveMult),
          damageToBase: 14,
          cashReward: 55,
          scoreReward: 170,
          color: '#fbbf24',
          angle: 0,
          rotationSpeed: 0.4,
        };
      case 'chrono_wraith':
        // Era 13+: temporal stalker — blink-teleports make it deceptively fast
        return {
          id: this.newId(),
          type,
          name: 'Chrono Wraith',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 0.75,
          radius: 18,
          hp: Math.round(48 * waveMult),
          maxHp: Math.round(48 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 16,
          cashReward: 60,
          scoreReward: 200,
          color: '#eab308',
          angle: 0,
          rotationSpeed: 0.8,
          blinkTimer: 0,
        };
      case 'void_cruiser':
        // Era 14+: armored siege platform — slow, tanky, bombards from range
        return {
          id: this.newId(),
          type,
          name: 'Void Cruiser',
          x,
          y,
          vx: (Math.random() - 0.5) * 24,
          vy: baseVy * 0.55,
          radius: 24,
          hp: Math.round(85 * waveMult),
          maxHp: Math.round(85 * waveMult),
          shieldHp: Math.round(55 * waveMult),
          maxShieldHp: Math.round(55 * waveMult),
          damageToBase: 30,
          cashReward: 90,
          scoreReward: 280,
          color: '#e11d48',
          angle: 0,
          rotationSpeed: 0.2,
          bombardCharge: 0,
        };
      case 'void_orb':
        return {
          id: this.newId(),
          type,
          name: 'Void Orb',
          x,
          y,
          vx: (Math.random() - 0.5) * 20,
          vy: baseVy * 0.7,
          radius: 23,
          hp: Math.round(80 * waveMult),
          maxHp: Math.round(80 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 20,
          cashReward: 55,
          scoreReward: 160,
          color: '#1e1b4b',
          angle: 0,
          rotationSpeed: -1.2,
        };
      case 'emp_asteroid':
        return {
          id: this.newId(),
          type,
          name: 'EMP Asteroid',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 0.95,
          radius: 20,
          hp: Math.round(50 * waveMult),
          maxHp: Math.round(50 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 16,
          cashReward: 45,
          scoreReward: 130,
          color: '#818cf8',
          angle: 0,
          rotationSpeed: 0.7,
        };
      case 'sniper_ship':
        return {
          id: this.newId(),
          type,
          name: 'Sniper Ship',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 0.5,
          radius: 21,
          hp: Math.round(60 * waveMult),
          maxHp: Math.round(60 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 24,
          cashReward: 60,
          scoreReward: 180,
          color: '#f87171',
          angle: 0,
          rotationSpeed: 0.2,
        };
      case 'healer_ship':
        return {
          id: this.newId(),
          type,
          name: 'Bio Healer',
          x,
          y,
          vx: (Math.random() - 0.5) * 40,
          vy: baseVy * 0.75,
          radius: 22,
          hp: Math.round(70 * waveMult),
          maxHp: Math.round(70 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 14,
          cashReward: 65,
          scoreReward: 190,
          color: '#22c55e',
          angle: 0,
          rotationSpeed: 0.3,
        };
      case 'magnet_drone':
        return {
          id: this.newId(),
          type,
          name: 'Magnet Drone',
          x,
          y,
          vx: (Math.random() - 0.5) * 50,
          vy: baseVy * 1.0,
          radius: 18,
          hp: Math.round(45 * waveMult),
          maxHp: Math.round(45 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 12,
          cashReward: 50,
          scoreReward: 140,
          color: '#f59e0b',
          angle: 0,
          rotationSpeed: 1.0,
        };
      case 'debris_junk':
        return {
          id: this.newId(),
          type,
          name: 'Orbital Junk',
          x,
          y,
          vx: (Math.random() - 0.5) * 60,
          vy: baseVy * 1.1,
          radius: 17,
          hp: Math.round(35 * waveMult),
          maxHp: Math.round(35 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 14,
          cashReward: 30,
          scoreReward: 90,
          color: '#94a3b8',
          angle: 0,
          rotationSpeed: 2.5,
        };
      case 'asteroid_small':
        return {
          id: this.newId(),
          type,
          name: 'Fragment Asteroid',
          x,
          y,
          vx: (Math.random() - 0.5) * 50,
          vy: baseVy * 1.3,
          radius: 12,
          hp: Math.round(20 * waveMult),
          maxHp: Math.round(20 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 8,
          cashReward: 20,
          scoreReward: 60,
          color: '#78716c',
          angle: 0,
          rotationSpeed: 1.5,
        };
      case 'stealth_threat':
        return {
          id: this.newId(),
          type,
          name: 'Phantom Stalker',
          x,
          y,
          vx: (Math.random() - 0.5) * 40,
          vy: baseVy * 1.2,
          radius: 16,
          hp: Math.round(48 * waveMult),
          maxHp: Math.round(48 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 16,
          cashReward: 55,
          scoreReward: 190,
          color: '#6366f1',
          angle: 0,
          rotationSpeed: 1.1,
          isStealth: true,
          specialTimer: Math.random() * 3,
        };
      case 'cluster_bomb':
        // Advanced ordnance: drifts down on a timed fuse, then AIRBURSTS into
        // a fan of bomblets. Defusing it early is a fat adrenaline payoff.
        return {
          id: this.newId(),
          type,
          name: 'Cluster Bomb',
          x,
          y,
          vx: (Math.random() - 0.5) * 24,
          vy: baseVy * 0.8,
          radius: 18,
          hp: Math.round(62 * waveMult),
          maxHp: Math.round(62 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 28,
          cashReward: 55,
          scoreReward: 170,
          color: '#f97316',
          angle: 0,
          rotationSpeed: 0.9,
          clusterFuse: 3.4,
        };
      case 'cluster_bomblet':
        // Submunition scattered by the airburst — small, fast, tumbling
        return {
          id: this.newId(),
          type,
          name: 'Cluster Bomblet',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 1.35,
          radius: 8,
          hp: Math.round(9 * waveMult),
          maxHp: Math.round(9 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 8,
          cashReward: 12,
          scoreReward: 35,
          color: '#fdba74',
          angle: Math.random() * Math.PI * 2,
          rotationSpeed: 6.0,
        };
      case 'hypersonic_missile': {
        // Standalone cruise missile rolled by the NATURAL spawner (era pools
        // carry them again — not just boss volleys and MIRV separation).
        // Flight profile is identical to the boss-fired pattern: terminal
        // dive with jink weave + proportional guidance (see update loop);
        // hull scales with the live wave so point-defense stays honest.
        // The spawner delivers these as small volleys with an inbound alarm
        // — see spawnNextWaveThreat.
        const hp = Math.round(16 + 2.2 * this.currentWave);
        return {
          id: this.newId(),
          type,
          name: 'Hypersonic Cruise Missile',
          x,
          y,
          vx: (x < this.cannonX ? 1 : -1) * 30,
          vy: 150,
          radius: 9,
          hp,
          maxHp: hp,
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 11,
          cashReward: 30,
          scoreReward: 260,
          color: '#f43f5e',
          angle: Math.PI / 2,
          rotationSpeed: 0,
          missileWeavePhase: Math.random() * Math.PI * 2,
        };
      }
      case 'mirv_warhead':
        // MIRV parent: a guided bus that separates into 3 re-entry seekers.
        // Kill the bus before separation and the whole volley never happens.
        return {
          id: this.newId(),
          type,
          name: 'MIRV Warhead Bus',
          x,
          y,
          vx: (Math.random() - 0.5) * 20,
          vy: 96,
          radius: 13,
          hp: Math.round((40 + 8 * this.currentWave) * Math.min(2.2, 1 + (this.powerFactor - 1) * 0.3)),
          maxHp: Math.round((40 + 8 * this.currentWave) * Math.min(2.2, 1 + (this.powerFactor - 1) * 0.3)),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 20,
          cashReward: 45,
          scoreReward: 300,
          color: '#fb7185',
          angle: Math.PI / 2,
          rotationSpeed: 0,
          missileWeavePhase: Math.random() * Math.PI * 2,
        };
      case 'railgun_slug':
        // Hypervelocity kinetic dart: charges at the top edge (visible aim
        // line), then snaps down the bore at the turret — a pure snap-shot.
        return {
          id: this.newId(),
          type,
          name: 'Railgun Slug',
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 9,
          hp: Math.round(26 * Math.min(2.4, 1 + (this.powerFactor - 1) * 0.25)),
          maxHp: Math.round(26 * Math.min(2.4, 1 + (this.powerFactor - 1) * 0.25)),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 18,
          cashReward: 35,
          scoreReward: 240,
          color: '#22d3ee',
          angle: Math.PI / 2,
          rotationSpeed: 0,
          specialTimer: 0,
        };
      case 'plasma_torpedo':
        // Slow homing energy torpedo — leaves a burning plasma pool on impact
        return {
          id: this.newId(),
          type,
          name: 'Plasma Torpedo',
          x,
          y,
          vx: (Math.random() - 0.5) * 20,
          vy: 52,
          radius: 15,
          hp: Math.round(52 * waveMult),
          maxHp: Math.round(52 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 22,
          cashReward: 50,
          scoreReward: 160,
          color: '#d946ef',
          angle: Math.PI / 2,
          rotationSpeed: 0,
        };
      case 'siege_carrier':
        // Drone-launching mothership — parks at the top and keeps feeding
        // hangar drones until destroyed. The #1 priority target on the field.
        return {
          id: this.newId(),
          type,
          name: 'Siege Carrier',
          x,
          y,
          vx: (Math.random() > 0.5 ? 1 : -1) * 22,
          vy: baseVy * 0.7,
          radius: 30,
          hp: Math.round(150 * waveMult),
          maxHp: Math.round(150 * waveMult),
          shieldHp: Math.round(40 * waveMult),
          maxShieldHp: Math.round(40 * waveMult),
          damageToBase: 30,
          cashReward: 130,
          scoreReward: 420,
          color: '#0ea5e9',
          angle: 0,
          rotationSpeed: 0,
          launchCd: 1.6,
        };
      case 'tesla_node':
        // Arc-welder satellite — periodically shocks the turret circuits
        // (firing disabled ~1.4s). Shoot it down to stop the zaps.
        return {
          id: this.newId(),
          type,
          name: 'Tesla Node',
          x,
          y,
          vx: (Math.random() - 0.5) * 26,
          vy: baseVy * 0.7,
          radius: 19,
          hp: Math.round(80 * waveMult),
          maxHp: Math.round(80 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 14,
          cashReward: 70,
          scoreReward: 230,
          color: '#facc15',
          angle: 0,
          rotationSpeed: 0,
          teslaCharge: 0,
        };
      case 'hunter_killer':
        // Lock-on stalker: tracks laterally above the field, then commits to
        // a proportional-guidance boost dive at the turret.
        return {
          id: this.newId(),
          type,
          name: 'Hunter-Killer',
          x,
          y,
          vx: (Math.random() > 0.5 ? 1 : -1) * 60,
          vy: 60,
          radius: 14,
          hp: Math.round(46 * waveMult),
          maxHp: Math.round(46 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 19,
          cashReward: 60,
          scoreReward: 210,
          color: '#ef4444',
          angle: Math.PI / 2,
          rotationSpeed: 0,
          lockOnTimer: 2.0,
          isDiving: false,
          missileWeavePhase: Math.random() * Math.PI * 2,
        };
      case 'mirror_shade':
        // Holographic decoy pair — spawns as TWO ships; one is a projection.
        // The decoy flickers harder (a learnable tell) and dies to one hit.
        return {
          id: this.newId(),
          type,
          name: 'Mirror Shade',
          x,
          y,
          vx: (Math.random() - 0.5) * 34,
          vy: baseVy * 0.9,
          radius: 17,
          hp: Math.round(54 * waveMult),
          maxHp: Math.round(54 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 16,
          cashReward: 58,
          scoreReward: 200,
          color: '#a78bfa',
          angle: 0,
          rotationSpeed: 0.3,
        };
      default: // asteroid_large
        return {
          id: this.newId(),
          type: 'asteroid_large',
          name: 'Heavy Asteroid',
          x,
          y,
          vx: (Math.random() - 0.5) * 30,
          vy: baseVy * 0.9,
          radius: 24,
          hp: Math.round(60 * waveMult),
          maxHp: Math.round(60 * waveMult),
          shieldHp: 0,
          maxShieldHp: 0,
          damageToBase: 18,
          cashReward: 40,
          scoreReward: 120,
          color: '#a8a29e',
          angle: 0,
          rotationSpeed: 0.8,
        };
    }
  }

  // --- Goodies (Falling Power-ups) ---

  private spawnGoodie(x: number, y: number) {
    const types: GoodieType[] = ['cash_orb', 'shield', 'fire_rate', 'bomb', 'repair', 'auto_aim', 'slow_mo'];
    // Weighted selection
    const roll = Math.random();
    let type: GoodieType = 'cash_orb';
    if (roll < 0.35) type = 'cash_orb';
    else if (roll < 0.55) type = 'shield';
    else if (roll < 0.70) type = 'fire_rate';
    else if (roll < 0.80) type = 'repair';
    else if (roll < 0.90) type = 'slow_mo';
    else if (roll < 0.96) type = 'auto_aim';
    else type = 'bomb'; // rare tactical nuke

    const meta = this.getGoodieMeta(type);
    this.goodies.push({
      id: this.newId(),
      type,
      x: this.clampCorridor(x, 25),
      y: Math.max(10, y),
      vy: 55,
      radius: 16,
      color: meta.color,
      glowColor: meta.glow,
      icon: meta.icon,
      name: meta.name,
      duration: meta.duration,
    });
  }

  private getGoodieMeta(type: GoodieType) {
    switch (type) {
      case 'cash_orb':
        return { color: '#fbbf24', glow: '#d97706', icon: '💰', name: 'Cash Cache', duration: 0 };
      case 'shield':
        return { color: '#38bdf8', glow: '#0284c7', icon: '🛡️', name: 'Terran Shield', duration: 0 };
      case 'fire_rate':
        return { color: '#f43f5e', glow: '#be123c', icon: '⚡', name: 'Hyper-Drive', duration: 7 };
      case 'bomb':
        return { color: '#f97316', glow: '#c2410c', icon: '💥', name: 'Tactical Nuke', duration: 0 };
      case 'repair':
        return { color: '#22c55e', glow: '#15803d', icon: '❤️', name: 'Field Repair', duration: 0 };
      case 'auto_aim':
        return { color: '#a855f7', glow: '#7e22ce', icon: '🎯', name: 'Target Lock-On', duration: 8 };
      case 'slow_mo':
        return { color: '#06b6d4', glow: '#0891b2', icon: '⏳', name: 'Stasis Field', duration: 6 };
    }
  }

  private updateGoodies(dt: number) {
    for (let i = this.goodies.length - 1; i >= 0; i--) {
      const g = this.goodies[i];
      g.y += g.vy * dt;

      // Sparkle
      if (Math.random() < 0.25) {
        this.spawnParticle({
          x: g.x + (Math.random() - 0.5) * 12,
          y: g.y + (Math.random() - 0.5) * 12,
          vx: 0,
          vy: 10,
          radius: 2,
          color: g.color,
          alpha: 0.8,
          life: 0,
          maxLife: 0.3,
          sparkle: true,
        });
      }

      // Reached Earth - auto collect (backwards + swap-pop)
      if (g.y >= this.cannonY) {
        this.collectGoodie(g);
        this.goodies[i] = this.goodies[this.goodies.length - 1];
        this.goodies.pop();
      }
    }
  }

  public tapCollectGoodieAt(x: number, y: number): boolean {
    for (let i = this.goodies.length - 1; i >= 0; i--) {
      const g = this.goodies[i];
      // Generous touch hitbox for mobile fingers (radius + 24px)
      const tdx = x - g.x;
      const tdy = y - g.y;
      const trr = g.radius + 24;
      if (tdx * tdx + tdy * tdy < trr * trr) {
        this.collectGoodie(g);
        this.goodies[i] = this.goodies[this.goodies.length - 1];
        this.goodies.pop();
        return true;
      }
    }
    return false;
  }

  private collectGoodie(g: Goodie) {
    sound.playGoodie();
    haptics.light();
    this.createShockwave(g.x, g.y, g.color, 45);

    switch (g.type) {
      case 'cash_orb': {
        // Orb payout rebalanced (was 100-250 — part of the over-generous economy)
        const bonus = 60 + Math.floor(Math.random() * 90);
        this.runCashEarned += bonus;
        this.callbacks.onCashUpdate(bonus, this.runCashEarned);
        this.addFloatingText(`+$${bonus} CASH!`, g.x, g.y, '#fbbf24', 1.2);
        break;
      }
      case 'shield': {
        this.currentShieldHp = Math.min(this.maxShieldHp, this.currentShieldHp + 35);
        this.callbacks.onHealthUpdate(this.currentBaseHp, this.maxBaseHp, this.currentShieldHp);
        this.addFloatingText('+35 SHIELD!', g.x, g.y, '#38bdf8', 1.2);
        break;
      }
      case 'fire_rate': {
        this.activeBuffs.set('fire_rate', {
          type: 'fire_rate',
          duration: g.duration,
        });
        this.buffsDirty = true;
        this.addFloatingText('HYPERDRIVE ACTIVE (7s)!', g.x, g.y, '#f43f5e', 1.3);
        break;
      }
      case 'bomb': {
        this.triggerNuke();
        break;
      }
      case 'repair': {
        this.repairBase(30);
        break;
      }
      case 'auto_aim': {
        this.activeBuffs.set('auto_aim', {
          type: 'auto_aim',
          duration: g.duration,
        });
        this.buffsDirty = true;
        this.addFloatingText('AUTO-AIM ONLINE (8s)!', g.x, g.y, '#a855f7', 1.3);
        break;
      }
      case 'slow_mo': {
        this.activeBuffs.set('slow_mo', {
          type: 'slow_mo',
          duration: g.duration,
        });
        this.buffsDirty = true;
        this.addFloatingText('CHRONO STASIS (6s)!', g.x, g.y, '#06b6d4', 1.3);
        break;
      }
    }
  }

  // --- Combo Streak System ---

  private incrementCombo() {
    this.comboStreak++;
    if (this.comboStreak > this.bestStreakInRun) {
      this.bestStreakInRun = this.comboStreak;
    }
    const mult = this.getComboMultiplier();
    this.callbacks.onComboUpdate(this.comboStreak, mult);

    // Combo milestones every 10 — escalating haptic taps (addictive rhythm)
    if (this.comboStreak % 10 === 0) {
      haptics.tap();
    }

    // Instant-payoff ladder: milestone kills credit a cash jackpot on the
    // spot (variable-ratio reward stacked on the combo chain — the compulsion
    // loop's loudest click). 10→$20, 20→$60, 35→$120, 50→$240, 75+→$400.
    // Trimmed ~20% by the cash-tightening pass.
    const milestoneBonus =
      this.comboStreak === 10
        ? 20
        : this.comboStreak === 20
          ? 60
          : this.comboStreak === 35
            ? 120
            : this.comboStreak === 50
              ? 240
              : this.comboStreak > 0 && this.comboStreak % 25 === 0
                ? 400
                : 0;
    if (milestoneBonus > 0) {
      this.runCashEarned += milestoneBonus;
      this.callbacks.onCashUpdate(milestoneBonus, this.runCashEarned);
      this.addFloatingText(
        `⭐ ${this.comboStreak}x CHAIN JACKPOT +$${milestoneBonus}`,
        this.cannonX,
        this.cannonY - 104,
        '#fde047',
        1.15
      );
    }

    if (this.comboStreak % 5 === 0) {
      sound.playCombo(Math.min(10, Math.floor(this.comboStreak / 5)));
      this.addFloatingText(`${this.comboStreak}x STREAK (${mult}x CASH)`, this.cannonX, this.cannonY - 80, '#f59e0b', 1.2);
    }
  }

  private resetCombo() {
    if (this.comboStreak >= 5) {
      this.addFloatingText('COMBO LOST', this.cannonX, this.cannonY - 60, '#94a3b8', 1.0);
    }
    this.comboStreak = 0;
    this.callbacks.onComboUpdate(0, 1.0);
  }

  public getComboMultiplier(): number {
    if (this.comboStreak >= 50) return 10.0;
    if (this.comboStreak >= 35) return 5.0;
    if (this.comboStreak >= 20) return 3.0;
    if (this.comboStreak >= 10) return 2.0;
    if (this.comboStreak >= 5) return 1.5;
    return 1.0;
  }

  // --- Particle & FX Helpers ---

  /**
   * Pooled particle spawn — THE allocation gate for the whole FX system.
   * Emitters pass a short-lived literal (nursery-cheap); fields are copied
   * into a pre-owned pool slot. When the pool is at cap, round-robin
   * eviction recycles the oldest-ish slot so fresh bursts always land while
   * continuous trails naturally thin out under pressure.
   */
  /** Next monotonic entity id (see nextEntityId). */
  private newId(): number {
    return this.nextEntityId++;
  }

  /**
   * Projectile object pool — fired rounds are recycled, never dropped for
   * the GC to sweep. acquireProjectile() pops from the free list (or mints
   * one on first use) and wipes the optional per-weapon fields so state can
   * never leak from a previous life. Released rounds (impact / out of
   * bounds / wave reset) go back on the free list, capped so a freak burst
   * can't pin unbounded memory.
   */
  private acquireProjectile(): Projectile {
    const p =
      this.projFree.pop() ??
      ({
        id: 0,
        weaponId: 'cannon',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 1,
        damage: 0,
        pierceRemaining: 0,
        splashRadius: 0,
        isEmp: false,
        isOrbital: false,
        color: '#fff',
      } as Projectile);
    // Reset optional fields — pooled objects must never inherit stale state
    p.isEmp = false;
    p.isOrbital = false;
    p.length = undefined;
    p.targetId = undefined;
    p.isGrenade = undefined;
    p.gravity = undefined;
    p.fuseTime = undefined;
    p.blastRadius = undefined;
    return p;
  }

  private releaseProjectile(p: Projectile): void {
    if (this.projFree.length < 256) this.projFree.push(p);
  }

  /** Drop every live round back into the pool (wave end / run reset). */
  private poolAllProjectiles(): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      this.releaseProjectile(this.projectiles[i]);
    }
    this.projectiles.length = 0;
  }

  private spawnParticle(src: Particle): void {
    if (this.pLive < this.particleCap) {
      let p = this.particles[this.pLive];
      if (!p) {
        p = { x: 0, y: 0, vx: 0, vy: 0, radius: 1, color: '#fff', alpha: 1, life: 0, maxLife: 1 };
        this.particles[this.pLive] = p;
      }
      p.x = src.x; p.y = src.y; p.vx = src.vx; p.vy = src.vy;
      p.radius = src.radius; p.color = src.color; p.alpha = src.alpha;
      p.life = src.life; p.maxLife = src.maxLife;
      if (src.sparkle) p.sparkle = true; else if (p.sparkle) p.sparkle = false;
      this.pLive++;
    } else {
      if (this.pEvict >= this.pLive) this.pEvict = 0;
      const p = this.particles[this.pEvict];
      p.x = src.x; p.y = src.y; p.vx = src.vx; p.vy = src.vy;
      p.radius = src.radius; p.color = src.color; p.alpha = src.alpha;
      p.life = src.life; p.maxLife = src.maxLife;
      if (src.sparkle) p.sparkle = true; else if (p.sparkle) p.sparkle = false;
      this.pEvict = (this.pEvict + 1) % this.particleCap;
    }
  }

  private createExplosion(x: number, y: number, maxRadius: number, color: string) {
    const count = Math.min(35, Math.floor(maxRadius * 0.9));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 140 + 30;
      this.spawnParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 3.5 + 1.5,
        color: Math.random() > 0.3 ? color : '#fbbf24',
        alpha: 1,
        life: 0,
        maxLife: Math.random() * 0.4 + 0.25,
      });
    }
  }

  private createShockwave(x: number, y: number, color: string, radius: number = 60) {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      this.spawnParticle({
        x: x + Math.cos(angle) * 10,
        y: y + Math.sin(angle) * 10,
        vx: Math.cos(angle) * radius * 2.5,
        vy: Math.sin(angle) * radius * 2.5,
        radius: 2.5,
        color,
        alpha: 1,
        life: 0,
        maxLife: 0.35,
      });
    }
  }

  public addFloatingText(text: string, x: number, y: number, color: string, scale: number = 1.0) {
    // HUD-STYLE CAP: late-run kill streaks can queue dozens of concurrent
    // texts (bounties, close-call saves, phase calls) — each one costs a
    // canvas save/restore + shadowed fill. Cap at 30; oldest fades first.
    if (this.floatingTexts.length >= 30) {
      this.floatingTexts.shift();
    }
    this.floatingTexts.push({
      id: this.newId(),
      text,
      x,
      y,
      vy: -35,
      alpha: 1,
      color,
      scale,
    });
  }

  // --- End of Wave & Game Over ---

  private handleWaveWon() {
    this.isWaveIntermission = true;
    sound.playGoodie();
    haptics.success();

    // ---------------------------------------------------------------------
    // WAVE-END SIMULATION RESET — "optimize the next gameplay" pass. The
    // board is already clear of threats (wave-won precondition), but the
    // transient layers are NOT: stray ordnance still in flight, particle
    // inventory near cap, floating combat text, starfall shards and scorch
    // hazards. Dropping them HERE means the intermission renders on a
    // minimal workload AND the next wave starts from a compact, calm heap
    // instead of inheriting the previous wave's allocation churn mid-fight.
    // ---------------------------------------------------------------------
    this.poolAllProjectiles();
    this.pLive = 0;
    this.pEvict = 0;
    this.floatingTexts.length = 0;
    this.starfallShards.length = 0;
    this.groundHazards.length = 0;
    this.activeWells.length = 0;

    const modeLabel = this.gameMode === 'bossRush' ? `RUSH STAGE ${this.currentWave}` : `WAVE ${this.currentWave}`;
    this.addFloatingText(`${modeLabel} CLEARED!`, this.L_WIDTH / 2, 350, '#4ade80', 1.5);

    // Wave-clear bonus tightened again (was 150 + wave*45, then 120 + 32) —
    // the guaranteed per-wave faucet stays the largest single income source,
    // so it carries the deepest cut of the cash tightening pass.
    // Run modes pay their score multiplier on the clear bonus too.
    const bonusCash = Math.round((90 + this.currentWave * 24) * this.scoreMultiplier);
    this.runCashEarned += bonusCash;
    this.callbacks.onCashUpdate(bonusCash, this.runCashEarned);

    // LUCKY SALVAGE — variable-ratio surprise on 30% of clears: a random
    // 1.5×–3.5× multiplier on a small cache. Unpredictable jackpots (the
    // slot-machine principle) keep every wave-clear exciting.
    if (Math.random() < 0.3) {
      const luckRoll = Math.random();
      const salvageMult = luckRoll < 0.6 ? 1.5 : luckRoll < 0.87 ? 2.5 : 3.5;
      const salvage = Math.round((20 + this.currentWave * 5) * salvageMult);
      this.runCashEarned += salvage;
      this.callbacks.onCashUpdate(salvage, this.runCashEarned);
      this.addFloatingText(
        `🍀 LUCKY SALVAGE +$${salvage} (${salvageMult}×)`,
        this.L_WIDTH / 2,
        312,
        '#4ade80',
        1.25
      );
      // Coin-fountain particles
      for (let i = 0; i < 14; i++) {
        this.spawnParticle({
          x: this.L_WIDTH / 2 + (Math.random() - 0.5) * 60,
          y: 340,
          vx: (Math.random() - 0.5) * 180,
          vy: -Math.random() * 220 - 60,
          radius: Math.random() * 2.4 + 1.4,
          color: Math.random() > 0.3 ? '#fbbf24' : '#fde047',
          alpha: 1,
          life: 0,
          maxLife: 0.6 + Math.random() * 0.3,
          sparkle: true,
        });
      }
    }

    this.callbacks.onWaveComplete(this.currentWave, {
      // Per-wave DELTAS (the callback contract): the run totals were being
      // reported here, so GA's per-wave kills/cash_earned grew every wave.
      cashEarned: this.runCashEarned - this.waveStartCash,
      kills: this.runKills - this.waveStartKills,
    });
  }

  private handleGameOver() {
    this.isRunning = false;
    this.starfallShards = [];
    sound.playGameOver();
    this.callbacks.onGameOver({
      score: this.score,
      waveReached: this.currentWave,
      cashEarned: this.runCashEarned,
      gemsEarned: this.runGemsEarned,
      bestStreak: this.bestStreakInRun,
      bossesDefeated: this.runBossesDefeated,
      kills: this.runKills,
      gameMode: this.gameMode,
    });
  }

  private broadcastState() {
    this.callbacks.onScoreUpdate(this.score);
    this.callbacks.onCashUpdate(0, this.runCashEarned);
    this.callbacks.onHealthUpdate(this.currentBaseHp, this.maxBaseHp, this.currentShieldHp);
    this.callbacks.onComboUpdate(this.comboStreak, this.getComboMultiplier());
    this.callbacks.onEraChange(this.currentEra);
  }

  // --- Rendering Pipeline ---

  public render(timeSec: number = performance.now() / 1000) {
    const ctx = this.ctx;
    const w = this.L_WIDTH;
    const h = this.L_HEIGHT;

    ctx.save();

    // Screen Shake
    if (this.screenShake > 0) {
      const dx = (Math.random() - 0.5) * this.screenShake;
      const dy = (Math.random() - 0.5) * this.screenShake;
      ctx.translate(dx, dy);
    }

    // 1. Background sky gradient based on Era — CACHED offscreen bitmap
    //    (per-frame createLinearGradient + fill was pure allocation churn;
    //    the era only changes once a wave so the cache lives ~20s+ per build)
    const bgKey = `${this.L_WIDTH}x${this.L_HEIGHT}|${this.currentEra.eraNumber}`;
    if (!this.bgCache || this.bgCacheKey !== bgKey) {
      this.bgCacheKey = bgKey;
      const bg = document.createElement('canvas');
      bg.width = Math.max(1, Math.round(w));
      bg.height = Math.max(1, Math.round(h));
      const g = bg.getContext('2d');
      if (g) {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, this.currentEra.palette.bgTop);
        grad.addColorStop(0.85, this.currentEra.palette.bgBottom);
        grad.addColorStop(1, '#050b14');
        g.fillStyle = grad;
        g.fillRect(0, 0, bg.width, bg.height);
      }
      this.bgCache = bg;
    }
    ctx.drawImage(this.bgCache, 0, 0, w, h);

    // Overdrive screen edge pulse aura
    if (this.isOverdrive) {
      const pulse = Math.sin(timeSec * 16) * 0.2 + 0.8;
      ctx.save();
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.45 * pulse})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.restore();
    }

    // 2. Parallax Stars — two pre-rendered scrolling tiles (far + near).
    //    Classic wrap-around blit: 4 drawImage calls replace ~240 per-star
    //    globalAlpha + fillRect state changes every frame. Motion stays tied
    //    to simulation time (starScroll advances in update, pauses on pause).
    for (const layer of this.starTiles) {
      const off = layer.offset % h;
      ctx.drawImage(layer.canvas, 0, off);
      ctx.drawImage(layer.canvas, 0, off - h);
    }

    // 3. Ground Hazards (fire trails) — plain indexed loop (a forEach here
    // allocated a fresh closure every rendered frame)
    for (let ghi = 0; ghi < this.groundHazards.length; ghi++) {
      const gh = this.groundHazards[ghi];
      const alpha = gh.duration / gh.maxDuration;
      ctx.fillStyle = `rgba(234, 88, 12, ${alpha * 0.75})`;
      ctx.fillRect(gh.x, gh.y, gh.width, gh.height);
      ctx.strokeStyle = `rgba(251, 191, 36, ${alpha})`;
      ctx.strokeRect(gh.x, gh.y, gh.width, gh.height);
    }

    // 4. Projectiles — plain indexed loop (same closure-per-frame fix)
    for (let pri = 0; pri < this.projectiles.length; pri++) {
      const p = this.projectiles[pri];
      ctx.save();
      ctx.translate(p.x, p.y);
      const angle = Math.atan2(p.vy, p.vx);
      ctx.rotate(angle);

      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = qBlur(8);

      if (p.isGrenade) {
        // Frag grenade: dark bomb body + glowing fuse, tumbling
        ctx.rotate(timeSec * 9);
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = qBlur(10);
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Crosshatch frag casing
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-p.radius * 0.7, 0);
        ctx.lineTo(p.radius * 0.7, 0);
        ctx.moveTo(0, -p.radius * 0.7);
        ctx.lineTo(0, p.radius * 0.7);
        ctx.stroke();
        // Burning fuse cap
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.arc(0, -p.radius - 2, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.weaponId === 'laser') {
        const len = p.length || 24;
        ctx.fillRect(-len / 2, -p.radius, len, p.radius * 2);
      } else if (p.weaponId === 'missiles') {
        // Rocket silhouette
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -4);
        ctx.lineTo(-6, 4);
        ctx.closePath();
        ctx.fill();
      } else {
        // Round bullet
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. Threat Danger Telegraphs (Sniper targeting, Kamikaze trajectory, Earth proximity warning)
    drawDangerTelegraphs(ctx, this.threats, this.cannonY, timeSec);

    // 5.5 Starfall Catastrophe streaks — fire shooting stars raining on Gaia
    this.renderStarfall(ctx);

    // 6. Threats Procedural 2.5D High-Octane Rendering (plain loop —
    // no per-frame closure allocation)
    for (let ti = 0; ti < this.threats.length; ti++) {
      renderEnemyAsset(ctx, this.threats[ti], timeSec);
    }

    // 7. Goodies — shadowBlur is the single most expensive canvas state on
    // mobile GPUs; it's the FIRST thing sacrificed when quality drops.
    const goodieBlur = this.renderQuality === 0 ? qBlur(14) : 0;
    for (let gi = 0; gi < this.goodies.length; gi++) {
      const g = this.goodies[gi];
      ctx.save();
      ctx.translate(g.x, g.y);

      // Outer glow pulse
      ctx.shadowColor = g.glowColor;
      ctx.shadowBlur = goodieBlur;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(0, 0, g.radius, 0, Math.PI * 2);
      ctx.fill();

      // Inner icon
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.icon, 0, 1);

      ctx.restore();
    }

    // 8. Particles — quality-tiered render cap bounds the worst case
    //    (screen-clear fireworks can otherwise queue 400+ arcs/frame).
    //    Reads the POOL's live window (particles[0..pLive)); sim and render
    //    now agree on the budget instead of simulating invisible sprites.
    const particleCap = this.renderQuality >= 2 ? 110 : this.renderQuality >= 1 ? 220 : 420;
    const particleCount = Math.min(this.pLive, particleCap);
    for (let pi = 0; pi < particleCount; pi++) {
      const p = this.particles[pi];
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // 9. Earth Atmosphere & Defensive Shield Dome
    this.renderEarthDefense(ctx, w, h, timeSec);

    // 10. Cannon Turret & Aiming Line
    this.renderCannon(ctx, timeSec);

    // 11. Floating Text — plain loop; text shadow only at full quality
    // (shadowed fills are the priciest canvas op per text on mobile).
    const ftBlur = this.renderQuality === 0 ? qBlur(4) : 0;
    for (let fi = 0; fi < this.floatingTexts.length; fi++) {
      const ft = this.floatingTexts[fi];
      ctx.save();
      ctx.font = `bold ${Math.round(14 * ft.scale)}px sans-serif`;
      ctx.fillStyle = ft.color;
      ctx.globalAlpha = ft.alpha;
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = ftBlur;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // 11. Void Fog Overlay if active
    if (this.voidFogTimer > 0) {
      ctx.fillStyle = `rgba(15, 23, 42, ${Math.min(0.7, this.voidFogTimer * 0.15)})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
  }

  private hexToRgba(hex: string, alpha: number): string {
    const m = hex.replace('#', '');
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private renderEarthDefense(ctx: CanvasRenderingContext2D, w: number, h: number, timeSec: number) {
    // Earth geometry adapts to the logical viewport: the crest stays pinned a
    // few px below the cannon line (L_HEIGHT-190 vs cannonY = L_HEIGHT-185) and
    // the planet widens proportionally on wider-than-base playfields — up to
    // ~2.75× base radius on desktop widescreen, where it reads as a proper
    // planetary horizon spanning the bottom of the universe.
    const widthScale = Math.min(2.75, this.L_WIDTH / 450);
    const earthR = 215 * widthScale;
    const apexY = this.L_HEIGHT - 190; // Earth crest curvature apex
    const earthY = apexY + earthR;
    const cx = w / 2;

    // Rebuild the offscreen planet layers only when geometry/skin changes.
    const artKey = `${this.L_WIDTH}x${this.L_HEIGHT}|${this.skinColors.base}`;
    if (this.planetArt === null || this.planetArtKey !== artKey) {
      this.planetArtKey = artKey;
      this.buildPlanetArt(earthR);
    }
    const art = this.planetArt!;

    // 1. Outer atmosphere halo (tinted by the equipped base skin, gently
    //    breathing so the planet feels alive even between waves).
    const breath = 0.92 + 0.08 * Math.sin(timeSec * 1.1);
    const atmosGrad = ctx.createRadialGradient(cx, earthY, earthR - 38, cx, earthY, earthR + 42);
    atmosGrad.addColorStop(0, this.hexToRgba(this.skinColors.base, 0.5 * breath));
    atmosGrad.addColorStop(0.6, this.hexToRgba(this.skinColors.base, 0.26 * breath));
    atmosGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = atmosGrad;
    ctx.beginPath();
    ctx.arc(cx, earthY, earthR + 42, 0, Math.PI * 2);
    ctx.fill();

    // 2. Rotating surface + fixed spherical shading, clipped to the sphere.
    const SW = art.stripW;
    const SH = art.stripH;
    const baseX = cx - earthR - ((timeSec * earthR * 0.02) % SW);
    const baseY = earthY - earthR;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, earthY, earthR, 0, Math.PI * 2);
    ctx.clip();

    // Surface strip ×2 (seamless horizontal wrap) — slow majestic rotation.
    ctx.drawImage(art.surface, baseX, baseY);
    ctx.drawImage(art.surface, baseX + SW, baseY);

    // Spherical shading: limb darkening + terminator — FIXED to the sphere
    // (drawn at strip-center alignment so the lit pole never drifts), blended
    // over the rotating surface with multiply.
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(art.shade, cx - SW / 2, baseY);
    ctx.globalCompositeOperation = 'source-over';

    // City lights riding the rotating surface (twinkling warm glows; the
    // lower latitudes sit closer to the terminator so they read brighter).
    for (const city of art.cities) {
      const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(timeSec * city.speed + city.phase));
      const depth = 0.35 + 0.65 * Math.min(1, city.sy / (SH * 0.5));
      const a = twinkle * depth;
      const x0 = baseX + city.sx;
      const y0 = baseY + city.sy;
      for (const x of [x0, x0 + SW]) {
        if (x < cx - earthR - 8 || x > cx + earthR + 8) continue;
        ctx.fillStyle = `rgba(251, 186, 64, ${0.5 * a})`;
        ctx.beginPath();
        ctx.arc(x, y0, city.size * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 232, 178, ${0.95 * a})`;
        ctx.beginPath();
        ctx.arc(x, y0, city.size * 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cloud layer — drifts faster than the surface for parallax depth.
    const cloudX = cx - earthR - ((timeSec * earthR * 0.034) % SW);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(art.clouds, cloudX, baseY);
    ctx.drawImage(art.clouds, cloudX + SW, baseY);
    ctx.globalAlpha = 1;

    // Specular ocean glint (screen blend) — the "sun" kissing the ocean,
    // also fixed to the sphere (single copy, strip-center aligned).
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(art.glint, cx - SW / 2, baseY);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // 3. Atmospheric rim light hugging the crest (Fresnel edge glow).
    ctx.save();
    ctx.strokeStyle = `rgba(186, 240, 255, ${0.4 * breath})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = this.skinColors.base;
    ctx.shadowBlur = qBlur(14);
    ctx.beginPath();
    ctx.arc(cx, earthY, earthR + 1, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.restore();

    // 4. Base Protective Shield Arc — energy shimmer flows along the dome.
    if (this.currentShieldHp > 0) {
      const shieldPct = this.currentShieldHp / this.maxShieldHp;
      ctx.save();
      ctx.strokeStyle = this.hexToRgba(this.skinColors.base, 0.45 + shieldPct * 0.5);
      ctx.lineWidth = 4;
      ctx.shadowColor = this.skinColors.base;
      ctx.shadowBlur = qBlur(16);
      ctx.setLineDash([16, 10]);
      ctx.lineDashOffset = -timeSec * 42;
      ctx.beginPath();
      ctx.arc(cx, earthY, earthR + 10, Math.PI * 1.22, Math.PI * 1.78);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderCannon(ctx: CanvasRenderingContext2D, timeSec: number) {
    const cx = this.cannonX;
    const cy = this.cannonY;

    ctx.save();
    ctx.translate(cx, cy);

    // Overdrive Electric Ring
    if (this.isOverdrive) {
      ctx.save();
      ctx.rotate(timeSec * 5);
      ctx.strokeStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = qBlur(14);
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(0, 4, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Aim Laser Guide / Trajectory dots
    ctx.save();
    ctx.rotate(this.aimAngle);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(35, 0);
    ctx.lineTo(240, 0);
    ctx.stroke();
    ctx.restore();

    // Turret Mount Base Platform (Sitting firmly on Earth crest)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, 4, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.skinColors.cannon;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner mechanical core
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(0, 4, 14, 0, Math.PI * 2);
    ctx.fill();

    // Rotatable Gun Barrel with dynamic recoil animation
    ctx.rotate(this.aimAngle);
    ctx.translate(-this.recoilOffset, 0);

    const activeW = this.weapons[this.activeWeaponId];
    ctx.fillStyle = activeW ? activeW.color : '#38bdf8';
    ctx.shadowColor = activeW ? activeW.color : '#38bdf8';
    ctx.shadowBlur = qBlur(10);

    if (activeW?.id === 'machinegun') {
      // Twin rapid barrels
      ctx.fillRect(0, -6, 28, 4);
      ctx.fillRect(0, 2, 28, 4);
    } else if (activeW?.id === 'laser') {
      // Sleek long emitter
      ctx.fillRect(0, -4, 34, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(30, -2, 5, 4);
    } else if (activeW?.id === 'missiles') {
      // Heavy dual missile launcher pods
      ctx.fillRect(0, -9, 25, 6);
      ctx.fillRect(0, 3, 25, 6);
    } else {
      // Standard heavy kinetic barrel
      ctx.fillRect(0, -5, 30, 10);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(8, -6, 4, 12);
    }

    // Frost overlay if frozen
    if (this.isCannonFrozen) {
      ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
      ctx.fillRect(-2, -8, 38, 16);
    }

    // Arc-spark overlay if tesla-shocked (turret circuits stuttering)
    if (this.shockTimer > 0) {
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.55 + Math.sin(this.shockTimer * 40) * 0.35})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let s = 0; s < 5; s++) {
        const sx = -2 + s * 9 + (Math.random() - 0.5) * 6;
        ctx.moveTo(sx, -10);
        ctx.lineTo(sx + (Math.random() - 0.5) * 8, -2 + (Math.random() - 0.5) * 4);
      }
      ctx.stroke();
    }

    ctx.restore();
  }
}
