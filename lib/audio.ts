// Web Audio sound engine for Earth Defender — procedural SFX + a real,
// sample-based AAA soundtrack (tiny Opus loops) with the legacy procedural
// sequencer retained as an offline fallback.

/**
 * SAMPLE SOUNDTRACK: a tiny instant-start intro loop plus seven
 * seamlessly-looping tracks remastered from the uploaded reference scores
 * (scripts/build_music.py) — 48 kHz stereo, loudness-matched, bar-grid
 * crossfaded loop seams, Opus ~40 kbps (~250-350 KB per track; the whole
 * score ships under 2 MB) with an AAC fallback for Safari. One menu theme +
 * six battle themes cover the fifteen eras, and the ~76 KB "First Contact"
 * intro bridge covers the network gap before any of them can decode.
 *
 * The procedural per-era sequencer below (EraMusicConfig) is no longer the
 * primary soundtrack — it stays armed purely as a safety net so the game is
 * never silent if the samples cannot be fetched/decoded (offline, exotic
 * host). Combat intensity now rides the sample mix itself: gain + brightness
 * automation on the music bus (see applyMusicIntensity).
 */
interface SampleTrackInfo {
  name: string;
  bpm: number;
}

const MUSIC_TRACKS: Record<string, SampleTrackInfo> = {
  intro: { name: 'First Contact', bpm: 73 },
  menu: { name: 'Deep Defense', bpm: 146 },
  battle1: { name: 'Event Horizon', bpm: 171 },
  battle2: { name: 'Neuro Defense', bpm: 139 },
  battle3: { name: 'Voidfront Siege', bpm: 142 },
  battle4: { name: 'Final War Scale', bpm: 143 },
  battle5: { name: 'Neurofunk Rampart', bpm: 171 },
  battle6: { name: 'Final Stand', bpm: 138 },
};

const MUSIC_TRACK_ORDER = ['intro', 'menu', 'battle1', 'battle2', 'battle3', 'battle4', 'battle5', 'battle6'];

/** Era number (0/negative = menu) -> soundtrack id. Eras wrap mod 15. */
function trackIdForEra(eraNumber: number): string {
  if (eraNumber <= 0) return 'menu';
  const era = ((eraNumber - 1) % 15) + 1;
  if (era <= 2) return 'battle1';
  if (era <= 5) return 'battle2';
  if (era <= 8) return 'battle3';
  if (era <= 11) return 'battle4';
  if (era <= 14) return 'battle5';
  return 'battle6';
}
interface EraMusicConfig {
  bpm: number;
  name: string;
  bassNotes: number[];
  leadNotes: number[];
  kickSteps: number[];
  snareSteps: number[];
  hatSteps: number[];
  openHatSteps: number[];
  bassWave: OscillatorType;
  leadWave: OscillatorType;
  filterCutoff: number;
  /** Rhythm personality of the bassline. */
  bassPattern: 'eighths' | 'sixteenths' | 'gallop' | 'offbeat' | 'pulse';
  /** Backbeat chord stabs — enter at SURGE intensity (drive ≥ 0.55). */
  stabSteps?: number[];
  stabChord?: number[];
  /** Bright hand-clap layer for the electro/acid eras. */
  clapSteps?: number[];
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private sfxMuted: boolean = false;
  private musicMuted: boolean = false;
  /** Master mute overlay (HUD speaker button / auto-mute when the tab loses
   *  focus). Forces BOTH channels silent while remembering the player's own
   * per-channel mix so unmuting restores exactly what they configured. */
  private masterMuted: boolean = false;
  private preMasterSfxMuted: boolean = false;
  private preMasterMusicMuted: boolean = false;
  private masterVolume: number = 0.8;
  private sfxVolume: number = 0.55;
  private musicVolume: number = 0.42;
  /** localStorage persistence key — the player's audio mix survives reloads. */
  private static readonly PREFS_KEY = 'gaia-audio-prefs-v1';
  private musicInterval: number | null = null;
  private musicPlaying: boolean = false;
  private currentEra: number = 1;
  private musicStep: number = 0;
  private nextStepTime: number = 0;
  private noiseBuffer: AudioBuffer | null = null;

  // --- Sample soundtrack state ---
  private musicBuffers = new Map<string, AudioBuffer>();
  private musicLoadPromises = new Map<string, Promise<AudioBuffer | null>>();
  private musicSource: AudioBufferSourceNode | null = null;
  private musicSourceGain: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicTrackId: string | null = null;
  private musicExt: '.opus' | '.m4a' | null = null;
  private musicBroken = false;
  private prefetchStarted = false;
  private prefetchIdx = 0;
  private retryTimer: number | null = null;

  // --- Instant-start intro loop ("First Contact") -------------------------
  // A ~76 KB ambient bridge (public/music/intro.opus, 73 BPM = half the menu
  // theme's tempo) that plays the moment audio unlocks, covering the
  // fetch+decode gap before the real menu or battle theme can sound. Raw
  // bytes are prefetched at page load (no AudioContext needed), the loop
  // starts on the first gesture, and startSource() crossfades it out the
  // instant the actual track is ready. If samples fail entirely the
  // procedural sequencer still owns the gap, as before.
  private introSource: AudioBufferSourceNode | null = null;
  private introGain: GainNode | null = null;
  private introActive: boolean = false;
  private introBytes: ArrayBuffer | null = null;
  private introExt: '.opus' | '.m4a' | null = null;
  private introPrefetchFailed: boolean = false;
  /**
   * Combat drive 0..1 — the "adrenaline" axis of the soundtrack. Fed live by
   * the game engine (rush meter, overdrive, boss phase, hull danger) it
   * progressively unlocks music layers: hat fills → 16th-note bass rolls →
   * octave lead accents + stabs → double-kick, riser sweeps and a +6 BPM
   * tempo push. The track literally races your pulse.
   */
  private combatDrive: number = 0;

  constructor() {
    // Lazy init on first user gesture
    this.loadPrefs();
  }

  /** Restore the player's saved mix (channels + volumes) across reloads. */
  private loadPrefs(): void {
    if (typeof window === 'undefined') return; // SSR guard
    try {
      const raw = window.localStorage.getItem(SoundEngine.PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<{
        sfxMuted: boolean;
        musicMuted: boolean;
        masterVolume: number;
        sfxVolume: number;
        musicVolume: number;
      }>;
      if (typeof p.sfxMuted === 'boolean') this.sfxMuted = p.sfxMuted;
      if (typeof p.musicMuted === 'boolean') this.musicMuted = p.musicMuted;
      if (typeof p.masterVolume === 'number') this.masterVolume = Math.max(0, Math.min(1, p.masterVolume));
      if (typeof p.sfxVolume === 'number') this.sfxVolume = Math.max(0, Math.min(1, p.sfxVolume));
      if (typeof p.musicVolume === 'number') this.musicVolume = Math.max(0, Math.min(1, p.musicVolume));
    } catch {
      /* corrupted blob — keep factory defaults */
    }
  }

  private persistPrefs(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        SoundEngine.PREFS_KEY,
        JSON.stringify({
          sfxMuted: this.sfxMuted,
          musicMuted: this.musicMuted,
          masterVolume: this.masterVolume,
          sfxVolume: this.sfxVolume,
          musicVolume: this.musicVolume,
        })
      );
    } catch {
      /* storage full / private mode — non-fatal */
    }
  }

  /**
   * Unlock WebAudio from INSIDE a user gesture handler.
   *
   * Mobile browsers (iOS Safari, Android Chrome) start every AudioContext
   * in `suspended` state unless it is created/resumed inside a gesture, and a
   * context created outside a gesture can NEVER be resumed later from a
   * non-gesture call. The game creates sounds from the rAF loop (shots,
   * impacts) — outside gestures — so on phones audio silently stayed off for
   * the whole session. page.tsx calls this once on the first pointerdown /
   * touchend / click anywhere (capture phase), which guarantees the context
   * is running before the first gameplay sound: sound ON by default.
   */
  public unlock(): void {
    this.initContext();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Classic iOS unlock: play one silent buffer end-to-end inside the gesture
    // so the audio pipeline is fully primed.
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      /* best-effort priming only */
    }
    // Instant music: the tiny intro loop starts right here — the menu theme
    // (350 KB) is still fetching/decoding at this point, and the bridge makes
    // the game audible from the very first touch instead of seconds in.
    this.startIntroMusic();
  }

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private getNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuffer) {
      try {
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.5);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buffer;
      } catch {
        return null;
      }
    }
    return this.noiseBuffer;
  }

  public setMuted(sfx: boolean, music: boolean) {
    this.sfxMuted = sfx;
    this.musicMuted = music;
    this.persistPrefs();
    if (this.musicMuted || this.masterMuted) {
      this.stopMusic();
    } else if (this.musicPlaying) {
      this.startMusic();
    }
  }

  /** Master mute: forces everything silent, remembers the channel mix. */
  public setMasterMuted(muted: boolean) {
    if (muted === this.masterMuted) return;
    this.masterMuted = muted;
    if (muted) {
      this.preMasterSfxMuted = this.sfxMuted;
      this.preMasterMusicMuted = this.musicMuted;
      this.sfxMuted = true;
      this.musicMuted = true;
      this.stopMusic();
    } else {
      this.sfxMuted = this.preMasterSfxMuted;
      this.musicMuted = this.preMasterMusicMuted;
      if (!this.musicMuted) this.startMusic();
    }
  }

  public isMasterMuted(): boolean {
    return this.masterMuted;
  }

  public setMusicMuted(muted: boolean) {
    this.musicMuted = muted; // intent — actual silence still enforced by masterMuted
    if (this.masterMuted) this.preMasterMusicMuted = muted; // keep restore-target fresh
    this.persistPrefs();
    if (muted || this.masterMuted) {
      this.stopMusic();
    } else {
      this.startMusic();
    }
  }

  public setSfxMuted(muted: boolean) {
    this.sfxMuted = muted; // intent — sfxSilent() stays true while masterMuted
    if (this.masterMuted) this.preMasterSfxMuted = muted; // keep restore-target fresh
    this.persistPrefs();
  }

  /** True when SFX should actually be silent (own setting OR master mute). */
  private sfxSilent(): boolean {
    return this.sfxMuted || this.masterMuted;
  }

  public isMusicMuted(): boolean {
    return this.musicMuted;
  }

  public isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  public isMuted() {
    return { sfx: this.sfxMuted, music: this.musicMuted };
  }

  public setMasterVolume(vol: number) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    this.persistPrefs();
    this.applyMusicIntensity();
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setMusicVolume(vol: number) {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    this.persistPrefs();
    this.applyMusicIntensity();
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public setSfxVolume(vol: number) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    this.persistPrefs();
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public getCurrentEra(): number {
    return this.currentEra;
  }

  public setEra(eraNumber: number) {
    const prevEra = this.currentEra;
    this.currentEra = Math.max(1, eraNumber);
    if (prevEra !== this.currentEra) {
      this.playEraTransitionRiser();
      // Live track swap: the new era's theme dips in over the riser.
      if (this.musicPlaying && !this.musicMuted && !this.masterMuted && !this.musicBroken && this.ctx) {
        const id = trackIdForEra(this.currentEra);
        if (this.musicTrackId !== id) void this.switchTrack(id);
      }
    }
  }

  // --- Sound Effects ---

  public playShoot(weapon: 'cannon' | 'machinegun' | 'laser' | 'missiles' | 'emp' | 'orbital') {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    switch (weapon) {
      case 'cannon': {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);
        gain.gain.setValueAtTime(0.4 * this.sfxVolume * this.masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }
      case 'machinegun': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.07);
        gain.gain.setValueAtTime(0.25 * this.sfxVolume * this.masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }
      case 'laser': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.linearRampToValueAtTime(440, now + 0.12);
        gain.gain.setValueAtTime(0.3 * this.sfxVolume * this.masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }
      case 'missiles': {
        // White noise whoosh
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
        gain.gain.setValueAtTime(0.35 * this.sfxVolume * this.masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      }
      case 'emp': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.4);
        gain.gain.setValueAtTime(0.45 * this.sfxVolume * this.masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
        break;
      }
      case 'orbital': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + 0.6);
        osc.frequency.exponentialRampToValueAtTime(200, now + 1.2);
        gain.gain.setValueAtTime(0.55 * this.sfxVolume * this.masterVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 1.2);
        break;
      }
    }
  }

  public playExplosion(isLarge: boolean = false) {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const dur = isLarge ? 0.6 : 0.25;

    // Sub rumble
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(isLarge ? 90 : 130, now);
    osc.frequency.exponentialRampToValueAtTime(25, now + dur);

    gain.gain.setValueAtTime((isLarge ? 0.6 : 0.35) * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  public playHit() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.05);

    gain.gain.setValueAtTime(0.15 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playCombo(streak: number) {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pentatonic scale rising pitch
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
    const pitch = scale[Math.min(streak, scale.length - 1)];

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, now + 0.12);

    gain.gain.setValueAtTime(0.25 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playGoodie() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Two-tone bell
    [523.25, 783.99].forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.3 * this.sfxVolume * this.masterVolume, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.2);
    });
  }

  public playCrit() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Punchy layered crit shock
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.18);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(920, now);
    osc2.frequency.exponentialRampToValueAtTime(320, now + 0.12);

    gain.gain.setValueAtTime(0.45 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.18);
    osc2.stop(now + 0.18);
  }

  /** Starfall catastrophe launch: the fake orb shattering into a fire shower —
   *  a rising whistling whoosh (band-passed noise sweep + glide tone). */
  public playStarfallLaunch() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(1450, now + 0.55);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.34 * this.sfxVolume * this.masterVolume, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.62);
  }

  /** One starfall shard slamming into the atmosphere — short meteor boomlet. */
  public playStarfallImpact() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300 + Math.random() * 140, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.16);
    gain.gain.setValueAtTime(0.3 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playOverdrive() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Sweeping electric energy surge
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(1100, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(650, now + 0.6);

    gain.gain.setValueAtTime(0.5 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  public playBossAlert() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Dual military klaxon pulses
    [0, 0.22].forEach((offset) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now + offset);
      osc.frequency.setValueAtTime(370, now + offset + 0.1);

      gain.gain.setValueAtTime(0.4 * this.sfxVolume * this.masterVolume, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  }

  public playKamikazeScream() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.25);

    gain.gain.setValueAtTime(0.28 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playHitstopSlowMo() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.3);

    gain.gain.setValueAtTime(0.6 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playBaseDamage() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);

    gain.gain.setValueAtTime(0.5 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  public playUiClick() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // High-tech crisp mechanical click
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.04);

    gain.gain.setValueAtTime(0.2 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  public playWeaponSwitch() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Heavy mechanical weapon rack slide
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.09);

    gain.gain.setValueAtTime(0.35 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playUpgradeSuccess() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Arcade level-up fanfare chord
    [392, 523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.3 * this.sfxVolume * this.masterVolume, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.005, now + idx * 0.06 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.26);
    });
  }

  public playPowerUp() {
    this.playUpgradeSuccess();
  }

  public playWaveClear() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Ascending celebratory fanfare arpeggio
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.35 * this.sfxVolume * this.masterVolume, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.005, now + idx * 0.08 + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.36);
    });
  }

  public playBossSiren() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Sub-bass heavy dread pulse
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(65, now);
    subOsc.frequency.linearRampToValueAtTime(45, now + 2.4);
    subGain.gain.setValueAtTime(0.55 * this.sfxVolume * this.masterVolume, now);
    subGain.gain.exponentialRampToValueAtTime(0.01, now + 2.5);
    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 2.5);

    // 4 siren wails ramping up and down (440Hz -> 820Hz -> 440Hz)
    const cycles = 4;
    const cycleDuration = 0.55;
    for (let c = 0; c < cycles; c++) {
      const cycleStart = now + c * cycleDuration;

      // Primary horn
      const horn = this.ctx.createOscillator();
      const hornGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      horn.type = 'sawtooth';
      horn.frequency.setValueAtTime(460, cycleStart);
      horn.frequency.linearRampToValueAtTime(840, cycleStart + cycleDuration * 0.5);
      horn.frequency.linearRampToValueAtTime(480, cycleStart + cycleDuration);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, cycleStart);
      filter.Q.setValueAtTime(3.5, cycleStart);

      hornGain.gain.setValueAtTime(0.48 * this.sfxVolume * this.masterVolume, cycleStart);
      hornGain.gain.linearRampToValueAtTime(0.55 * this.sfxVolume * this.masterVolume, cycleStart + cycleDuration * 0.5);
      hornGain.gain.linearRampToValueAtTime(0.25 * this.sfxVolume * this.masterVolume, cycleStart + cycleDuration);

      horn.connect(filter);
      filter.connect(hornGain);
      hornGain.connect(this.ctx.destination);
      horn.start(cycleStart);
      horn.stop(cycleStart + cycleDuration);

      // Harmony overtone (octave lower with square wave for harsh industrial timbre)
      const subHorn = this.ctx.createOscillator();
      const subHornGain = this.ctx.createGain();
      subHorn.type = 'square';
      subHorn.frequency.setValueAtTime(230, cycleStart);
      subHorn.frequency.linearRampToValueAtTime(420, cycleStart + cycleDuration * 0.5);
      subHorn.frequency.linearRampToValueAtTime(240, cycleStart + cycleDuration);

      subHornGain.gain.setValueAtTime(0.22 * this.sfxVolume * this.masterVolume, cycleStart);
      subHornGain.gain.linearRampToValueAtTime(0.01, cycleStart + cycleDuration);

      subHorn.connect(subHornGain);
      subHornGain.connect(this.ctx.destination);
      subHorn.start(cycleStart);
      subHorn.stop(cycleStart + cycleDuration);
    }
  }

  public playBossAlarm() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, now + i * 0.25);
      osc.frequency.linearRampToValueAtTime(650, now + i * 0.25 + 0.18);

      gain.gain.setValueAtTime(0.4 * this.sfxVolume * this.masterVolume, now + i * 0.25);
      gain.gain.linearRampToValueAtTime(0.01, now + i * 0.25 + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.22);
    }
  }

  public playGameOver() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [220, 196, 174.61, 146.83].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.22);

      gain.gain.setValueAtTime(0.35 * this.sfxVolume * this.masterVolume, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.22 + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.35);
    });
  }

  // --- Advanced alien ordnance SFX -----------------------------------------

  /** Cluster airburst: deep sub-drop + scatter pings raining outward. */
  public playClusterAirburst() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Sub-drop thump
    const boom = this.ctx.createOscillator();
    const boomGain = this.ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(120, now);
    boom.frequency.exponentialRampToValueAtTime(32, now + 0.4);
    boomGain.gain.setValueAtTime(0.5 * this.sfxVolume * this.masterVolume, now);
    boomGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    boom.connect(boomGain);
    boomGain.connect(this.ctx.destination);
    boom.start(now);
    boom.stop(now + 0.4);

    // Bomblet scatter pings — staggered high blips
    for (let i = 0; i < 5; i++) {
      const t0 = now + 0.05 + i * 0.07;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1100 - i * 120, t0);
      osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.1);
      gain.gain.setValueAtTime(0.14 * this.sfxVolume * this.masterVolume, t0);
      gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.1);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    }
  }

  /** Railgun discharge: sharp electromagnetic CRACK + hypersonic whistle-out. */
  public playRailgunShot() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // The crack
    const crack = this.ctx.createOscillator();
    const crackGain = this.ctx.createGain();
    crack.type = 'square';
    crack.frequency.setValueAtTime(2200, now);
    crack.frequency.exponentialRampToValueAtTime(180, now + 0.08);
    crackGain.gain.setValueAtTime(0.4 * this.sfxVolume * this.masterVolume, now);
    crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    crack.connect(crackGain);
    crackGain.connect(this.ctx.destination);
    crack.start(now);
    crack.stop(now + 0.08);

    // The whistle as the slug bores past
    const whistle = this.ctx.createOscillator();
    const wGain = this.ctx.createGain();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(900, now + 0.06);
    whistle.frequency.exponentialRampToValueAtTime(2900, now + 0.3);
    wGain.gain.setValueAtTime(0.16 * this.sfxVolume * this.masterVolume, now + 0.06);
    wGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    whistle.connect(wGain);
    wGain.connect(this.ctx.destination);
    whistle.start(now + 0.06);
    whistle.stop(now + 0.3);
  }

  /** Tesla arc: buzzing electrical discharge with rapid frequency wobble. */
  public playTeslaZap() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    // Rapid buzz wobble across the zap window
    for (let w = 0; w < 9; w++) {
      osc.frequency.setValueAtTime(w % 2 === 0 ? 240 : 120, now + w * 0.035);
    }
    gain.gain.setValueAtTime(0.32 * this.sfxVolume * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  /** Hologram shatter: glassy descending chime cluster. */
  public playHoloShatter() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [1568, 1319, 1047, 784].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);
      gain.gain.setValueAtTime(0.2 * this.sfxVolume * this.masterVolume, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.25);
    });
  }

  /** MIRV separation: rising three-stage staging clunk + thrust blip. */
  public playMirvSeparation() {
    if (this.sfxSilent()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [90, 140, 210].forEach((freq, i) => {
      const t0 = now + i * 0.09;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * 2.4, t0 + 0.12);
      gain.gain.setValueAtTime(0.3 * this.sfxVolume * this.masterVolume, t0);
      gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.14);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    });
  }

  // --- Era Configuration & Active Procedural Music ---

  private getEraConfig(eraNumber: number): EraMusicConfig {
    // Era 0 / negative = MAIN MENU theme — the calmest track in the game, but
    // still a propulsive 118bpm heroic groove (adrenaline-era DNA, menu dose).
    if (eraNumber <= 0) {
      return {
        bpm: 118,
        name: 'Terra Prime (Menu)',
        // C2 / G2 / A2 / F2 — heroic I-V-vi-IV
        bassNotes: [65.41, 65.41, 98.00, 98.00, 110.00, 110.00, 87.31, 87.31],
        // C5 G4 E4 G4 + Am arpeggio sparkle
        leadNotes: [261.63, 392.00, 329.63, 392.00, 523.25, 659.25, 587.33, 493.88],
        kickSteps: [0, 4, 8, 12],
        snareSteps: [12],
        hatSteps: [2, 6, 10, 14],
        openHatSteps: [14],
        bassWave: 'triangle' as OscillatorType,
        leadWave: 'sine' as OscillatorType,
        filterCutoff: 640,
        bassPattern: 'eighths',
      };
    }
    const era = ((eraNumber - 1) % 15) + 1;
    switch (era) {
      case 1: // Asteroid Field — 144bpm driving synthwave charge in D Minor
        return {
          bpm: 144,
          name: 'Outer Rim',
          bassNotes: [73.42, 73.42, 73.42, 73.42, 65.41, 65.41, 87.31, 82.41], // D2, C2, F2, E2
          leadNotes: [146.83, 174.61, 220.00, 261.63, 293.66, 349.23, 440.00, 293.66],
          kickSteps: [0, 4, 8, 12],
          snareSteps: [4, 12],
          hatSteps: [0, 2, 4, 6, 8, 10, 12, 14],
          openHatSteps: [14],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'square' as OscillatorType,
          filterCutoff: 560,
          bassPattern: 'eighths',
        };
      case 2: // Solar Flare / Meteor Storm — 152bpm urgent E Phrygian burn, warning stabs
        return {
          bpm: 152,
          name: 'Solar Flare',
          bassNotes: [82.41, 82.41, 87.31, 82.41, 98.00, 87.31, 82.41, 73.42], // E2, F2, G2, D2
          leadNotes: [164.81, 174.61, 196.00, 246.94, 261.63, 329.63, 293.66, 246.94],
          kickSteps: [0, 3, 6, 8, 11, 14],
          snareSteps: [4, 12, 15],
          hatSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          openHatSteps: [6, 14],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'sawtooth' as OscillatorType,
          filterCutoff: 720,
          bassPattern: 'sixteenths',
          stabSteps: [0, 6, 10],
          stabChord: [164.81, 246.94, 329.63], // E minor warning chord
        };
      case 3: // Alien Scouts — 148bpm electro-pursuit in A Minor, offbeat bounce + claps
        return {
          bpm: 148,
          name: 'Alien Scouts',
          bassNotes: [110.00, 110.00, 130.81, 110.00, 146.83, 130.81, 110.00, 98.00],
          leadNotes: [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 329.63, 261.63],
          kickSteps: [0, 6, 8, 10],
          snareSteps: [4, 12, 14],
          hatSteps: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14],
          openHatSteps: [2, 10],
          bassWave: 'triangle' as OscillatorType,
          leadWave: 'triangle' as OscillatorType,
          filterCutoff: 820,
          bassPattern: 'offbeat',
          clapSteps: [4, 12],
        };
      case 4: // Alien Armada — 140bpm industrial war march in C Minor, gallop + war chords
        return {
          bpm: 140,
          name: 'Dreadnought Armada',
          bassNotes: [65.41, 65.41, 77.78, 65.41, 87.31, 77.78, 65.41, 58.27],
          leadNotes: [130.81, 155.56, 174.61, 196.00, 207.65, 233.08, 261.63, 196.00],
          kickSteps: [0, 2, 4, 8, 10, 12],
          snareSteps: [4, 12],
          hatSteps: [2, 6, 10, 14],
          openHatSteps: [6, 14],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'sawtooth' as OscillatorType,
          filterCutoff: 440,
          bassPattern: 'gallop',
          stabSteps: [0, 8],
          stabChord: [130.81, 196.00, 261.63], // C minor war chord
        };
      case 5: // Orbital Debris — 150bpm glitch electro in F# Minor, 16th bass + claps
        return {
          bpm: 150,
          name: 'Nanite Ring',
          bassNotes: [92.50, 92.50, 110.00, 92.50, 123.47, 110.00, 92.50, 82.41],
          leadNotes: [185.00, 220.00, 246.94, 277.18, 329.63, 369.99, 277.18, 220.00],
          kickSteps: [0, 4, 7, 10, 12],
          snareSteps: [4, 12, 14, 15],
          hatSteps: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
          openHatSteps: [4, 12],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'square' as OscillatorType,
          filterCutoff: 640,
          bassPattern: 'sixteenths',
          clapSteps: [4, 12, 14],
        };
      case 6: // Rogue AI — 156bpm cyber-trance swarm in G Minor, rolling 16ths + power drone
        return {
          bpm: 156,
          name: 'AI Hive Swarm',
          bassNotes: [98.00, 98.00, 98.00, 98.00, 116.54, 116.54, 87.31, 87.31],
          leadNotes: [196.00, 233.08, 261.63, 293.66, 349.23, 392.00, 466.16, 392.00],
          kickSteps: [0, 4, 8, 12],
          snareSteps: [4, 12],
          hatSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          openHatSteps: [2, 6, 10, 14],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'sawtooth' as OscillatorType,
          filterCutoff: 580,
          bassPattern: 'sixteenths',
          stabSteps: [0, 8],
          stabChord: [196.00, 293.66], // G power-chord drone
        };
      case 7: // Dimensional Rift — 146bpm hypnotic psytrance roll in B Minor
        return {
          bpm: 146,
          name: 'Chrono Rift',
          bassNotes: [61.74, 61.74, 73.42, 61.74, 82.41, 73.42, 61.74, 55.00],
          leadNotes: [246.94, 293.66, 329.63, 369.99, 440.00, 493.88, 369.99, 293.66],
          kickSteps: [0, 5, 8, 11],
          snareSteps: [4, 12],
          hatSteps: [0, 3, 6, 8, 11, 14],
          openHatSteps: [6, 14],
          bassWave: 'triangle' as OscillatorType,
          leadWave: 'sine' as OscillatorType,
          filterCutoff: 500,
          bassPattern: 'pulse',
        };
      case 8: // Comet Apocalypse — 154bpm galloping darksynth in E Minor
        return {
          bpm: 154,
          name: 'Comet Barrage',
          bassNotes: [82.41, 82.41, 98.00, 82.41, 110.00, 98.00, 82.41, 73.42],
          leadNotes: [329.63, 392.00, 440.00, 493.88, 587.33, 659.25, 493.88, 392.00],
          kickSteps: [0, 3, 6, 8, 12],
          snareSteps: [4, 10, 12],
          hatSteps: [0, 2, 4, 6, 8, 10, 12, 14],
          openHatSteps: [2, 10],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'square' as OscillatorType,
          filterCutoff: 680,
          bassPattern: 'gallop',
        };
      case 9: // Bio-Organic Infestation — 148bpm squelchy acid techno in C# Minor
        return {
          bpm: 148,
          name: 'Hive Mind Infestation',
          bassNotes: [69.30, 69.30, 82.41, 69.30, 92.50, 82.41, 69.30, 61.74],
          leadNotes: [138.59, 164.81, 185.00, 207.65, 246.94, 277.18, 207.65, 164.81],
          kickSteps: [0, 4, 8, 10, 12],
          snareSteps: [4, 12],
          hatSteps: [0, 2, 4, 6, 8, 10, 12, 14],
          openHatSteps: [6, 14],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'sawtooth' as OscillatorType,
          filterCutoff: 780,
          bassPattern: 'sixteenths',
          clapSteps: [4, 12],
        };
      case 10: // Black Hole Singularity — 140bpm sub-bass pressure in Eb Minor
        return {
          bpm: 140,
          name: 'Gravitational Singularity',
          bassNotes: [38.89, 38.89, 46.25, 38.89, 58.27, 46.25, 38.89, 34.65],
          leadNotes: [155.56, 185.00, 233.08, 277.18, 311.13, 369.99, 233.08, 185.00],
          kickSteps: [0, 6, 8, 14],
          snareSteps: [4, 12],
          hatSteps: [2, 6, 10, 14],
          openHatSteps: [10],
          bassWave: 'sine' as OscillatorType,
          leadWave: 'triangle' as OscillatorType,
          filterCutoff: 380,
          bassPattern: 'eighths',
        };
      case 11: // Solar Corona Inferno — 164bpm blistering solar-burn in E Minor
        return {
          bpm: 164,
          name: 'Corona Immolation',
          bassNotes: [82.41, 82.41, 82.41, 92.50, 82.41, 77.78, 82.41, 73.42],
          leadNotes: [329.63, 415.30, 493.88, 622.25, 659.25, 830.61, 739.99, 493.88],
          kickSteps: [0, 3, 6, 8, 11, 14],
          snareSteps: [4, 12, 15],
          hatSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          openHatSteps: [3, 7, 11, 15],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'square' as OscillatorType,
          filterCutoff: 820,
          bassPattern: 'sixteenths',
          stabSteps: [0, 3, 6, 11],
          stabChord: [164.81, 246.94, 392.00],
        };
      case 12: // Nebula Leviathan Reef — 144bpm liquid racing current in F Minor
        return {
          bpm: 144,
          name: 'Abyssal Reef',
          bassNotes: [43.65, 43.65, 51.91, 43.65, 58.27, 51.91, 43.65, 38.89],
          leadNotes: [174.61, 233.08, 261.63, 311.13, 349.23, 415.30, 311.13, 233.08],
          kickSteps: [0, 4, 7, 8, 11, 14],
          snareSteps: [4, 12],
          hatSteps: [2, 6, 10, 14],
          openHatSteps: [6],
          bassWave: 'sine' as OscillatorType,
          leadWave: 'triangle' as OscillatorType,
          filterCutoff: 520,
          bassPattern: 'offbeat',
          clapSteps: [4, 12],
        };
      case 13: // Chrono Storm Paradox — 158bpm glitch-staccato time-warps in G# Minor
        return {
          bpm: 158,
          name: 'Paradox Engine',
          bassNotes: [103.83, 103.83, 116.54, 103.83, 138.59, 116.54, 103.83, 92.50],
          leadNotes: [207.65, 311.13, 277.18, 415.30, 466.16, 554.37, 415.30, 277.18],
          kickSteps: [0, 2, 5, 8, 10, 13],
          snareSteps: [4, 9, 12, 15],
          hatSteps: [1, 3, 5, 7, 9, 11, 13, 15],
          openHatSteps: [7, 15],
          bassWave: 'square' as OscillatorType,
          leadWave: 'square' as OscillatorType,
          filterCutoff: 700,
          bassPattern: 'sixteenths',
          stabSteps: [2, 7, 13],
          stabChord: [207.65, 311.13],
          clapSteps: [4, 12],
        };
      case 14: // Void Legion Dominion — 148bpm imperial war-march in D Minor
        return {
          bpm: 148,
          name: 'Obsidian Legion',
          bassNotes: [36.71, 36.71, 43.65, 36.71, 55.00, 43.65, 36.71, 32.70],
          leadNotes: [146.83, 185.00, 220.00, 293.66, 329.63, 369.99, 293.66, 220.00],
          kickSteps: [0, 2, 4, 8, 10, 12],
          snareSteps: [6, 14],
          hatSteps: [2, 6, 10, 14],
          openHatSteps: [10],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'sawtooth' as OscillatorType,
          filterCutoff: 400,
          bassPattern: 'gallop',
          stabSteps: [0, 8],
          stabChord: [146.83, 220.00, 293.66],
        };
      case 15: // Omega Convergence Point — 172bpm multiversal finale in A Minor
      default:
        return {
          bpm: 172,
          name: 'Omega Convergence',
          bassNotes: [55.00, 55.00, 65.41, 55.00, 73.42, 65.41, 55.00, 49.00],
          leadNotes: [220.00, 329.63, 440.00, 523.25, 587.33, 659.25, 523.25, 329.63],
          kickSteps: [0, 3, 4, 7, 8, 11, 12, 15],
          snareSteps: [4, 12, 14],
          hatSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          openHatSteps: [4, 12],
          bassWave: 'sawtooth' as OscillatorType,
          leadWave: 'square' as OscillatorType,
          filterCutoff: 860,
          bassPattern: 'sixteenths',
          stabSteps: [0, 4, 8, 12],
          stabChord: [220.00, 329.63, 523.25],
        };
    }
  }

  public playEraTransitionRiser() {
    if (this.musicMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      // Dramatic pitch-bending hyperspace riser
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.8);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.35 * this.musicVolume * this.masterVolume, now + 0.7);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 1.05);

      // Deep sonic sub boom at climax
      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(140, now + 0.75);
      sub.frequency.exponentialRampToValueAtTime(32, now + 1.4);

      subGain.gain.setValueAtTime(0.5 * this.musicVolume * this.masterVolume, now + 0.75);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

      sub.connect(subGain);
      subGain.connect(this.ctx.destination);
      sub.start(now + 0.75);
      sub.stop(now + 1.45);
    } catch {
      // AudioContext interrupted
    }
  }

  private playMusicKick(time: number, gainMul: number = 1) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, time);
      osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

      gain.gain.setValueAtTime(0.55 * gainMul * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.15);
    } catch {}
  }

  private playMusicSnare(time: number) {
    if (!this.ctx) return;
    try {
      const buffer = this.getNoiseBuffer();
      if (!buffer) return;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100, time);
      filter.Q.setValueAtTime(1.3, time);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.3 * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(time);
      src.stop(time + 0.17);
    } catch {}
  }

  private playMusicHat(time: number, open: boolean) {
    if (!this.ctx) return;
    try {
      const buffer = this.getNoiseBuffer();
      if (!buffer) return;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(7500, time);

      const gain = this.ctx.createGain();
      const dur = open ? 0.12 : 0.045;
      gain.gain.setValueAtTime((open ? 0.22 : 0.14) * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(time);
      src.stop(time + dur + 0.01);
    } catch {}
  }

  private playMusicBass(freq: number, time: number, wave: OscillatorType, filterCutoff: number, gainMul: number = 1) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = wave;
      osc.frequency.setValueAtTime(freq, time);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterCutoff, time);
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterCutoff * 0.4), time + 0.15);
      filter.Q.setValueAtTime(3.0, time);

      gain.gain.setValueAtTime(0.24 * gainMul * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.2);
    } catch {}
  }

  private playMusicLead(freq: number, time: number, wave: OscillatorType, gainMul: number = 1) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.09 * gainMul * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.16);
    } catch {}
  }

  /** Backbeat chord stab — sawtooth cluster through a snapping lowpass. */
  private playMusicStab(time: number, chord: number[]) {
    if (!this.ctx) return;
    try {
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, time);
      filter.frequency.exponentialRampToValueAtTime(500, time + 0.16);
      filter.Q.setValueAtTime(1.2, time);

      gain.gain.setValueAtTime(0.14 * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

      chord.forEach((freq) => {
        const osc = this.ctx!.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + 0.2);
      });
      filter.connect(gain);
      gain.connect(this.ctx.destination);
    } catch {}
  }

  /** Bright double-hit hand clap for the electro/acid eras. */
  private playMusicClap(time: number) {
    if (!this.ctx) return;
    try {
      const buffer = this.getNoiseBuffer();
      if (!buffer) return;
      for (let hit = 0; hit < 2; hit++) {
        const t = time + hit * 0.028;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1900, t);
        filter.Q.setValueAtTime(2.2, t);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((hit === 0 ? 0.18 : 0.24) * this.musicVolume * this.masterVolume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        src.start(t);
        src.stop(t + 0.12);
      }
    } catch {}
  }

  /** Bar-start sub drop — adds floor-shaking weight at SURGE intensity. */
  private playMusicSubBoom(time: number) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.4);
      gain.gain.setValueAtTime(0.4 * this.musicVolume * this.masterVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.5);
    } catch {}
  }

  /** Overdrive riser — a 1.6s noise sweep that screams "finish it!". */
  private playMusicSweep(time: number) {
    if (!this.ctx) return;
    try {
      const buffer = this.getNoiseBuffer();
      if (!buffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(400, time);
      filter.frequency.exponentialRampToValueAtTime(6500, time + 1.6);
      filter.Q.setValueAtTime(1.6, time);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(0.16 * this.musicVolume * this.masterVolume, time + 1.3);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 1.7);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(time);
      src.stop(time + 1.75);
    } catch {}
  }

  /**
   * Bassline rhythm router — each era's bassPattern sets its groove, and the
   * combat drive escalates sparser patterns into a full 16th-note roll once
   * the fight hits SURGE (0.65+).
   */
  private bassPlaysAt(pattern: EraMusicConfig['bassPattern'], step: number, drive: number): boolean {
    if (drive >= 0.65 && (pattern === 'eighths' || pattern === 'offbeat')) return true;
    switch (pattern) {
      case 'sixteenths':
      case 'pulse':
        return true;
      case 'gallop':
        return step % 4 !== 3;
      case 'offbeat':
        return step % 4 === 2;
      case 'eighths':
      default:
        return step % 2 === 0;
    }
  }

  /** Bass root index — gallop changes root per beat, everything else per 8th. */
  private bassIndexAt(pattern: EraMusicConfig['bassPattern'], step: number): number {
    if (pattern === 'gallop') return Math.floor(step / 4);
    return Math.floor(step / 2);
  }

  private scheduleTick = () => {
    if (!this.ctx || this.musicMuted || this.masterMuted || !this.musicPlaying) return;
    // Sample soundtrack active — the procedural fallback stays idle.
    if (this.musicSource) return;

    try {
      const now = this.ctx.currentTime;
      const config = this.getEraConfig(this.currentEra);
      const drive = this.combatDrive;
      // The music races your pulse: subtle tempo push as adrenaline spikes
      const bpm = config.bpm + (drive >= 0.9 ? 6 : drive >= 0.65 ? 3 : 0);
      const stepDuration = (60 / bpm) / 4; // 16th note in seconds

      if (this.nextStepTime < now) {
        this.nextStepTime = now + 0.02;
      }

      // Lookahead window: schedule up to 140ms in advance
      while (this.nextStepTime < now + 0.14) {
        const step = this.musicStep % 16;
        const time = this.nextStepTime;

        // 1. Drums
        if (config.kickSteps.includes(step)) {
          this.playMusicKick(time);
        } else if (drive >= 0.9 && step % 4 === 2) {
          // OVERDRIVE: double-bass drive fills the idle eighths
          this.playMusicKick(time, 0.45);
        }
        if (config.snareSteps.includes(step)) {
          this.playMusicSnare(time);
        }
        if (config.clapSteps && config.clapSteps.includes(step)) {
          this.playMusicClap(time);
        }
        // RUSH (0.35+): the hat grid densifies to every 8th — the track leans in
        const hatOn = config.hatSteps.includes(step) || (drive >= 0.35 && step % 2 === 0);
        if (hatOn) {
          const isOpen = config.openHatSteps.includes(step);
          this.playMusicHat(time, isOpen);
        }

        // 2. Bass — the era's rhythm DNA, escalating with combat drive
        if (this.bassPlaysAt(config.bassPattern, step, drive)) {
          const bassIdx = this.bassIndexAt(config.bassPattern, step) % config.bassNotes.length;
          const bassNote = config.bassNotes[bassIdx];
          const accent = config.bassPattern === 'pulse' ? step % 4 === 0 : step % 8 === 0;
          const driveBoost = drive >= 0.9 ? 1.18 : drive >= 0.65 ? 1.08 : 1;
          this.playMusicBass(
            bassNote,
            time,
            config.bassWave,
            config.filterCutoff * (accent ? 1.35 : 1),
            driveBoost
          );
        }

        // 3. Arpeggio / lead — density and octave accents climb with drive
        const leadPlays =
          drive >= 0.65
            ? true
            : drive >= 0.35
              ? step % 2 === 0
              : step % 2 === 1 || step === 0 || step === 8;
        if (leadPlays) {
          const leadIdx = (Math.floor(this.musicStep / 2) + (step % 4)) % config.leadNotes.length;
          let leadNote = config.leadNotes[leadIdx];
          // Adrenaline sparkle: octave-up answer phrase once the rush builds
          if (drive >= 0.35 && this.musicStep % 8 >= 4) leadNote *= 2;
          this.playMusicLead(leadNote, time, config.leadWave, drive >= 0.65 ? 1.25 : 1);
        }

        // 4. Harmony stabs — enter at SURGE, extra accent hit at OVERDRIVE
        if (config.stabChord && config.stabSteps && drive >= 0.55) {
          if (config.stabSteps.includes(step) || (drive >= 0.9 && step === 14)) {
            this.playMusicStab(time, config.stabChord);
          }
        }

        // 5. Bar-start weight + overdrive risers
        if (step === 0) {
          if (drive >= 0.65 && this.musicStep % 32 === 0) {
            this.playMusicSubBoom(time);
          }
          if (drive >= 0.9 && this.musicStep % 64 === 0) {
            this.playMusicSweep(time);
          }
        }

        this.nextStepTime += stepDuration;
        this.musicStep++;
      }
    } catch {
      // Catch transient audio context drops
    }
  };

  // --- Sample-based soundtrack playback ------------------------------------
  //
  // The soundtrack is REAL music now: seven tiny, seamlessly-looping tracks
  // remastered from the uploaded reference scores (see scripts/build_music.py).
  // Playback graph:  source (loop) -> sourceGain (per-track fades)
  // -> musicFilter (combat brightness) -> musicBus (volume x intensity)
  // -> destination.

  private ensureMusicBus(): void {
    if (!this.ctx) return;
    if (!this.musicFilter) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      this.musicFilter = filter;
    }
    if (!this.musicBus) {
      const bus = this.ctx.createGain();
      bus.gain.value = 0.0001;
      this.musicFilter.connect(bus);
      bus.connect(this.ctx.destination);
      this.musicBus = bus;
    }
  }

  /** Page-load prefetch: grabs the tiny intro loop (~76 KB) before the
   *  player has even touched the screen, so the very first gesture can
   *  start music with zero network wait. Needs no AudioContext — safe to
   *  call on mount. Falls back to a gesture-time fetch (and then to the
   *  procedural sequencer) if the network is unavailable. */
  public prefetchIntro(): void {
    if (typeof window === 'undefined' || this.introBytes !== null || this.introPrefetchFailed) return;
    const exts: Array<'.opus' | '.m4a'> = this.musicExt ? [this.musicExt] : ['.opus', '.m4a'];
    void (async () => {
      for (const ext of exts) {
        try {
          const res = await fetch(`music/intro${ext}`);
          if (!res.ok) continue;
          this.introBytes = await res.arrayBuffer();
          this.introExt = ext;
          return;
        } catch {
          /* this extension failed — try the next one */
        }
      }
      this.introPrefetchFailed = true; // offline first visit — later layers cover
    })();
  }

  /** Start the instant intro loop. Called the moment audio unlocks (and from
   *  startMusic when no real track is live yet); hands off via
   *  stopIntroMusic() when a track's startSource() fires. Every failure path
   *  resets introActive so the procedural fallback can take the gap. */
  private startIntroMusic(): void {
    if (this.introActive || this.musicMuted || this.masterMuted) return;
    this.initContext();
    const ctx = this.ctx;
    if (!ctx || this.musicSource) return; // real track already live
    this.introActive = true;
    void (async () => {
      let ok = false;
      try {
        let buffer: AudioBuffer | null = null;
        if (this.introBytes) {
          try {
            buffer = await ctx.decodeAudioData(this.introBytes.slice(0));
            if (this.introExt && !this.musicExt) this.musicExt = this.introExt; // codec probe won
          } catch {
            buffer = null; // e.g. Safari + Opus bytes — fall through to the loader
          }
        }
        if (!buffer) buffer = await this.loadTrack('intro');
        if (!buffer) return; // both extensions failed — procedural fallback owns the gap
        if (!this.introActive || !this.ctx || this.musicSource || this.musicMuted || this.masterMuted) {
          return; // lost the race to the real track / muted meanwhile
        }
        this.ensureMusicBus();
        if (!this.musicFilter) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = ctx.createGain();
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(1, t + 0.8);
        src.connect(gain);
        gain.connect(this.musicFilter);
        src.start(t);
        this.introSource = src;
        this.introGain = gain;
        this.musicBuffers.set('intro', buffer); // later loadTrack('intro') hits the cache
        ok = true;
      } catch {
        // decode/start hiccup — procedural fallback owns the gap
      } finally {
        if (!ok) this.introActive = false;
      }
    })();
  }

  /** Fade the intro bridge out — crossfades into a real track (startSource),
   *  or stands down when music is muted/stopped or the procedural sequencer
   *  takes over the gap. */
  private stopIntroMusic(dur = 1.2): void {
    this.introActive = false;
    const src = this.introSource;
    const gain = this.introGain;
    this.introSource = null;
    this.introGain = null;
    if (!src || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (gain) {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      } catch {
        // already disconnected
      }
    }
    try {
      src.stop(t + dur + 0.05);
    } catch {
      // already stopped
    }
  }

  /**
   * CombatDrive -> mix movement. A pre-rendered track can't drop layers the
   * way the old sequencer did, so intensity rides the mix instead: the bed
   * sits slightly back (quieter + gently band-limited) at BASE, then opens
   * up in brightness and level through RUSH and SURGE, and hits a hot lift
   * at OVERDRIVE — the same four-tier adrenaline curve, AAA style.
   */
  private applyMusicIntensity(): void {
    if (!this.ctx || !this.musicBus || !this.musicFilter) return;
    const t = this.ctx.currentTime;
    let gainMul = 1;
    let cutoff = 20000;
    if (this.currentEra > 0) {
      const d = this.combatDrive;
      if (d >= 0.9) {
        gainMul = 1.07;
        cutoff = 19500;
      } else if (d >= 0.65) {
        gainMul = 1.0;
        cutoff = 17500;
      } else if (d >= 0.35) {
        gainMul = 0.9;
        cutoff = 14500;
      } else {
        gainMul = 0.82;
        cutoff = 11500;
      }
    }
    const vol = Math.max(0.0001, this.musicVolume * this.masterVolume * gainMul);
    try {
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setTargetAtTime(vol, t, 0.75);
      this.musicFilter.frequency.cancelScheduledValues(t);
      this.musicFilter.frequency.setTargetAtTime(cutoff, t, 0.9);
    } catch {
      // context interrupted mid-automation
    }
  }

  /**
   * Fetch + decode a track. Tries Opus first (~40 kbps, tiny) and falls back
   * to AAC for Safari. Remembers the extension that worked so later loads
   * take a single request. Never rejects — resolves null on failure and arms
   * the procedural fallback when no extension has ever decoded.
   */
  private loadTrack(id: string): Promise<AudioBuffer | null> {
    const cached = this.musicBuffers.get(id);
    if (cached) return Promise.resolve(cached);
    const inflight = this.musicLoadPromises.get(id);
    if (inflight) return inflight;
    const load = (async (): Promise<AudioBuffer | null> => {
      if (!this.ctx) return null;
      const exts: Array<'.opus' | '.m4a'> = this.musicExt ? [this.musicExt] : ['.opus', '.m4a'];
      for (const ext of exts) {
        try {
          const res = await fetch(`music/${id}${ext}`);
          if (!res.ok) continue;
          const data = await res.arrayBuffer();
          const buffer = await this.ctx.decodeAudioData(data.slice(0));
          this.musicExt = ext;
          this.musicBuffers.set(id, buffer);
          return buffer;
        } catch {
          // this extension failed for this track — try the next one
        }
      }
      if (!this.musicExt) this.musicBroken = true;
      return null;
    })();
    this.musicLoadPromises.set(id, load);
    void load.then(() => this.musicLoadPromises.delete(id));
    return load;
  }

  private startSource(buffer: AudioBuffer, id: string): void {
    if (!this.ctx) return;
    this.ensureMusicBus();
    if (!this.musicFilter) return;
    this.fadeOutAndStopSource(0.3);
    this.stopIntroMusic(1.2); // crossfade the instant-start bridge into the real track
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + 0.55);
    src.connect(gain);
    gain.connect(this.musicFilter);
    try {
      src.start(t);
    } catch {
      return;
    }
    this.musicSource = src;
    this.musicSourceGain = gain;
    this.musicTrackId = id;
    this.applyMusicIntensity();
  }

  private fadeOutAndStopSource(dur = 0.3): void {
    const src = this.musicSource;
    const gain = this.musicSourceGain;
    this.musicSource = null;
    this.musicSourceGain = null;
    this.musicTrackId = null;
    if (!src || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (gain) {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      } catch {
        // already disconnected
      }
    }
    try {
      src.stop(t + dur + 0.05);
    } catch {
      // already stopped
    }
  }

  /**
   * Swap to a track with a soft dip transition. First loads are usually
   * instant (files are ~250-350 KB and prefetched); if the network is slow
   * the procedural engine covers the gap and the swap retries once the
   * buffer has cached.
   */
  private async switchTrack(id: string): Promise<void> {
    if (!this.ctx) return;
    if (this.musicTrackId === id && this.musicSource) return;
    if (this.musicBroken) {
      this.startProceduralMusic();
      return;
    }
    const buffer = await Promise.race([
      this.loadTrack(id),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 1600);
      }),
    ]);
    if (!this.ctx) return;
    if (this.musicBroken) {
      this.startProceduralMusic();
      return;
    }
    if (!buffer) {
      // The instant intro loop keeps bridging if it is already playing;
      // otherwise the procedural sequencer covers the gap as before.
      if (!this.introActive) this.startProceduralMusic();
      this.scheduleSampleRetry(id);
      return;
    }
    if (!this.musicPlaying || this.musicMuted || this.masterMuted) return;
    if (this.musicTrackId === id && this.musicSource) return; // raced caller won
    this.stopProceduralMusic();
    this.startSource(buffer, id);
    if (!this.prefetchStarted) {
      this.prefetchStarted = true;
      this.prefetchNext();
    }
  }

  private scheduleSampleRetry(id: string): void {
    if (this.retryTimer !== null || typeof window === 'undefined') return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (
        this.musicPlaying &&
        !this.musicMuted &&
        !this.masterMuted &&
        !this.musicBroken &&
        this.ctx &&
        trackIdForEra(this.currentEra) === id &&
        this.musicTrackId !== id
      ) {
        void this.switchTrack(id);
      }
    }, 9000);
  }

  /** Warm the remaining tracks in the background (staggered, low priority). */
  private prefetchNext(): void {
    if (this.musicBroken || !this.ctx || typeof window === 'undefined') return;
    if (this.prefetchIdx >= MUSIC_TRACK_ORDER.length) return;
    const id = MUSIC_TRACK_ORDER[this.prefetchIdx++];
    if (this.musicBuffers.has(id) || this.musicLoadPromises.has(id)) {
      this.prefetchNext();
      return;
    }
    void this.loadTrack(id).finally(() => {
      window.setTimeout(() => this.prefetchNext(), 600);
    });
  }

  // --- Procedural fallback engine (offline / no-sample safety net) ---------

  private startProceduralMusic(): void {
    if (!this.ctx || this.musicInterval || this.musicMuted || this.masterMuted || !this.musicPlaying) return;
    this.stopIntroMusic(0.6); // the sequencer takes over the gap
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.musicInterval = window.setInterval(this.scheduleTick, 25);
  }

  private stopProceduralMusic(): void {
    if (this.musicInterval) {
      window.clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }

  // --- Active Background Music Control ---
  public startMusic(eraNumber?: number) {
    if (eraNumber !== undefined) {
      // 0 = menu theme; anything negative also falls back to the menu track
      this.currentEra = Math.max(0, eraNumber);
      // Leaving combat for the menu: stand down from combat intensity
      if (eraNumber <= 0) this.combatDrive = 0;
    }
    this.musicPlaying = true;
    if (this.musicMuted || this.masterMuted || typeof window === 'undefined') return;

    this.initContext();
    if (!this.ctx) return;

    // Instant bridge: while the real track is still loading (or after a
    // mute/stop), the tiny intro loop keeps the game audible.
    if (!this.musicSource && !this.introActive) this.startIntroMusic();

    const id = trackIdForEra(this.currentEra);
    if (this.musicTrackId === id && this.musicSource) {
      this.applyMusicIntensity(); // unmute / volume-refresh path
      return;
    }
    void this.switchTrack(id);
  }

  /**
   * Live gameplay -> music intensity. The engine feeds this 5x/second with
   * the state that matters for adrenaline: the rush meter, overdrive, the
   * boss's current phase, and hull danger. The sample soundtrack rides the
   * same four-tier curve (BASE < RUSH 0.35 < SURGE 0.65 < OVERDRIVE 0.9)
   * through gain + brightness automation on the music bus.
   */
  public setCombatDrive(adrenaline: number, overdrive: boolean, bossPhase: number, hpRatio: number) {
    let drive = (Math.max(0, Math.min(100, adrenaline)) / 100) * 0.55;
    if (overdrive) drive = Math.max(drive, 0.95);
    if (bossPhase > 0) drive = Math.max(drive, 0.45 + bossPhase * 0.16);
    if (hpRatio < 0.3) drive = Math.max(drive, 0.55);
    this.combatDrive = Math.min(1, drive);
    this.applyMusicIntensity();
  }

  /** Stand the soundtrack down to base intensity (menu / game over). */
  public resetCombatDrive() {
    this.combatDrive = 0;
    this.applyMusicIntensity();
  }

  public getCombatDrive(): number {
    return this.combatDrive;
  }

  /** Current era's track name — surfaces "each era has its own music" in the UI. */
  public getCurrentTrackName(): string {
    if (this.introActive && !this.musicSource) return MUSIC_TRACKS.intro.name;
    if (this.musicBroken || this.musicInterval !== null) {
      return this.getEraConfig(this.currentEra).name;
    }
    const id = this.musicTrackId ?? trackIdForEra(this.currentEra);
    return MUSIC_TRACKS[id]?.name ?? this.getEraConfig(this.currentEra).name;
  }

  /** Current era's tempo (BPM) — the detected tempo of the sample loop. */
  public getCurrentTrackBpm(): number {
    if (this.introActive && !this.musicSource) return MUSIC_TRACKS.intro.bpm;
    if (this.musicBroken || this.musicInterval !== null) {
      return this.getEraConfig(this.currentEra).bpm;
    }
    const id = this.musicTrackId ?? trackIdForEra(this.currentEra);
    return MUSIC_TRACKS[id]?.bpm ?? this.getEraConfig(this.currentEra).bpm;
  }

  public stopMusic() {
    this.musicPlaying = false;
    this.stopProceduralMusic();
    if (this.retryTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopIntroMusic(0.25);
    this.fadeOutAndStopSource(0.25);
  }
}

export const sound = new SoundEngine();
