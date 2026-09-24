//import dotenv from "dotenv";

//dotenv.config();

const env = process.env ?? {};


// One port everywhere: .env PORT === package.json start === nginx upstream.
// (Was `env.port` — lowercase never set, so the health probe pointed at :3000
// while the app listened on the .env PORT. Fixed.)
const PORT = env.PORT || 33400;



const gaiaFrontier = {

  name: 'gaia-frontier',
  // Bun-native custom server: SDK-first <head> injection + async brotli/gzip.
  // `bun server.mjs` engages every Bun fast path (Bun.file, Bun.gzipSync).
  script: './server.mjs',
  instances: 1,
  execMode: "fork",
  env: {
    ...env,
    NODE_ENV: "production",
    PORT,
  },
  autorestart: true,

 // maxRestarts: 16,
 // minUptime: 4000, // ms stable before a crash counts as "unstable"
 // maxMemoryRestart: '1G', // OOM guard — the game server is ~120-180MB
 // killTimeout: 8000, // graceful shutdown window (in-flight syncs finish)

  // --- Health ---------------------------------------------------------------
  // Probing the root HTML route also verifies the Playables SDK injection
  // path end-to-end on every check (30s cadence, 3 fails → restart).
  healthCheckUrl: `http://localhost:${PORT}/`,
  healthCheckInterval: 30000,
  healthCheckTimeout: 5000,
  healthCheckMaxFails: 3,

  // Watch: OFF in every mode — the Next dev server hot-reloads itself, and a
  // production build is immutable by design (rebuild + `pboss restart`).
  watch: false,
  ignoreWatch: ['node_modules', '.git', '.pboss', '.next', 'db'],
};

const ecosystem = { apps: [gaiaFrontier] };

export default ecosystem;
