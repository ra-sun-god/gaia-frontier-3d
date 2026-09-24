/**
 * Haptics (vibration) manager for Earth Defender.
 *
 * Goals (per product feedback):
 *  - Sync device vibration with screen shake / chaos moments (boss barrages,
 *    orbital strikes, explosions) so impacts are FELT, not just seen.
 *  - Use vibration as a game-feel layer for addictive feedback loops: goodie
 *    pickups, combo milestones, adrenaline overdrive, boss kills.
 *  - Fully disableable from Settings (persisted; ON by default).
 *
 * Implementation notes:
 *  - navigator.vibrate is Android-Chrome only (iOS Safari is a silent no-op) —
 *    every call is guarded so the game never depends on it.
 *  - Inside YouTube Playables the API is typically unavailable — same guard.
 *  - A small throttle (70ms) stops rapid-fire events (crits, sparks) from
 *    merging into one endless buzz.
 */

const HAPTICS_KEY = 'earth_defender_haptics_on';

class HapticsEngine {
  private enabled: boolean = true;
  private lastBuzzAt: number = 0;
  private loaded: boolean = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(HAPTICS_KEY);
      // Default ON (null = never configured). Explicit "0"/"false" = off.
      this.enabled = raw === null ? true : raw === '1' || raw === 'true';
    } catch {
      this.enabled = true;
    }
  }

  public isEnabled(): boolean {
    this.ensureLoaded();
    return this.enabled;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    this.loaded = true;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(HAPTICS_KEY, on ? '1' : '0');
    } catch {
      // storage disabled — keep the runtime flag only
    }
    if (!on && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(0); // cancel any in-flight pattern
      } catch {}
    }
  }

  /** True when the vibration API exists at all (for settings hints). */
  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  /**
   * Raw buzz. Pattern = ms or [ms, pause, ms...]. Throttled.
   * Returns whether a vibration was actually issued.
   */
  public buzz(pattern: number | number[]): boolean {
    if (!this.isEnabled()) return false;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return false;
    const now = Date.now();
    if (now - this.lastBuzzAt < 70) return false;
    this.lastBuzzAt = now;
    try {
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }

  // --- Semantic patterns (tuned short — arcade taps, not phone-call buzzes) ---

  /** Feather tick: HUD taps, goodie pickup, minor events. */
  public light(): void {
    this.buzz(12);
  }

  /** Noticeable tap: weapon switch, combo milestone. */
  public tap(): void {
    this.buzz([18, 40, 18]);
  }

  /** Medium impact: shield break, crit hit, EMP discharge. */
  public medium(): void {
    this.buzz([30, 35, 25]);
  }

  /** Heavy impact: orbital strike, boss barrage, base hit, overdrive. */
  public heavy(): void {
    this.buzz([55, 45, 70]);
  }

  /** Rising success fanfare: wave clear, boss defeated. */
  public success(): void {
    this.buzz([15, 45, 15, 45, 35]);
  }

  /** Urgent alarm: fake goodie detonation, near-death, enrage. */
  public alarm(): void {
    this.buzz([80, 60, 80, 60, 110]);
  }

  /** VIOLENT sustained chaos: starfall catastrophe bursts and meteor
   *  showers — the phone should feel like it's rattling in the player's
   *  hands. Bypasses the 70ms throttle with its own longer cadence so the
   *  multi-impact chain stays felt. */
  public violent(): void {
    if (!this.isEnabled()) return;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    const now = Date.now();
    if (now - this.lastBuzzAt < 220) return;
    this.lastBuzzAt = now;
    try {
      navigator.vibrate([160, 60, 160, 60, 260]);
    } catch {}
  }

  /** Short sharp impact tick for individual starfall shard landings. */
  public impactTick(): void {
    this.buzz([45, 25, 35]);
  }

  /**
   * Screen-shake sync — the "chaos mode" coupling. Every engine screen shake
   * routes through here; the vibration magnitude follows the visual shake so
   * the phone thumps when the screen does.
   */
  public shakeSync(magnitude: number): void {
    if (!this.isEnabled()) return;
    if (magnitude >= 22) this.buzz([55, 40, 70]);
    else if (magnitude >= 14) this.buzz([30, 30, 25]);
    else if (magnitude >= 8) this.buzz([20, 25, 15]);
    else if (magnitude >= 4) this.buzz(15);
  }
}

export const haptics = new HapticsEngine();
