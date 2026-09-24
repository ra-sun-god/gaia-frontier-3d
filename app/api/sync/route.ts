import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Player progress sync API (standalone web build).
 *
 * GET  /api/sync?playerId=<uuid>  → pull the latest cloud save
 * POST /api/sync                  → push a save (last-write-wins by savedAt)
 *
 * The POST body is the same save envelope the game keeps in localStorage:
 * { playerId, data: { v, profile, challenges }, savedAt, summary: {...} }
 *
 * Conflict policy: if the incoming save is OLDER than the stored one, the
 * server rejects it and returns the newer server copy so the client can
 * reconcile instead of silently overwriting progress made on another device.
 *
 * When the game runs inside YouTube Playables, progress is synced through
 * ytgame.game.saveData() instead (YouTube CSP blocks cross-origin fetches),
 * so this endpoint only serves the standalone website build.
 */

// Same order of magnitude as YouTube Playables' 3 MiB saveData limit, but far
// above anything this game actually produces (~10 KB) — generous headroom.
const MAX_DATA_CHARS = 256 * 1024;
const MAX_NAME_CHARS = 24;

const PLAYER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

function isValidPlayerId(id: unknown): id is string {
  return typeof id === 'string' && PLAYER_ID_RE.test(id);
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_CHARS);
  return cleaned.length > 0 ? cleaned : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('playerId');
    if (!isValidPlayerId(playerId)) {
      return NextResponse.json({ ok: false, error: 'invalid playerId' }, { status: 400 });
    }

    const player = await db.player.findUnique({
      where: { id: playerId },
      select: { data: true, savedAt: true, revision: true },
    });

    if (!player) {
      // Not an error: first launch on this device / fresh cloud save.
      return NextResponse.json({ ok: true, found: false });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      data: player.data,
      savedAt: Number(player.savedAt),
      revision: player.revision,
    });
  } catch (error) {
    console.error('[api/sync] GET failed', error);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
    }

    const { playerId, data, savedAt } = body as {
      playerId?: unknown;
      data?: unknown;
      savedAt?: unknown;
    };

    if (!isValidPlayerId(playerId)) {
      return NextResponse.json({ ok: false, error: 'invalid playerId' }, { status: 400 });
    }
    if (typeof data !== 'string' || data.length === 0 || data.length > MAX_DATA_CHARS) {
      return NextResponse.json({ ok: false, error: 'invalid data payload' }, { status: 400 });
    }
    // Reject garbage envelopes early so the DB never stores unusable saves.
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return NextResponse.json({ ok: false, error: 'data must be JSON' }, { status: 400 });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: 'data must be an object' }, { status: 400 });
    }
    const envelope = parsed as { profile?: Record<string, unknown> };
    if (!envelope.profile || typeof envelope.profile !== 'object') {
      return NextResponse.json({ ok: false, error: 'data.profile missing' }, { status: 400 });
    }

    const now = Date.now();
    const clientSavedAt =
      typeof savedAt === 'number' && Number.isFinite(savedAt)
        ? Math.max(0, Math.min(now + 5 * 60_000, Math.floor(savedAt)))
        : now;

    const summary = (body.summary ?? {}) as Record<string, unknown>;
    const profile = envelope.profile;

    const existing = await db.player.findUnique({
      where: { id: playerId },
      select: { savedAt: true, revision: true, data: true },
    });

    // Last-write-wins: a late push from a stale device must NOT clobber newer
    // progress. Return the newer server copy so the client can reconcile.
    if (existing && clientSavedAt < Number(existing.savedAt)) {
      return NextResponse.json({
        ok: true,
        status: 'stale',
        server: {
          data: existing.data,
          savedAt: Number(existing.savedAt),
          revision: existing.revision,
        },
      });
    }

    const fallbackName = `Commander-${playerId.slice(0, 4).toUpperCase()}`;
    const name = sanitizeName(body.name ?? summary.name, fallbackName);

    const player = await db.player.upsert({
      where: { id: playerId },
      create: {
        id: playerId,
        name,
        data,
        bestScore: clampInt(profile.highScore, 0, 2_000_000_000, 0),
        cash: clampInt(profile.cash, 0, 2_000_000_000, 0),
        gems: clampInt(profile.gems, 0, 2_000_000_000, 0),
        highestWave: clampInt(profile.highestWave, 0, 100_000, 0),
        savedAt: BigInt(clientSavedAt),
        revision: 1,
      },
      update: {
        name,
        data,
        bestScore: clampInt(profile.highScore, 0, 2_000_000_000, 0),
        cash: clampInt(profile.cash, 0, 2_000_000_000, 0),
        gems: clampInt(profile.gems, 0, 2_000_000_000, 0),
        highestWave: clampInt(profile.highestWave, 0, 100_000, 0),
        savedAt: BigInt(clientSavedAt),
        revision: { increment: 1 },
      },
      select: { revision: true, savedAt: true },
    });

    return NextResponse.json({
      ok: true,
      status: 'saved',
      savedAt: Number(player.savedAt),
      revision: player.revision,
    });
  } catch (error) {
    console.error('[api/sync] POST failed', error);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}
