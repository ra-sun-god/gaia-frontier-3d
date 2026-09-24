// Shared cosmetic skin registry for Earth Defender.
// Single source of truth used by BOTH the CosmeticsModal UI and the GameEngine
// renderer, so equipped skins actually change the in-game visuals.

import { SkinItem } from './types';

export const COSMETIC_SKINS: SkinItem[] = [
  // Cannon / turret skins
  { id: 'cannon_standard', type: 'cannon', name: 'Terran Standard', costGems: 0, unlocked: true, color: '#38bdf8', previewClass: 'from-sky-500 to-blue-600' },
  { id: 'cannon_neon', type: 'cannon', name: 'Cyber Neon', costGems: 35, unlocked: false, color: '#06b6d4', previewClass: 'from-cyan-400 to-sky-600' },
  { id: 'cannon_gold', type: 'cannon', name: 'Gold Commander', costGems: 60, unlocked: false, color: '#f59e0b', previewClass: 'from-amber-400 to-yellow-600' },
  { id: 'cannon_plasma', type: 'cannon', name: 'Singularity Core', costGems: 90, unlocked: false, color: '#818cf8', previewClass: 'from-blue-600 to-cyan-400' },
  { id: 'cannon_crimson', type: 'cannon', name: 'Crimson Vanguard', costGems: 70, unlocked: false, color: '#f87171', previewClass: 'from-red-500 to-rose-700' },
  { id: 'cannon_void', type: 'cannon', name: 'Void Phage', costGems: 85, unlocked: false, color: '#a78bfa', previewClass: 'from-violet-500 to-purple-800' },

  // Base / citadel atmosphere skins
  { id: 'base_standard', type: 'base', name: 'Standard Atmosphere', costGems: 0, unlocked: true, color: '#0284c7', previewClass: 'from-blue-600 to-cyan-500' },
  { id: 'base_aegis', type: 'base', name: 'Aegis Forcefield', costGems: 40, unlocked: false, color: '#38bdf8', previewClass: 'from-sky-400 to-indigo-600' },
  { id: 'base_matrix', type: 'base', name: 'Cyber Matrix Citadel', costGems: 70, unlocked: false, color: '#10b981', previewClass: 'from-emerald-500 to-teal-700' },
  { id: 'base_solar', type: 'base', name: 'Solar Bastion', costGems: 85, unlocked: false, color: '#f59e0b', previewClass: 'from-amber-400 to-orange-600' },
  { id: 'base_gaia', type: 'base', name: 'Gaia Bloom', costGems: 95, unlocked: false, color: '#34d399', previewClass: 'from-green-400 to-emerald-600' },

  // Projectile trail skins
  { id: 'proj_standard', type: 'projectile', name: 'Standard Kinetic', costGems: 0, unlocked: true, color: '#38bdf8', previewClass: 'from-sky-400 to-blue-500' },
  { id: 'proj_plasma', type: 'projectile', name: 'Emerald Plasma', costGems: 25, unlocked: false, color: '#34d399', previewClass: 'from-emerald-400 to-teal-500' },
  { id: 'proj_crimson', type: 'projectile', name: 'Solar Flare Gold', costGems: 45, unlocked: false, color: '#f59e0b', previewClass: 'from-amber-400 to-yellow-500' },
  { id: 'proj_ion', type: 'projectile', name: 'Ion Violet', costGems: 30, unlocked: false, color: '#c084fc', previewClass: 'from-violet-400 to-purple-500' },
  { id: 'proj_ghost', type: 'projectile', name: 'Spectral White', costGems: 55, unlocked: false, color: '#e2e8f0', previewClass: 'from-slate-200 to-slate-400' },
  { id: 'proj_dragon', type: 'projectile', name: 'Dragon Breath', costGems: 65, unlocked: false, color: '#fb7185', previewClass: 'from-rose-400 to-red-600' },
];

/** Resolve the render color for an equipped skin, falling back when unknown. */
export function getSkinColor(
  equippedId: string | undefined,
  type: SkinItem['type'],
  fallback: string
): string {
  const skin = COSMETIC_SKINS.find((s) => s.id === equippedId && s.type === type);
  return skin ? skin.color : fallback;
}
