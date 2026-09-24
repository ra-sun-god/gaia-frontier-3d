'use client';

import React, { useEffect, useState } from 'react';
import { PlayerProfile } from '@/lib/types';
import { sound } from '@/lib/audio';
import { X, Info } from 'lucide-react';
import { ModalDock } from './ModalDock';

interface LeaderboardModalProps {
  profile: PlayerProfile;
  /** Cloud player UUID — highlights your own row and computes your rank. */
  playerId: string;
  onClose: () => void;
}

interface LeaderEntry {
  rank: number;
  name: string;
  bestScore: number;
  highestWave: number;
  isPlayer?: boolean;
}

/** Avatar pool — deterministic pick per entry so rows keep stable faces. */
const AVATARS = ['👨‍🚀', '🤖', '🥷', '🐻', '🤠', '👾', '🦊', '🐲', '🦾', '🌟'];

function avatarFor(entry: LeaderEntry): string {
  if (entry.isPlayer) return '👨‍🚀';
  const seed = entry.name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATARS[seed % (AVATARS.length - 1)] || '🤖';
}

function formatScore(value: number): string {
  return value.toLocaleString('en-US');
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  profile,
  playerId,
  onClose,
}) => {
  const [showInfo, setShowInfo] = useState(false);
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Pull the global leaderboard from the game backend. When the server is
  // unreachable (offline play / YouTube Playables build where cross-origin
  // fetches are CSP-blocked) we fall back to the showcase list so the modal
  // never shows an empty screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
        const res = await fetch(`/api/leaderboard${qs}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`leaderboard ${res.status}`);
        const json = (await res.json()) as {
          ok: boolean;
          entries?: LeaderEntry[];
          you?: Omit<LeaderEntry, 'rank'> & { rank: number } | null;
        };
        if (!json.ok || !Array.isArray(json.entries)) throw new Error('bad payload');
        const list = [...json.entries];
        if (json.you) list.push({ ...json.you, isPlayer: true });
        if (!cancelled) setEntries(list.length > 0 ? list : null);
      } catch {
        if (!cancelled) setEntries(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  // Showcase fallback (offline / no synced players yet)
  const fallbackCommanders: LeaderEntry[] = [
    { rank: 1, name: 'StarNovaX', bestScore: 63900, highestWave: 12 },
    { rank: 2, name: 'AstroFury', bestScore: 55200, highestWave: 11 },
    { rank: 3, name: 'VoidHunter', bestScore: 54300, highestWave: 10 },
    { rank: 4, name: 'GalaxyKing', bestScore: 43100, highestWave: 9 },
    {
      rank: 5,
      name: 'COMMANDER (You)',
      bestScore: Math.max(1200, profile.highScore),
      highestWave: profile.highestWave,
      isPlayer: true,
    },
    { rank: 6, name: 'CosmoKnight', bestScore: 31000, highestWave: 8 },
  ];

  const rows: LeaderEntry[] = entries ?? fallbackCommanders;

  const renderRow = (c: LeaderEntry) => {
    // EXACT #1 CARD FROM INSPIRATION IMAGE:
    // Mint-Cyan Gradient Card with Ribbon 1, Golden Avatar Border
    if (c.rank === 1) {
      return (
        <div
          key={`${c.rank}-${c.name}`}
          className="card-leaderboard-top p-2 sm:p-2.5 flex items-center justify-between transition active:scale-[0.99]"
        >
          <div className="flex items-center gap-2">
            {/* Golden Ribbon Medal #1 */}
            <div className="w-7 h-7 medal-ribbon-gold flex items-center justify-center text-sm shrink-0">
              1
            </div>

            {/* Avatar with Golden Square Border */}
            <div className="w-10 h-10 avatar-border-gold flex items-center justify-center text-xl shrink-0">
              {avatarFor(c)}
            </div>

            {/* Commander Name */}
            <div className="flex flex-col text-left">
              <span className="text-sm font-black text-[#0B3A30] uppercase tracking-wider leading-tight">
                {c.name}
              </span>
              <span className="text-[9px] font-bold text-[#0E5244] uppercase tracking-wider">
                {c.isPlayer ? 'YOUR CALL SIGN' : 'CHAMPION'}
              </span>
            </div>
          </div>

          {/* Best Score Pill */}
          <div className="flex items-center gap-1.5 bg-[#0B3A30] border-[2px] border-[#07241E] px-2.5 py-1 rounded-full shadow-inner">
            <span className="text-xs">🏆</span>
            <span className="text-xs font-black text-white tabular-nums tracking-wide">
              {formatScore(c.bestScore)}
            </span>
          </div>
        </div>
      );
    }

    // Standard Commander Row
    return (
      <div
        key={`${c.rank}-${c.name}`}
        className={`p-2 sm:p-2.5 rounded-2xl flex items-center justify-between border-[2px] transition ${
          c.isPlayer
            ? 'bg-[#18274B] border-[#00D2FF] shadow-[0_0_12px_rgba(0,210,255,0.4)]'
            : 'bg-[#151932] border-[#0B1022]'
        }`}
      >
        {/* Rank & Avatar & Name */}
        <div className="flex items-center gap-2">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs border border-black/40 shadow-sm shrink-0 ${
              c.rank === 2
                ? 'bg-slate-300 text-slate-950'
                : c.rank === 3
                  ? 'bg-[#D97706] text-white'
                  : 'bg-[#282C4E] text-slate-300'
            }`}
          >
            {c.rank}
          </div>

          <div className="w-9 h-9 rounded-xl bg-[#0F1328] border-2 border-[#242A50] flex items-center justify-center text-lg shrink-0">
            {avatarFor(c)}
          </div>

          <div className="flex flex-col text-left">
            <span
              className={`text-xs font-black tracking-wide leading-tight ${
                c.isPlayer ? 'text-[#00D2FF]' : 'text-white'
              }`}
            >
              {c.name}
            </span>
            <span className="text-[9px] text-slate-400 font-bold">
              {c.isPlayer ? 'Your Current Rank' : `Wave ${c.highestWave} · Division ${Math.ceil(c.rank / 2)}`}
            </span>
          </div>
        </div>

        {/* Best Score Pill */}
        <div className="flex items-center gap-1.5 bg-[#0D1124] border border-[#23294E] px-2.5 py-1 rounded-full shadow-inner">
          <span className="text-xs">🏆</span>
          <span className="text-xs font-black text-[#FAC602] tabular-nums">
            {formatScore(c.bestScore)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      id="leaderboard-modal"
      className="absolute inset-0 z-50 flex flex-col justify-between items-center p-3 sm:p-4 game-modal-backdrop animate-in fade-in select-none"
    >
      {/* Top Header Row with Info & Close buttons */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] flex items-center justify-between pt-1">
        {/* Info button */}
        <button
          id="btn-leaderboard-info"
          onClick={() => {
            sound.playUiClick();
            setShowInfo(!showInfo);
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-[#FAC602] active:scale-90 transition"
          title="Event Info"
        >
          <Info className="w-4 h-4 stroke-[3]" />
        </button>

        {/* Sculpted Badge Banner (Reference: TOP COMMANDERS) */}
        <div className="bg-[#1474E0] border-[2.5px] border-[#062349] rounded-full px-5 py-1 flex flex-col items-center shadow-[0_4px_0_#073B78,0_6px_10px_rgba(0,0,0,0.5)]">
          <span className="text-xs sm:text-sm font-black text-white uppercase tracking-wider leading-tight text-stroke-arcade">
            TOP COMMANDERS
          </span>
          <span className="text-[9px] font-black text-[#FAC602] uppercase tracking-widest leading-none">
            GLOBAL TOURNAMENT
          </span>
        </div>

        {/* Close Button */}
        <button
          id="btn-close-leaderboard"
          onClick={() => {
            sound.playUiClick();
            onClose();
          }}
          className="w-9 h-9 rounded-full btn-game-navy flex items-center justify-center text-white active:scale-90 transition"
          title="Close"
        >
          <X className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

      {/* Main Event Showcase & Leaderboard List Card */}
      <div className="w-full max-w-sm md:max-w-[30rem] lg:max-w-[34rem] game-dialog-card p-3 sm:p-4 flex flex-col gap-2.5 relative my-auto max-h-[75vh] overflow-hidden">
        {/* Event Banner Hero Art */}
        <div className="w-full h-24 rounded-2xl bg-gradient-to-b from-[#1E2756] via-[#151D42] to-[#0D122B] border-[2.5px] border-[#0A1021] relative overflow-hidden flex items-center justify-center shadow-inner shrink-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,210,255,0.25)_0%,transparent_70%)]" />

          {/* Defender Silhouette & Swords */}
          <div className="relative flex flex-col items-center z-10">
            <div className="flex items-center justify-center">
              <div className="w-2 h-10 bg-gradient-to-t from-[#FAC602] via-yellow-200 to-white rounded-full -rotate-45 shadow-[0_0_10px_#FAC602]" />
              <div className="w-11 h-11 rounded-full bg-[#11162F] border-2 border-[#00D2FF] flex items-center justify-center text-2xl shadow-[0_0_14px_rgba(0,210,255,0.7)] mx-1">
                👨‍🚀
              </div>
              <div className="w-2 h-10 bg-gradient-to-t from-[#FAC602] via-yellow-200 to-white rounded-full rotate-45 shadow-[0_0_10px_#FAC602]" />
            </div>
            <span className="text-[9px] font-black text-[#00D2FF] uppercase tracking-widest mt-1">
              SECTOR 01: GLOBAL RESISTANCE
            </span>
          </div>

          {/* Data Source Pill */}
          <div className="absolute top-2 right-2 bg-[#0C1024] border border-[#232B54] px-2 py-0.5 rounded-full text-[9px] font-black text-[#FAC602]">
            {entries ? 'LIVE RANKINGS' : loading ? 'CONNECTING…' : 'SHOWCASE'}
          </div>
        </div>

        {/* Info Alert Dropdown */}
        {showInfo && (
          <div className="p-2.5 rounded-xl bg-[#171B33] border border-[#2A3464] text-[10px] text-cyan-100 flex flex-col gap-1 animate-in fade-in">
            <span className="font-black text-white">TERRAN DEFENSE RANKINGS:</span>
            <span>
              Every synced run is ranked by best score. Your weapons, funds and wave
              progress stay attached to your Defender ID, so your rank follows you to
              any device you sign in from.
            </span>
          </div>
        )}

        {/* Ranking List */}
        <div className="flex flex-col gap-2 overflow-y-auto pr-1">
          {loading ? (
            // Skeleton rows while the backend responds
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-2xl bg-[#151932] border-[2px] border-[#0B1022] flex items-center gap-2 animate-pulse"
                >
                  <div className="w-6 h-6 rounded-full bg-[#282C4E]" />
                  <div className="w-9 h-9 rounded-xl bg-[#0F1328]" />
                  <div className="flex-1 h-3 rounded bg-[#23294E]" />
                  <div className="w-16 h-3 rounded bg-[#23294E]" />
                </div>
              ))}
            </>
          ) : (
            rows.map(renderRow)
          )}
        </div>
      </div>

      {/* Bottom Squircles Navigation Dock (shared) */}
      <ModalDock onClose={onClose} />
    </div>
  );
};
