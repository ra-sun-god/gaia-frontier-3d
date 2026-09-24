/**
 * Gaia Frontier: After Contact — runtime-adaptive server (Bun-native).
 *
 * Runs on BOTH runtimes, but is tuned Bun-first because the production
 * backend is Bun:
 *   bun server.mjs    ← recommended (all Bun-native fast paths active)
 *   node server.mjs   ← fully supported fallback (async node:zlib)
 *
 * WHY THIS EXISTS:
 *   YouTube Playables certification requires the SDK script
 *   (<script src="https://www.youtube.com/game_api/v1"></script>) to load
 *   BEFORE ANY game code. Next.js always serializes its own bootstrap chunk
 *   scripts (main-app.js, app-pages-internals.js, app/page.js ...) before any
 *   layout-rendered <head> child, and `next/script strategy="beforeInteractive"`
 *   only *preloads* the SDK and injects it from the body bootstrap — game code
 *   still executes first. The only way to win is to rewrite the HTML stream:
 *   this server injects the SDK tag as the literal FIRST element of <head>,
 *   parser-blocking, so the browser downloads & executes it before it has even
 *   discovered Next's chunk scripts (guaranteed order under every
 *   interpretation: DOM tag order, execution order, resource timing).
 *
 * WHAT IT DOES:
 *   - Buffers HTML-route responses, injects the SDK tag right after <head>
 *     (preceded only by a <link rel="preconnect"> hint, which is not script
 *     code and therefore does not affect the "SDK loaded before any game code"
 *     check — the SDK test suite inspects the FIRST <script> element only),
 *     then flushes.
 *   - Compresses responses (brotli > gzip where available) for clients that
 *     advertise Accept-Encoding. This is critical for the SDK test suite's
 *     "gameReady called within 5 seconds" SHOULD check: next.config.ts sets
 *     `compress: false` so this layer sees plain bytes, and the external
 *     proxy does NOT re-compress — without this layer every client downloads
 *     the full ~200 kB HTML+JS+CSS uncompressed. It also shrinks the
 *     transferSize the suite sums for the "Initial bundle < 30 MiB" check.
 *   - Non-HTML responses stream through untouched unless compressible.
 *   - Works in dev AND production (`NODE_ENV` selects the mode) so the served
 *     document is byte-identical in shape to what the Playables QA sees.
 *
 * SELF-HEALING PRODUCTION START (the "I built it, why is it missing?" guard):
 *   `next dev` clobbers `.next/` (BUILD_ID is a production-only artifact),
 *   fresh clones/pulls have no `.next/` at all, and a build from another
 *   directory never lands here. So in production mode the server verifies
 *   `.next/BUILD_ID` BEFORE touching Next.js — and if it is missing it runs
 *   `next build` itself (once, guarded by a single-flight lock so pboss
 *   cluster workers never race), then continues. Opt out with
 *   GAIA_SKIP_AUTOBUILD=1 to get the old hard error instead.
 *
 * BUN ADAPTATION LAYER (async everywhere, zero event-loop blocking):
 *   • Compression  — Bun.gzipSync() behind an async fn (Bun's native zlib
 *                    binding; there is no brotli compress API in Bun, so we
 *                    negotiate gzip only under Bun). Under Node: promisified
 *                    zlib.gzip / zlib.brotliCompress — the old
 *                    brotliCompressSync/gzipSync blocked the event loop.
 *   • Static files — Bun.file() + arrayBuffer() (async, zero-copy) under Bun;
 *                    node:fs/promises readFile under Node.
 *   • HTTP listen  — node:http createServer is the ONE Node API kept on
 *                    purpose: it is the only bridge that can host Next.js's
 *                    (req, res) request handler, and under Bun it is Bun's
 *                    own native HTTP implementation (Bun implements node:http
 *                    in Zig) — no Node runtime is actually engaged.
 *
 * next.config.ts sets `compress: false` so this layer always sees plain text
 * (Next's built-in gzip would otherwise hand us already-compressed bytes).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import next from 'next';

const isBun = typeof globalThis.Bun !== 'undefined';

// Directory that CONTAINS server.mjs — cwd-independent (pboss / cluster
// launchers may start the process from anywhere; the build check and Next's
// `dir` must always resolve to the real app root).
const appRoot = isBun ? import.meta.dir : fileURLToPath(new URL('.', import.meta.url));

/**
 * Minimal async .env loader for the Node runtime. Bun autoloads `.env`
 * natively; without this, `node server.mjs` would miss PORT/DB config and
 * drift from the Bun behaviour. Real environment variables always win —
 * `.env` only fills the gaps (pboss-injected env included).
 */
async function loadDotEnv(path) {
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(path, 'utf8');
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no .env in this deployment — environment-only config is fine */
  }
}

if (!isBun) await loadDotEnv(`${appRoot}/.env`);

const dev = process.env.NODE_ENV !== 'production';
const port = Number.parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.HOSTNAME || '0.0.0.0';

// Preconnect warms DNS+TCP+TLS to the SDK origin while the parser is still
// chewing on our markup — the SDK fetch itself starts that much sooner.
// NOT a script element, so the firstFrameReady SDK-order check is unaffected.
const HEAD_HINTS =
  '<link rel="preconnect" href="https://www.youtube.com">' +
  '<script src="https://www.youtube.com/game_api/v1"></script>';

/** Content types worth compressing (everything this app serves of note). */
const COMPRESSIBLE_TYPES = [
  'text/html',
  'text/css',
  'text/plain',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/json',
  'image/svg+xml',
];

/** Below this size compression costs more than it saves. */
const MIN_COMPRESS_BYTES = 1024;

// ---------------------------------------------------------------------------
// Async compression backends — selected once at boot, never block the loop.
// ---------------------------------------------------------------------------
/** @type {null | ((buf: Uint8Array) => Promise<Uint8Array>)} */
let compressBrotli = null;
/** @type {(buf: Uint8Array) => Promise<Uint8Array>} */
let compressGzip;

if (isBun) {
  // Bun's native zlib binding (sub-millisecond for typical bodies). Bun does
  // not expose brotli *compression*, so under Bun we negotiate gzip only —
  // still comfortably inside the Playables 5-second gameReady budget.
  compressGzip = async (buf) => Bun.gzipSync(buf);
} else {
  // Node path: fully async zlib (the sync variants stalled concurrent requests).
  const { promisify } = await import('node:util');
  const zlib = await import('node:zlib');
  const gzipP = promisify(zlib.gzip);
  const brotliP = promisify(zlib.brotliCompress);
  compressGzip = async (buf) => gzipP(buf, { level: 6 });
  compressBrotli = async (buf) =>
    brotliP(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
}

// ---------------------------------------------------------------------------
// Async static file reads — Bun.file() is zero-copy under Bun.
// ---------------------------------------------------------------------------
const HARNESS_URL = new URL('./public/yt-iframe-harness.html', import.meta.url);
/** @type {() => Promise<Uint8Array | Buffer>} */
const readHarnessFile = isBun
  ? async () => new Uint8Array(await Bun.file(HARNESS_URL).arrayBuffer())
  : (await import('node:fs/promises')).readFile.bind(null, HARNESS_URL);

function isCompressible(res) {
  const ct = String(res.getHeader('Content-Type') || '').split(';')[0].trim().toLowerCase();
  return COMPRESSIBLE_TYPES.includes(ct);
}

function pickEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '');
  // Brotli: ~20% smaller than gzip for JS (only offered when the runtime can).
  if (compressBrotli && accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

/** HTML-shaped routes: no file extension, not a Next internal path. */
function isHtmlRoute(req) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    if (p.startsWith('/_next/') || p.startsWith('/favicon')) return false;
    return !/\.[a-zA-Z0-9]+(?:$|\?)/.test(p);
  } catch {
    return true; // worst case: buffer a route we didn't recognize
  }
}

const app = next({ dev, hostname, port, dir: appRoot });
const handle = app.getRequestHandler();

// ---------------------------------------------------------------------------
// Production preflight — self-healing build check (see header comment).
// ---------------------------------------------------------------------------
const BUILD_ID = `${appRoot}/.next/BUILD_ID`;
const BUILD_LOCK = `${appRoot}/.next/.prod-build.lock`;
const BUILD_TIMEOUT_MS = 20 * 60 * 1000; // winner: generous compile budget
const STALE_LOCK_MS = 10 * 60 * 1000; // crash leftovers get stolen after this
const POLL_MS = 2000;

/** Async existence probe (Bun.file().exists() / fs.access). */
async function fileExists(path) {
  if (isBun) return Bun.file(path).exists();
  const { access } = await import('node:fs/promises');
  return access(path)
    .then(() => true)
    .catch(() => false);
}

/** True when the `node` binary is on PATH — Next's build is battle-tested
 *  under Node; pure-Bun builds work too, but Node wins whenever it exists. */
async function hasNodeRuntime() {
  return new Promise((resolve) => {
    const probe = spawn('node', ['--version'], { stdio: 'ignore' });
    probe.once('error', () => resolve(false));
    probe.once('exit', () => resolve(true));
  });
}

/** Runs `next build` exactly once across ALL workers (single-flight lock),
 *  or waits for a sibling worker that already won the lock. */
async function ensureProductionBuild() {
  const { mkdir, open, rm, stat } = await import('node:fs/promises');
  await mkdir(`${appRoot}/.next`, { recursive: true });

  let lock = null;
  try {
    lock = await open(BUILD_LOCK, 'wx'); // atomic O_EXCL — one winner
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // A previous builder crashed mid-build — steal its lock after a grace period.
    try {
      const age = Date.now() - (await stat(BUILD_LOCK)).mtimeMs;
      if (age > STALE_LOCK_MS) {
        await rm(BUILD_LOCK, { force: true });
        lock = await open(BUILD_LOCK, 'wx');
      }
    } catch {
      /* raced away under us — fall through to the waiting path */
    }
  }

  if (!lock) {
    // A sibling (pboss cluster worker) is building — poll for its BUILD_ID.
    const deadline = Date.now() + BUILD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((sleep) => setTimeout(sleep, POLL_MS));
      if (await fileExists(BUILD_ID)) return;
    }
    throw new Error('Timed out waiting for a parallel production build to finish.');
  }

  try {
    console.warn('\n[server.mjs] No production build found (.next/BUILD_ID missing).');
    console.warn('[server.mjs] Auto-running `next build` — this happens once after a fresh clone/pull,');
    console.warn('[server.mjs] or when `next dev` overwrote the production artifacts.\n');

    const runtime = isBun
      ? (await hasNodeRuntime())
        ? 'node' // prefer Node for the compile when it exists
        : process.execPath // pure-Bun machine — bun runs the next CLI fine
      : process.execPath;
    const nextBin = `${appRoot}/node_modules/next/dist/bin/next`;
    const child = spawn(runtime, [nextBin, 'build'], {
      cwd: appRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    });

    // If pboss (or an operator) SIGTERMs us mid-build: kill the builder too
    // and drop the lock, so the next start rebuilds instead of waiting out
    // the 10-minute stale-lock grace period. Handlers are removed on success.
    const onSignal = () => {
      try {
        child.kill('SIGTERM');
      } catch {}
      rm(BUILD_LOCK, { force: true })
        .catch(() => {})
        .finally(() => process.exit(1));
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);

    const code = await new Promise((resolve) => {
      child.once('error', (err) => {
        console.error(`[server.mjs] could not spawn the builder (${runtime}):`, err.message);
        resolve(1);
      });
      child.once('exit', (c) => resolve(c ?? 1));
    });
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);

    if (code !== 0 || !(await fileExists(BUILD_ID))) {
      throw new Error('`next build` failed — the compiler errors are printed above.');
    }
    console.warn('\n[server.mjs] Production build ready — starting the server.\n');
  } finally {
    await lock.close().catch(() => {});
    await rm(BUILD_LOCK, { force: true }).catch(() => {});
  }
}

if (dev) {
  // Dev mode compiles on demand — no preflight needed.
} else if (await fileExists(BUILD_ID)) {
  // Production build already present — normal fast start.
} else if (process.env.GAIA_SKIP_AUTOBUILD === '1') {
  console.error('[server.mjs] No production build (.next/BUILD_ID missing) and GAIA_SKIP_AUTOBUILD=1.');
  console.error('[server.mjs] Run `bun run build` (or `npm run build`) and start again.');
  process.exit(1);
} else {
  await ensureProductionBuild();
}

await app.prepare();

createServer((req, res) => {
  // DEV harness page (public/ isn't served by `next start` under the
  // standalone output config) — simulates the Playables Test Suite hosting.
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/yt-iframe-harness.html') {
    readHarnessFile()
      .then((buf) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buf);
      })
      .catch(() => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      });
    return;
  }

  const htmlRoute = req.method !== 'HEAD' && isHtmlRoute(req);

  // Cases we must never touch: range requests (byte offsets assume identity),
  // and clients with no gzip/brotli support.
  const rangeRequest = req.headers.range !== undefined;

  const chunks = [];
  const origWrite = res.write;
  const origEnd = res.end;

  const toBuf = (c) => (typeof c === 'string' ? Buffer.from(c, 'utf8') : c);
  const flushAll = () => {
    if (chunks.length) origWrite.call(res, Buffer.concat(chunks.map(toBuf)));
  };

  res.write = function patchedWrite(chunk) {
    if (chunk != null && chunk.length) chunks.push(chunk);
    return true; // pretend backpressure is fine; we flush on end
  };

  /**
   * Async finalizer: HTML rewrite + compression happen OFF the synchronous
   * end() call so one slow compress can never stall other in-flight requests
   * (the old sync brotli/gzip did exactly that under load).
   */
  const finalize = async () => {
    try {
      // If headers somehow went out before us (streaming already started),
      // degrade to a plain passthrough flush.
      if (res.headersSent) {
        flushAll();
        origEnd.call(res);
        return;
      }

      const body = Buffer.concat(chunks.map(toBuf));
      const ct = String(res.getHeader('Content-Type') || '');
      const first = body.length ? body.slice(0, 32).toString('utf8') : '';
      const looksHtml =
        ct.includes('text/html') || first.startsWith('<!DOCTYPE') || first.startsWith('<html');
      const rewriteHtml = htmlRoute && looksHtml;

      let finalBody = body;

      if (rewriteHtml) {
        let html = body.toString('utf8');
        // Safety: if any SDK tag already exists downstream, strip it first so
        // the SDK can never load twice.
        if (html.includes('game_api/v1')) {
          html = html.replace(/<script[^>]*game_api\/v1[^>]*>\s*<\/script>/gi, '');
        }
        if (/<head[^>]*>/.test(html)) {
          html = html.replace(/<head[^>]*>/, (m) => `${m}${HEAD_HINTS}`);
        }
        finalBody = Buffer.from(html, 'utf8');
      }

      // Compression — applied AFTER the SDK injection so the injected bytes
      // are part of the compressed stream. Only for compressible types, big
      // enough bodies, no Range header, no existing Content-Encoding.
      let bodyChanged = rewriteHtml;
      const canCompress =
        !rangeRequest &&
        finalBody.length >= MIN_COMPRESS_BYTES &&
        (rewriteHtml || isCompressible(res)) &&
        res.getHeader('Content-Encoding') === undefined &&
        res.statusCode !== 204 &&
        res.statusCode !== 304;

      if (canCompress) {
        const encoding = pickEncoding(req);
        if (encoding) {
          const compressed = await (encoding === 'br' ? compressBrotli : compressGzip)(finalBody);
          // Only use it when it actually helps (already-tiny/minified edge cases).
          if (compressed && compressed.length < finalBody.length) {
            finalBody = Buffer.isBuffer(compressed) ? compressed : Buffer.from(compressed);
            bodyChanged = true;
            res.setHeader('Content-Encoding', encoding);
            // Correct cache keying when representations differ by encoding.
            const vary = String(res.getHeader('Vary') || '');
            if (!vary.toLowerCase().includes('accept-encoding')) {
              res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
            }
          }
        }
      }

      if (bodyChanged) {
        res.setHeader('Content-Length', String(finalBody.length));
      }

      origWrite.call(res, finalBody);
      origEnd.call(res);
    } catch (err) {
      // The patch must never kill a response — degrade to a plain flush.
      console.error('[server.mjs] rewrite failed:', err);
      try {
        flushAll();
      } catch {}
      origEnd.call(res);
    }
  };

  res.end = function patchedEnd(chunk) {
    if (chunk != null && chunk.length) chunks.push(chunk);
    // Fire-and-forget async flush — origEnd is invoked when the pipeline
    // completes; nothing after end() may write, so ordering is safe.
    void finalize();
    return res;
  };

  handle(req, res).catch((err) => {
    console.error('[server.mjs] request error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    res.end('Internal Server Error');
  });
}).listen(port, () => {
  console.log(
    `> Gaia Frontier: After Contact ready on http://${hostname}:${port} (${dev ? 'dev' : 'production'}, ${isBun ? 'bun-native' : 'node'})` +
      ' — YouTube Playables SDK injected as the first <head> script + async brotli/gzip enabled'
  );
});
