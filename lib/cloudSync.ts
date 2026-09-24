import { DailyChallenge, PlayerProfile } from './types';
import { inPlayablesEnv, loadPlayablesSave, savePlayablesSave } from './ytplayables';

/**
 * Cross-platform progress sync for Earth Defender.
 *
 * One save envelope (profile + daily challenges + savedAt) is synced through
 * whichever cloud is reachable:
 *
 *   ┌ YouTube Playables runtime ─────────────────────────────────────────┐
 *   │ ytgame.game.saveData()/loadData() — YouTube's own cloud storage    │
 *   │ (keyed to the player's YouTube account). YouTube's CSP restricts   │
 *   │ connect-src to 'self', so our HTTP backend is unreachable there.   │
 *   └────────────────────────────────────────────────────────────────────┘
 *   ┌ Standalone website build ──────────────────────────────────────────┐
 *   │ POST/GET /api/sync on this Next.js server (SQLite via Prisma),     │
 *   │ identity = random UUID kept in localStorage.                       │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * localStorage always remains the instant local cache (existing behavior),
 * so the game never blocks on the network.
 *
 * Conflict policy: last-write-wins by savedAt (epoch ms). A device that is
 * behind receives the server's newer copy (pull at boot, or the `stale`
 * response to a late push) and reconciles.
 */

export interface SaveEnvelope {
  v: 1;
  profile: PlayerProfile;
  challenges: DailyChallenge[];
  /** Epoch-ms timestamp of the most recent modification of this state. */
  savedAt: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline';

const PLAYER_ID_KEY = 'earth_defender_player_id';
const META_KEY = 'earth_defender_sync_meta';
const PROFILE_KEY = 'earth_defender_profile_v1';
const CHALLENGES_KEY = 'earth_defender_challenges';

/** Coalesce bursts of profile updates (kills award cash every few seconds). */
const PUSH_DEBOUNCE_MS = 2_500;
/** Never send more than ~7 save uploads per minute during combat. */
const PUSH_MIN_INTERVAL_MS = 9_000;
const MAX_SEND_ATTEMPTS = 3;

interface SyncMeta {
  savedAt: number;
}

type StatusListener = (status: SyncStatus) => void;
type StaleListener = (envelope: SaveEnvelope) => void;

function randomPlayerId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback for very old browsers
  return `pid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SyncMeta;
      if (typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
        return { savedAt: Math.max(0, Math.floor(parsed.savedAt)) };
      }
    }
  } catch {}
  return { savedAt: 0 };
}

function writeMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

/** Parses + shape-checks a raw envelope JSON string from any cloud. */
export function parseSaveEnvelope(raw: string): SaveEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.profile || typeof parsed.profile !== 'object') return null;
    if (!Array.isArray(parsed.challenges)) return null;
    const savedAt =
      typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)
        ? Math.max(0, Math.floor(parsed.savedAt))
        : 0;
    return {
      v: 1,
      profile: parsed.profile as PlayerProfile,
      challenges: parsed.challenges as DailyChallenge[],
      savedAt,
    };
  } catch {
    return null;
  }
}

class CloudSyncService {
  private profileRef: PlayerProfile | null = null;
  private challengesRef: DailyChallenge[] | null = null;

  /**
   * Hydration-echo guard. The page's profile/challenges effects fire once
   * right after hydration with the just-loaded state — that first call is NOT
   * a real mutation. Bumping savedAt (or pushing) for it was corrupting the
   * LWW arbiter: a fresh/evicted localStorage got savedAt=Date.now() BEFORE
   * the boot pull resolved, so the remote copy (always older than "now")
   * could never win — and markBootstrapDone() then PUSHED the local state,
   * destroying the cloud save. Rewarded-ad gems earned in earlier sessions
   * vanished exactly this way. The first updateProfile/updateChallenges call
   * absorbs the ref only; every later call is a real mutation.
   */
  private profileEchoPending = true;
  private challengesEchoPending = true;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSendAt = 0;
  private sending = false;
  private sendAttempts = 0;

  private status: SyncStatus = 'idle';
  private statusListeners = new Set<StatusListener>();
  private staleListener: StaleListener | null = null;

  /** Pushes are held until the boot pull/merge has settled. */
  private bootstrapDone = false;
  private autoFlushInstalled = false;

  // -- identity -------------------------------------------------------------//

  /** Stable player UUID (created on first launch, kept in localStorage). */
  getPlayerId(): string {
    if (typeof window === 'undefined') return '';
    try {
      let id = localStorage.getItem(PLAYER_ID_KEY) || '';
      if (!id) {
        id = randomPlayerId();
        localStorage.setItem(PLAYER_ID_KEY, id);
      }
      return id;
    } catch {
      return '';
    }
  }

  // -- status ---------------------------------------------------------------//

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(next: SyncStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.statusListeners.forEach((l) => l(next));
  }

  /** Server sent a newer copy in response to our stale push. */
  setOnStale(listener: StaleListener): void {
    this.staleListener = listener;
  }

  // -- local bookkeeping ----------------------------------------------------//

  /** Timestamp of the local state's last modification (LWW arbiter). */
  getLocalSavedAt(): number {
    return readMeta().savedAt;
  }

  /**
   * Writes a remote envelope into the localStorage cache. The next read via
   * getStoredProfile()/getDailyChallenges() sanitizes it exactly like a local
   * save, so hostile/corrupt cloud data can never reach the engine unsanitized.
   */
  applyRemoteToLocal(envelope: SaveEnvelope): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(envelope.profile));
      localStorage.setItem(CHALLENGES_KEY, JSON.stringify(envelope.challenges));
      writeMeta({ savedAt: envelope.savedAt });
    } catch {}
  }

  /** Called once the boot pull finished — releases held pushes. */
  markBootstrapDone(): void {
    this.bootstrapDone = true;
    if (this.debounceTimer !== null) {
      // A push was already scheduled while booting — let it fire normally.
      return;
    }
    if (this.profileRef || this.challengesRef) {
      // Local state exists but nothing pending: make sure the cloud copy
      // exists too (first-launch case: server has never seen this player).
      this.schedulePush(0);
    }
  }

  // -- push side ------------------------------------------------------------//

  updateProfile(profile: PlayerProfile): void {
    this.profileRef = profile;
    if (this.profileEchoPending) {
      this.profileEchoPending = false; // hydration echo: keep savedAt untouched
      return;
    }
    writeMeta({ savedAt: Date.now() });
    this.schedulePush();
  }

  updateChallenges(challenges: DailyChallenge[]): void {
    this.challengesRef = challenges;
    if (this.challengesEchoPending) {
      this.challengesEchoPending = false; // hydration echo: keep savedAt untouched
      return;
    }
    writeMeta({ savedAt: Date.now() });
    this.schedulePush();
  }

  private schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
    if (typeof window === 'undefined') return;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.sendCycle();
    }, delayMs);
  }

  /** Debounce elapsed → enforce the min-interval throttle, then send. */
  private async sendCycle(): Promise<void> {
    if (this.sending) return;
    const sinceLast = Date.now() - this.lastSendAt;
    if (sinceLast < PUSH_MIN_INTERVAL_MS && this.bootstrapDone) {
      const wait = PUSH_MIN_INTERVAL_MS - sinceLast;
      if (this.retryTimer !== null) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.sendCycle();
      }, wait);
      return;
    }
    await this.send();
  }

  /** Sends the current envelope to whichever cloud is reachable. */
  private async send(): Promise<void> {
    if (this.sending) return;
    if (!this.profileRef) return; // nothing worth saving yet
    if (!this.bootstrapDone) return; // held until boot pull settles

    this.sending = true;
    this.setStatus('syncing');
    try {
      const envelope = this.buildEnvelope();
      const json = JSON.stringify(envelope);

      if (inPlayablesEnv()) {
        // Inside YouTube: the HTTP backend is unreachable (CSP), use the
        // official Playables cloud save instead.
        const ok = await savePlayablesSave(json);
        this.lastSendAt = Date.now();
        this.sendAttempts = 0;
        this.setStatus(ok ? 'synced' : 'offline');
        return;
      }

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: this.getPlayerId(),
          data: json,
          savedAt: envelope.savedAt,
        }),
      });

      this.lastSendAt = Date.now();

      if (!response.ok) throw new Error(`sync POST ${response.status}`);

      const result = (await response.json()) as {
        ok: boolean;
        status?: string;
        server?: { data: string; savedAt: number };
      };

      if (result.status === 'stale' && result.server) {
        // Another device is ahead — adopt the server copy.
        const newer = parseSaveEnvelope(result.server.data);
        if (newer && this.staleListener) {
          this.staleListener(newer);
        }
      }

      this.sendAttempts = 0;
      this.setStatus('synced');
    } catch {
      // Offline / server down: keep local play untouched, retry lazily.
      this.sendAttempts += 1;
      if (this.sendAttempts >= MAX_SEND_ATTEMPTS) {
        this.setStatus('offline');
        this.sendAttempts = 0; // allow a fresh attempt on the next change
      } else {
        this.setStatus('offline');
        if (this.retryTimer !== null) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.send();
        }, 5_000 * this.sendAttempts);
      }
    } finally {
      this.sending = false;
    }
  }

  private buildEnvelope(): SaveEnvelope {
    const savedAt = readMeta().savedAt || Date.now();
    return {
      v: 1,
      profile: this.profileRef as PlayerProfile,
      challenges: this.challengesRef ?? [],
      savedAt,
    };
  }

  /** Immediate best-effort save (pagehide, YouTube onPause, etc.). */
  flush(): void {
    if (!this.profileRef || !this.bootstrapDone) return;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    void this.send();
  }

  // -- pull side ------------------------------------------------------------//

  /** Pulls the newest remote envelope; null when absent/unreachable. */
  async pull(): Promise<SaveEnvelope | null> {
    if (typeof window === 'undefined') return null;
    try {
      if (inPlayablesEnv()) {
        const raw = await loadPlayablesSave();
        return raw ? parseSaveEnvelope(raw) : null;
      }

      const playerId = this.getPlayerId();
      if (!playerId) return null;
      const response = await fetch(`/api/sync?playerId=${encodeURIComponent(playerId)}`, {
        // Cache busting: progress sync must never be served from a cache.
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const result = (await response.json()) as {
        ok: boolean;
        found?: boolean;
        data?: string;
        savedAt?: number;
      };
      if (!result.ok || !result.found || typeof result.data !== 'string') return null;
      return parseSaveEnvelope(result.data);
    } catch {
      return null;
    }
  }

  // -- page lifecycle -------------------------------------------------------//

  /** Installs pagehide/visibility flush listeners exactly once. */
  installAutoFlush(): void {
    if (this.autoFlushInstalled || typeof window === 'undefined') return;
    this.autoFlushInstalled = true;
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }
}

export const cloudSync = new CloudSyncService();
