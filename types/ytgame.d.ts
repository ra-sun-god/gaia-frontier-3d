/**
 * TypeScript definitions for the YouTube Playables SDK (game_api/v1).
 *
 * Source of truth:
 *   https://developers.google.com/youtube/gaming/playables/reference/sdk
 *
 * The SDK is loaded via <script src="https://www.youtube.com/game_api/v1">
 * (MUST be loaded before any game code) and exposes the global `ytgame`
 * namespace. When the game runs outside YouTube the SDK still loads but runs
 * as a no-op: IN_PLAYABLES_ENV === false and the calls do nothing meaningful.
 */

declare global {
  /** Reward IDs are opaque, stable, non-user-derived strings. */
  type YtGameSdkErrorType =
    | 'API_UNAVAILABLE'
    | 'INVALID_PARAMS'
    | 'SIZE_LIMIT_EXCEEDED'
    | 'UNKNOWN';

  class YtGameSdkError extends Error {
    errorType: YtGameSdkErrorType;
  }

  interface YtGameAds {
    /**
     * Requests an interstitial ad at a natural gameplay breakpoint
     * (level end / game over / mid-game loading). Makes no guarantee the ad
     * was shown. NEVER use this to reward players.
     */
    requestInterstitialAd(): Promise<void>;
    /**
     * Requests a rewarded ad the player explicitly opted into.
     * Resolves `true` when the reward conditions were met, `false` when not.
     * `rewardId` must be a stable unique ID per reward type, no user data
     * (e.g. "revive-continue-run", "100-coins-reward-12").
     */
    requestRewardedAd(rewardId: string): Promise<boolean>;
  }

  interface YtGameEngagementScore {
    /** Integer ≤ Number.MAX_SAFE_INTEGER. One consistent progress dimension. */
    value: number;
  }

  interface YtGameEngagementContent {
    id: string;
    contentType?: YtGameContentType;
  }

  type YtGameContentType = 'VIDEO' | 'PLAYABLE';

  interface YtGameEngagement {
    /** Sends the best score to YouTube; the highest value is displayed. */
    sendScore(score: YtGameEngagementScore): Promise<void>;
    /** Opens a YouTube video or another Playable. */
    openYTContent(content: YtGameEngagementContent): Promise<void>;
    readonly ContentType: Record<YtGameContentType, YtGameContentType>;
  }

  interface YtGameGame {
    /**
     * MUST be called once the game begins showing frames, and MUST be called
     * before gameReady(). Otherwise the game is never shown to users.
     */
    firstFrameReady(): void;
    /**
     * MUST be called when the game is interactable (never while a loading
     * screen is still shown) or the game fails YouTube certification.
     */
    gameReady(): void;
    /** Loads the player's cloud save (serialized string, ≤ 3 MiB). */
    loadData(): Promise<string>;
    /** Saves the player's cloud save. Data must be well-formed UTF-16, ≤ 3 MiB. */
    saveData(data: string): Promise<void>;
  }

  interface YtGameHealth {
    /** Best-effort, rate-limited error logging to YouTube. */
    logError(): void;
    /** Best-effort, rate-limited warning logging to YouTube. */
    logWarning(): void;
  }

  interface YtGameSystem {
    /** BCP-47 language tag from the user's YouTube settings. */
    getLanguage(): Promise<string>;
    /** Whether game audio is enabled in the user's YouTube settings. */
    isAudioEnabled(): boolean;
    /** MUST be used to keep game audio state in sync with YouTube settings. */
    onAudioEnabledChange(callback: (isAudioEnabled: boolean) => void): () => void;
    /**
     * Pause callback — the game has a short window to save state before it
     * may be evicted. Fired for all pause types including user exit; there
     * is no guarantee the game will resume.
     */
    onPause(callback: () => void): () => void;
    /** Resume callback — not guaranteed to fire after every pause. */
    onResume(callback: () => void): () => void;
  }

  interface YtGame {
    /** True only when running inside the actual YouTube Playables environment. */
    readonly IN_PLAYABLES_ENV: boolean;
    readonly SDK_VERSION: string;
    readonly ads: YtGameAds;
    readonly engagement: YtGameEngagement;
    readonly game: YtGameGame;
    readonly health: YtGameHealth;
    readonly system: YtGameSystem;
  }

  interface Window {
    ytgame?: YtGame;
  }
}

export {};
