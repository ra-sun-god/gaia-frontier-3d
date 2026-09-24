'use client';

// GameCanvas — 3D battlefield (Three.js) + crisp 2D overlay for combat text.
//
// The visible `#earth-defender-viewport` canvas is the WebGL surface that the
// engine's ThreeWorld paints each frame; a second transparent 2D canvas on top
// carries floating combat text + the aim crosshair. Input mapping is
// perspective-exact: the pointer is ray-cast onto the gameplay plane, so what
// the crosshair covers is exactly what the simulation targets.
import React, { useEffect, useRef } from 'react';
import { GameEngine } from '@/lib/gameEngine';
import { sound } from '@/lib/audio';
import { CANVAS_CONTEXT_OPTS } from '@/lib/utils';
import { registerWorld, ThreeWorld } from '@/lib/three/world';

interface GameCanvasProps {
  engineRef: React.MutableRefObject<GameEngine | null>;
  isPaused: boolean;
  /** Increments every time a NEW engine instance is created (run restart). */
  engineEpoch: number;
  /** Adaptive quality tier from the engine's frame-time governor (0/1/2). */
  qualityLevel?: number;
}

/** Canvas context creation options — kept exported for API compatibility. */
export { CANVAS_CONTEXT_OPTS };

/**
 * Logical playfield for a given container size (shared by GameCanvas sizing
 * and engine boot so the first frame of a run is already correctly mapped).
 */
export function computeLogicalSize(containerW: number, containerH: number) {
  const aspect = containerW / containerH;
  const BASE_W = 450;
  const BASE_H = 800;
  if (aspect >= BASE_W / BASE_H) {
    return { w: BASE_H * aspect, h: BASE_H };
  }
  return { w: BASE_W, h: BASE_W / aspect };
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  engineRef,
  isPaused,
  engineEpoch,
  qualityLevel = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ThreeWorld | null>(null);
  const isDraggingRef = useRef(false);
  const rectCacheRef = useRef<DOMRect | null>(null);

  const refreshRectCache = () => {
    const canvas = canvasRef.current;
    if (canvas) rectCacheRef.current = canvas.getBoundingClientRect();
  };

  // Full-bleed responsive canvas: same adaptive logical viewport contract as
  // the 2D build (min 450x800, taller screens gain height, wider gain width).
  const applySizing = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const world = worldRef.current;
    if (!canvas || !container || !world) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    world.setSize(rect.width, rect.height);

    const logical = computeLogicalSize(rect.width, rect.height);
    world.setLogicalSize(logical.w, logical.h);
    engineRef.current?.setViewport(logical.w, logical.h);
    rectCacheRef.current = rect;
  };

  // Build the 3D world exactly once per mount and register it so the engine
  // (created later by the PLAY button) can find its renderer.
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const world = new ThreeWorld(canvas);
    world.attachOverlay(overlay);
    world.setQuality(qualityLevel);
    worldRef.current = world;
    registerWorld(canvas, world);
    applySizing();

    const observer = new ResizeObserver(applySizing);
    const container = containerRef.current;
    if (container) observer.observe(container);
    window.addEventListener('scroll', refreshRectCache, { passive: true });
    window.addEventListener('resize', refreshRectCache, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', refreshRectCache);
      window.removeEventListener('resize', refreshRectCache);
      world.dispose();
      worldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync whenever a fresh engine instance mounts or the quality tier flips.
  useEffect(() => {
    applySizing();
    worldRef.current?.setQuality(qualityLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineEpoch, qualityLevel]);

  // Debug/test handle (QA flows drive combat + inspect audio through this).
  useEffect(() => {
    const engine = engineRef.current;
    const w = window as unknown as {
      __earthDefender?: {
        engine: GameEngine | null;
        sound: typeof sound;
        world?: ThreeWorld | null;
      };
    };
    // Preserve sibling QA handles; re-attach this canvas' 3D world.
    w.__earthDefender = { ...w.__earthDefender, engine, sound, world: worldRef.current };
    return () => {
      if (w.__earthDefender?.engine === engine) w.__earthDefender = undefined;
    };
  }, [engineEpoch, engineRef]);

  // Pointer → logical coords via the world's perspective-exact ray-cast.
  const getLogicalCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    const engine = engineRef.current;
    const logicalW = engine?.L_WIDTH ?? 450;
    const logicalH = engine?.L_HEIGHT ?? 800;
    if (!canvas || !world) return { x: logicalW / 2, y: logicalH / 2 };
    const rect = rectCacheRef.current ?? canvas.getBoundingClientRect();
    return world.screenToLogical(clientX, clientY, rect);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPaused) return;
    const engine = engineRef.current;
    if (!engine) return;

    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    rectCacheRef.current = canvasRef.current?.getBoundingClientRect() ?? null;

    const { x, y } = getLogicalCoords(e.clientX, e.clientY);
    engine.setAim(x, y);
    const collected = engine.tapCollectGoodieAt(x, y);
    if (!collected) {
      engine.tryShoot();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPaused) return;
    const engine = engineRef.current;
    if (!engine) return;

    const { x, y } = getLogicalCoords(e.clientX, e.clientY);
    if (isDraggingRef.current || e.pointerType === 'mouse') {
      engine.setAim(x, y);
      if (isDraggingRef.current && !engine.autoFireEnabled) {
        engine.tryShoot();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  return (
    <div
      ref={containerRef}
      id="game-canvas-container"
      className="relative w-full h-full flex items-center justify-center overflow-hidden select-none touch-none"
    >
      <canvas
        ref={canvasRef}
        id="earth-defender-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="block shadow-2xl cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      <canvas
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
};
