import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Global leaderboard (standalone web build).
 *
 * GET /api/leaderboard?playerId=<uuid>
 *   → top 25 commanders by best score, plus the requesting player's own
 *     rank even when outside the top 25.
 *
 * Ranks by highScore (the same dimension YouTube sees via
 * ytgame.engagement.sendScore inside Playables), so in-game boards and
 * platform boards always agree.
 */

const TOP_LIMIT = 25;

const PLAYER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('playerId');

    const top = await db.player.findMany({
      where: { bestScore: { gt: 0 } },
      orderBy: [{ bestScore: 'desc' }, { savedAt: 'asc' }],
      take: TOP_LIMIT,
      select: {
        id: true,
        name: true,
        bestScore: true,
        highestWave: true,
        updatedAt: true,
      },
    });

    const entries = top.map((p, i) => ({
      rank: i + 1,
      name: p.name,
      bestScore: p.bestScore,
      highestWave: p.highestWave,
      isPlayer: playerId ? p.id === playerId : false,
    }));

    let you: { rank: number; name: string; bestScore: number; highestWave: number } | null = null;
    if (playerId && PLAYER_ID_RE.test(playerId)) {
      const mine = await db.player.findUnique({
        where: { id: playerId },
        select: { name: true, bestScore: true, highestWave: true },
      });
      if (mine && !entries.some((e) => e.isPlayer)) {
        // Compute the player's absolute rank when they're outside the top list
        const ahead = await db.player.count({
          where: { bestScore: { gt: mine.bestScore } },
        });
        you = {
          rank: ahead + 1,
          name: mine.name,
          bestScore: mine.bestScore,
          highestWave: mine.highestWave,
        };
      }
    }

    return NextResponse.json({ ok: true, entries, you });
  } catch (error) {
    console.error('[api/leaderboard] GET failed', error);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}
