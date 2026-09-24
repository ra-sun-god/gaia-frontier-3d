'use client';

import React, { useRef, useState } from 'react';
import { GameEngine } from '@/lib/gameEngine';

interface TouchJoystickProps {
  /** Live engine handle — the stick streams aim angles straight into it. */
  engineRef: React.MutableRefObject<GameEngine | null>;
  /** Block input while the sim is frozen (pause modal / menus / death). */
  enabled: boolean;
}

/**
 * VIRTUAL AIM JOYSTICK — twin-stick control for phones & tablets.
 *
 * Rests above the weapon dock in the lower-RIGHT corner (natural right-thumb
 * zone). Deflecting the knob aims the turret DIRECTLY at the stick's angle:
 *
 *   pointermove → atan2 → engine.setAimAngle() → turret snaps instantly.
 *
 * That one-hop path is the whole point of this v2 stick. The v1 stick
 * streamed a normalized vector into a page-level rAF loop that dragged a
 * virtual cursor across the playfield at 760 logical px/s and let setAim
 * chase it — a full-field sweep took ~0.6s, which players felt as "the
 * controls lag". v2 has no loop, no cursor and no turn-rate cap: the gun is
 * where your thumb is, every frame, at pointer-event rate.
 *
 * Rendering is equally lean: the knob is moved by direct DOM style writes
 * (no React state per pointermove — zero reconciliation in the gesture hot
 * path; only the active/inactive highlight toggles state, once per touch).
 * iOS hygiene: touch-action none kills scroll/zoom interception, and the
 * generous invisible grab halo means a landing thumb never misses the ring.
 */
export const TouchJoystick: React.FC<TouchJoystickProps> = ({ engineRef, enabled }) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  /** Gesture-local stick center (screen px) — captured at pointerdown so
   *  pointermove never needs getBoundingClientRect (zero layout reads). */
  const centerRef = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const MAX_RADIUS = 44; // px the knob can travel from center
  const DEAD_ZONE = 0.12; // normalized — resting thumb keeps the current aim

  /** Direct DOM knob placement — bypasses React state entirely. */
  const placeKnob = (dx: number, dy: number) => {
    const knob = knobRef.current;
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  const updateFromPointer = (clientX: number, clientY: number) => {
    let dx = clientX - centerRef.current.x;
    let dy = clientY - centerRef.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }
    placeKnob(dx, dy);

    const engine = engineRef.current;
    if (!engine || !enabled || engine.isPaused || !engine.isRunning) return;

    // Dead zone: a resting thumb must not bleed micro-drift into the aim —
    // and the turret simply HOLDS its last angle (nothing to reset).
    if (Math.hypot(dx, dy) / MAX_RADIUS < DEAD_ZONE) return;

    // One atan2, one clamp inside the engine, instant snap. No cursor
    // chasing, no angular speed budget, no frame of indirection.
    engine.setAimAngle(Math.atan2(dy, dx));

    // Manual-fire players shoot while steering — exactly the keyboard
    // steering contract (engine gates the actual fire rate internally).
    if (!engine.autoFireEnabled) engine.tryShoot();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    e.preventDefault();
    const base = baseRef.current;
    if (!base) return;
    pointerIdRef.current = e.pointerId;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    // Single per-gesture layout read (the only getBoundingClientRect call)
    const rect = base.getBoundingClientRect();
    centerRef.current.x = rect.left + rect.width / 2;
    centerRef.current.y = rect.top + rect.height / 2;
    setActive(true);
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    placeKnob(0, 0);
    setActive(false);
  };

  return (
    <div
      className="absolute right-3 bottom-[104px] z-30 select-none"
      style={{
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Compact control label */}
      <div
        className={`text-center text-[8px] font-black tracking-[0.2em] mb-1 pointer-events-none transition-colors ${
          active ? 'text-cyan-300' : 'text-slate-500'
        }`}
      >
        AIM
      </div>

      {/* Joystick base ring — the padded halo doubles the grab area so a
          landing thumb never misses; the visible ring stays compact. */}
      <div
        ref={baseRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative w-[112px] h-[112px] p-[18px] rounded-full cursor-pointer transition-all duration-150 ${
          active
            ? 'bg-[#0a1a33]/80 border-2 border-cyan-400/70 shadow-[0_0_18px_rgba(34,211,238,0.45)]'
            : 'bg-[#0a1a33]/50 border border-slate-600/70 shadow-[0_0_10px_rgba(0,0,0,0.5)]'
        }`}
        style={{ touchAction: 'none' }}
      >
        {/* Crosshair guides */}
        <div className="absolute left-1/2 top-4 bottom-4 w-px -translate-x-1/2 bg-slate-600/40 pointer-events-none" />
        <div className="absolute top-1/2 left-4 right-4 h-px -translate-y-1/2 bg-slate-600/40 pointer-events-none" />

        {/* Movable knob — positioned by direct style writes only */}
        <div
          ref={knobRef}
          className={`absolute left-1/2 top-1/2 w-[50px] h-[50px] rounded-full pointer-events-none transition-colors ${
            active
              ? 'bg-gradient-to-b from-cyan-300 to-sky-600 border-2 border-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.8)]'
              : 'bg-gradient-to-b from-slate-400 to-slate-700 border-2 border-slate-500'
          }`}
          style={{ transform: 'translate(calc(-50% + 0px), calc(-50% + 0px))' }}
        />
      </div>
    </div>
  );
};
