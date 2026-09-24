# 🌍 Gaia Frontier: After Contact

Contact was made — and it turned hostile. Defend Gaia against cosmic and alien threats
across **three arcade cabinets** — the campaign road, the **Daily Boss Rush**
gauntlet and the **Endless Gauntlet** — with upgradeable weapons, era bosses,
deception orbs that burst into starfall catastrophes, and endless progression.
Built as an AI Studio applet on **Next.js 15 + React 19 + TypeScript + Tailwind CSS 4**.

## Gameplay

- **Three run modes** — CAMPAIGN (the classic 15-era invasion road), DAILY
  BOSS RUSH (back-to-back flagship duels, ×2 score, one free entry per day,
  extra entries cost gems) and ENDLESS GAUNTLET (every wave mutates, ×1.5
  score, the "one more run" pressure cooker).
- **Starfall Catastrophe** — shooting a fake orb (deception core) detonates it
  into a dozen fire shooting stars that rain down on Gaia at terminal
  velocity: every shard burns the hull, shakes the screen and rattles the
  phone (violent haptics). **Every shard is interceptable** — bullets, frag
  blasts and nukes can shoot the fire-rain out of the sky to prevent the
  impact entirely.
- **15 eras** — each era has its own enemy roster, palette
  and soundtrack theme (real remastered music loops); after era 15 the
  Convergence cycles with rising difficulty.
- **6 weapons** — Standard Cannon, Gatling Autocannon, Piercing Beam Laser,
  Homing Rockets, EMP Shockwave, Orbital Strike — unlimited Mk-tiers.
- **Bosses** — mini-bosses on wave-in-5+3, era bosses with named alien pilots
  on every 5th wave. Boss encounters trigger a siren warning cinematic.
- **Special enemies** — stealthy Phantom Stalkers (era 7/10) cloak periodically
  and are invulnerable while cloaked; phase ghosts, healers, snipers, magnet
  drones, kamikazes and decoy goodies all behave differently.
- **Adrenaline / Overdrive** — kills charge adrenaline; at 100% unleash
  overdrive for triple-shot electric mayhem.
- **Combo system** — kill streaks multiply cash and score up to 10x, with
  milestone chain jackpots ($20 at 10x → $400 at 75x).
- **Near-miss saves** — kills landed deep in the terminal pocket pay +25%
  courage bonuses (last-second wins feel heroic).
- **Lucky salvage** — 30% of wave clears roll a 1.5×–3.5× jackpot cache.
- **Hull Expansion Doctrine** — the Citadel's hull ceiling starts at 100% and
  is raised permanently in expensive +25% reinforcement steps
  (100 → 125 → 150 → 175 → …). Damage only ever drives it down; a slow field
  nano-repair (+0.8%/s after 4s clean) creeps it back, while FAST repair is a
  paid/ad privilege: rewarded ads, the Emergency Hull Refit, intermission
  field repair, or sky-dropped repair goodies.

## Meta systems

- Shop with weapons, hull reinforcement extensions (+25% steps), idle
  satellite collector and bundles
- Mystery box vault with transparent odds (50/25/15/8/2) and a free daily roll
- 10-tier Convergence battle pass with one-time tier claims
- Daily challenges with claimable rewards
- Cosmetics that actually render — equipped skins recolor the turret, the
  planetary atmosphere/shield arc and your projectiles

All progress persists locally and syncs to the cloud — see below.

## Controls

| Input | Action |
| --- | --- |
| Tap / drag | Aim + fire (auto-fire is on by default) |
| `1`–`4` | Switch weapon |
| `E` / `R` | EMP / Orbital special |
| `V` | Trigger overdrive (when adrenaline is full) |
| `Space` | Toggle auto-fire |
| `P` | Pause |
| `Esc` | Close any open modal |

## Installable app (PWA)

The standalone website is a full installable PWA — "Install App" button on the
main menu (only for players who haven't installed yet):

- **Chrome / Edge / Android**: the browser's native install dialog fires once
  the app is installable (service worker + manifest + icons). Launches
  full-screen from the home screen / desktop.
- **iOS (Safari & every WebKit browser)**: no install-prompt API exists, so
  the button opens a short "Add to Home Screen" walkthrough instead.
- **YouTube Playables / iframes**: the button and service worker stay
  completely out — Playables hosting behavior is untouched.

Plumbing: `public/sw.js` (app-shell precache, network-first navigations,
cache-first immutable chunks, stale-while-revalidate for music/icons,
background soundtrack warm-up for full offline play, `/api/*` always live),
`lib/pwa.ts` (deferred `beforeinstallprompt` store + `usePwaInstall()` hook +
SW registration),
`components/InstallAppButton.tsx` + `components/ServiceWorkerRegister.tsx`,
`app/manifest.ts` (fullscreen display, 192/512/maskable icons) and
`appleWebApp` metadata in `app/layout.tsx`. After install the game is fully
playable offline — including the soundtrack (all 8 opus loops, ~2.3 MB,
warmed into the cache in the background after load).

**Update rule**: bump `VERSION` in `public/sw.js` whenever its logic or the
precached/public assets change meaningfully — old caches purge on activation.

## Cloud sync + backend

Progress (profile, weapons, cash, gems, wave records, challenges) syncs
automatically through whichever cloud is reachable:

- **YouTube Playables build** — the official Playables SDK cloud save
  (`ytgame.game.saveData` / `loadData`), keyed to the player's YouTube
  account. YouTube's CSP blocks cross-origin fetches, so the game's own HTTP
  backend is unreachable inside the Playables iframe — the SDK cloud is the
  correct compliant channel there.
- **Standalone website build** — this repo's Next.js backend:
  - `POST /api/sync` — push a save (last-write-wins by `savedAt`; a stale
    device receives the newer server copy back for reconciliation)
  - `GET /api/sync?playerId=` — pull the newest save
  - `GET /api/leaderboard?playerId=` — global top-25 by best score + your rank
  - SQLite via **Prisma** (`prisma/schema.prisma`, db file in `db/`)

`localStorage` always remains the instant local cache, so the game never
blocks on the network and works fully offline. Identity is a random UUID
kept in `localStorage` (shown as DEFENDER ID on the main menu, along with a
live sync-status badge).

```bash
npx prisma db push   # create/migrate db/game.db after cloning
```

## Google Analytics

The standalone website build ships a full **GA4** telemetry pipeline
(`lib/analytics.ts`). It stays completely dark (no script, no events) until a
measurement ID is configured, and it never loads inside the YouTube Playables
iframe (no third-party network calls allowed there).

**Enable it** — set the env var before build/serve and restart:

```bash
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-AB12CD34EF npm run dev     # or your prod launcher
```

(Or edit `FALLBACK_ID` in `lib/analytics.ts`.)

**Event taxonomy** (snake_case, GA4 limits enforced by the sanitizer):

| Event | Params | Fires |
| --- | --- | --- |
| `game_start` | `game_mode`, `first_run` | every run start |
| `wave_start` | `wave`, `era_number`, `era_name`, `game_mode` | every wave setup (deduped) |
| `wave_complete` | + `kills`, `cash_earned`, `score` | wave cleared |
| `wave_fail` | `wave`, `era_number`, `game_mode` | run ended mid-wave |
| `era_start` | `era_number`, `era_name`, `game_mode`, `wave` | era entered |
| `era_complete` | `era_number`, `era_name`, `game_mode` | era cleared |
| `boss_spawn` / `boss_defeated` | `boss_name`, `era_number`, `wave`, `game_mode` | boss lifecycle |
| `game_over` | `score`, `wave_reached`, `era_*`, `kills`, `bosses_defeated`, `best_streak`, `run_duration_s`, `gems_earned`, `cash_earned`, `game_mode`, `new_high_score` | full run report |
| `story_complete` | `pages_viewed`, `skipped`, `total_pages` | first-contact cinematic funnel |
| `revive` | `method` (ad/gems), `wave`, `gems_spent` | continues |
| `rewarded_ad` | `placement`, `earned` | every sponsored-ad placement |
| `purchase` | `item`, `cost`, `currency`, `surface`, `level` | every shop/intermission spend |
| `pwa_install` | `accepted` | install prompt outcome |

`page_view`, `session_start` and `first_visit` arrive automatically from the
gtag `config` call. Debug tip: inspect `window.dataLayer` in the console —
every event lands there even before the network flush.

## YouTube Playables integration

The game is wired for [YouTube Playables](https://developers.google.com/youtube/gaming/playables):

- SDK loaded as the **literal first `<script>` of `<head>`** — injected by
  `server.mjs`, the custom runtime-adaptive server (Bun-native fast paths,
  Node fallback) that wraps the Next.js handler and rewrites every HTML
  response. (`next/script beforeInteractive` proved
  insufficient: Next serializes its own chunk scripts before any
  layout-rendered head child, which fails the SDK Test Suite MUST check
  "SDK loaded before any game code")
- `lib/ytplayables.ts` — a fully typed, always-safe wrapper
  (`types/ytgame.d.ts`); every call no-ops outside YouTube so local dev and
  the standalone site are unaffected
- Required lifecycle: `firstFrameReady()` → `gameReady()` handshake,
  `onPause` (flush cloud save + pause) / `onResume`, `isAudioEnabled()` +
  `onAudioEnabledChange` (audio follows the user's YouTube settings)
- Monetization: **rewarded ads** power the “watch ad → continue” revive
  (`requestRewardedAd('revive-continue-run')`); an **interstitial** plays at
  the natural Game-Over → Play-Again breakpoint. The simulated ad flows
  remain as fallbacks on the standalone site
- Engagement: `sendScore()` reports the live run score as an integer after
  **every wave clear and every game over** (YouTube keeps the best value —
  this cadence satisfies the SDK Test Suite); `health.logError()` reports
  window errors

## 3D renderer

The battlefield is rendered in true 3D with **Three.js** (`lib/three/`), while the
proven 2D simulation in `lib/gameEngine.ts` keeps running unchanged — same
physics, AI, waves, economy and logical coordinate space. Only the paint layer
was replaced:

- `lib/three/world.ts` — scene, tilted perspective camera (auto-fitted to any
  aspect), era-reactive lighting/fog, entity pools, particle system, starfield,
  citadel + shield dome, danger telegraphs, and a crisp 2D overlay for floating
  combat text and the aim crosshair.
- `lib/three/enemyMeshes.ts` — procedural meshes for every hostile family
  (rocky bodies, drones, munitions, alien cruisers, era bosses with visible
  alien pilots), goodies, projectiles and the turret. No model assets: the
  bundle stays tiny and the PWA/offline story is untouched.
- `lib/three/engine3d.ts` — `GameEngine3D` swaps `render()` for the 3D world
  sync; the simulation loop, adaptive quality governor and callbacks are the
  original engine's.
- `components/GameCanvas.tsx` — WebGL canvas + overlay canvas + input. Pointing
  is perspective-exact: the pointer is ray-cast onto the gameplay plane, so the
  crosshair covers exactly what the simulation targets.

Mapping contract (kept exact so aim/hit-tests stay fair): `world.x = logical.x −
L_WIDTH/2`, `world.z = L_HEIGHT/2 − logical.y`, entities live on the gameplay
plane `y = 42`. Controls, HUD and all meta systems are unchanged.

## Development

The custom server (`server.mjs`) is **runtime-adaptive and fully async**: it
runs on Node, but is tuned Bun-first because the production backend is Bun —
`Bun.file()` for static reads (async, zero-copy) and `Bun.gzipSync()` for
compression under Bun, promisified async `node:zlib` (gzip + brotli) under
Node. The HTTP listener uses `node:http`'s `createServer` on purpose: it is
the only bridge that can host Next.js's `(req, res)` request handler, and
under Bun it is Bun's own native HTTP implementation (no Node runtime is
engaged).

```bash
bun install            # or: npm install
bun run setup          # prisma generate + db push (creates db/game.db)
bun run dev            # node server.mjs (dev mode, SDK injected first)
bun run dev:bun        # bun server.mjs — the recommended dev backend
bun run build          # production build
bun run start          # node server.mjs (production mode)
bun run start:bun      # bun server.mjs — the recommended prod backend
bun run start:pboss    # pboss start pboss.config.js
bun run lint           # eslint
```

> **Self-healing production start:** if `.next/BUILD_ID` is missing when the
> production server boots (fresh clone, `git pull`, or a `next dev` run that
> clobbered the build artifacts), `server.mjs` detects it **before** touching
> Next.js and runs `next build` itself — once, guarded by a single-flight lock
> so pboss cluster workers never race each other — then starts normally.
> The runtime picked for the compile is `node` when installed (battle-tested)
> and falls back to `bun` on pure-Bun machines. Opt out with
> `GAIA_SKIP_AUTOBUILD=1` for a hard error instead.
>
> **SDK Test Suite:** always point the Playables SDK Test Suite at the
> **production** server (`bun run build && bun run start:bun`). The dev server
> compiles on demand and easily exceeds the “gameReady within 5 seconds”
> SHOULD check.

## Production deployment with ProcBoss (pboss)

The repo ships an ecosystem file for [ProcBoss (pboss)](https://github.com/Procboss/pboss) —
a blazing-fast process manager built on Bun native APIs (universal runtimes,
cluster mode, health checks, log rotation, a web dashboard, Prometheus
metrics). It boots the game with the **Bun interpreter**, keeps it alive with
health checks against the root HTML route (which also exercises the SDK
injection path), auto-restarts on crash with a 512MB OOM guard, and rotates
+gzips logs.

```bash
# 1. Install Bun (https://bun.sh) and pboss
curl -fsSL https://bun.sh/install | bash
bun add -g pboss              # or: curl -fsSL https://procboss.com/install.sh | bash

# 2. One-time project setup
bun install
bun run setup                 # prisma generate + db push (creates db/game.db)

# 3. Start under pboss (production mode; server.mjs auto-builds if needed)
bun run start:pboss           # = pboss start pboss.config.js

# Everyday operations
pboss list                    # status table (CPU / memory / uptime)
pboss logs gaia-frontier      # tail the server logs
pboss restart gaia-frontier   # rolling restart
pboss stop gaia-frontier      # graceful stop
pboss dash                    # live web dashboard
```

The ecosystem file (`pboss.config.js`) pins `NODE_ENV=production` and the
`.env` `PORT` (33400 — the same upstream your nginx conf proxies to), probes
the root HTML route every 30s (which also exercises the SDK injection path
end-to-end), and auto-restarts on crash. Because the production server is
self-healing, a plain `pboss restart gaia-frontier` after a `git pull` is
enough — the first worker to boot compiles the fresh code, the others wait on
the single-flight lock and follow. Real secrets (`GEMINI_API_KEY`, `APP_URL`,
`EARTH_DEFENDER_DB`) belong in `.env` (see `.env.example`); the ecosystem file
only pins runtime-critical values (`NODE_ENV`, `PORT`).

> **Deploy order matters after big pulls:** `pboss restart` SIGTERMs workers
> gracefully (a mid-build restart kills its own `next build` child and drops
> the lock cleanly), but the safest cadence is still
> `bun run build && pboss restart gaia-frontier` so players never wait on a
> compile.

## Project structure

```
app/            Next.js app shell (page.tsx orchestrates the game session)
app/api/sync/         Player progress sync API (pull/push, LWW)
app/api/leaderboard/  Global rankings by best score
components/     HUD + all modal UI (Shop, Battle Pass, Cosmetics, ...)
lib/gameEngine.ts     Canvas game loop, physics, waves, bosses, combat
lib/enemyRenderer.ts  Procedural canvas art for every threat archetype
lib/audio.ts          Web Audio SFX + sample-based soundtrack (Opus loops, era-keyed)
public/music/         7 remastered soundtrack loops (~2 MB Opus + AAC fallback)
scripts/build-music.py  Soundtrack builder: loop extraction + tiny encoding
lib/eras.ts           Era definitions and threat rosters
lib/bossData.ts       Era boss configs with alien pilots
lib/skins.ts          Shared cosmetic skin registry (UI + engine)
lib/storage.ts        localStorage persistence + economy constants
lib/cloudSync.ts      Cross-platform cloud save client (YT SDK / HTTP backend)
lib/ytplayables.ts    YouTube Playables SDK wrapper (safe no-op outside YT)
lib/db.ts             Prisma client singleton (server)
prisma/schema.prisma  Player table for the progress backend
types/ytgame.d.ts     TypeScript definitions for the global `ytgame` SDK
server.mjs            Runtime-adaptive custom server (Bun-native / Node)
ecosystem.config.ts   ProcBoss (pboss) process ecosystem for Bun deployment
```

## Known limitations

The online counter and gem "purchases" remain cosmetic placeholders; the
"watch ad" bonus is a simulated progress bar on the standalone site (a real
rewarded ad inside YouTube Playables). Submitting to YouTube Playables also
requires packaging the game as a static zip via `next export`-style output —
the dev server setup here targets development and the hosted website build.
