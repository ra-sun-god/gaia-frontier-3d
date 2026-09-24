import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Canvas 2D context creation options — the single source of truth shared by
 * GameCanvas and GameEngine so BOTH getContext calls request identical
 * attributes (context attributes only apply to the FIRST call for a canvas):
 *
 *  • alpha:false        — opaque backing store: the browser skips per-frame
 *                         alpha compositing of the full-screen game canvas
 *  • desynchronized:true — low-latency "plow ahead" painting (Chromium);
 *                         decouples canvas updates from the main frame tick
 *                         so the turret tracks the mouse with less input lag.
 *                         Harmlessly ignored on Safari/Firefox.
 */
export const CANVAS_CONTEXT_OPTS: CanvasRenderingContext2DSettings = {
  alpha: false,
  desynchronized: true,
}
