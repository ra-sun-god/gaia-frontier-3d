'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Threat } from '@/lib/types';
import { sound } from '@/lib/audio';
import { AlertTriangle } from 'lucide-react';

interface IncomingThreatWarningProps {
  boss: Threat | null;
  onDismiss: () => void;
}

/**
 * Boss encounter red-alert pill.
 *
 * Design rules (product feedback):
 *  • Made SMALL — same visual weight as the HUD adrenaline meter: a single
 *    slim rounded pill pinned near the top edge. No card body, no hazard
 *    banners, no stat stack — just the siren, the name, the HP tag and a
 *    hairline countdown underneath.
 *  • NEVER covers the play field — pointer-events only on the pill itself.
 *  • Auto-dismisses after 3 seconds (plus slide-out) so combat resumes fast;
 *    tapping engages immediately for impatient players.
 */
export const IncomingThreatWarning: React.FC<IncomingThreatWarningProps> = ({
  boss,
  onDismiss,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const onDismissRef = useRef(onDismiss);
  // Trailing dismiss timer (the slide-out animation delay). It MUST be
  // tracked and cleared: if a new boss warning replaces this one within the
  // 350ms window, the stale timer would fire onDismiss() and instantly kill
  // the NEW warning card.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    // Renders as null while boss is null, so no explicit hide is needed here
    if (!boss) return;

    // Play procedural boss emergency siren and trigger haptic pulse
    sound.playBossSiren();
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([120, 60, 120, 60, 240]);
      }
    } catch {}

    // Trigger slide-in animation on next frame
    const timerIn = setTimeout(() => {
      setIsVisible(true);
    }, 20);

    // Countdown progress line
    const duration = 3000; // 3.0 seconds total display
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingPct = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remainingPct);
      if (remainingPct <= 0) {
        clearInterval(interval);
      }
    }, 40);

    // Slide-out and dismiss
    const timerOut = setTimeout(() => {
      setIsVisible(false);
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        onDismissRef.current();
      }, 350); // Allow slide-up animation to complete
    }, duration);

    return () => {
      clearTimeout(timerIn);
      clearTimeout(timerOut);
      clearInterval(interval);
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [boss]);

  if (!boss) return null;

  const isEraBoss = !!boss.alienPilot;
  const bossName = boss.alienPilot?.name || boss.name || 'VANGUARD DESTROYER';

  const handleManualDismiss = () => {
    sound.playUiClick();
    setIsVisible(false);
    // Cancel any pending auto-dismiss path first — manual wins, and a fresh
    // boss warning may have already replaced this card by the time the
    // animation delay elapses.
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      onDismissRef.current();
    }, 300);
  };

  return (
    <>
      {/* 1. Pulsing Red Emergency screen-edge vignette (non-blocking, unchanged) */}
      <div
        className={`pointer-events-none absolute inset-0 z-40 threat-siren-overlay transition-opacity duration-500 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* 2. Slim Red-Alert Pill — adrenaline-meter proportions, auto-clears in 3s */}
      <div className="absolute inset-x-0 top-2 z-50 flex justify-center px-2 pointer-events-none">
        <div
          id="incoming-threat-card"
          onClick={handleManualDismiss}
          className={`pointer-events-auto cursor-pointer select-none transition-all duration-300 ease-out transform ${
            isVisible
              ? 'translate-y-0 opacity-100 scale-100'
              : '-translate-y-6 opacity-0 scale-95'
          }`}
        >
          {/* Single-row compact pill body (h-5 like the adrenaline bar) */}
          <div
            className={`h-5 max-w-[300px] rounded-full overflow-hidden flex items-center gap-1.5 pl-2 pr-2.5 border shadow-[0_0_12px_rgba(230,46,92,0.65)] ${
              isVisible ? 'animate-pulse' : ''
            }`}
            style={{
              background: 'linear-gradient(180deg, #1C0B1B 0%, #0B0E1B 100%)',
              borderColor: '#E62E5C',
            }}
          >
            <AlertTriangle className="w-2.5 h-2.5 text-[#FAC602] fill-[#FAC602] shrink-0 animate-bounce" />
            <span className="text-[7px] font-black uppercase tracking-[0.14em] text-[#FAC602] shrink-0 leading-none">
              RED ALERT
            </span>
            <span className="text-[9px] font-black text-white uppercase tracking-wide truncate leading-none text-stroke-arcade drop-shadow-[0_1px_4px_rgba(230,46,92,0.9)]">
              {bossName}
            </span>
            <span className="shrink-0 px-1 py-px rounded-full bg-rose-600/90 text-white text-[7px] font-black uppercase leading-none">
              {isEraBoss ? 'APEX' : 'TITAN'}
            </span>
            <span className="shrink-0 text-[8px] font-mono font-bold text-rose-200 leading-none">
              {abbrevNum(boss.maxHp)}HP
            </span>
            {boss.maxShieldHp > 0 && (
              <span className="shrink-0 text-[8px] font-mono font-bold text-cyan-300 leading-none">
                +{abbrevNum(boss.maxShieldHp)}
              </span>
            )}
          </div>

          {/* 3.0s hairline countdown (2px, pill-width) */}
          <div className="h-[2px] w-full px-2 mt-px">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 via-[#FAC602] to-rose-600 transition-all duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </>
  );
};

/** 1200 → "1.2k" keeps the pill compact on narrow phones. */
function abbrevNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
