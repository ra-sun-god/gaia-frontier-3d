'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GameEngine } from '@/lib/gameEngine';
import { GameEngine3D } from '@/lib/three/engine3d';
import { GameCanvas, computeLogicalSize } from '@/components/GameCanvas';
import { HUD } from '@/components/HUD';
import { PauseModal } from '@/components/PauseModal';
import { WaveIntermission } from '@/components/WaveIntermission';
import { GameOverModal } from '@/components/GameOverModal';
import { ShopModal } from '@/components/ShopModal';
import { DailyChallengesModal } from '@/components/DailyChallengesModal';
import { MysteryBoxModal } from '@/components/MysteryBoxModal';
import { BattlePassModal } from '@/components/BattlePassModal';
import { CosmeticsModal } from '@/components/CosmeticsModal';
import { LeaderboardModal } from '@/components/LeaderboardModal';
import {
  PlayerProfile,
  WeaponId,
  WeaponDef,
  ActiveBuff,
  EraInfo,
  MysteryBoxReward,
  DailyChallenge,
  SkinItem,
  Threat,
  GameMode,
} from '@/lib/types';
import {
  DEFAULT_PROFILE,
  DAILY_CHALLENGES_DATA,
  getStoredProfile,
  saveProfile,
  getDailyChallenges,
  saveDailyChallenges,
  INITIAL_WEAPONS,
  HULL_REFIT_COST,
  getHullExtensionCost,
  getHullMaxHp,
  MAX_HULL_EXTENSION_STEPS,
  getIdleUpgradeCost,
  calculateIdleCash,
  FREE_SPECIAL_CHARGES,
  SPECIAL_CHARGE_COSTS,
  getWeaponUpgradeCost,
  weaponStatsAtTier,
  MAX_WEAPON_TIER,
  ADRENALINE_STIM_COST,
  ADRENALINE_STIM_AMOUNT,
  ADRENALINE_REFILL_STEP,
  MAX_ADRENALINE_REFILL_STEPS,
  getAdrenalineRefillCost,
  getAdrenalineGainMultiplier,
  rollMysteryBox,
  getReviveCostGems,
  BATTLE_PASS_TIERS,
  getTodayDayStamp,
  previewDailyStreak,
  claimDailyStreak,
} from '@/lib/storage';
import { getEraInfo } from '@/lib/eras';
import { sound } from '@/lib/audio';
import { haptics } from '@/lib/haptics';
import {
  initAnalytics,
  trackGameStart,
  trackWaveStart,
  trackWaveComplete,
  trackWaveFail,
  trackEraStart,
  trackEraComplete,
  trackBossSpawn,
  trackBossDefeated,
  trackGameOver,
  trackStoryComplete,
  trackRevive,
  trackRewardedAd,
  trackPurchase,
} from '@/lib/analytics';
import { cloudSync, SyncStatus } from '@/lib/cloudSync';
import {
  firstFrameReady as ytFirstFrameReady,
  gameReady as ytGameReady,
  getPlayablesAudioEnabled,
  installErrorReporting,
  registerPlayablesLifecycle,
  sendBestScore,
  showInterstitialAd,
  showRewardedAd,
  inPlayablesEnv,
  REWARD_IDS,
} from '@/lib/ytplayables';
import { EarthTopBar } from '@/components/EarthTopBar';
import { EarthBottomDock } from '@/components/EarthBottomDock';
import { TouchJoystick } from '@/components/TouchJoystick';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { InstallAppButton } from '@/components/InstallAppButton';
import { IncomingThreatWarning } from '@/components/IncomingThreatWarning';
import { StoryIntroModal } from '@/components/StoryIntroModal';
import { RewardedAdOffer, AdOffer, AdOfferKind } from '@/components/RewardedAdOffer';
import { ClaimBoostModal, ClaimBoost } from '@/components/ClaimBoostModal';
import { Play, RotateCcw, Volume2, VolumeX, Shield, Award, Gift, Sparkles, Trophy, ShoppingBag, Cloud, CloudOff, Flame, Swords, Infinity as InfinityIcon } from 'lucide-react';

/** Free "watch sponsored ad" continues per run (mobile-arcade standard: 3). */
const MAX_AD_REVIVES_PER_RUN = 3;

/** Turret steering keys — arrows plus WASD aliases (desktop/keyboard play).
 *  Held keys sweep the gun; the steering loop lives in the page component. */
const AIM_KEY_MAP: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  s: 'down',
  S: 'down',
};

/** Gem price for EXTRA Daily Boss Rush entries after the free daily one. */
const BOSS_RUSH_EXTRA_ENTRY_GEMS = 25;

/** Mid-run rewarded-ad offers: max per run + minimum spacing between them. */
const MAX_MIDRUN_AD_OFFERS = 4;
const MIDRUN_AD_OFFER_COOLDOWN_MS = 75_000;

/** Cash granted by the mid-run "war funds" rewarded ad. */
const AD_REWARD_WAR_FUNDS = 350;
/** Hull restored by the mid-run "repair drone" rewarded ad. */
const AD_REWARD_REPAIR_HP = 40;

/** The concrete offers the game can surface mid-combat. */
const AD_OFFER_DEFS: Record<AdOfferKind, AdOffer> = {
  adrenaline: {
    kind: 'adrenaline',
    title: 'Adrenaline Boost +60',
    detail: 'Surge the rush meter — auto-Overdrive at 100',
    cta: 'Watch Ad • Boost Rush',
    icon: 'zap',
    color: '#38bdf8',
  },
  grenades: {
    kind: 'grenades',
    title: '+2 Frag Grenades',
    detail: 'Lobbed AoE blasts at your aim point',
    cta: 'Watch Ad • Arm Frags',
    icon: 'bomb',
    color: '#FAC602',
  },
  emp: {
    kind: 'emp',
    title: '+1 EMP Charge',
    detail: 'Shield-breaking stun pulse for the next push',
    cta: 'Watch Ad • Charge EMP',
    icon: 'sparkles',
    color: '#c084fc',
  },
  repair: {
    kind: 'repair',
    title: `Field Repair +${AD_REWARD_REPAIR_HP} HP`,
    detail: 'Emergency drone patches the Citadel hull',
    cta: 'Watch Ad • Repair Now',
    icon: 'wrench',
    color: '#4ade80',
  },
  funds: {
    kind: 'funds',
    title: `War Funds +$${AD_REWARD_WAR_FUNDS}`,
    detail: 'Defense budget top-up for upgrades',
    cta: 'Watch Ad • Claim Funds',
    icon: 'coins',
    color: '#fbbf24',
  },
};

export default function GaiaFrontierPage() {
  // Touch-device detection for the virtual aim joystick: coarse-pointer
  // matchMedia covers phones/tablets up front; a one-time touch pointerdown
  // upgrades hybrid devices (touch laptops / stylus-first tablets). Desktop
  // mouse users never see the stick. (The coarse check rides a 0ms timeout
  // so no setState fires synchronously inside the effect body.)
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    const coarseTimer = setTimeout(() => {
      try {
        if (window.matchMedia?.('(pointer: coarse)').matches) setIsTouchDevice(true);
      } catch {
        /* matchMedia unsupported — the touch upgrade below still works */
      }
    }, 0);
    const upgradeOnTouch = (e: PointerEvent) => {
      if (e.pointerType === 'touch') setIsTouchDevice(true);
    };
    window.addEventListener('pointerdown', upgradeOnTouch, { once: false });
    return () => {
      clearTimeout(coarseTimer);
      window.removeEventListener('pointerdown', upgradeOnTouch);
    };
  }, []);

  // Persistent Player Profile State initialized with deterministic defaults for identical SSR hydration
  const [profile, setProfile] = useState<PlayerProfile>(DEFAULT_PROFILE);
  const [challenges, setChallenges] = useState<DailyChallenge[]>(DAILY_CHALLENGES_DATA);
  const isHydratedRef = useRef(false);

  // Active run mode (campaign / bossRush / endless) + menu-side daily-roll preview
  // (null until hydration — SSR-safe: the streak card simply isn't rendered
  // server-side, so a server/client midnight boundary can never desync HTML)
  const [gameMode, setGameMode] = useState<GameMode>('campaign');
  const [streakPreview, setStreakPreview] = useState<ReturnType<typeof previewDailyStreak> | null>(null);
  const [streakJustClaimed, setStreakJustClaimed] = useState(false);

  // CLAIM-BOOST ECONOMY — every currency claim (challenges, mystery box,
  // battle pass tiers, daily streak, idle collector) credits HALF the legacy
  // payout (the tables in storage.ts are already halved) and then queues this
  // boost offer: watch a rewarded ad to DOUBLE the claim (restores the legacy
  // value) or take +50% for free. Null = no offer live.
  const [claimBoost, setClaimBoost] = useState<ClaimBoost | null>(null);

  // Mirrors of shell state for the once-registered SDK lifecycle callbacks
  // (they must read current values through refs, not stale closures)
  const hasStartedRef = useRef(false);
  const isGameOverRef = useRef(false);
  const isIntermissionRef = useRef(false);
  const isPausedRef = useRef(false);
  const profileRef = useRef<PlayerProfile>(DEFAULT_PROFILE);
  // GA telemetry run-scoped refs: engine callbacks are created once per run
  // (stale-closure risk for React state), so live wave/era/startTime live in
  // refs that the callbacks themselves keep fresh.
  const runStartRef = useRef(0);
  const liveWaveRef = useRef(1);
  const liveEraRef = useRef<EraInfo | null>(null);
  /** Last wave that reported wave_start — dedupes the extra onEraChange
   *  calls from broadcastState() (run boot + revive resync). */
  const lastReportedWaveRef = useRef(0);

  // Cloud identity + sync status for the menu badge (post-hydration only,
  // keeping SSR markup deterministic)
  const [playerId, setPlayerId] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  // Mobile autoplay policy: unlock WebAudio inside the FIRST user gesture so
  // sound is ON by default on phones (the engine only ever creates the
  // AudioContext lazily — from the rAF loop, outside gestures — which iOS and
  // Android keep suspended forever). One-time, capture-phase, self-removing.
  // Music ALSO starts right here (menu theme) — the game must never sit in
  // silence: music + FX on by default, per product feedback.
  useEffect(() => {
    // Google Analytics 4: boots the gtag pipeline (no-op without a configured
    // measurement ID — see lib/analytics.ts).
    initAnalytics();
    // Warm the tiny intro loop (~76 KB) before the player even touches the
    // screen, so the first gesture starts music instantly — the full menu
    // theme (350 KB) is still fetching at that point.
    sound.prefetchIntro();
    const unlock = () => {
      sound.unlock();
      if (!hasStartedRef.current) {
        sound.startMusic(0); // 0 = main-menu theme
      }
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      window.removeEventListener('click', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    window.addEventListener('click', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      window.removeEventListener('click', unlock, true);
    };
  }, []);

  // Synchronize client-side saved progress only after hydration
  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = getStoredProfile();
      setProfile(stored);
      setChallenges(getDailyChallenges());
      // Refresh the daily-streak card against the real persisted profile
      setStreakPreview(previewDailyStreak(stored));
      setStreakJustClaimed(false);
      isHydratedRef.current = true;
      setPlayerId(cloudSync.getPlayerId());
      // Cloud bootstrap (non-blocking): pull the remote save and adopt it
      // when strictly newer than the local cache, then release cloud pushes.
      void (async () => {
        const remote = await cloudSync.pull();
        if (remote && remote.savedAt > cloudSync.getLocalSavedAt()) {
          cloudSync.applyRemoteToLocal(remote);
          // Re-read through the storage sanitizers so a corrupt/hand-edited
          // cloud blob can never reach the engine unsanitized.
          const restored = getStoredProfile();
          setProfile(restored);
          setChallenges(getDailyChallenges());
          setStreakPreview(previewDailyStreak(restored));
        }
        cloudSync.markBootstrapDone();
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Day-rollover refresh — a player leaving the tab open across local
  // midnight must not keep staring at yesterday's "STREAK SECURED — RETURN
  // TOMORROW" card (and yesterday's fully-claimed challenge board) until a
  // reload. Cheap 30s poll; does nothing unless the calendar day actually
  // changed. Never touches the live profile (mid-run progress is safe).
  useEffect(() => {
    let lastDay = getTodayDayStamp();
    const timer = setInterval(() => {
      const today = getTodayDayStamp();
      if (today === lastDay) return;
      lastDay = today;
      const stored = getStoredProfile();
      setStreakPreview(previewDailyStreak(stored));
      setStreakJustClaimed(false);
      setChallenges(getDailyChallenges());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Game Engine & Real-time gameplay state
  const engineRef = useRef<GameEngine | null>(null);
  // Bumped every time a fresh engine instance is created so GameCanvas re-syncs
  // its adaptive viewport to the new engine before the first frame renders
  const [engineEpoch, setEngineEpoch] = useState(0);
  /** Adaptive render-quality tier (0/1/2) from the engine's frame-time
   *  governor — tier 2 tells GameCanvas to shrink the backing-store DPR. */
  const [qualityLevel, setQualityLevel] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  // FIRST CONTACT story intro: shown once, the first time a brand-new player
  // presses PLAY (any cabinet). pendingStoryMode remembers which cabinet they
  // pressed so the run actually starts when the cinematic ends; the session
  // ref guards against the stale-closure re-trigger loop.
  const [showStoryIntro, setShowStoryIntro] = useState(false);
  const [pendingStoryMode, setPendingStoryMode] = useState<GameMode>('campaign');
  const storyGateRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(false);

  // HUD and in-game reactive states
  const [score, setScore] = useState(0);
  const [runCash, setRunCash] = useState(0);
  const [runGems, setRunGems] = useState(0);
  const [currentHp, setCurrentHp] = useState(100);
  const [maxHp, setMaxHp] = useState(100);
  const [shieldHp, setShieldHp] = useState(0);
  const [comboStreak, setComboStreak] = useState(0);
  const [comboMultiplier, setComboMultiplier] = useState(1.0);
  const [currentWave, setCurrentWave] = useState(1);
  const [currentEra, setCurrentEra] = useState<EraInfo>(getEraInfo(1));
  const [activeWeaponId, setActiveWeaponId] = useState<WeaponId>('cannon');
  const [activeBuffs, setActiveBuffs] = useState<ActiveBuff[]>([]);
  const [autoFireEnabled, setAutoFireEnabled] = useState(true);
  const [empCooldown, setEmpCooldown] = useState(0);
  const [orbitalCooldown, setOrbitalCooldown] = useState(0);
  const [grenadeCooldown, setGrenadeCooldown] = useState(0);
  // Consumable special ammo — mirrored from the engine for the HUD (buy/fire UI)
  const [empCharges, setEmpCharges] = useState(FREE_SPECIAL_CHARGES.emp);
  const [orbitalCharges, setOrbitalCharges] = useState(FREE_SPECIAL_CHARGES.orbital);
  const [grenadeCharges, setGrenadeCharges] = useState(FREE_SPECIAL_CHARGES.grenade);
  const [adrenaline, setAdrenaline] = useState(0);
  const [isOverdrive, setIsOverdrive] = useState(false);
  const [activeBoss, setActiveBoss] = useState<Threat | null>(null);
  const [bossWarning, setBossWarning] = useState<Threat | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Free "watch sponsored ad" revives: how many the player has already burned this run
  const [adRevivesUsed, setAdRevivesUsed] = useState(0);
  // Gem (premium, no-ad) revives used this run — the price doubles each time
  // (40 → 80 → 160 …) so banking gems can never buy infinite continues.
  const [gemRevivesUsed, setGemRevivesUsed] = useState(0);

  // Mid-run rewarded-ad offer (see RewardedAdOffer.tsx). Null = no offer live.
  const [adOffer, setAdOffer] = useState<AdOffer | null>(null);
  const [isAdOfferPlaying, setIsAdOfferPlaying] = useState(false);
  const adOffersShownRef = useRef(0);
  const lastAdOfferAtRef = useRef(0);
  const adOfferAcceptedRef = useRef(false);

  // Modals & Intermissions
  const [isIntermission, setIsIntermission] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [gameOverStats, setGameOverStats] = useState({
    score: 0,
    waveReached: 1,
    cashEarned: 0,
    bestStreak: 0,
    bossesDefeated: 0,
    kills: 0,
  });

  // Synchronize weapons with player profile state — stats recomputed from the
  // shared tier curve so every UI surface (shop, intermission, advisor) shows
  // the weapon's REAL current damage/fire rate, not its Mk1 base values.
  const weapons = useMemo<Record<WeaponId, WeaponDef>>(() => {
    const result: Record<WeaponId, WeaponDef> = JSON.parse(JSON.stringify(INITIAL_WEAPONS));
    Object.keys(profile.weapons).forEach((id) => {
      const wid = id as WeaponId;
      if (result[wid]) {
        result[wid].unlocked = profile.weapons[wid].unlocked;
        result[wid].tier = profile.weapons[wid].tier;
        const stats = weaponStatsAtTier(
          INITIAL_WEAPONS[wid].damage,
          INITIAL_WEAPONS[wid].fireRate,
          profile.weapons[wid].tier
        );
        result[wid].damage = stats.damage;
        result[wid].fireRate = stats.fireRate;
      }
    });
    return result;
  }, [profile.weapons]);

  const [activeModal, setActiveModal] = useState<
    'none' | 'shop' | 'challenges' | 'mystery' | 'battlepass' | 'cosmetics' | 'leaderboard'
  >('none');

  // Sync profile & challenges to localStorage + the cloud, only after hydration
  useEffect(() => {
    profileRef.current = profile;
    if (isHydratedRef.current) {
      saveProfile(profile);
      cloudSync.updateProfile(profile);
    }
  }, [profile]);

  useEffect(() => {
    if (isHydratedRef.current) {
      saveDailyChallenges(challenges);
      cloudSync.updateChallenges(challenges);
    }
  }, [challenges]);

  // Keep mirrors in sync for SDK lifecycle callbacks
  useEffect(() => {
    hasStartedRef.current = hasStarted;
    isGameOverRef.current = isGameOver;
    isIntermissionRef.current = isIntermission;
    isPausedRef.current = isPaused;
  }, [hasStarted, isGameOver, isIntermission, isPaused]);

  // The post-ad auto-resume timer must never outlive an explicit pause: an
  // impatient double-tap on the pause button during the ad's 800ms grace
  // window used to leave the timer armed — it then fired engine.resume()
  // and combat ran LIVE behind the PAUSED modal.
  const postAdResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isPaused && postAdResumeTimerRef.current !== null) {
      clearTimeout(postAdResumeTimerRef.current);
      postAdResumeTimerRef.current = null;
    }
  }, [isPaused]);

  // Cloud status badge + reconciliation when the server rejects a late push
  useEffect(() => {
    const unsubscribe = cloudSync.subscribe(setSyncStatus);
    cloudSync.setOnStale((newer) => {
      // Never yank a live run's in-flight progress — reconcile at next boot.
      if (hasStartedRef.current && !isGameOverRef.current) return;
      cloudSync.applyRemoteToLocal(newer);
      setProfile(getStoredProfile());
      setChallenges(getDailyChallenges());
    });
    return unsubscribe;
  }, []);

  // Update cooldown timers for UI — DISPLAY-VALUE guards: cooldowns tick
  // continuously but the HUD only renders Math.ceil(seconds), and charges are
  // integers. Setting state only when a DISPLAYED value actually changes cuts
  // the HUD's React re-render rate from a fixed 6.7/s to ~1/s during combat
  // (each avoided re-render is layout+paint budget the render loop gets back).
  useEffect(() => {
    if (!hasStarted || isPaused || isGameOver) return;
    const timer = setInterval(() => {
      const eng = engineRef.current;
      if (eng) {
        setEmpCooldown((prev) => (Math.ceil(prev) === Math.ceil(eng.specialCooldowns.emp) ? prev : eng.specialCooldowns.emp));
        setOrbitalCooldown((prev) => (Math.ceil(prev) === Math.ceil(eng.specialCooldowns.orbital) ? prev : eng.specialCooldowns.orbital));
        setGrenadeCooldown((prev) => (Math.ceil(prev) === Math.ceil(eng.specialCooldowns.grenade) ? prev : eng.specialCooldowns.grenade));
        setEmpCharges((prev) => (prev === eng.specialCharges.emp ? prev : eng.specialCharges.emp));
        setOrbitalCharges((prev) => (prev === eng.specialCharges.orbital ? prev : eng.specialCharges.orbital));
        setGrenadeCharges((prev) => (prev === eng.specialCharges.grenade ? prev : eng.specialCharges.grenade));
        if (eng.activeBoss) {
          const boss = eng.activeBoss;
          setActiveBoss((prev) => {
            if (prev && prev.id === boss.id && prev.hp === boss.hp && prev.bossPhase === boss.bossPhase) {
              return prev; // skip re-render when nothing meaningful changed
            }
            return { ...boss };
          });
        } else {
          setActiveBoss((prev) => (prev === null ? prev : null));
        }
      }
    }, 150);
    return () => clearInterval(timer);
  }, [hasStarted, isPaused, isGameOver]);

  // Freeze the simulation whenever a full-screen menu is open so the player
  // can never die behind an opaque modal (GameOver + menus stay exclusive too)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !hasStarted || isGameOver) return;
    if (activeModal !== 'none' && !eng.isPaused) {
      eng.pause();
    } else if (activeModal === 'none' && eng.isPaused && !isPaused) {
      eng.resume();
    }
  }, [activeModal, hasStarted, isGameOver, isPaused]);

  // Daily Challenge progress helper
  const trackChallengeProgress = useCallback((type: DailyChallenge['type'], increment: number = 1) => {
    setChallenges((prev) =>
      prev.map((ch) => {
        if (ch.type === type && !ch.completed) {
          // Clamp to target so late-firing events can't overshoot the progress bar
          const nextVal = Math.min(ch.target, ch.current + increment);
          const completed = nextVal >= ch.target;
          return { ...ch, current: nextVal, completed };
        }
        return ch;
      })
    );
  }, []);

  // --- Mid-run rewarded-ad offers ---------------------------------------------

  /**
   * Rewarded ad with a standalone-web fallback: inside YouTube Playables the
   * REAL ad plays (requestRewardedAd). Outside it, we simulate a ~4s sponsored
   * transmission so the button is always testable in dev/standalone builds.
   */
  const playRewardedOrSimulate = useCallback(async (rewardId: string): Promise<boolean> => {
    const res = await showRewardedAd(rewardId);
    if (res !== null) return res; // real SDK flow decided
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return true;
  }, []);

  /**
   * Evaluates whether a rewarded-ad support offer should surface right now.
   * Priority: critical hull → dry ordnance → low adrenaline → war funds.
   * Rate limits: max 4 offers per run, ≥75s apart, live combat only.
   */
  useEffect(() => {
    if (!hasStarted || isPaused || isGameOver || isIntermission) return;
    const timer = setInterval(() => {
      if (adOffer !== null || isAdOfferPlaying || activeModal !== 'none') return;
      const eng = engineRef.current;
      if (!eng || !eng.isRunning || eng.isPaused || eng.isWaveIntermission) return;
      if (adOffersShownRef.current >= MAX_MIDRUN_AD_OFFERS) return;
      if (Date.now() - lastAdOfferAtRef.current < MIDRUN_AD_OFFER_COOLDOWN_MS) return;

      const hpRatio = eng.currentBaseHp / Math.max(1, eng.maxBaseHp);
      const wave = eng.currentWave;

      let kind: AdOfferKind | null = null;
      if (hpRatio < 0.45 && wave >= 2) kind = 'repair';
      else if (eng.specialCharges.grenade <= 0 && wave >= 3) kind = 'grenades';
      else if (eng.specialCharges.emp <= 0 && eng.weapons.emp.unlocked && wave >= 4) kind = 'emp';
      else if (eng.adrenaline < 25 && !eng.isOverdrive && wave >= 4) kind = 'adrenaline';
      else if (profileRef.current.cash < 100 && wave >= 5) kind = 'funds';

      if (!kind) return;
      adOffersShownRef.current += 1;
      lastAdOfferAtRef.current = Date.now();
      adOfferAcceptedRef.current = false;
      setAdOffer(AD_OFFER_DEFS[kind]);
    }, 2000);
    return () => clearInterval(timer);
  }, [hasStarted, isPaused, isGameOver, isIntermission, adOffer, isAdOfferPlaying, activeModal]);

  /** Accept flow: pause the sim → play the ad → grant the reward → resume. */
  const handleAdOfferAccept = useCallback(async () => {
    if (!adOffer || isAdOfferPlaying) return;
    const eng = engineRef.current;
    const kind = adOffer.kind;
    setIsAdOfferPlaying(true);
    adOfferAcceptedRef.current = true;
    // Freeze the sim while the sponsored broadcast owns the screen
    if (eng && eng.isRunning && !eng.isPaused) eng.pause();

    let granted = false;
    try {
      switch (kind) {
        case 'adrenaline':
          granted = await playRewardedOrSimulate(REWARD_IDS.adrenalineBoost);
          if (granted && engineRef.current) engineRef.current.increaseAdrenaline(60);
          break;
        case 'grenades':
          granted = await playRewardedOrSimulate(REWARD_IDS.grenadeBundle);
          if (granted && engineRef.current) engineRef.current.grantSpecialCharges('grenade', 2);
          break;
        case 'emp':
          granted = await playRewardedOrSimulate(REWARD_IDS.empCharge);
          if (granted && engineRef.current) engineRef.current.grantSpecialCharges('emp', 1);
          break;
        case 'repair':
          granted = await playRewardedOrSimulate(REWARD_IDS.repairDrone);
          if (granted && engineRef.current) engineRef.current.repairBase(AD_REWARD_REPAIR_HP);
          break;
        case 'funds':
          granted = await playRewardedOrSimulate(REWARD_IDS.warFunds);
          if (granted) {
            setProfile((p) => ({ ...p, cash: p.cash + AD_REWARD_WAR_FUNDS }));
          }
          break;
      }
    } finally {
      setIsAdOfferPlaying(false);
      setAdOffer(null);
      // Hand control back — a fresh 1s grace keeps the return from being unfair.
      // State-aware: if the player explicitly PAUSED during the grace window,
      // cancel the auto-resume (never fight the user, never run combat behind
      // the PauseModal).
      const e = engineRef.current;
      if (e && e.isRunning && e.isPaused && !isPaused) {
        if (postAdResumeTimerRef.current !== null) clearTimeout(postAdResumeTimerRef.current);
        postAdResumeTimerRef.current = setTimeout(() => {
          postAdResumeTimerRef.current = null;
          const eng = engineRef.current;
          if (eng && eng.isRunning && eng.isPaused && !isPausedRef.current) {
            eng.resume();
          }
        }, 800);
      }
    }
    trackRewardedAd(`midrun_${kind}`, granted);
    if (granted) {
      haptics.success();
      void cloudSync.flush();
    }
  }, [adOffer, isAdOfferPlaying, isPaused, playRewardedOrSimulate]);

  const handleAdOfferDismiss = useCallback(() => {
    if (adOfferAcceptedRef.current) return; // dismissing after accept is a no-op
    setAdOffer(null);
  }, []);

  // YouTube Playables SDK lifecycle (every call no-ops outside YouTube):
  //  - firstFrameReady → gameReady handshake (REQUIRED for certification)
  //  - onPause: flush the cloud save + pause the run; onResume: the player
  //    deliberately resumes manually (never auto-resume into combat)
  //  - audio state follows the user's YouTube audio settings
  useEffect(() => {
    const audioEnabled = getPlayablesAudioEnabled();
    // Defer the initial mute so we never setState synchronously in the effect
    let muteTimer: ReturnType<typeof setTimeout> | null = null;
    if (audioEnabled === false) {
      muteTimer = setTimeout(() => {
        setIsMuted(true);
        sound.setMasterMuted(true);
      }, 0);
    }
    registerPlayablesLifecycle({
      onPause: () => {
        cloudSync.flush();
        const eng = engineRef.current;
        // During intermission there is no live combat to freeze — pausing
        // here would stack the PauseModal on top of the intermission card
        // while its auto-deploy countdown kept ticking into the next wave.
        if (
          eng &&
          hasStartedRef.current &&
          !isGameOverRef.current &&
          !isIntermissionRef.current &&
          !eng.isPaused
        ) {
          eng.pause();
          setIsPaused(true);
        }
      },
      onAudioEnabledChange: (enabled) => {
        setIsMuted(!enabled);
        sound.setMasterMuted(!enabled);
      },
    });
    installErrorReporting();
    cloudSync.installAutoFlush();
    // The menu overlay paints immediately after hydration; double-rAF lands
    // on the first presented, fully interactive frame.
    //
    // Robustness guards: the SDK Test Suite loads the game inside an iframe
    // that can be scrolled offscreen or throttled — requestAnimationFrame
    // callbacks are then starved, which would stall the handshake forever and
    // flag the "gameReady called within 5 seconds" SHOULD check. The timeout
    // fallback guarantees the signal fires no matter how the browser schedules
    // rAF, and the once-flags keep firstFrameReady strictly before gameReady
    // (and idempotent under React strict-mode double-mount in dev).
    let firstFrameSent = false;
    let gameReadySent = false;
    const sendFirstFrame = () => {
      if (!firstFrameSent) {
        firstFrameSent = true;
        ytFirstFrameReady();
      }
    };
    const sendGameReady = () => {
      sendFirstFrame();
      if (!gameReadySent) {
        gameReadySent = true;
        ytGameReady();
      }
    };
    requestAnimationFrame(() => {
      sendFirstFrame();
      requestAnimationFrame(sendGameReady);
    });
    // Safety net: never wait on rAF scheduling longer than ~350ms after the
    // interactive menu has mounted — the SDK only cares that the game is
    // interactable, and by this point it fully is.
    const readyFallback = setTimeout(sendGameReady, 350);
    return () => {
      clearTimeout(readyFallback);
      if (muteTimer !== null) clearTimeout(muteTimer);
    };
  }, []);

  // Initialize and start run — mode selects the arcade cabinet:
  //   campaign : the classic invasion road
  //   bossRush : DAILY flagship gauntlet (free entry once/day, then gems)
  //   endless  : Endless Gauntlet (×1.5 score pressure cooker)
  const handleStartGame = (mode: GameMode = 'campaign') => {
    // FIRST CONTACT: first-time players watch the illustrated storyline before
    // their very first run (product spec). Skipped or finished → straight in.
    if (!profile.storyIntroSeen && !storyGateRef.current) {
      storyGateRef.current = true;
      setPendingStoryMode(mode);
      setShowStoryIntro(true);
      return;
    }

    // Belt and braces: START is the most likely first gesture — make sure the
    // audio context is live BEFORE the music fires (mobile sound on by default)
    sound.unlock();
    const canvas = document.getElementById('earth-defender-viewport') as HTMLCanvasElement;
    if (!canvas) return;

    // Boss Rush access control: 1 free entry per calendar day, extra runs
    // cost gems (keeps the daily appointment SPECIAL — scarcity = habit).
    if (mode === 'bossRush') {
      const today = getTodayDayStamp();
      const freeAvailable = profile.lastBossRushDay !== today;
      if (!freeAvailable) {
        if (profile.gems < BOSS_RUSH_EXTRA_ENTRY_GEMS) {
          haptics.alarm();
          return; // button UI already communicates the cost — hard gate here
        }
        setProfile((p) => ({ ...p, gems: p.gems - BOSS_RUSH_EXTRA_ENTRY_GEMS }));
      } else {
        setProfile((p) => ({ ...p, lastBossRushDay: today }));
      }
    }

    setGameMode(mode);

    // GA: a run actually begins (story gate passed, engine about to spin up).
    // Refs reset so every run reports its own wave/era/heartbeat cleanly.
    trackGameStart(mode, !profile.storyIntroSeen);
    runStartRef.current = Date.now();
    liveWaveRef.current = 1;
    liveEraRef.current = null;
    lastReportedWaveRef.current = 0;

    // Tear down any previous engine so its RAF loop and music never leak into this run
    engineRef.current?.stop();

    const engine = new GameEngine3D(
      canvas,
      {
        onScoreUpdate: (s) => setScore(s),
        onCashUpdate: (earned) => {
          setRunCash((prev) => Math.max(0, prev + earned));
          // Clamped at 0: fake-goodie deception now DEDUCTS funds (negative deltas)
          setProfile((p) => ({ ...p, cash: Math.max(0, p.cash + earned) }));
        },
        onGemsUpdate: (earned) => {
          setRunGems((prev) => prev + earned);
          setProfile((p) => ({ ...p, gems: p.gems + earned }));
        },
        onHealthUpdate: (hp, max, shield) => {
          setCurrentHp(hp);
          setMaxHp(max);
          setShieldHp(shield);
        },
        onWaveComplete: (wave, waveStats) => {
          setIsIntermission(true);
          // +1 per cleared wave (target 6): the old `+wave` increment summed
          // wave NUMBERS (1+2+3 = 6) so the quest completed after wave 3.
          trackChallengeProgress('survive_waves', 1);
          // GA: wave cleared with the run's context — the core progression event.
          trackWaveComplete(wave, liveEraRef.current?.eraNumber ?? 1, liveEraRef.current?.name ?? '', mode, {
            kills: waveStats.kills,
            cashEarned: waveStats.cashEarned,
            score: engineRef.current?.score ?? 0,
          });
          // Engagement ping per wave (Playables only): the run's live score as
          // an integer. YouTube keeps the best value, so frequent sends are
          // safe — and the SDK test suite expects sendScore to fire.
          void sendBestScore(engineRef.current?.score ?? 0);
          // Natural checkpoint: persist progress to the cloud every wave clear
          void cloudSync.flush();
          setProfile((p) => ({
            ...p,
            highestWave: Math.max(p.highestWave, wave),
            battlePassXp: p.battlePassXp + 60,
          }));
        },
        // Live wave tracking — previously the shell's wave state was frozen at 1,
        // so the HUD badge and the "Wave Cleared" intermission always said 1.
        onWaveChange: (wave) => {
          setCurrentWave(wave);
          liveWaveRef.current = wave; // GA context for era/boss events
        },
        onGameOver: (stats) => {
          setIsGameOver(true);
          setGameOverStats(stats);
          setActiveModal('none');
          setIsIntermission(false);
          // GA: the run's full report — score, waves, kills, bosses, duration,
          // earnings, mode, record — plus the wave_fail marker for funnel maps.
          trackWaveFail(stats.waveReached, liveEraRef.current?.eraNumber ?? 1, mode);
          trackGameOver({
            score: stats.score,
            waveReached: stats.waveReached,
            eraNumber: liveEraRef.current?.eraNumber ?? 1,
            eraName: liveEraRef.current?.name ?? '',
            kills: stats.kills,
            bossesDefeated: stats.bossesDefeated,
            bestStreak: stats.bestStreak,
            runDurationS: Math.round((Date.now() - runStartRef.current) / 100) / 10,
            gemsEarned: stats.gemsEarned,
            cashEarned: stats.cashEarned,
            mode,
            // profileRef, not the run-start closure: on die→revive→die runs
            // the stale snapshot overcounted record runs in GA.
            newHighScore: stats.score > profileRef.current.highScore,
          });
          // Run over: stand the soundtrack down from combat intensity
          sound.resetCombatDrive();
          // Any live ad offer is moot once the run is over
          setAdOffer(null);
          // Report EVERY run's final score to YouTube's leaderboard surface
          // (Playables only) — not just new records: sendScore must reliably
          // fire with an integer for SDK certification.
          void sendBestScore(stats.score);
          // Final checkpoint: push the run's earnings to the cloud immediately
          void cloudSync.flush();
          setProfile((p) => ({
            ...p,
            totalRuns: p.totalRuns + 1,
            highScore: Math.max(p.highScore, stats.score),
            highestWave: Math.max(p.highestWave, stats.waveReached),
            bestStreak: Math.max(p.bestStreak, stats.bestStreak),
            bossesDefeated: p.bossesDefeated + stats.bossesDefeated,
            battlePassXp: p.battlePassXp + stats.kills * 2,
            // Mode-specific record books — separate leaderboards-in-the-head
            // for each cabinet (mastery identity per mode).
            bossRushBestStage:
              stats.gameMode === 'bossRush'
                ? Math.max(p.bossRushBestStage, stats.waveReached)
                : p.bossRushBestStage,
            endlessBestWave:
              stats.gameMode === 'endless'
                ? Math.max(p.endlessBestWave, stats.waveReached)
                : p.endlessBestWave,
          }));
        },
        onComboUpdate: (streak, mult) => {
          setComboStreak(streak);
          setComboMultiplier(mult);
          // Fire exactly once per climb to 15 (combo increments by 1 per kill)
          if (streak === 15) {
            trackChallengeProgress('combo_streak', 15);
          }
        },
        onBuffsUpdate: (buffs) => setActiveBuffs(buffs),
        onEraChange: (era) => {
          setCurrentEra(era);
          sound.setEra(era.eraNumber);
          // GA: setupWave fires onEraChange once per wave (AFTER onWaveChange),
          // making this the one reliable per-wave hook — but broadcastState()
          // (run boot + revive) re-fires it with an unchanged wave, so
          // wave_start dedupes on the wave number. Era transitions report
          // era_complete (previous) + era_start (new); Boss Rush stages wrap
          // eras without completing them, so era_complete only fires on a
          // forward number climb.
          const wave = liveWaveRef.current;
          if (wave !== lastReportedWaveRef.current) {
            trackWaveStart(wave, era.eraNumber, era.name, mode);
            lastReportedWaveRef.current = wave;
          }
          const prev = liveEraRef.current;
          if (prev && prev.eraNumber < era.eraNumber && mode !== 'bossRush') {
            trackEraComplete(prev.eraNumber, prev.name, mode);
          }
          if (!prev || prev.eraNumber !== era.eraNumber) {
            trackEraStart(era.eraNumber, era.name, mode, wave);
          }
          liveEraRef.current = era;
        },
        onBossEncounter: (boss) => {
          setActiveBoss(boss ? { ...boss } : null);
          if (boss) {
            setBossWarning(boss);
            // GA: named boss encounter (era flagship or mini-boss).
            trackBossSpawn(
              boss.name || boss.type,
              liveEraRef.current?.eraNumber ?? 1,
              liveWaveRef.current,
              mode
            );
          }
        },
        onBossDefeated: (info) => {
          // GA: engine-side exact boss death (see gameEngine kill path).
          trackBossDefeated(info.bossName, info.eraNumber, info.wave, mode);
        },
        onThreatKilled: (threatType) => {
          if (threatType === 'scout') {
            trackChallengeProgress('kill_scouts', 1);
          }
        },
        onAdrenalineUpdate: (adr, overdrive) => {
          setAdrenaline(adr);
          setIsOverdrive(overdrive);
        },
        // Adaptive quality governor: tier 2 tells the canvas to shrink its
        // backing-store DPR (fewer pixels = the frame loop catches back up)
        onQualityLevel: (level) => {
          setQualityLevel(level);
        },
        // Soundtrack adrenaline: the era track escalates (hat fills → 16th-note
        // bass roll → stabs/octave lead → double-kick + risers + tempo push)
        // as the rush meter climbs, overdrive kicks in, or the boss enrages.
        onCombatDrive: (s) => {
          sound.setCombatDrive(s.adrenaline, s.overdrive, s.bossPhase, s.hpRatio);
        },
      },
      profile
    );

    engineRef.current = engine;
    setEngineEpoch((e) => e + 1);

    // Dev/test hook: expose the live engine so the QA harness (and console
    // debugging) can spawn threats / inspect state without natural waiting.
    if (typeof window !== 'undefined') {
      (window as unknown as { __GF_ENGINE__: GameEngine | null }).__GF_ENGINE__ = engine;
      // Sound-engine twin hook: lets the QA harness assert which soundtrack
      // track is live (sample vs procedural fallback) without guessing.
      (window as unknown as { __GF_SOUND__?: typeof sound }).__GF_SOUND__ = sound;
    }

    // Sync the engine's adaptive logical viewport to the live canvas size BEFORE
    // the first frame renders (the canvas itself was already sized full-bleed)
    {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const logical = computeLogicalSize(rect.width, rect.height);
        engine.setViewport(logical.w, logical.h);
      }
    }

    setHasStarted(true);
    setIsGameOver(false);
    setIsIntermission(false);
    setIsPaused(false);
    setAdRevivesUsed(0);
    setGemRevivesUsed(0);
    setCurrentWave(1);
    // Fresh run → fresh ad-offer budget & cooldown
    adOffersShownRef.current = 0;
    lastAdOfferAtRef.current = Date.now() - MIDRUN_AD_OFFER_COOLDOWN_MS + 30_000; // first offer eligible ~30s in
    adOfferAcceptedRef.current = false;
    setAdOffer(null);
    setIsAdOfferPlaying(false);
    sound.startMusic(1);
    engine.startNewRun(mode);
  };

  // Keyboard controls for desktop convenience
  // Held-direction registry shared by the keydown/keyup listeners and the
  // steering rAF loop below (arrow keys + WASD aliases).
  const aimKeysRef = useRef<Set<'left' | 'right' | 'up' | 'down'>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape always closes the active modal first
      if (e.key === 'Escape') {
        setActiveModal((prev) => (prev !== 'none' ? 'none' : prev));
        return;
      }

      // Turret steering keys — captured while a run is live so the page
      // never scrolls while sweeping the gun (arrows scroll by default).
      const aimDir = AIM_KEY_MAP[e.key];
      if (aimDir) {
        const eng = engineRef.current;
        const canSteer =
          !!eng && hasStarted && !isGameOver && !isIntermission && activeModal === 'none' && !isPaused;
        if (canSteer) {
          e.preventDefault();
          if (!e.repeat) aimKeysRef.current.add(aimDir);
        }
        return;
      }

      const eng = engineRef.current;
      if (!eng || !hasStarted) return;
      // Never let hotkeys fire "through" open menus, the death screen, or intermission
      if (activeModal !== 'none' || isGameOver || isIntermission) return;

      if (e.key === '1') eng.switchWeapon('cannon') && setActiveWeaponId('cannon');
      if (e.key === '2') eng.switchWeapon('machinegun') && setActiveWeaponId('machinegun');
      if (e.key === '3') eng.switchWeapon('laser') && setActiveWeaponId('laser');
      if (e.key === '4') eng.switchWeapon('missiles') && setActiveWeaponId('missiles');
      if (e.key.toLowerCase() === 'e') eng.triggerSpecial('emp');
      if (e.key.toLowerCase() === 'r') eng.triggerSpecial('orbital');
      if (e.key.toLowerCase() === 'v') eng.triggerOverdrive();
      if (e.key === ' ') {
        e.preventDefault(); // keep Space from re-activating a focused button
        const next = eng.toggleAutoFire();
        setAutoFireEnabled(next);
      }
      if (e.key.toLowerCase() === 'p') {
        if (eng.isPaused) eng.resume();
        else eng.pause();
        setIsPaused(eng.isPaused);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const aimDir = AIM_KEY_MAP[e.key];
      if (aimDir) aimKeysRef.current.delete(aimDir);
    };

    // Window blur also drops held keys (alt-tab mid-sweep must not leave the
    // turret spinning when focus returns)
    const dropAimKeys = () => aimKeysRef.current.clear();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', dropAimKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', dropAimKeys);
    };
  }, [hasStarted, activeModal, isGameOver, isIntermission, isPaused]);

  // Turret steering loop (desktop twin of the touch drag): while any arrow /
  // WASD key is held the turret sweeps with a ramped angular speed — slow at
  // tap for fine aim, fast after ~0.45s held for full-field sweeps. With
  // auto-fire off, holding a steer key also squeezes the trigger (mirrors
  // the drag-to-aim-while-firing touch behavior).
  useEffect(() => {
    const gameLive =
      hasStarted && !isPaused && !isGameOver && !isIntermission && activeModal === 'none';
    if (!gameLive) {
      aimKeysRef.current.clear();
      return;
    }

    let raf = 0;
    let last = performance.now();
    let ramp = 0;

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const eng = engineRef.current;
      if (eng) {
        const held = aimKeysRef.current;
        const left = held.has('left');
        const right = held.has('right');
        const up = held.has('up');
        const down = held.has('down');
        if (left || right || up || down) {
          // Ramp 0 → 1 over ~0.45s: base 1.0 rad/s → max 2.4 rad/s.
          ramp = Math.min(1, ramp + dt * 2.2);
          const speed = 1.0 + ramp * 1.4;
          let delta = 0;
          if (left) delta -= speed * dt;
          if (right) delta += speed * dt;
          if (up) {
            // Pull toward straight-up (-90°).
            delta += Math.sign(-Math.PI / 2 - eng.aimAngle) * speed * dt;
          }
          if (down) {
            // Push away from vertical, toward the nearer horizon edge.
            delta += Math.sign(eng.aimAngle + Math.PI / 2) * speed * dt;
          }
          if (delta !== 0) eng.rotateAim(delta);
          // Manual-fire players shoot while steering, exactly like dragging.
          if (!eng.autoFireEnabled) eng.tryShoot();
        } else {
          ramp = 0;
        }
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [hasStarted, isPaused, isGameOver, isIntermission, activeModal]);

  // AUTO-PAUSE & AUTO-MUTE on focus loss — switching tabs, minimizing the
  // browser, or clicking away must never cost hull: the run freezes AND all
  // audio silences the instant the game loses the user. On return the
  // player's own mix (music/FX settings) is restored automatically, but the
  // run STAYS paused until they consciously resume — nobody wants to jump
  // back into a live firefight they walked away from.
  const autoMutedByFocusRef = useRef(false);
  useEffect(() => {
    const silenceAndPause = () => {
      // Mute everything (master overlay — remembers the player's channel mix)
      if (!autoMutedByFocusRef.current && !sound.isMasterMuted()) {
        autoMutedByFocusRef.current = true;
        sound.setMasterMuted(true);
      }
      // Freeze the simulation during live combat only (menus, death screens,
      // intermissions and already-paused runs need no intervention; a playing
      // rewarded ad manages its own lifecycle).
      const eng = engineRef.current;
      if (
        eng &&
        hasStarted &&
        !isGameOver &&
        !isIntermission &&
        activeModal === 'none' &&
        !isAdOfferPlaying &&
        !eng.isPaused
      ) {
        eng.pause();
        setIsPaused(true);
      }
    };

    const restoreOnReturn = () => {
      if (autoMutedByFocusRef.current) {
        autoMutedByFocusRef.current = false;
        sound.setMasterMuted(false);
        setIsMuted(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') silenceAndPause();
      else restoreOnReturn();
    };

    window.addEventListener('blur', silenceAndPause);
    window.addEventListener('focus', restoreOnReturn);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', silenceAndPause);
      window.removeEventListener('focus', restoreOnReturn);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasStarted, isGameOver, isIntermission, activeModal, isAdOfferPlaying]);

  // Actions
  const handleToggleAutoFire = () => {
    if (engineRef.current) {
      const next = engineRef.current.toggleAutoFire();
      setAutoFireEnabled(next);
    }
  };

  const handleSwitchWeapon = (id: WeaponId) => {
    if (engineRef.current && engineRef.current.switchWeapon(id)) {
      setActiveWeaponId(id);
    }
  };

  const handleTriggerSpecial = (type: 'emp' | 'orbital' | 'grenade') => {
    if (engineRef.current) {
      // Only count successful fires (previously counted jams/cooldown misses too)
      const fired = engineRef.current.triggerSpecial(type);
      if (fired) trackChallengeProgress('use_orbital', 1);
    }
  };

  // Mid-run consumable purchase: one charge per tap, repeatable, no cap.
  // The engine arms the ammo; cash is deducted from the persistent profile.
  const handleBuySpecialCharge = (type: 'emp' | 'orbital' | 'grenade') => {
    const eng = engineRef.current;
    if (!eng) return;
    const cost = SPECIAL_CHARGE_COSTS[type];
    if (profile.cash < cost) {
      eng.addFloatingText(`NEED $${cost}`, eng.L_WIDTH / 2, 440, '#f87171', 1.1);
      return;
    }
    setProfile((p) => ({ ...p, cash: p.cash - cost }));
    trackPurchase(`special_charge_${type}`, cost, 'cash', 'run');
    eng.addSpecialCharge(type);
    setEmpCharges(eng.specialCharges.emp);
    setOrbitalCharges(eng.specialCharges.orbital);
    setGrenadeCharges(eng.specialCharges.grenade);
  };

  const handleTogglePause = () => {
    if (!engineRef.current) return;
    if (engineRef.current.isPaused) {
      engineRef.current.resume();
      setIsPaused(false);
    } else {
      engineRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleToggleMute = () => {
    // Master mute — remembers the player's own music/FX mix and restores it
    // on unmute (channel toggles live in Settings).
    const next = !sound.isMasterMuted();
    sound.setMasterMuted(next);
    setIsMuted(next);
  };

  // Intermission Actions
  // Field repair purchase ($75 → +35 hull) — one of the only legal hull
  // restoration paths under the Merciless Hull Doctrine (buy / sky goodie / ad).
  const handleRepairBase = () => {
    if (profile.cash >= 75 && engineRef.current) {
      setProfile((p) => ({ ...p, cash: p.cash - 75 }));
      engineRef.current.repairBase(35);
      trackPurchase('field_repair', 75, 'cash', 'intermission');
    }
  };

  // Story intro finished (last NEXT or SKIP ALL): persist the flag and launch
  // the run the player originally pressed. The funnel report (pages viewed,
  // skipped) feeds the story_complete analytics event.
  const handleStoryFinish = (info: { pagesViewed: number; skipped: boolean }) => {
    trackStoryComplete(info.pagesViewed, info.skipped);
    setProfile((p) => ({ ...p, storyIntroSeen: true }));
    setShowStoryIntro(false);
    const mode = pendingStoryMode;
    setPendingStoryMode('campaign');
    handleStartGame(mode);
  };

  // UNLIMITED weapon upgrades: any weapon can climb Mk-forever. The cost
  // follows the shared exponential curve (getWeaponUpgradeCost) and the live
  // engine recomputes its stats from base — so a mid-run upgrade takes effect
  // on the very next shot (previously only the tier badge changed).
  const handleUpgradeWeaponIntermission = (id: WeaponId) => {
    const w = weapons[id];
    if (!w || w.tier >= MAX_WEAPON_TIER) return;
    const cost = getWeaponUpgradeCost(w);
    if (profile.cash >= cost) {
      const nextTier = w.tier + 1;
      setProfile((p) => ({
        ...p,
        cash: p.cash - cost,
        weapons: {
          ...p.weapons,
          [id]: { ...p.weapons[id], tier: nextTier },
        },
      }));
      trackPurchase(`weapon_upgrade_${id}`, cost, 'cash', 'upgrade', nextTier);
      engineRef.current?.setWeaponTier(id, nextTier);
    }
  };

  // Adrenaline combat stim: +50 adrenaline (auto-Overdrive at 100) — the
  // purchasable "fast reload" boost. Repeatable, no cap.
  const handleBuyAdrenalineStim = () => {
    const eng = engineRef.current;
    if (!eng || !hasStarted || isGameOver) return;
    // Never sell a useless stim: at 100 the player just taps the bar to engage
    if (eng.isOverdrive || eng.adrenaline >= 100) {
      eng.addFloatingText('RUSH ALREADY PRIMED', eng.L_WIDTH / 2, 440, '#fbbf24', 1.1);
      return;
    }
    if (profile.cash < ADRENALINE_STIM_COST) {
      eng.addFloatingText(`NEED $${ADRENALINE_STIM_COST}`, eng.L_WIDTH / 2, 440, '#f87171', 1.1);
      return;
    }
    setProfile((p) => ({ ...p, cash: p.cash - ADRENALINE_STIM_COST }));
    eng.increaseAdrenaline(ADRENALINE_STIM_AMOUNT);
    trackPurchase('adrenaline_stim', ADRENALINE_STIM_COST, 'cash', 'run');
  };

  // COMBAT RESPONSE PROTOCOL — permanent adrenaline refill-speed upgrade
  // (+25% gain per level, max 4 levels = ×2.0). Bought between waves or in
  // the shop; applies to the LIVE run instantly (next kill fills faster) and
  // persists into every future run like hull reinforcement steps.
  const handleBuyAdrenalineRefill = () => {
    const steps = profile.adrenalineGainSteps;
    if (steps >= MAX_ADRENALINE_REFILL_STEPS) return;
    const cost = getAdrenalineRefillCost(steps);
    if (profile.cash < cost) return;
    const nextSteps = steps + 1;
    setProfile((p) => ({ ...p, cash: p.cash - cost, adrenalineGainSteps: nextSteps }));
    const eng = engineRef.current;
    if (eng && eng.isRunning) {
      eng.applyAdrenalineGainSteps(nextSteps); // live multiplier kick-in
    }
    haptics.success();
    trackPurchase('adrenaline_refill', cost, 'cash', 'run', nextSteps);
  };

  const handleStartNextWave = () => {
    setIsIntermission(false);
    if (engineRef.current) {
      engineRef.current.nextWave();
    }
  };

  // Game Over Actions
  // Sponsored-ad revive: free continue from the wave where the player was defeated.
  // Inside YouTube Playables this now plays a REAL rewarded ad
  // (ytgame.ads.requestRewardedAd); on the standalone site the legacy
  // simulated-ad flow in the modal stays so the button is always testable.
  // Resolves true when the continue actually happened.
  const handleAdRevive = async (): Promise<boolean> => {
    if (MAX_AD_REVIVES_PER_RUN - adRevivesUsed <= 0 || !engineRef.current) return false;
    const earned = await showRewardedAd(REWARD_IDS.reviveContinueRun);
    trackRewardedAd('revive', earned !== false);
    if (earned === false) return false; // real ad flow ran but the reward was not granted
    setAdRevivesUsed((used) => used + 1);
    setIsGameOver(false);
    engineRef.current.revivePlayer();
    trackRevive('ad', liveWaveRef.current, 0);
    return true;
  };

  const handleRevive = () => {
    // Premium continue: diamonds are rare, so the instant revive is priced
    // like the luxury it is — base 40 gems, doubling per use within the run.
    const cost = getReviveCostGems(gemRevivesUsed);
    if (profile.gems >= cost && engineRef.current) {
      setProfile((p) => ({ ...p, gems: p.gems - cost }));
      setGemRevivesUsed((used) => used + 1);
      setIsGameOver(false);
      engineRef.current.revivePlayer();
      trackRevive('gems', liveWaveRef.current, cost);
    }
  };

  // Natural-breakpoint interstitial (YouTube Playables only): shown right
  // after the Game Over screen, before the next run boots. No-op + instant
  // start everywhere else, and failures never block the restart.
  const handlePlayAgain = async () => {
    await showInterstitialAd();
    handleStartGame(gameMode);
  };

  const handleDoubleCashClaimed = async (bonus: number): Promise<boolean> => {
    // Inside Playables the REAL rewarded ad decides the payout; the
    // standalone web build (simulated flow in the modal) credits directly.
    if (inPlayablesEnv()) {
      const earned = await showRewardedAd(REWARD_IDS.doubleCash);
      trackRewardedAd('double_cash', earned !== false);
      if (earned === false) return false;
    } else {
      trackRewardedAd('double_cash', true); // simulated ad already played in the modal
    }
    setProfile((p) => ({ ...p, cash: p.cash + bonus }));
    return true;
  };

  /** Native mystery-box bonus: roll + credit only after a real rewarded ad. */
  const handleMysteryBoxBonus = async (): Promise<MysteryBoxReward | null | false> => {
    if (!inPlayablesEnv()) return null; // modal handles the simulated flow itself
    const earned = await showRewardedAd(REWARD_IDS.mysteryBox);
    trackRewardedAd('mystery_box', earned !== false);
    if (earned === false) return false;
    const reward = rollMysteryBox();
    setProfile((p) => ({
      ...p,
      cash: p.cash + (reward.cash || 0),
      gems: p.gems + (reward.gems || 0),
      unlockedSkins: reward.skinId && !p.unlockedSkins.includes(reward.skinId)
        ? [...p.unlockedSkins, reward.skinId]
        : p.unlockedSkins,
    }));
    return reward;
  };

  const handleMysteryBoxReward = (reward: MysteryBoxReward) => {
    trackRewardedAd('mystery_box', true); // standalone-web simulated ad completed
    setProfile((p) => ({
      ...p,
      cash: p.cash + (reward.cash || 0),
      gems: p.gems + (reward.gems || 0),
      unlockedSkins: reward.skinId && !p.unlockedSkins.includes(reward.skinId)
        ? [...p.unlockedSkins, reward.skinId]
        : p.unlockedSkins,
    }));
  };

  // Shop actions
  const handleUnlockWeapon = (id: WeaponId, costCash: number, costGems: number) => {
    if (profile.cash >= costCash && profile.gems >= costGems) {
      setProfile((p) => ({
        ...p,
        cash: p.cash - costCash,
        gems: p.gems - costGems,
        weapons: {
          ...p.weapons,
          [id]: { unlocked: true, tier: 1 },
        },
      }));
      trackPurchase(`weapon_unlock_${id}`, costCash, 'cash+gems', 'shop');
      if (engineRef.current) {
        engineRef.current.weapons[id].unlocked = true;
      }
    }
  };

  const handleUpgradeWeaponShop = (id: WeaponId) => {
    handleUpgradeWeaponIntermission(id);
  };

  // EMERGENCY HULL REFIT (Hull Expansion Doctrine): fast FULL restore up to
  // the current reinforced ceiling. The free path is the glacial nano-repair
  // trickle — this is the paid fast lane (others: ads, sky goodies).
  // Only offered while a run is live, because a fresh run always starts full.
  const handleBuyHullRefit = () => {
    const eng = engineRef.current;
    if (!eng || !hasStarted || isGameOver) return;
    if (profile.cash < HULL_REFIT_COST) return;
    if (eng.currentBaseHp >= eng.maxBaseHp) return; // already pristine
    setProfile((p) => ({ ...p, cash: p.cash - HULL_REFIT_COST }));
    eng.repairBase(eng.maxBaseHp); // full restore → current reinforced max
    sound.playUpgradeSuccess();
    trackPurchase('hull_refit', HULL_REFIT_COST, 'cash', 'run');
  };

  // HULL EXPANSION — permanent +25% ceiling reinforcement (100 → 125 → 150 →
  // …). Deliberately EXPENSIVE with an escalating price curve (see storage.ts).
  // Available any time (menu or mid-run): bought mid-run, the new plating is
  // welded on immediately as LIVE hull via engine.applyHullExtension.
  const handleBuyHullExtension = () => {
    const steps = profile.hullExtensionSteps;
    if (steps >= MAX_HULL_EXTENSION_STEPS) return;
    const cost = getHullExtensionCost(steps);
    if (profile.cash < cost) return;
    const nextSteps = steps + 1;
    setProfile((p) => ({ ...p, cash: p.cash - cost, hullExtensionSteps: nextSteps }));
    const eng = engineRef.current;
    if (eng && eng.isRunning) {
      eng.applyHullExtension(nextSteps); // raise the live ceiling right now
    }
    haptics.success();
    trackPurchase('hull_extension', cost, 'cash', 'shop', nextSteps);
  };

  const handleBuyStarterPack = () => {
    setProfile((p) => ({
      ...p,
      hasPurchasedStarterPack: true,
      gems: p.gems + 80,
      weapons: {
        ...p.weapons,
        machinegun: { unlocked: true, tier: 2 },
      },
      unlockedSkins: Array.from(new Set([...p.unlockedSkins, 'cannon_neon'])),
    }));
    trackPurchase('starter_pack', 0, 'free', 'shop');
  };

  const handleBuyGems = (count: number) => {
    setProfile((p) => ({ ...p, gems: p.gems + count }));
    trackPurchase(`gem_pack_${count}`, count, 'iap', 'shop');
  };

  const handleUpgradeIdleCollector = () => {
    const cost = getIdleUpgradeCost(profile.idleCollectorLevel);
    if (profile.cash >= cost) {
      setProfile((p) => ({
        ...p,
        cash: p.cash - cost,
        idleCollectorLevel: p.idleCollectorLevel + 1,
      }));
      trackPurchase('idle_collector', cost, 'cash', 'shop', profile.idleCollectorLevel + 1);
    }
  };

  const handleClaimIdleCash = () => {
    // Shared formula with the shop display (previously two divergent copies)
    const { amount } = calculateIdleCash(profile);
    if (amount > 0) {
      setProfile((p) => ({
        ...p,
        cash: p.cash + amount,
        lastIdleCollectedAt: Date.now(),
      }));
      // Claim-boost offer: watch an ad to double the harvest, or +50% free
      setClaimBoost({ cash: amount, gems: 0, label: 'Idle Collector Harvest' });
    }
  };

  // Challenges claim
  const handleClaimChallenge = (id: string) => {
    // Resolve the challenge OUTSIDE the state updaters — the profile credit,
    // the claim flag and the boost offer must never fire from inside a
    // setChallenges/setProfile mapper (React re-invokes those updaters).
    const target = challenges.find((ch) => ch.id === id);
    if (!target || !target.completed || target.claimed) return;
    setChallenges((prev) => prev.map((ch) => (ch.id === id ? { ...ch, claimed: true } : ch)));
    setProfile((p) => ({
      ...p,
      cash: p.cash + target.rewardCash,
      gems: p.gems + target.rewardGems,
    }));
    // Claim-boost offer: watch an ad to double the bounty, or +50% free
    setClaimBoost({ cash: target.rewardCash, gems: target.rewardGems, label: `Mission: ${target.title}` });
  };

  // Mystery box dialog claim
  const handleMysteryBoxClaimFromDialog = (reward: MysteryBoxReward, spentGems: number) => {
    setProfile((p) => ({
      ...p,
      // Deduct the paid gems, then actually credit the reward gems (previously dropped)
      gems: Math.max(0, p.gems - spentGems) + (reward.gems || 0),
      cash: p.cash + (reward.cash || 0),
      lastDailyBoxClaimedAt: spentGems === 0 ? Date.now() : p.lastDailyBoxClaimedAt,
      unlockedSkins: reward.skinId && !p.unlockedSkins.includes(reward.skinId)
        ? [...p.unlockedSkins, reward.skinId]
        : p.unlockedSkins,
    }));
    // Claim-boost offer on the currency portion (skin-only rolls skip it)
    if ((reward.cash || 0) + (reward.gems || 0) > 0) {
      setClaimBoost({ cash: reward.cash || 0, gems: reward.gems || 0, label: `Orbital Crate: ${reward.rarity}` });
    }
  };

  // Battle pass claim
  const handleUpgradeElitePass = () => {
    if (profile.gems >= 50) {
      setProfile((p) => ({
        ...p,
        gems: p.gems - 50,
        isBattlePassPremium: true,
      }));
    }
  };

  const handleClaimPassTier = (tier: number) => {
    // One reward per tier, tracked in the profile — no infinite re-claims.
    // Payout comes straight from BATTLE_PASS_TIERS (the same table the modal
    // renders), so displayed rewards and credited rewards are always identical.
    if (profile.battlePassClaimedTiers?.includes(tier)) return;
    const def = BATTLE_PASS_TIERS.find((t) => t.tier === tier);
    if (!def) return;
    const cashGain = def.free.cash + (profile.isBattlePassPremium ? def.premium.cash : 0);
    const gemGain = def.free.gems + (profile.isBattlePassPremium ? def.premium.gems : 0);
    setProfile((p) => ({
      ...p,
      cash: p.cash + cashGain,
      gems: p.gems + gemGain,
      battlePassTier: Math.max(p.battlePassTier, tier + 1),
      battlePassClaimedTiers: [...(p.battlePassClaimedTiers || []), tier],
    }));
    // Claim-boost offer on the currency portion (skin-only tiers skip it)
    if (cashGain + gemGain > 0) {
      setClaimBoost({ cash: cashGain, gems: gemGain, label: `Battle Pass — Tier ${tier}` });
    }
  };

  // Cosmetics
  const handleEquipSkin = (type: 'cannon' | 'base' | 'projectile', skinId: string) => {
    setProfile((p) => ({
      ...p,
      equippedSkins: {
        ...p.equippedSkins,
        [type]: skinId,
      },
    }));
  };

  const handleBuySkin = (skin: SkinItem) => {
    if (profile.gems >= skin.costGems) {
      setProfile((p) => ({
        ...p,
        gems: p.gems - skin.costGems,
        unlockedSkins: [...p.unlockedSkins, skin.id],
        equippedSkins: {
          ...p.equippedSkins,
          [skin.type]: skin.id,
        },
      }));
      trackPurchase(`skin_${skin.id}`, skin.costGems, 'gems', 'cosmetics');
    }
  };

  // Daily streak claim — the retention engine's morning hook. Credits the
  // PREVIEWED roll (what the card promised is what the player gets) and
  // celebrates with haptics + fanfare so the ritual feels rewarding.
  const handleClaimStreak = () => {
    if (!streakPreview || !streakPreview.claimable) return;
    setProfile((p) => claimDailyStreak(p, streakPreview));
    setStreakJustClaimed(true);
    setStreakPreview({ ...streakPreview, claimable: false });
    haptics.success();
    sound.playUpgradeSuccess();
    void cloudSync.flush();
    // Claim-boost offer: watch an ad to double the streak cache, or +50% free
    setClaimBoost({
      cash: streakPreview.cash,
      gems: streakPreview.gems,
      label: `Day ${streakPreview.streak} Streak${streakPreview.isJackpot ? ' — JACKPOT' : ''}`,
    });
  };

  // --- Claim-boost actions (see ClaimBoostModal) ---------------------------

  /**
   * Watch-ad DOUBLE: grants +100% of the just-claimed base. Inside YouTube
   * Playables the REAL rewarded ad decides the payout (resolves false when
   * the reward was not granted); on the standalone site the modal already
   * simulated the sponsored feed before calling this — credit directly.
   */
  const handleClaimBoostDouble = async (): Promise<boolean> => {
    if (!claimBoost) return false;
    if (inPlayablesEnv()) {
      const earned = await showRewardedAd(REWARD_IDS.claimBoost);
      trackRewardedAd('claim_boost_double', earned !== false);
      if (earned === false) return false;
    } else {
      // standalone web: the modal already simulated the sponsored feed
      trackRewardedAd('claim_boost_double', true);
    }
    setProfile((p) => ({
      ...p,
      cash: p.cash + Math.floor(claimBoost.cash),
      gems: p.gems + Math.floor(claimBoost.gems),
    }));
    void cloudSync.flush();
    return true;
  };

  /** Free +50% of the just-claimed base — no ad, one tap. */
  const handleClaimBoostFifty = () => {
    if (!claimBoost) return;
    const cash = Math.floor(claimBoost.cash / 2);
    const gems = claimBoost.gems > 0 ? Math.max(1, Math.round(claimBoost.gems / 2)) : 0;
    if (cash > 0 || gems > 0) {
      setProfile((p) => ({
        ...p,
        cash: p.cash + cash,
        gems: p.gems + gems,
      }));
      void cloudSync.flush();
    }
  };

  // Cloud-sync badge copy for the menu card
  const syncBadgeLabel =
    syncStatus === 'syncing'
      ? 'SYNCING…'
      : syncStatus === 'synced'
        ? 'PROGRESS SYNCED'
        : syncStatus === 'offline'
          ? 'SAVED LOCALLY'
          : 'CLOUD READY';

  return (
    <main
      className="w-full h-screen bg-slate-950 flex flex-col items-center justify-center overflow-hidden font-sans text-slate-100 select-none"
      style={{ height: '100dvh' }}
    >
      {/* Game chassis: TRUE FULLSCREEN on every device — desktop monitors,
          laptops, tablets, phones, portrait or landscape. The canvas fills the
          viewport edge-to-edge (100vw × 100dvh, no cabinet bezel, no aspect
          cap, no letterbox bars) and the engine's adaptive logical viewport
          matches the real aspect ratio, so the universe takes the shape of
          whatever screen it is played on. */}
      <div className="relative bg-black overflow-hidden flex flex-col w-full h-full">
        {/* PWA bootstrap (renders nothing): service worker + install-prompt
            capture + offline soundtrack warm-up. Top-level pages only — the
            YouTube Playables iframe is never touched. */}
        <ServiceWorkerRegister />

        {/* The HTML5 Canvas Layer */}
        <GameCanvas
          engineRef={engineRef}
          isPaused={isPaused}
          engineEpoch={engineEpoch}
          qualityLevel={qualityLevel}
        />

        {/* Optional Retro Arcade CRT Scanline Overlay */}
        {crtEnabled && <div className="crt-scanlines pointer-events-none absolute inset-0 z-20" />}

        {/* Live In-Game HUD overlay */}
        {hasStarted && !isGameOver && (
          <HUD
            score={score}
            cash={profile.cash}
            gems={profile.gems}
            currentHp={currentHp}
            maxHp={maxHp}
            shieldHp={shieldHp}
            maxShieldHp={100}
            comboStreak={comboStreak}
            comboMultiplier={comboMultiplier}
            currentWave={currentWave}
            currentEra={currentEra}
            gameMode={gameMode}
            activeWeaponId={activeWeaponId}
            weapons={weapons}
            activeBuffs={activeBuffs}
            autoFireEnabled={autoFireEnabled}
            empCooldown={empCooldown}
            orbitalCooldown={orbitalCooldown}
            grenadeCooldown={grenadeCooldown}
            empCharges={empCharges}
            orbitalCharges={orbitalCharges}
            grenadeCharges={grenadeCharges}
            onBuySpecialCharge={handleBuySpecialCharge}
            isPaused={isPaused}
            isMuted={isMuted}
            activeBoss={activeBoss}
            adrenaline={adrenaline}
            isOverdrive={isOverdrive}
            adrenalineMultiplier={getAdrenalineGainMultiplier(profile.adrenalineGainSteps)}
            onTriggerOverdrive={() => engineRef.current?.triggerOverdrive()}
            onBuyAdrenalineStim={handleBuyAdrenalineStim}
            onToggleAutoFire={handleToggleAutoFire}
            onSwitchWeapon={handleSwitchWeapon}
            onTriggerSpecial={handleTriggerSpecial}
            onTogglePause={handleTogglePause}
            onToggleMute={handleToggleMute}
            onOpenShop={() => setActiveModal('shop')}
            onOpenChallenges={() => setActiveModal('challenges')}
            onOpenBattlePass={() => setActiveModal('battlepass')}
            onOpenMysteryBox={() => setActiveModal('mystery')}
            onOpenLeaderboard={() => setActiveModal('leaderboard')}
          />
        )}

        {/* Virtual aim joystick — touch devices only, combat only. Streams
            stick angles straight into engine.setAimAngle() (instant turret
            snap; see the component doc for why there is no rAF loop here). */}
        {isTouchDevice && hasStarted && !isGameOver && !isIntermission && (
          <TouchJoystick engineRef={engineRef} enabled={!isPaused} />
        )}

        {/* Mid-run rewarded-ad support offer (floating toast, sim keeps running).
            Keyed on the offer kind so each new offer remounts with a fresh countdown. */}
        {hasStarted && !isGameOver && !isPaused && adOffer && (
          <RewardedAdOffer
            key={adOffer.kind}
            offer={adOffer}
            isPlaying={isAdOfferPlaying}
            onAccept={() => void handleAdOfferAccept()}
            onDismiss={handleAdOfferDismiss}
          />
        )}

        {/* Boss encounter cinematic: siren vignette + pilot intro card + haptics */}
        {hasStarted && !isGameOver && (
          <IncomingThreatWarning boss={bossWarning} onDismiss={() => setBossWarning(null)} />
        )}

        {/* --- Landing / Main Menu Screen (Matching Screen 2 in Reference) ---
            Semi-transparent: the 3D battlefield (Earth limb, defense grid,
            drifting stars) stays alive behind the menu instead of a flat
            gradient, with backdrop blur keeping the UI readable. */}
        {!hasStarted && (
          <div
            id="main-menu-overlay"
            className="absolute inset-0 z-30 flex flex-col justify-between bg-gradient-to-b from-[#020a17e8] via-[#081b3bc0] to-[#040f24e8] backdrop-blur-md select-none overflow-hidden [@media(max-height:500px)]:overflow-y-auto"
          >
            {/* Top Status Bar (Profile, Rank, Online 10, Settings) */}
            <EarthTopBar
              profile={profile}
              onlineCount={10}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenStats={() => setActiveModal('leaderboard')}
            />

            {/* Radial Light Burst & Curved Earth Atmosphere Background */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
              <div className="w-[500px] h-[500px] rounded-full earth-light-burst animate-pulse" />
              {/* Planetary atmosphere curve at the bottom */}
              <div className="absolute -bottom-48 w-[600px] h-[320px] rounded-t-full bg-gradient-to-t from-blue-700/30 via-cyan-500/20 to-transparent border-t-2 border-cyan-400/50 blur-[2px]" />
            </div>

            {/* Centerpiece: 3D Sculpted Title Logo & Hero Mascot */}
            <div className="relative z-10 flex flex-col items-center text-center px-4 my-auto">
              {/* 3D Gold Title Logo on Faceted Shield (compact on short/
                  landscape screens — taglines and hero mascot yield space so
                  START and the mode cabinets stay reachable) */}
              <div className="earth-title-shield px-6 py-2 rounded-3xl mb-2 flex flex-col items-center">
                <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest leading-none mb-1 [@media(max-height:500px)]:hidden">
                  GAIA DEFENSE INITIATIVE
                </span>
                <h1 className="text-3xl sm:text-4xl md:text-5xl [@media(max-height:500px)]:text-xl font-black uppercase tracking-wider leading-none earth-title-text">
                  GAIA FRONTIER
                </h1>
                <span className="text-[10px] font-black text-amber-300 uppercase tracking-[0.3em] mt-1.5 leading-none drop-shadow [@media(max-height:500px)]:hidden">
                  — AFTER CONTACT —
                </span>
              </div>

              {/* Studio credit — "by LibertyPie Games" */}
              <a
                href="https://libertypie.com"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sound.playUiClick()}
                className="group mt-1.5 mb-0.5 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-[#0a1626]/60 px-3.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300/90 hover:text-cyan-200 hover:border-cyan-300/60 hover:bg-[#0d1f36]/80 transition cursor-pointer select-none shadow-md backdrop-blur-sm"
                title="Gaia Frontier is a LibertyPie Games production — libertypie.com"
              >
                <Sparkles
                  className="w-3 h-3 text-cyan-300/80 group-hover:text-cyan-200 group-hover:rotate-12 transition-transform"
                  aria-hidden
                />
                <span>
                  by <span className="text-cyan-300/90 group-hover:text-cyan-200 font-black">LibertyPie Games</span>
                </span>
              </a>

              {/* Animated Terran Defender Hero Centerpiece */}
              <div className="relative my-1 flex flex-col items-center shrink-0 [@media(max-height:500px)]:hidden">
                {/* Hero Mascot Aura */}
                <div className="relative flex items-center justify-center">
                  {/* Left Plasma Saber/Cannon */}
                  <div className="w-2.5 h-12 bg-gradient-to-t from-amber-400 via-yellow-200 to-white rounded-full -rotate-30 shadow-[0_0_14px_#fde047] animate-pulse" />

                  {/* Defender Helmet & Armored Suit */}
                  <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-b from-[#1e3a8a] via-[#0f2b5c] to-[#0a1b38] border-2 border-cyan-300 p-1 shadow-[0_0_24px_rgba(56,189,248,0.8)] flex items-center justify-center mx-2">
                    <span className="text-4xl filter drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]">
                      👨‍🚀
                    </span>
                    {/* Glowing Cyan Visor Light */}
                    <div className="absolute top-6 w-9 h-3 rounded-full bg-cyan-300/40 border border-cyan-200 shadow-[0_0_8px_#38bdf8]" />
                  </div>

                  {/* Right Plasma Saber/Cannon */}
                  <div className="w-2.5 h-12 bg-gradient-to-t from-amber-400 via-yellow-200 to-white rounded-full rotate-30 shadow-[0_0_14px_#fde047] animate-pulse" />
                </div>
              </div>

              {/* Sleek Launch Card (Matching reference design) */}
              <div className="w-full max-w-xs game-dialog-card p-3.5 [@media(max-height:500px)]:p-2.5 flex flex-col gap-2.5 [@media(max-height:500px)]:gap-2 shadow-2xl mt-1">
                {/* New Mission Header */}
                <div className="flex items-center justify-between border-b border-[#23294E] pb-1.5 text-left">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-[#53CE17] animate-ping" />
                    <span className="text-[10px] font-black uppercase text-white tracking-wider">
                      ACTIVE OPERATION
                    </span>
                  </div>
                  <span className="text-[9px] font-black text-[#0A0E21] bg-[#00D2FF] px-2 py-0.5 rounded-full">
                    3 CABINETS
                  </span>
                </div>

                {/* Daily Login Streak — the loss-aversion morning hook */}
                {streakPreview && (
                  <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-[#1a0f00]/90 to-[#2d1a02]/90 border border-amber-400/40 rounded-xl px-2.5 py-1.5 shadow-md">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Flame className="w-4 h-4 text-orange-400 shrink-0 animate-pulse" aria-hidden />
                      <div className="flex flex-col leading-tight min-w-0">
                        <span className="text-[10px] font-black text-amber-200 uppercase tracking-wider">
                          DAY {Math.max(1, streakPreview.streak)} STREAK
                        </span>
                        <span className="text-[8px] font-bold text-amber-100/70 uppercase tracking-wide truncate">
                          {streakPreview.claimable
                            ? streakPreview.isJackpot
                              ? '★ 7-DAY JACKPOT READY ★'
                              : `${streakPreview.luckMultiplier}× LUCK ON TODAY'S CACHE`
                            : 'STREAK SECURED — RETURN TOMORROW'}
                        </span>
                      </div>
                    </div>
                    {streakPreview.claimable ? (
                      <button
                        onClick={handleClaimStreak}
                        className="btn-game-gold shrink-0 px-3 py-1 rounded-full text-[10px] font-black tracking-wider uppercase flex items-center gap-1 cursor-pointer select-none active:scale-95 transition shadow-lg"
                      >
                        <Gift className="w-3 h-3" aria-hidden />
                        +${streakPreview.cash}
                        {streakPreview.gems > 0 ? ` +${streakPreview.gems}💎` : ''}
                      </button>
                    ) : (
                      <span className="shrink-0 text-[9px] font-black text-emerald-300 uppercase tracking-wider px-2">
                        {streakJustClaimed ? '✓ CLAIMED' : '✓ ACTIVE'}
                      </span>
                    )}
                  </div>
                )}

                {/* Big Juicy 3D Golden "START" Button */}
                <button
                  id="btn-launch-game"
                  onClick={() => handleStartGame('campaign')}
                  className="btn-game-gold w-full py-2.5 px-6 rounded-full text-xl sm:text-2xl font-black tracking-widest uppercase flex items-center justify-center gap-2 shadow-2xl cursor-pointer select-none active:scale-98 transition"
                >
                  <Play className="w-6 h-6 fill-white drop-shadow" />
                  <span>START</span>
                </button>

                {/* Mode Select — Daily Boss Rush & Endless Gauntlet cabinets */}
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const today = getTodayDayStamp();
                    const freeToday = profile.lastBossRushDay !== today;
                    const canEnter = freeToday || profile.gems >= BOSS_RUSH_EXTRA_ENTRY_GEMS;
                    return (
                      <button
                        onClick={() => canEnter && handleStartGame('bossRush')}
                        disabled={!canEnter}
                        className={`rounded-xl px-2 py-1.5 flex items-center justify-center gap-1 border-2 transition select-none cursor-pointer ${
                          canEnter
                            ? 'border-rose-400/60 bg-gradient-to-b from-[#3b0a1a]/90 to-[#1f040d]/90 hover:border-rose-300 active:scale-95'
                            : 'border-slate-700 bg-[#0a0e21]/80 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <Swords className="w-3.5 h-3.5 text-rose-300 shrink-0" aria-hidden />
                        <span className="text-[9px] font-black uppercase tracking-wide text-rose-200 leading-tight">
                          BOSS RUSH
                          <span className={freeToday ? 'text-emerald-300 ml-1' : 'text-amber-300 ml-1'}>
                            {freeToday ? '· FREE' : `· ${BOSS_RUSH_EXTRA_ENTRY_GEMS}💎`}
                          </span>
                          <span className="text-rose-300/70 ml-1">×2</span>
                        </span>
                      </button>
                    );
                  })()}
                  <button
                    onClick={() => handleStartGame('endless')}
                    className="rounded-xl px-2 py-1.5 flex items-center justify-center gap-1 border-2 border-violet-400/60 bg-gradient-to-b from-[#1e0b33]/90 to-[#120620]/90 hover:border-violet-300 active:scale-95 transition select-none cursor-pointer"
                  >
                    <InfinityIcon className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden />
                    <span className="text-[9px] font-black uppercase tracking-wide text-violet-200 leading-tight">
                      ENDLESS
                      <span className="text-violet-300/80 ml-1">· ×1.5 PTS</span>
                    </span>
                  </button>
                </div>

                {/* Install as an app (PWA) — offered only to players who
                    haven't installed yet; native prompt on Chrome/Edge/Android,
                    Add-to-Home-Screen walkthrough on iOS. Hidden entirely when
                    already installed or inside YouTube Playables. */}
                <InstallAppButton />

                {/* Desktop keyboard legend — only rendered on hover-capable
                    (mouse/keyboard) devices; touch players never see it. */}
                <div className="kb-only items-center justify-center gap-1.5 flex-wrap text-[8px] font-bold text-slate-400/90 uppercase tracking-wider leading-tight px-1">
                  <span className="text-cyan-300/90">←→↑↓ / WASD</span>
                  <span>aim</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-300/90">1-4</span>
                  <span>weapons</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-300/90">E / R</span>
                  <span>specials</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-300/90">V</span>
                  <span>overdrive</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-300/90">Space</span>
                  <span>auto-fire</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-300/90">P</span>
                  <span>pause</span>
                </div>

                {/* Quick Player Badges: real player ID + live cloud-sync status */}
                <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold px-1 gap-2">
                  <span className="truncate">
                    DEFENDER ID: {(playerId || '------------').slice(0, 13).toUpperCase()}
                  </span>
                  <span
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#2B3566] shrink-0 ${
                      syncStatus === 'offline' ? 'bg-[#0A0E21] text-amber-300' : 'bg-[#0A0E21] text-emerald-300'
                    }`}
                    title="Your progress (weapons, money, waves) syncs to the cloud and restores on any device."
                  >
                    {syncStatus === 'offline' ? (
                      <CloudOff className="w-3 h-3" aria-hidden />
                    ) : (
                      <Cloud className="w-3 h-3" aria-hidden />
                    )}
                    {syncBadgeLabel}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Floating Navigation Dock (Back, Shop, Vault, Overdrive, Top Commanders) */}
            <EarthBottomDock
              activeTab={activeModal as any}
              onNavigate={(tab) => {
                if (tab === 'home') setActiveModal('none');
                else setActiveModal(tab as any);
              }}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          </div>
        )}

        {/* --- FIRST CONTACT story cinematic (first PLAY only) --- */}
        {showStoryIntro && <StoryIntroModal onFinish={handleStoryFinish} />}

        {/* --- Pause Modal (Matching left screen in reference image) --- */}
        {isPaused && hasStarted && !isGameOver && (
          <PauseModal
            onResume={handleTogglePause}
            onRestart={() => {
              setIsPaused(false);
              handleStartGame(gameMode);
            }}
            onOpenShop={() => setActiveModal('shop')}
            onOpenVault={() => setActiveModal('mystery')}
            onOpenQuests={() => setActiveModal('challenges')}
            activeWeaponId={activeWeaponId}
            weapons={weapons}
            cash={profile.cash}
            currentHp={currentHp}
            maxHp={maxHp}
            nextWave={currentWave}
            empCharges={empCharges}
            orbitalCharges={orbitalCharges}
            grenadeCharges={grenadeCharges}
            adrenalineGainSteps={profile.adrenalineGainSteps}
            onUpgradeWeapon={handleUpgradeWeaponIntermission}
            onRepairBase={handleRepairBase}
            onBuyAdrenalineStim={handleBuyAdrenalineStim}
            onBuyAdrenalineRefill={handleBuyAdrenalineRefill}
            onBuySpecialCharge={handleBuySpecialCharge}
          />
        )}

        {/* --- Settings Modal (opened from the main-menu dock) --- */}
        {isSettingsOpen && (
          <PauseModal
            variant="settings"
            crtEnabled={crtEnabled}
            onToggleCrt={() => setCrtEnabled((v) => !v)}
            onResume={() => setIsSettingsOpen(false)}
          />
        )}

        {/* --- Intermission Quick Window --- */}
        {isIntermission && (
          <WaveIntermission
            currentWave={currentWave}
            nextWave={currentWave + 1}
            nextEra={getEraInfo(currentWave + 1)}
            cash={profile.cash}
            currentHp={currentHp}
            maxHp={maxHp}
            activeWeaponId={activeWeaponId}
            weapons={weapons}
            empCharges={empCharges}
            orbitalCharges={orbitalCharges}
            grenadeCharges={grenadeCharges}
            adrenalineGainSteps={profile.adrenalineGainSteps}
            onBuySpecialCharge={handleBuySpecialCharge}
            onRepairBase={handleRepairBase}
            onUpgradeWeapon={handleUpgradeWeaponIntermission}
            onBuyAdrenalineStim={handleBuyAdrenalineStim}
            onBuyAdrenalineRefill={handleBuyAdrenalineRefill}
            onStartNextWave={handleStartNextWave}
            frozen={isPaused || activeModal !== 'none'}
          />
        )}

        {/* --- Game Over Modal --- */}
        {isGameOver && (
          <GameOverModal
            stats={gameOverStats}
            playerGems={profile.gems}
            reviveCost={getReviveCostGems(gemRevivesUsed)}
            adRevivesRemaining={Math.max(0, MAX_AD_REVIVES_PER_RUN - adRevivesUsed)}
            nativeRewardedAds={inPlayablesEnv()}
            gameMode={gameMode}
            bossRushBestStage={profile.bossRushBestStage}
            endlessBestWave={profile.endlessBestWave}
            nearMissPoints={
              profile.highScore > 0 &&
              profile.highScore > gameOverStats.score &&
              profile.highScore - gameOverStats.score <= 500
                ? profile.highScore - gameOverStats.score
                : undefined
            }
            onAdRevive={handleAdRevive}
            onRevive={handleRevive}
            onPlayAgain={handlePlayAgain}
            onReturnHome={() => {
              engineRef.current?.stop();
              setHasStarted(false);
              setIsGameOver(false);
              setIsIntermission(false);
              setActiveModal('none');
              // Back to base: the menu theme takes over so music never stops
              sound.startMusic(0);
            }}
            onDoubleCashClaimed={handleDoubleCashClaimed}
            onMysteryBoxReward={handleMysteryBoxReward}
            onMysteryBoxBonus={handleMysteryBoxBonus}
          />
        )}

        {/* --- Shop Modal --- */}
        {activeModal === 'shop' && (
          <ShopModal
            profile={profile}
            weapons={weapons}
            activeWeaponId={activeWeaponId}
            currentHp={currentHp}
            onClose={() => setActiveModal('none')}
            onUnlockWeapon={handleUnlockWeapon}
            onUpgradeWeapon={handleUpgradeWeaponShop}
            onBuyHullRefit={hasStarted && !isGameOver ? handleBuyHullRefit : undefined}
            onBuyHullExtension={handleBuyHullExtension}
            onBuyAdrenalineStim={hasStarted && !isGameOver ? handleBuyAdrenalineStim : undefined}
            onBuyAdrenalineRefill={handleBuyAdrenalineRefill}
            onBuyStarterPack={handleBuyStarterPack}
            onBuyGems={handleBuyGems}
            onUpgradeIdleCollector={handleUpgradeIdleCollector}
            onClaimIdleCash={handleClaimIdleCash}
          />
        )}

        {/* --- Daily Challenges Modal --- */}
        {activeModal === 'challenges' && (
          <DailyChallengesModal
            challenges={challenges}
            onClaim={handleClaimChallenge}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* --- Mystery Box Modal (keyed to remount after a daily claim) --- */}
        {activeModal === 'mystery' && (
          <MysteryBoxModal
            key={profile.lastDailyBoxClaimedAt}
            playerGems={profile.gems}
            lastDailyClaimedAt={profile.lastDailyBoxClaimedAt}
            onRewardClaimed={handleMysteryBoxClaimFromDialog}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* --- Battle Pass Modal --- */}
        {activeModal === 'battlepass' && (
          <BattlePassModal
            profile={profile}
            onUpgradePremium={handleUpgradeElitePass}
            onClaimTier={handleClaimPassTier}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* --- Cosmetics Customization Modal --- */}
        {activeModal === 'cosmetics' && (
          <CosmeticsModal
            profile={profile}
            onEquipSkin={handleEquipSkin}
            onBuySkin={handleBuySkin}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* --- Leaderboard Modal --- */}
        {activeModal === 'leaderboard' && (
          <LeaderboardModal
            profile={profile}
            playerId={playerId}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* --- Claim Booster (post-claim ad modal — above every other modal) --- */}
        {claimBoost && (
          <ClaimBoostModal
            claim={claimBoost}
            nativeRewardedAds={inPlayablesEnv()}
            onDouble={handleClaimBoostDouble}
            onTakeFifty={handleClaimBoostFifty}
            onClose={() => setClaimBoost(null)}
          />
        )}
      </div>
    </main>
  );
}
