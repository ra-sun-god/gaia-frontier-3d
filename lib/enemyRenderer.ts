import { Threat } from './types';
import { getEraBossConfig } from './bossData';

// ---------------------------------------------------------------------------
// RENDER QUALITY GATE (GPU optimization)
//
// shadowBlur rasterization is by far the most expensive canvas op in this
// renderer (dozens of blurred strokes/fills per threat per frame). The
// engine's adaptive governor calls setRenderQuality() when sustained frame
// times slip below the display budget; qBlur() then flattens every blur to 0
// so shape outlines stay crisp but the GPU cost collapses. Tier 0 keeps the
// exact legacy look.
// ---------------------------------------------------------------------------
let RENDER_QUALITY = 0;

/** 0 = full detail (legacy), 1 = glow-reduced, 2 = minimal (crisis mode). */
export function setRenderQuality(q: number) {
  RENDER_QUALITY = Math.max(0, Math.min(2, Math.floor(q) || 0));
}

/** Current quality tier (engine + shell can read it back). */
export function getRenderQuality(): number {
  return RENDER_QUALITY;
}

/** Clamp a shadowBlur radius by the live quality tier. */
export function qBlur(blur: number): number {
  return RENDER_QUALITY >= 1 ? 0 : blur;
}

/**
 * High-octane procedural 2.5D asset renderer for all Earth Defender enemy archetypes.
 * Crafted with multi-layered metallic hulls, glowing cockpits, animated engine exhausts,
 * realistic rock craters, plasma fissures, and laser warning telegraphs.
 */

/**
 * Cheap integer hash of a numeric entity id → decorrelated phase in
 * [0, 10). Sequential ids must NOT map to sequential phases (adjacent
 * rocks/craft would wobble in near-lockstep) — one multiply-xor mix
 * spreads them out. Zero allocation, deterministic per entity. Replaces
 * the old string-id hashing (split+reduce per call allocated per frame).
 */
function idPhase(id: number): number {
  let h = id | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return ((h >>> 0) % 1000) / 100;
}

// Helper to pseudo-randomize craggy rock vertices based on threat ID
function getRockVertices(id: number, radius: number, count: number = 10): Array<{ x: number; y: number }> {
  const seed = idPhase(id) % 1;
  const verts: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    // Harmonic variation creates organic, asymmetrical crags
    const offset =
      Math.sin(angle * 3 + seed * 10) * 0.16 +
      Math.cos(angle * 5 + seed * 5) * 0.12;
    const r = radius * (0.86 + offset);
    verts.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    });
  }
  return verts;
}

export function drawDangerTelegraphs(
  ctx: CanvasRenderingContext2D,
  threats: Threat[],
  cannonY: number,
  timeSec: number
) {
  threats.forEach((t) => {
    // 1. Sniper Ship Laser Targeting Sight Beam
    if (t.type === 'sniper_ship') {
      const charge = t.sniperCharge || 0;
      const chargePct = Math.min(1, charge / 3.5);
      const beamAlpha = 0.25 + chargePct * 0.65;
      const pulse = Math.sin(timeSec * (8 + chargePct * 20)) * 0.5 + 0.5;

      ctx.save();
      // Outer faint aura
      ctx.strokeStyle = `rgba(239, 68, 68, ${beamAlpha * 0.5})`;
      ctx.lineWidth = 3 + chargePct * 4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + t.radius);
      ctx.lineTo(t.x, cannonY);
      ctx.stroke();

      // Core targeting line
      ctx.strokeStyle = chargePct > 0.8 ? '#ffffff' : `rgba(248, 113, 113, ${beamAlpha})`;
      ctx.lineWidth = 1 + chargePct * 2;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + t.radius);
      ctx.lineTo(t.x, cannonY);
      ctx.stroke();

      // Crosshair at target point on Earth base
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, cannonY, 8 + pulse * 4, 0, Math.PI * 2);
      ctx.moveTo(t.x - 12, cannonY);
      ctx.lineTo(t.x + 12, cannonY);
      ctx.moveTo(t.x, cannonY - 12);
      ctx.lineTo(t.x, cannonY + 12);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Kamikaze Dive trajectory lock-on line
    if (t.type === 'kamikaze') {
      const alpha = 0.3 + (Math.sin(timeSec * 24) * 0.5 + 0.5) * 0.35;
      ctx.save();
      ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + t.radius);
      ctx.lineTo(t.x, cannonY);
      ctx.stroke();
      ctx.restore();
    }

    // 2b. Hypersonic missile impact vector — a hot dashed streak along the
    // live flight path so the defender can pre-lead the intercept. The impact
    // reticle only appears in the final ~1.1s so it never misleads from far.
    if (t.type === 'hypersonic_missile') {
      const speed = Math.hypot(t.vx, t.vy) || 1;
      const ux = t.vx / speed;
      const uy = t.vy / speed;
      const vy = Math.max(1, t.vy);
      const tta = Math.max(0, (cannonY - t.y) / vy);
      ctx.save();
      ctx.strokeStyle = `rgba(251, 113, 133, ${0.35 + (Math.sin(timeSec * 20) * 0.5 + 0.5) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + ux * speed * Math.min(0.5, tta), t.y + uy * speed * Math.min(0.5, tta));
      ctx.stroke();
      if (tta < 1.1) {
        // Impact reticle where the warhead will land
        const ix = t.x + ux * speed * tta;
        const iy = cannonY;
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(ix, iy, 9 + Math.sin(timeSec * 18) * 2.5, 0, Math.PI * 2);
        ctx.moveTo(ix - 13, iy);
        ctx.lineTo(ix - 5, iy);
        ctx.moveTo(ix + 5, iy);
        ctx.lineTo(ix + 13, iy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2c. Cluster bomb airburst warning — pulsing danger ring that strobes
    // urgently in the final second of the fuse (defuse it NOW).
    if (t.type === 'cluster_bomb' && t.clusterFuse !== undefined && t.y > 60) {
      const urgent = t.clusterFuse < 1.2;
      const pulse = Math.sin(timeSec * (urgent ? 22 : 8)) * 0.5 + 0.5;
      ctx.save();
      ctx.strokeStyle = `rgba(249, 115, 22, ${0.35 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius + 10 + pulse * 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Fuse countdown ticks
      ctx.strokeStyle = 'rgba(253, 186, 116, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(t.x - 7, t.y - t.radius - 12);
      ctx.lineTo(t.x + 7, t.y - t.radius - 12);
      ctx.moveTo(t.x, t.y - t.radius - 16);
      ctx.lineTo(t.x, t.y - t.radius - 8);
      ctx.stroke();
      ctx.restore();
    }

    // 2d. Railgun slug bore line — while CHARGING at the top edge the slug
    // paints its firing column down to the base; the intercept window is
    // the charge (then it's a pure snap-shot).
    if (t.type === 'railgun_slug' && (t.vy ?? 0) === 0) {
      const charge = Math.min(1, Math.max(0, (t.specialTimer ?? 0) / 0.9));
      ctx.save();
      ctx.strokeStyle = `rgba(34, 211, 238, ${0.2 + charge * 0.5})`;
      ctx.lineWidth = 1 + charge * 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + t.radius);
      ctx.lineTo(t.x, cannonY);
      ctx.stroke();
      ctx.setLineDash([]);
      // Muzzle charge reticle
      ctx.strokeStyle = `rgba(165, 243, 252, ${0.4 + charge * 0.5})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius + 5 + Math.sin(timeSec * 16) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2e. Plasma torpedo homing vector — dashed drift line toward the base
    if (t.type === 'plasma_torpedo') {
      ctx.save();
      ctx.strokeStyle = 'rgba(217, 70, 239, 0.3)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + t.radius);
      ctx.lineTo(t.x, cannonY);
      ctx.stroke();
      ctx.restore();
    }

    // 2f. Hunter-killer lock-on — flashing diamond while tracking, then a
    // hard dive line once committed.
    if (t.type === 'hunter_killer') {
      ctx.save();
      if (!t.isDiving) {
        const flash = Math.sin(timeSec * 12) * 0.5 + 0.5;
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.35 + flash * 0.45})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y - t.radius - 14);
        ctx.lineTo(t.x + 11, t.y - t.radius - 3);
        ctx.lineTo(t.x, t.y - t.radius + 8);
        ctx.lineTo(t.x - 11, t.y - t.radius - 3);
        ctx.closePath();
        ctx.stroke();
      } else {
        const alpha = 0.35 + (Math.sin(timeSec * 20) * 0.5 + 0.5) * 0.3;
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y + t.radius);
        ctx.lineTo(t.x, cannonY);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2g. Tesla node charge-up arcs — jagged feelers reach toward the turret
    // in the final ~40% of the charge so the player knows the zap is coming.
    if (t.type === 'tesla_node') {
      const charge = Math.min(1, (t.teslaCharge ?? 0) / 3.4);
      if (charge > 0.55) {
        const intensity = (charge - 0.55) / 0.45;
        ctx.save();
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.25 + intensity * 0.5})`;
        ctx.lineWidth = 1.5;
        for (let bolt = 0; bolt < 2; bolt++) {
          ctx.beginPath();
          ctx.moveTo(t.x, t.y + t.radius * 0.6);
          ctx.lineTo(t.x + (Math.random() - 0.5) * 30, t.y + 30 + Math.random() * 30);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 3. Proximity Danger Pulse if threat is dangerously close to Earth
    if (t.y + t.radius > cannonY - 95) {
      const urgency = Math.min(1, (t.y + t.radius - (cannonY - 95)) / 95);
      ctx.save();
      ctx.strokeStyle = `rgba(244, 63, 94, ${urgency * 0.7})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius + 8 + Math.sin(timeSec * 16) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });
}

export function renderEnemyAsset(
  ctx: CanvasRenderingContext2D,
  t: Threat,
  timeSec: number
) {
  ctx.save();
  ctx.translate(t.x, t.y);

  // Phased out ghost transparency
  if (t.isPhasedOut) {
    ctx.globalAlpha = 0.25;
  }

  // Freeze frost overlay
  if (t.isFrozen) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, t.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Render archetype
  if (t.isBoss) {
    renderEraBossWithVisibleAlien(ctx, t, timeSec);
  } else if (t.type === 'alien_hoverbike') {
    renderHoverbikeRaider(ctx, t, timeSec);
  } else if (
    t.type === 'fire_meteor' ||
    t.type === 'ice_comet' ||
    t.type === 'emp_asteroid' ||
    t.type === 'asteroid_large' ||
    t.type === 'asteroid_small' ||
    t.type === 'debris_junk'
  ) {
    renderMeteor(ctx, t, timeSec);
  } else if (t.type === 'scout') {
    renderScout(ctx, t, timeSec);
  } else if (t.type === 'shielded_trooper') {
    renderShieldedTrooper(ctx, t, timeSec);
  } else if (t.type === 'kamikaze') {
    renderKamikaze(ctx, t, timeSec);
  } else if (t.type === 'swarm_pod') {
    renderSwarmPod(ctx, t, timeSec);
  } else if (t.type === 'mini_drone') {
    renderMiniDrone(ctx, t, timeSec);
  } else if (t.type === 'sniper_ship') {
    renderSniperShip(ctx, t, timeSec);
  } else if (t.type === 'healer_ship') {
    renderHealerShip(ctx, t, timeSec);
  } else if (t.type === 'magnet_drone') {
    renderMagnetDrone(ctx, t, timeSec);
  } else if (t.type === 'phase_ghost') {
    renderPhaseGhost(ctx, t, timeSec);
  } else if (t.type === 'stealth_threat') {
    renderStealthShip(ctx, t, timeSec);
  } else if (t.type === 'gravity_well' || t.type === 'void_orb') {
    renderCosmicVortex(ctx, t, timeSec);
  } else if (t.type === 'fake_goodie') {
    renderFakeGoodie(ctx, t, timeSec);
  } else if (t.type === 'plasma_raider') {
    renderPlasmaRaider(ctx, t, timeSec);
  } else if (t.type === 'chrono_wraith') {
    renderChronoWraith(ctx, t, timeSec);
  } else if (t.type === 'void_cruiser') {
    renderVoidCruiser(ctx, t, timeSec);
  } else if (t.type === 'hypersonic_missile') {
    renderHypersonicMissile(ctx, t, timeSec);
  } else if (t.type === 'cluster_bomb' || t.type === 'cluster_bomblet') {
    renderClusterBomb(ctx, t, timeSec);
  } else if (t.type === 'mirv_warhead') {
    renderMirvWarhead(ctx, t, timeSec);
  } else if (t.type === 'railgun_slug') {
    renderRailgunSlug(ctx, t, timeSec);
  } else if (t.type === 'plasma_torpedo') {
    renderPlasmaTorpedo(ctx, t, timeSec);
  } else if (t.type === 'siege_carrier') {
    renderSiegeCarrier(ctx, t, timeSec);
  } else if (t.type === 'tesla_node') {
    renderTeslaNode(ctx, t, timeSec);
  } else if (t.type === 'hunter_killer') {
    renderHunterKiller(ctx, t, timeSec);
  } else if (t.type === 'mirror_shade') {
    renderMirrorShade(ctx, t, timeSec);
  } else {
    // Default fallback to high-detail rock
    renderMeteor(ctx, t, timeSec);
  }

  // ELITE champion aura — golden hex ring + orbiting crown sparks so a
  // jackpot spawn reads instantly at any zoom.
  if (t.isElite) {
    const pulse = Math.sin(timeSec * 5) * 0.18 + 0.82;
    ctx.save();
    ctx.strokeStyle = `rgba(251, 191, 36, ${0.85 * pulse})`;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = qBlur(14);
    ctx.rotate(timeSec * 1.2);
    ctx.beginPath();
    for (let hx = 0; hx < 6; hx++) {
      const ang = (hx / 6) * Math.PI * 2;
      const px = Math.cos(ang) * (t.radius + 8);
      const py = Math.sin(ang) * (t.radius + 8);
      if (hx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Orbiting crown sparks
    for (let cs = 0; cs < 3; cs++) {
      const ang = timeSec * 2.4 + (cs / 3) * Math.PI * 2;
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * (t.radius + 8), Math.sin(ang) * (t.radius + 8), 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Energy Shield Dome Bubble
  if (t.shieldHp > 0) {
    const shieldPct = Math.min(1, t.shieldHp / (t.maxShieldHp || t.maxHp));
    const pulse = Math.sin(timeSec * 6) * 0.15 + 0.85;

    // Glowing outer aura
    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${0.7 * shieldPct * pulse})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = qBlur(12);
    ctx.beginPath();
    ctx.arc(0, 0, t.radius + 6, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating hexagonal matrix wireframe
    ctx.rotate(timeSec * 1.5);
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.45 * shieldPct})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const x = Math.cos(ang) * (t.radius + 6);
      const y = Math.sin(ang) * (t.radius + 6);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // Health bar above threat (for high HP targets & bosses)
  if (t.maxHp > 35 || t.isBoss) {
    const barW = Math.max(30, t.radius * 2);
    const barH = t.isBoss ? 6 : 4;
    const hpPct = Math.max(0, t.hp / t.maxHp);

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(t.x - barW / 2 - 1, t.y - t.radius - 14, barW + 2, barH + 2);

    // Health gradient
    const hpGrad = ctx.createLinearGradient(t.x - barW / 2, 0, t.x + barW / 2, 0);
    if (t.isBoss) {
      hpGrad.addColorStop(0, '#f43f5e');
      hpGrad.addColorStop(1, '#e11d48');
    } else if (hpPct > 0.5) {
      hpGrad.addColorStop(0, '#4ade80');
      hpGrad.addColorStop(1, '#22c55e');
    } else if (hpPct > 0.25) {
      hpGrad.addColorStop(0, '#facc15');
      hpGrad.addColorStop(1, '#eab308');
    } else {
      hpGrad.addColorStop(0, '#f87171');
      hpGrad.addColorStop(1, '#ef4444');
    }

    ctx.fillStyle = hpGrad;
    ctx.fillRect(t.x - barW / 2, t.y - t.radius - 13, barW * hpPct, barH);

    // Shield portion on top of health bar if shielded
    if (t.shieldHp > 0 && t.maxShieldHp > 0) {
      const shieldPct = Math.min(1, t.shieldHp / t.maxShieldHp);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(t.x - barW / 2, t.y - t.radius - 18, barW * shieldPct, 2.5);
    }
    ctx.restore();
  }
}

// --- 1. Meteors & Crystalline Asteroids ---
function renderMeteor(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  ctx.rotate(t.angle);

  const verts = getRockVertices(t.id, t.radius, 10);

  // 2.5D Shading Gradient (Simulating directional space sun)
  const grad = ctx.createRadialGradient(
    -t.radius * 0.35,
    -t.radius * 0.35,
    t.radius * 0.1,
    t.radius * 0.2,
    t.radius * 0.2,
    t.radius * 1.1
  );

  if (t.type === 'fire_meteor') {
    grad.addColorStop(0, '#78350f');
    grad.addColorStop(0.6, '#292524');
    grad.addColorStop(1, '#0c0a09');
  } else if (t.type === 'ice_comet') {
    grad.addColorStop(0, '#bae6fd');
    grad.addColorStop(0.5, '#0284c7');
    grad.addColorStop(1, '#082f49');
  } else if (t.type === 'emp_asteroid') {
    grad.addColorStop(0, '#c084fc');
    grad.addColorStop(0.6, '#4c1d95');
    grad.addColorStop(1, '#1e1b4b');
  } else {
    // Standard rock
    grad.addColorStop(0, '#94a3b8');
    grad.addColorStop(0.65, '#334155');
    grad.addColorStop(1, '#0f172a');
  }

  // Draw main craggy boulder
  ctx.beginPath();
  verts.forEach((v, idx) => {
    if (idx === 0) ctx.moveTo(v.x, v.y);
    else ctx.lineTo(v.x, v.y);
  });
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.shadowColor = t.color;
  ctx.shadowBlur = qBlur(t.type === 'fire_meteor' || t.type === 'ice_comet' ? 14 : 4);
  ctx.fill();

  // Highlight rock rim (Top edge specular light)
  ctx.strokeStyle =
    t.type === 'fire_meteor'
      ? '#ea580c'
      : t.type === 'ice_comet'
      ? '#e0f2fe'
      : t.type === 'emp_asteroid'
      ? '#a855f7'
      : '#cbd5e1';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Sub-features: Craters
  const seed = (idPhase(t.id) % 5) / 5;
  const craters = [
    { x: -t.radius * 0.25, y: -t.radius * 0.2, r: t.radius * 0.22 },
    { x: t.radius * 0.3, y: t.radius * 0.15, r: t.radius * 0.28 },
    { x: -t.radius * 0.1, y: t.radius * 0.4, r: t.radius * 0.18 },
  ];

  craters.forEach((c) => {
    // Dark pit
    ctx.fillStyle = '#0c0a09';
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();

    // Illuminated upper-left crescent
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, Math.PI * 0.8, Math.PI * 1.6);
    ctx.stroke();
  });

  // Type-specific effects
  if (t.type === 'fire_meteor') {
    // Molten lava core & branching fissures
    const pulse = Math.sin(timeSec * 10) * 0.2 + 0.8;
    ctx.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-t.radius * 0.4, -t.radius * 0.1);
    ctx.lineTo(0, 0);
    ctx.lineTo(t.radius * 0.4, -t.radius * 0.2);
    ctx.moveTo(0, 0);
    ctx.lineTo(t.radius * 0.1, t.radius * 0.4);
    ctx.stroke();

    // Lava core center
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, 0, t.radius * 0.25 * pulse, 0, Math.PI * 2);
    ctx.fill();
  } else if (t.type === 'ice_comet') {
    // Faceted diamond glint
    const glint = Math.sin(timeSec * 8) * 0.4 + 0.6;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // 4-point star specular highlight
    const gx = -t.radius * 0.35;
    const gy = -t.radius * 0.35;
    const gl = 6 * glint;
    ctx.moveTo(gx - gl, gy);
    ctx.lineTo(gx + gl, gy);
    ctx.moveTo(gx, gy - gl);
    ctx.lineTo(gx, gy + gl);
    ctx.stroke();
  } else if (t.type === 'emp_asteroid') {
    // Crackling purple lightning arcs
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-t.radius * 0.5, t.radius * 0.2);
    ctx.lineTo(-t.radius * 0.2, -t.radius * 0.3);
    ctx.lineTo(t.radius * 0.3, -t.radius * 0.1);
    ctx.lineTo(t.radius * 0.5, t.radius * 0.3);
    ctx.stroke();
  } else if (t.type === 'asteroid_large') {
    // Fracture cleavage seam
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(0, -t.radius * 0.9);
    ctx.lineTo(-t.radius * 0.1, 0);
    ctx.lineTo(t.radius * 0.1, t.radius * 0.9);
    ctx.stroke();
  }

  ctx.restore();
}

// --- 2. Alien Scout Fighter ---
function renderStealthShip(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  // Phantom Stalker: angular indigo dart that shimmers while cloaked.
  // Cloaking reuses the phase-ghost intangibility flag (isPhasedOut).
  const r = t.radius;
  const cloaked = !!t.isPhasedOut;

  ctx.save();
  ctx.globalAlpha = cloaked ? 0.16 + Math.sin(timeSec * 6) * 0.05 : 1;

  // Slight weave bank
  ctx.rotate(Math.sin(timeSec * 3 + idPhase(t.id)) * 0.12);

  // Cloak shimmer ring
  if (cloaked) {
    ctx.strokeStyle = 'rgba(148, 163, 253, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Twin violet exhaust trails
  [-r * 0.4, r * 0.4].forEach((offX) => {
    const flLen = r * (0.7 + Math.sin(timeSec * 26 + offX) * 0.3);
    const grad = ctx.createLinearGradient(0, -r, 0, -r - flLen);
    grad.addColorStop(0, '#e0e7ff');
    grad.addColorStop(0.4, '#818cf8');
    grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(offX - 2.5, -r * 0.65);
    ctx.lineTo(offX, -r * 0.65 - flLen);
    ctx.lineTo(offX + 2.5, -r * 0.65);
    ctx.closePath();
    ctx.fill();
  });

  // Angular stealth dart hull
  ctx.beginPath();
  ctx.moveTo(0, r * 1.05);
  ctx.lineTo(r * 0.8, -r * 0.35);
  ctx.lineTo(r * 0.28, -r * 0.6);
  ctx.lineTo(0, -r * 0.4);
  ctx.lineTo(-r * 0.28, -r * 0.6);
  ctx.lineTo(-r * 0.8, -r * 0.35);
  ctx.closePath();
  const hullGrad = ctx.createLinearGradient(-r, 0, r, 0);
  hullGrad.addColorStop(0, '#312e81');
  hullGrad.addColorStop(0.5, '#4f46e5');
  hullGrad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = hullGrad;
  ctx.shadowColor = '#6366f1';
  ctx.shadowBlur = qBlur(cloaked ? 0 : 10);
  ctx.fill();
  ctx.shadowBlur = qBlur(0);

  // Glowing forward sensor eye
  ctx.beginPath();
  ctx.arc(0, r * 0.25, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = '#c7d2fe';
  ctx.fill();

  ctx.restore();
}

function renderScout(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  // Orient downwards toward Earth with slight roll bank
  const roll = Math.sin(timeSec * 5 + idPhase(t.id)) * 0.18;
  ctx.save();
  ctx.rotate(roll);

  const r = t.radius;

  // Dual engine afterburner exhaust flames
  [-r * 0.45, r * 0.45].forEach((offX) => {
    const flLen = r * (0.8 + Math.sin(timeSec * 30 + offX) * 0.35);
    const flGrad = ctx.createLinearGradient(0, -r, 0, -r - flLen);
    flGrad.addColorStop(0, '#ffffff');
    flGrad.addColorStop(0.4, '#22d3ee');
    flGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = flGrad;
    ctx.beginPath();
    ctx.moveTo(offX - 3, -r * 0.7);
    ctx.lineTo(offX, -r * 0.7 - flLen);
    ctx.lineTo(offX + 3, -r * 0.7);
    ctx.closePath();
    ctx.fill();
  });

  // Main Delta Wings Hull
  ctx.beginPath();
  ctx.moveTo(0, r); // Sharp forward nose facing Earth
  ctx.lineTo(r * 0.95, -r * 0.7); // Right wingtip
  ctx.lineTo(r * 0.35, -r * 0.45); // Wing inner indent
  ctx.lineTo(0, -r * 0.65); // Engine bay center
  ctx.lineTo(-r * 0.35, -r * 0.45);
  ctx.lineTo(-r * 0.95, -r * 0.7); // Left wingtip
  ctx.closePath();

  const hullGrad = ctx.createLinearGradient(-r, 0, r, 0);
  hullGrad.addColorStop(0, '#0f766e');
  hullGrad.addColorStop(0.5, '#14b8a6');
  hullGrad.addColorStop(1, '#042f2e');
  ctx.fillStyle = hullGrad;
  ctx.shadowColor = '#2dd4bf';
  ctx.shadowBlur = qBlur(10);
  ctx.fill();

  // Edge metallic trim
  ctx.strokeStyle = '#5eead4';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cockpit Canopy Glass
  ctx.fillStyle = '#67e8f9';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.15, 3.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Wingtip pulse cannons
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-r * 0.95, -r * 0.7, 2, 5);
  ctx.fillRect(r * 0.95 - 2, -r * 0.7, 2, 5);

  ctx.restore();
}

// --- 3. Shielded Armored Trooper ---
function renderShieldedTrooper(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Heavy Octagonal Assault Chassis
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const bodyGrad = ctx.createLinearGradient(-r, -r, r, r);
  bodyGrad.addColorStop(0, '#334155');
  bodyGrad.addColorStop(0.5, '#1e293b');
  bodyGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bodyGrad;
  ctx.shadowColor = '#38bdf8';
  ctx.shadowBlur = qBlur(8);
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dual Autocannons
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(-r * 0.9, -r * 0.2, 4, r * 0.9);
  ctx.fillRect(r * 0.9 - 4, -r * 0.2, 4, r * 0.9);

  // Red Optic Visor Scanner (Sweeping beam)
  const sweep = Math.sin(timeSec * 6) * (r * 0.35);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-r * 0.5, -3, r, 6);
  ctx.fillStyle = '#ef4444';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = qBlur(6);
  ctx.beginPath();
  ctx.arc(sweep, 0, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- 4. Kamikaze Dive-Bomber ---
function renderKamikaze(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Giant Rocket Afterburner Flame
  const flLen = r * 1.5 + Math.random() * 8;
  const flGrad = ctx.createLinearGradient(0, -r * 0.8, 0, -r * 0.8 - flLen);
  flGrad.addColorStop(0, '#ffffff');
  flGrad.addColorStop(0.3, '#facc15');
  flGrad.addColorStop(0.7, '#ea580c');
  flGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
  ctx.fillStyle = flGrad;
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, -r * 0.8);
  ctx.lineTo(0, -r * 0.8 - flLen);
  ctx.lineTo(r * 0.4, -r * 0.8);
  ctx.closePath();
  ctx.fill();

  // Needle-Sharp Arrowhead Delta Hull
  ctx.beginPath();
  ctx.moveTo(0, r * 1.2); // Forward needle nose
  ctx.lineTo(r * 0.85, -r * 0.8);
  ctx.lineTo(0, -r * 0.5);
  ctx.lineTo(-r * 0.85, -r * 0.8);
  ctx.closePath();

  ctx.fillStyle = '#b91c1c';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = qBlur(12);
  ctx.fill();
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Yellow/Black Hazard Chevrons across wings
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, -r * 0.3);
  ctx.lineTo(0, -r * 0.1);
  ctx.lineTo(r * 0.45, -r * 0.3);
  ctx.stroke();

  // Blinking Red Warning Strobe at nose
  const strobe = Math.sin(timeSec * 32) > 0;
  ctx.fillStyle = strobe ? '#ffffff' : '#ef4444';
  ctx.beginPath();
  ctx.arc(0, r * 1.0, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- 5. Swarm Pod ---
function renderSwarmPod(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const pulse = 1 + Math.sin(timeSec * 6) * 0.08;

  // Organic segmented carapace
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.85, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#581c87';
  ctx.shadowColor = '#a855f7';
  ctx.shadowBlur = qBlur(12);
  ctx.fill();
  ctx.strokeStyle = '#d8b4fe';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Glowing internal embryo pods
  const pods = [
    { x: 0, y: -r * 0.35, r: 4.5 },
    { x: -r * 0.3, y: r * 0.15, r: 4 },
    { x: r * 0.3, y: r * 0.15, r: 4 },
  ];
  pods.forEach((p) => {
    ctx.fillStyle = '#a3e635';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

// --- 6. Mini Swarm Drone ---
function renderMiniDrone(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const flutter = Math.sin(timeSec * 45) * 0.45;

  // Fluttering translucent insect wings
  ctx.fillStyle = 'rgba(192, 132, 252, 0.45)';
  [-1, 1].forEach((dir) => {
    ctx.save();
    ctx.translate(dir * 2, -1);
    ctx.rotate(dir * flutter);
    ctx.beginPath();
    ctx.ellipse(dir * r * 0.8, -r * 0.2, r * 0.8, 2.5, dir * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Chitinous Body
  ctx.fillStyle = '#7e22ce';
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.5, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glowing venom stinger
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(0, r * 0.7, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- 7. Orbital Sniper Ship ---
function renderSniperShip(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const charge = (t.sniperCharge || 0) / 3.5;

  // Long electromagnetic railgun barrel
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-3, 0, 6, r * 1.3);

  // 3 Induction accelerator coils charging up
  for (let i = 0; i < 3; i++) {
    const coilY = r * 0.25 + i * (r * 0.35);
    const coilActive = charge >= (i + 1) / 3;
    ctx.fillStyle = coilActive ? '#ef4444' : '#f59e0b';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = qBlur(coilActive ? 8 : 2);
    ctx.fillRect(-5, coilY, 10, 3.5);
  }

  // Heavy Stabilizer Wings
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.8);
  ctx.lineTo(r * 0.9, -r * 0.2);
  ctx.lineTo(r * 0.4, r * 0.2);
  ctx.lineTo(-r * 0.4, r * 0.2);
  ctx.lineTo(-r * 0.9, -r * 0.2);
  ctx.closePath();
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

// --- 8. Bio-Support Healer Ship ---
function renderHealerShip(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Rotating Nanite Energy Halo
  ctx.save();
  ctx.rotate(timeSec * 2);
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Ceramic white cruiser hull
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.shadowColor = '#22c55e';
  ctx.shadowBlur = qBlur(10);
  ctx.fill();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Emerald Medical Cross Insignia
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(-3, -r * 0.5, 6, r);
  ctx.fillRect(-r * 0.5, -3, r, 6);

  ctx.restore();
}

// --- 9. Magnet Drone ---
function renderMagnetDrone(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Horseshoe Chassis
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, Math.PI, 0);
  ctx.lineTo(r * 0.85, r * 0.7);
  ctx.lineTo(r * 0.45, r * 0.7);
  ctx.lineTo(r * 0.45, 0);
  ctx.arc(0, 0, r * 0.45, 0, Math.PI, true);
  ctx.lineTo(-r * 0.45, r * 0.7);
  ctx.lineTo(-r * 0.85, r * 0.7);
  ctx.closePath();

  ctx.fillStyle = '#334155';
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Red (+) and Blue (-) magnetic tips
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-r * 0.85, r * 0.4, r * 0.4, r * 0.3);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(r * 0.45, r * 0.4, r * 0.4, r * 0.3);

  // Lightning spark between poles
  if (Math.random() < 0.75) {
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.65, r * 0.6);
    ctx.lineTo(0, r * 0.4 + (Math.random() - 0.5) * 6);
    ctx.lineTo(r * 0.65, r * 0.6);
    ctx.stroke();
  }

  ctx.restore();
}

// --- 10. Phase Ghost ---
function renderPhaseGhost(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // RGB Chromatic Aberration Shadow Hulls
  [-3, 3].forEach((offX, idx) => {
    ctx.save();
    ctx.translate(offX, 0);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.9);
    ctx.lineTo(r * 0.7, -r * 0.7);
    ctx.lineTo(0, -r * 0.3);
    ctx.lineTo(-r * 0.7, -r * 0.7);
    ctx.closePath();
    ctx.fillStyle = idx === 0 ? 'rgba(34, 211, 238, 0.35)' : 'rgba(232, 121, 249, 0.35)';
    ctx.fill();
    ctx.restore();
  });

  // Main Phantom Hull
  ctx.beginPath();
  ctx.moveTo(0, r * 0.9);
  ctx.lineTo(r * 0.7, -r * 0.7);
  ctx.lineTo(0, -r * 0.3);
  ctx.lineTo(-r * 0.7, -r * 0.7);
  ctx.closePath();
  ctx.fillStyle = 'rgba(217, 70, 239, 0.85)';
  ctx.shadowColor = '#d946ef';
  ctx.shadowBlur = qBlur(12);
  ctx.fill();
  ctx.strokeStyle = '#f5d0fe';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Horizontal Scanlines
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  for (let y = -r * 0.6; y < r * 0.8; y += 4) {
    ctx.fillRect(-r * 0.6, y, r * 1.2, 1);
  }

  ctx.restore();
}

// --- 11. Cosmic Vortex / Gravity Well / Void Orb ---
function renderCosmicVortex(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Rotating Accretion Disk in 2.5D perspective
  ctx.rotate(timeSec * (t.type === 'gravity_well' ? -1.8 : 1.5));

  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 3);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.45, 0, 0, Math.PI * 2);
    ctx.strokeStyle = i === 0 ? '#818cf8' : i === 1 ? '#c084fc' : '#e879f9';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = qBlur(10);
    ctx.stroke();
    ctx.restore();
  }

  // Pitch-Black Event Horizon Singularity Core
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#020617';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

// --- 12. Deception Core (Fake Goodie) ---
function renderFakeGoodie(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Golden exterior mimics real goodie
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#facc15';
  ctx.shadowColor = '#eab308';
  ctx.shadowBlur = qBlur(10);
  ctx.fill();

  // Subtle glitch red skull indicator
  const glitch = Math.sin(timeSec * 8) > 0.6;
  ctx.fillStyle = glitch ? '#ef4444' : '#000000';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☠️', 0, 1);

  ctx.restore();
}

// --- 13. Alien Hoverbike Raider (Little Aliens on Tiny Speeder-Bike Ship) ---
function renderHoverbikeRaider(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;

  // Responsive banking tilt based on lateral velocity and speed wobble
  const lateralTilt = Math.max(-0.45, Math.min(0.45, (t.vx / 85) * 0.4 + Math.sin(timeSec * 8 + idPhase(t.id)) * 0.12));
  ctx.rotate(lateralTilt);

  // 1. Anti-Grav Repulsor Hover Field (Pulsing energy ring undercarriage)
  const repulsorPulse = Math.sin(timeSec * 12) * 0.2 + 0.8;
  const hoverGrad = ctx.createRadialGradient(0, r * 0.3, 2, 0, r * 0.3, r * 1.0);
  hoverGrad.addColorStop(0, 'rgba(34, 211, 238, 0.7)');
  hoverGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.35)');
  hoverGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');
  ctx.fillStyle = hoverGrad;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.4, r * 0.85 * repulsorPulse, r * 0.35 * repulsorPulse, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. Twin High-Velocity Ion Jet Exhausts
  [-r * 0.32, r * 0.32].forEach((exX) => {
    const flLen = r * (0.85 + Math.sin(timeSec * 28 + exX * 10) * 0.3);
    const flGrad = ctx.createLinearGradient(0, -r * 0.7, 0, -r * 0.7 - flLen);
    flGrad.addColorStop(0, '#ffffff');
    flGrad.addColorStop(0.3, '#38bdf8');
    flGrad.addColorStop(0.7, '#818cf8');
    flGrad.addColorStop(1, 'rgba(129, 140, 248, 0)');

    ctx.fillStyle = flGrad;
    ctx.beginPath();
    ctx.moveTo(exX - 2.5, -r * 0.65);
    ctx.lineTo(exX, -r * 0.65 - flLen);
    ctx.lineTo(exX + 2.5, -r * 0.65);
    ctx.closePath();
    ctx.fill();
  });

  // 3. Sleek Hoverbike Chassis Body
  ctx.beginPath();
  ctx.moveTo(0, r * 0.95); // Forward tapered aerodynamic nose
  ctx.lineTo(r * 0.38, r * 0.4); // Right forward canard
  ctx.lineTo(r * 0.32, -r * 0.2); // Mid waist
  ctx.lineTo(r * 0.48, -r * 0.65); // Right rear thruster fin
  ctx.lineTo(r * 0.15, -r * 0.6); // Engine cowl inner
  ctx.lineTo(-r * 0.15, -r * 0.6);
  ctx.lineTo(-r * 0.48, -r * 0.65); // Left rear thruster fin
  ctx.lineTo(-r * 0.32, -r * 0.2); // Left mid waist
  ctx.lineTo(-r * 0.38, r * 0.4); // Left forward canard
  ctx.closePath();

  const chassisGrad = ctx.createLinearGradient(-r, 0, r, 0);
  chassisGrad.addColorStop(0, '#0f172a');
  chassisGrad.addColorStop(0.5, '#1e293b');
  chassisGrad.addColorStop(1, '#020617');
  ctx.fillStyle = chassisGrad;
  ctx.shadowColor = '#06b6d4';
  ctx.shadowBlur = qBlur(8);
  ctx.fill();

  // Vibrant Cyber Neon Trim along bike contours
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Forward Twin Plasma Blasters on bike nose
  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(-r * 0.32, r * 0.25, 2, 6);
  ctx.fillRect(r * 0.32 - 2, r * 0.25, 2, 6);

  // Bike Handlebars
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.35, -r * 0.05);
  ctx.lineTo(0, -r * 0.12);
  ctx.lineTo(r * 0.35, -r * 0.05);
  ctx.stroke();

  // Digital Cockpit Dial on hoverbike center
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(0, -r * 0.08, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 4. THE LITTLE ALIEN RIDER!
  // Alien Body / Torso (leaned forward in fast racing posture)
  ctx.fillStyle = '#10b981'; // Alien green suit
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.28, 4.5, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Little Alien Arms gripping the handlebars
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-3, -r * 0.32);
  ctx.lineTo(-r * 0.32, -r * 0.08); // Left hand
  ctx.moveTo(3, -r * 0.32);
  ctx.lineTo(r * 0.32, -r * 0.08); // Right hand
  ctx.stroke();

  // Tiny Alien Hands
  ctx.fillStyle = '#6ee7b7';
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.08, 1.6, 0, Math.PI * 2);
  ctx.arc(r * 0.32, -r * 0.08, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Alien Head (Cute, expressive alien with big eyes!)
  const headBob = Math.sin(timeSec * 14) * 0.6;
  const alienHeadY = -r * 0.42 + headBob;

  ctx.fillStyle = '#34d399'; // Bright alien skin
  ctx.beginPath();
  ctx.ellipse(0, alienHeadY, 5.5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Alien Antennae / Ear Fins (wobble with speed)
  const wobble = Math.sin(timeSec * 22) * 1.5;
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 1.6;
  // Left antenna
  ctx.beginPath();
  ctx.moveTo(-3, alienHeadY - 4);
  ctx.quadraticCurveTo(-6, alienHeadY - 10 + wobble, -4, alienHeadY - 12 + wobble);
  ctx.stroke();
  // Right antenna
  ctx.beginPath();
  ctx.moveTo(3, alienHeadY - 4);
  ctx.quadraticCurveTo(6, alienHeadY - 10 - wobble, 4, alienHeadY - 12 - wobble);
  ctx.stroke();

  // Antenna tips (glowing neon spheres)
  ctx.fillStyle = '#a7f3d0';
  ctx.beginPath();
  ctx.arc(-4, alienHeadY - 12 + wobble, 1.5, 0, Math.PI * 2);
  ctx.arc(4, alienHeadY - 12 - wobble, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Big Glossy Alien Almond Eyes!
  ctx.fillStyle = '#0f172a'; // Deep black glossy eyes
  ctx.beginPath();
  ctx.ellipse(-2.4, alienHeadY + 0.5, 1.8, 2.5, -0.25, 0, Math.PI * 2);
  ctx.ellipse(2.4, alienHeadY + 0.5, 1.8, 2.5, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Glossy white eye shine highlights
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-2.7, alienHeadY - 0.5, 0.7, 0, Math.PI * 2);
  ctx.arc(2.1, alienHeadY - 0.5, 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Speed-Pilot Headband / Goggles
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, alienHeadY - 1.5, 5.2, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();

  ctx.restore();
}

// --- 14. Visible Alien in Spaceship (Era-End Boss Mode) ---
function renderEraBossWithVisibleAlien(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const eraNum = t.bossEraNumber || 1;
  const cfg = getEraBossConfig(eraNum);
  const pilot = t.alienPilot || cfg.pilot;
  const isEnraged = t.hp / t.maxHp < 0.5 || (t.bossPhase !== undefined && t.bossPhase > 1);

  // 1. Massive Sub-Light Plasma Engines based on ship size
  const enginePorts = [-r * 0.65, -r * 0.25, r * 0.25, r * 0.65];
  enginePorts.forEach((ox) => {
    const flicker = Math.sin(timeSec * 30 + ox * 5) * (r * 0.2);
    const plLen = r * 0.85 + flicker + (isEnraged ? r * 0.35 : 0);
    const plGrad = ctx.createLinearGradient(0, -r * 0.75, 0, -r * 0.75 - plLen);

    if (isEnraged) {
      plGrad.addColorStop(0, '#ffffff');
      plGrad.addColorStop(0.3, '#f59e0b');
      plGrad.addColorStop(0.8, '#ef4444');
      plGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
    } else {
      plGrad.addColorStop(0, '#ffffff');
      plGrad.addColorStop(0.3, cfg.color);
      plGrad.addColorStop(0.8, '#38bdf8');
      plGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    }

    ctx.fillStyle = plGrad;
    ctx.beginPath();
    ctx.moveTo(ox - 4.5, -r * 0.75);
    ctx.lineTo(ox, -r * 0.75 - plLen);
    ctx.lineTo(ox + 4.5, -r * 0.75);
    ctx.closePath();
    ctx.fill();
  });

  // 2. Spaceship Hull Construction (Procedural 2.5D geometric hull based on Era Theme)
  renderSpaceshipHull(ctx, cfg.hullTheme, r, cfg.color, timeSec, isEnraged);

  // 3. Enraged Damage FX (Smoking wings, sparking electrical fissures if HP < 50%)
  if (isEnraged) {
    const sparkPulse = Math.sin(timeSec * 25);
    if (sparkPulse > 0) {
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.1);
      ctx.lineTo(-r * 0.5, r * 0.1);
      ctx.lineTo(-r * 0.6, r * 0.2);
      ctx.moveTo(r * 0.6, -r * 0.2);
      ctx.lineTo(r * 0.45, 0);
      ctx.stroke();
    }
  }

  // 4. THE VISIBLE ALIEN IN COCKPIT!
  // Center panoramic glass bubble cockpit positioned at front-center of ship
  const cockpitCenterY = r * 0.05;
  const cockpitRadius = r * 0.44;

  // A. Cockpit Interior Deck (Dark illuminated control cabin)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, cockpitCenterY, cockpitRadius, 0, Math.PI * 2);
  ctx.clip(); // Keep alien inside cockpit

  // Cockpit background
  const cabinGrad = ctx.createRadialGradient(0, cockpitCenterY, 2, 0, cockpitCenterY, cockpitRadius);
  cabinGrad.addColorStop(0, isEnraged ? '#450a0a' : '#0f172a');
  cabinGrad.addColorStop(1, '#020617');
  ctx.fillStyle = cabinGrad;
  ctx.fill();

  // Emergency flashing alarm strobe inside cockpit if enraged
  if (isEnraged) {
    const strobe = Math.sin(timeSec * 16) * 0.4 + 0.4;
    ctx.fillStyle = `rgba(239, 68, 68, ${strobe})`;
    ctx.fill();
  }

  // B. The Alien Pilot Model!
  const breathBob = Math.sin(timeSec * 3.5) * 1.5;
  const pilotHeadY = cockpitCenterY - cockpitRadius * 0.22 + breathBob;

  // Alien Flight Suit / Shoulders & Torso
  ctx.fillStyle = isEnraged ? '#7f1d1d' : '#1e1b4b';
  ctx.beginPath();
  ctx.ellipse(0, cockpitCenterY + cockpitRadius * 0.35, cockpitRadius * 0.62, cockpitRadius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flight Suit Collar / Insignia
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, cockpitCenterY + cockpitRadius * 0.1, cockpitRadius * 0.25, 0, Math.PI);
  ctx.stroke();

  // Alien Hands on Dual Flight Controls
  ctx.fillStyle = pilot.skinColor;
  ctx.beginPath();
  ctx.arc(-cockpitRadius * 0.4, cockpitCenterY + cockpitRadius * 0.32, 3, 0, Math.PI * 2);
  ctx.arc(cockpitRadius * 0.4, cockpitCenterY + cockpitRadius * 0.32, 3, 0, Math.PI * 2);
  ctx.fill();

  // Dual Control Joysticks
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-cockpitRadius * 0.4, cockpitCenterY + cockpitRadius * 0.48);
  ctx.lineTo(-cockpitRadius * 0.4, cockpitCenterY + cockpitRadius * 0.28);
  ctx.moveTo(cockpitRadius * 0.4, cockpitCenterY + cockpitRadius * 0.48);
  ctx.lineTo(cockpitRadius * 0.4, cockpitCenterY + cockpitRadius * 0.28);
  ctx.stroke();

  // Alien Pilot Head
  ctx.fillStyle = pilot.skinColor;
  ctx.beginPath();
  // Distinct alien head silhouette
  ctx.ellipse(0, pilotHeadY, cockpitRadius * 0.36, cockpitRadius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Alien Species Details (horns, antennae, crest, cyclops eye, or crowns)
  renderAlienPilotFeatures(ctx, eraNum, pilot, pilotHeadY, cockpitRadius, timeSec, isEnraged);

  // C. Floating Holographic Cockpit HUD (semi-transparent display between alien & glass)
  ctx.strokeStyle = isEnraged ? 'rgba(239, 68, 68, 0.7)' : 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.2;
  // Curved mini radar screen
  ctx.beginPath();
  ctx.arc(0, cockpitCenterY + cockpitRadius * 0.05, cockpitRadius * 0.5, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  // Target reticle
  ctx.strokeRect(-4, cockpitCenterY + cockpitRadius * 0.1, 8, 4);

  ctx.restore(); // Exit cockpit clip

  // 5. Panoramic Glass Canopy Dome (Drawn on top of alien with authentic 2.5D reflections)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, cockpitCenterY, cockpitRadius, 0, Math.PI * 2);

  // Subtle glass tint
  ctx.fillStyle = cfg.canopyColor;
  ctx.fill();

  // Polished Canopy Frame Rim
  ctx.strokeStyle = isEnraged ? '#f87171' : '#e0f2fe';
  ctx.lineWidth = 2.2;
  ctx.shadowColor = cfg.color;
  ctx.shadowBlur = qBlur(10);
  ctx.stroke();

  // Glass Specular Curved Arc Highlight (Top-left 2.5D reflection)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, cockpitCenterY, cockpitRadius - 2.5, Math.PI * 1.1, Math.PI * 1.6);
  ctx.stroke();

  // Small glint star on glass
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(
    cockpitRadius * Math.cos(Math.PI * 1.35) * 0.75,
    cockpitCenterY + cockpitRadius * Math.sin(Math.PI * 1.35) * 0.75,
    1.6,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.restore();

  // 6. Boss Identification Badge Floating Mini Overhead Plate
  ctx.save();
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = cfg.color;
  ctx.shadowBlur = qBlur(6);
  ctx.fillText(pilot.name.toUpperCase(), 0, -r * 0.95);
  ctx.restore();

  ctx.restore();
}

// Sub-helper: Alien Pilot facial features by era
function renderAlienPilotFeatures(
  ctx: CanvasRenderingContext2D,
  eraNum: number,
  pilot: { name: string; species: string; skinColor: string; eyeColor: string },
  headY: number,
  r: number,
  timeSec: number,
  isEnraged: boolean
) {
  // Full 1-15 era coverage: eras 11-15 used to wrap around and reuse the
  // faces of eras 1-5, which read as "every late boss is the same creature".
  const normEra = Math.min(15, Math.max(1, eraNum));

  if (normEra === 1) {
    // Warlord Krag'Tor (Reptilian Marauder)
    // Horned crest
    ctx.fillStyle = '#065f46';
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, headY - r * 0.25);
    ctx.lineTo(-r * 0.35, headY - r * 0.45);
    ctx.lineTo(-r * 0.12, headY - r * 0.35);
    ctx.moveTo(r * 0.22, headY - r * 0.25);
    ctx.lineTo(r * 0.35, headY - r * 0.45);
    ctx.lineTo(r * 0.12, headY - r * 0.35);
    ctx.fill();
    // Red glowing slit eyes
    ctx.fillStyle = isEnraged ? '#ff0000' : pilot.eyeColor;
    ctx.fillRect(-r * 0.18, headY - 1, 3.5, 1.8);
    ctx.fillRect(r * 0.18 - 3.5, headY - 1, 3.5, 1.8);
  } else if (normEra === 2) {
    // Pyromancer Ignis (Solar Flare Plasma Alien)
    // Blazing fire horns
    const flameWobble = Math.sin(timeSec * 18) * 2;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, headY - r * 0.3);
    ctx.lineTo(-r * 0.28, headY - r * 0.55 + flameWobble);
    ctx.lineTo(-r * 0.05, headY - r * 0.35);
    ctx.moveTo(r * 0.15, headY - r * 0.3);
    ctx.lineTo(r * 0.28, headY - r * 0.55 - flameWobble);
    ctx.lineTo(r * 0.05, headY - r * 0.35);
    ctx.fill();
    // Radiant white-hot eyes
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = qBlur(6);
    ctx.beginPath();
    ctx.arc(-r * 0.15, headY, 2.5, 0, Math.PI * 2);
    ctx.arc(r * 0.15, headY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 3) {
    // Fleet Admiral Xylar (Zeta Reticulan Grey)
    // Huge reflective purple almond eyes
    ctx.fillStyle = pilot.eyeColor;
    ctx.shadowColor = '#c084fc';
    ctx.shadowBlur = qBlur(4);
    ctx.beginPath();
    ctx.ellipse(-r * 0.16, headY - 0.5, 3.8, 5.2, -0.3, 0, Math.PI * 2);
    ctx.ellipse(r * 0.16, headY - 0.5, 3.8, 5.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Specular eye glint
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-r * 0.16, headY - 2, 1.2, 0, Math.PI * 2);
    ctx.arc(r * 0.16, headY - 2, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 4) {
    // Inquisitor Vex (Cyborg Arch-Vanguard)
    // 4 glowing cybernetic sensor optics
    ctx.fillStyle = pilot.eyeColor;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = qBlur(5);
    [-r * 0.18, -r * 0.07, r * 0.07, r * 0.18].forEach((ox) => {
      ctx.fillRect(ox - 1.5, headY - 1, 3, 2.5);
    });
    // Metallic chin guard
    ctx.fillStyle = '#475569';
    ctx.fillRect(-r * 0.15, headY + r * 0.22, r * 0.3, 3);
  } else if (normEra === 5) {
    // Rustjaw (Cyclopean Scrap Warlord)
    // Giant central glowing cyclops eye
    ctx.fillStyle = pilot.eyeColor;
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = qBlur(8);
    ctx.beginPath();
    ctx.arc(0, headY - 1, 5, 0, Math.PI * 2);
    ctx.fill();
    // Cyclops pupil
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, headY - 1, 2, 0, Math.PI * 2);
    ctx.fill();
    // Welded eye patch/goggles rim
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(-7, headY - 8, 14, 14);
  } else if (normEra === 6) {
    // Synth-Prime (Digital AI Synthezoid)
    // Animated pixel eyes
    ctx.fillStyle = '#a7f3d0';
    ctx.fillRect(-r * 0.18, headY - 1, 4, 2);
    ctx.fillRect(r * 0.18 - 4, headY - 1, 4, 2);
    // Green circuit matrix lines on face
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, headY - r * 0.2);
    ctx.lineTo(-r * 0.1, headY);
    ctx.lineTo(0, headY - r * 0.1);
    ctx.lineTo(r * 0.1, headY);
    ctx.lineTo(r * 0.2, headY - r * 0.2);
    ctx.stroke();
  } else if (normEra === 7) {
    // Void Weaver Nyx (Cosmic Rift Specter)
    // Constellation starry slit eyes
    ctx.fillStyle = isEnraged ? '#ffffff' : pilot.eyeColor;
    ctx.shadowColor = '#f0abfc';
    ctx.shadowBlur = qBlur(8);
    ctx.beginPath();
    ctx.ellipse(-r * 0.16, headY, 2, 4.5, -0.4, 0, Math.PI * 2);
    ctx.ellipse(r * 0.16, headY, 2, 4.5, 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 8) {
    // Lord Glacius (Cryo Titan)
    // Crystalline ice brow horns
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, headY - r * 0.25);
    ctx.lineTo(-r * 0.35, headY - r * 0.5);
    ctx.lineTo(-r * 0.1, headY - r * 0.3);
    ctx.moveTo(r * 0.2, headY - r * 0.25);
    ctx.lineTo(r * 0.35, headY - r * 0.5);
    ctx.lineTo(r * 0.1, headY - r * 0.3);
    ctx.fill();
    // Ice white eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-r * 0.15, headY, 2.5, 0, Math.PI * 2);
    ctx.arc(r * 0.15, headY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 9) {
    // Queen Xol'Zara (Insectoid Queen)
    // Chitin crown
    ctx.fillStyle = '#831843';
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, headY - r * 0.2);
    ctx.lineTo(-r * 0.3, headY - r * 0.45);
    ctx.lineTo(0, headY - r * 0.3);
    ctx.lineTo(r * 0.3, headY - r * 0.45);
    ctx.lineTo(r * 0.25, headY - r * 0.2);
    ctx.fill();
    // Compound magenta faceted eyes
    ctx.fillStyle = pilot.eyeColor;
    ctx.beginPath();
    ctx.arc(-r * 0.18, headY, 3.5, 0, Math.PI * 2);
    ctx.arc(r * 0.18, headY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 10) {
    // Singularity Sovereign (Cosmic Dark Matter)
    // Golden coronal halo ring
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, headY - r * 0.35, r * 0.3, r * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Golden cosmic eyes
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(-r * 0.15, headY, 2.8, 0, Math.PI * 2);
    ctx.arc(r * 0.15, headY, 2.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 11) {
    // HELIOS PRIME (Solar Titan): a face of living corona fire — radiating
    // ray crown + white-hot core eyes with lava iris cracks
    const rayN = 9;
    for (let i = 0; i < rayN; i++) {
      const a = (i / rayN) * Math.PI * 2 + timeSec * 0.6;
      const rayLen = r * (0.5 + 0.14 * Math.sin(timeSec * 7 + i));
      ctx.strokeStyle = i % 2 ? '#fbbf24' : '#f97316';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.32, headY - r * 0.1 + Math.sin(a) * r * 0.22);
      ctx.lineTo(Math.cos(a) * rayLen, headY - r * 0.1 + Math.sin(a) * rayLen * 0.6);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = qBlur(9);
    ctx.beginPath();
    ctx.arc(-r * 0.15, headY, 2.6, 0, Math.PI * 2);
    ctx.arc(r * 0.15, headY, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = qBlur(0);
    // Lava crack brows
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, headY - r * 0.16);
    ctx.lineTo(-r * 0.08, headY - r * 0.1);
    ctx.moveTo(r * 0.25, headY - r * 0.16);
    ctx.lineTo(r * 0.08, headY - r * 0.1);
    ctx.stroke();
  } else if (normEra === 12) {
    // ABYSSUS MAW (Nebula Leviathan): deep-sea anglerfish horror — glowing
    // lure stalk dangling over the face + rows of needle fangs
    const lureSway = Math.sin(timeSec * 3.3) * 3;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, headY - r * 0.42);
    ctx.quadraticCurveTo(lureSway, headY - r * 0.75, lureSway * 1.4, headY - r * 0.62);
    ctx.stroke();
    const lureGlow = 0.6 + 0.4 * Math.sin(timeSec * 5);
    ctx.fillStyle = '#a5f3fc';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = qBlur(10 * lureGlow);
    ctx.beginPath();
    ctx.arc(lureSway * 1.4, headY - r * 0.62, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = qBlur(0);
    // Tiny dead-white eyes
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(-r * 0.16, headY - 0.5, 2, 0, Math.PI * 2);
    ctx.arc(r * 0.16, headY - 0.5, 2, 0, Math.PI * 2);
    ctx.fill();
    // Needle fang maw
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.1 - 1.5, headY + r * 0.18);
      ctx.lineTo(i * r * 0.1, headY + r * 0.34);
      ctx.lineTo(i * r * 0.1 + 1.5, headY + r * 0.18);
      ctx.stroke();
    }
  } else if (normEra === 13) {
    // CHRONARCH ZETA: a literal clock for a face — numeral-ring dial,
    // sweeping second hand for a pupil, fixed hour hand
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, headY, r * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.3, headY + Math.sin(a) * r * 0.3);
      ctx.lineTo(Math.cos(a) * r * 0.34, headY + Math.sin(a) * r * 0.34);
      ctx.stroke();
    }
    const secA = timeSec * 1.5;
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, headY);
    ctx.lineTo(Math.cos(secA) * r * 0.22, headY + Math.sin(secA) * r * 0.22);
    ctx.stroke();
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, headY);
    ctx.lineTo(Math.cos(secA * 0.08 - 1.1) * r * 0.13, headY + Math.sin(secA * 0.08 - 1.1) * r * 0.13);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, headY, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (normEra === 14) {
    // DREAD EMPEROR NOX: full DEMON face — heavy curved ram horns, deep-set
    // burning red eyes with ember flicker, fanged snarling maw
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.26, headY - r * 0.3);
      ctx.quadraticCurveTo(side * r * 0.55, headY - r * 0.42, side * r * 0.42, headY - r * 0.7);
      ctx.quadraticCurveTo(side * r * 0.3, headY - r * 0.5, side * r * 0.18, headY - r * 0.38);
      ctx.closePath();
      ctx.fillStyle = '#7f1d1d';
      ctx.fill();
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
    [-r * 0.15, r * 0.15].forEach((ex) => {
      const ember = 0.7 + 0.3 * Math.sin(timeSec * 9 + ex * 20);
      ctx.fillStyle = `rgba(239, 68, 68, ${ember})`;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = qBlur(8);
      ctx.beginPath();
      ctx.ellipse(ex, headY - 0.5, 3.2, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = qBlur(0);
      ctx.fillStyle = '#450a0a';
      ctx.beginPath();
      ctx.ellipse(ex, headY - 0.5, 1.2, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // Snarling fanged maw
    ctx.fillStyle = '#450a0a';
    ctx.beginPath();
    ctx.moveTo(-r * 0.16, headY + r * 0.18);
    ctx.quadraticCurveTo(0, headY + r * 0.1, r * 0.16, headY + r * 0.18);
    ctx.quadraticCurveTo(0, headY + r * 0.36, -r * 0.16, headY + r * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fecdd3';
    [-1, 0, 1].forEach((i) => {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.09 - 1.4, headY + r * 0.18);
      ctx.lineTo(i * r * 0.09, headY + r * 0.28);
      ctx.lineTo(i * r * 0.09 + 1.4, headY + r * 0.18);
      ctx.closePath();
      ctx.fill();
    });
    // Ash-gray brow slash
    ctx.strokeStyle = '#78716c';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-r * 0.24, headY - r * 0.12);
    ctx.lineTo(-r * 0.07, headY - r * 0.06);
    ctx.moveTo(r * 0.24, headY - r * 0.12);
    ctx.lineTo(r * 0.07, headY - r * 0.06);
    ctx.stroke();
  } else {
    // OMEGA PRIME: prism construct — triangular prism head with rainbow
    // refracting eyes and a rotating halo ring of light shards
    ctx.save();
    ctx.translate(0, headY - r * 0.1);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.34);
    ctx.lineTo(r * 0.3, r * 0.12);
    ctx.lineTo(-r * 0.3, r * 0.12);
    ctx.closePath();
    const pg = ctx.createLinearGradient(-r * 0.3, -r * 0.3, r * 0.3, r * 0.2);
    pg.addColorStop(0, '#e0e7ff');
    pg.addColorStop(0.5, '#818cf8');
    pg.addColorStop(1, '#4c1d95');
    ctx.fillStyle = pg;
    ctx.shadowColor = '#a5b4fc';
    ctx.shadowBlur = qBlur(8);
    ctx.fill();
    ctx.shadowBlur = qBlur(0);
    ctx.strokeStyle = '#e0e7ff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Rainbow refracting eyes
    ['#f43f5e', '#f59e0b', '#22c55e', '#38bdf8'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-r * 0.14 + i * 1.2, -r * 0.02, 2, 3.2);
      ctx.fillRect(r * 0.14 - 3 - i * 1.2, -r * 0.02, 2, 3.2);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    // Rotating halo shards
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + timeSec * 1.6;
      ctx.save();
      ctx.translate(Math.cos(a) * r * 0.42, headY - r * 0.1 + Math.sin(a) * r * 0.16);
      ctx.rotate(a * 2);
      ctx.fillStyle = ['#f43f5e', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#818cf8'][i];
      ctx.beginPath();
      ctx.moveTo(0, -2.6);
      ctx.lineTo(1.8, 0);
      ctx.lineTo(0, 2.6);
      ctx.lineTo(-1.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

// Sub-helper: Era Spaceship Hull Architecture
// --- 15. Plasma Raider (Era 11+: Solar Corona Inferno) ---
function renderPlasmaRaider(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const tilt = Math.sin(timeSec * 7 + idPhase(t.id)) * 0.35;
  ctx.rotate(tilt);

  // Arrowhead corona hull
  ctx.beginPath();
  ctx.moveTo(0, r * 1.1);
  ctx.lineTo(r * 0.75, -r * 0.35);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(-r * 0.75, -r * 0.35);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#fef3c7');
  g.addColorStop(0.5, '#f59e0b');
  g.addColorStop(1, '#9a3412');
  ctx.fillStyle = g;
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = qBlur(14);
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Twin plasma thruster nozzles (pointed up — it dives toward Earth)
  [-r * 0.35, r * 0.35].forEach((nx) => {
    const flick = Math.sin(timeSec * 26 + nx * 3) * 0.3 + 0.7;
    const flame = ctx.createLinearGradient(0, -r * 0.6, 0, -r * 0.6 - r * 0.7 * flick);
    flame.addColorStop(0, '#ffffff');
    flame.addColorStop(0.4, '#fbbf24');
    flame.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(nx - 3.5, -r * 0.6);
    ctx.lineTo(nx, -r * 0.6 - r * 0.75 * flick);
    ctx.lineTo(nx + 3.5, -r * 0.6);
    ctx.closePath();
    ctx.fill();
  });

  // Molten core eye
  ctx.fillStyle = '#450a0a';
  ctx.beginPath();
  ctx.arc(0, r * 0.15, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(0, r * 0.15, r * 0.1 + Math.sin(timeSec * 10) * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- 16. Chrono Wraith (Era 13+: Chrono Storm Paradox) ---
function renderChronoWraith(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const phase = (t.blinkTimer ?? 0) / 2.4;
  const shimmer = Math.sin(timeSec * 8) * 0.5 + 0.5;

  // Stalled-time halo ring
  ctx.strokeStyle = `rgba(254, 243, 199, ${0.35 + shimmer * 0.3})`;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.25, timeSec * 2, timeSec * 2 + Math.PI * 1.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hooded wraith body — flowing spectral robe
  ctx.beginPath();
  ctx.moveTo(0, r * 0.95);
  ctx.quadraticCurveTo(r * 0.85, r * 0.3, r * 0.45, -r * 0.75);
  ctx.quadraticCurveTo(0, -r * 1.05, -r * 0.45, -r * 0.75);
  ctx.quadraticCurveTo(-r * 0.85, r * 0.3, 0, r * 0.95);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#fef9c3');
  g.addColorStop(0.45, '#ca8a04');
  g.addColorStop(1, '#422006');
  ctx.fillStyle = g;
  ctx.shadowColor = '#eab308';
  ctx.shadowBlur = qBlur(16);
  ctx.fill();
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Hourglass chest emblem charging toward the blink
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.18, -r * 0.05);
  ctx.lineTo(r * 0.18, -r * 0.05);
  ctx.moveTo(-r * 0.18, r * 0.35);
  ctx.lineTo(r * 0.18, r * 0.35);
  ctx.moveTo(-r * 0.2, -r * 0.1);
  ctx.lineTo(r * 0.2, r * 0.4);
  ctx.moveTo(r * 0.2, -r * 0.1);
  ctx.lineTo(-r * 0.2, r * 0.4);
  ctx.stroke();

  // Blink charge orb — brightens as the teleport approaches
  ctx.fillStyle = `rgba(254, 240, 138, ${0.35 + phase * 0.6})`;
  ctx.shadowColor = '#fef08a';
  ctx.shadowBlur = qBlur(10 + phase * 14);
  ctx.beginPath();
  ctx.arc(0, -r * 0.45, r * 0.2 + phase * r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- 17. Void Cruiser (Era 14+: Void Legion Dominion) ---
function renderVoidCruiser(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  ctx.save();
  const r = t.radius;
  const charge = Math.min(1, (t.bombardCharge ?? 0) / 4.2);

  // Heavy armored siege hull
  ctx.beginPath();
  ctx.moveTo(0, r * 0.9);
  ctx.lineTo(r * 0.55, r * 0.5);
  ctx.lineTo(r * 1.05, r * 0.1);
  ctx.lineTo(r * 0.9, -r * 0.6);
  ctx.lineTo(-r * 0.9, -r * 0.6);
  ctx.lineTo(-r * 1.05, r * 0.1);
  ctx.lineTo(-r * 0.55, r * 0.5);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#4c0519');
  g.addColorStop(0.55, '#9f1239');
  g.addColorStop(1, '#1c0509');
  ctx.fillStyle = g;
  ctx.shadowColor = '#e11d48';
  ctx.shadowBlur = qBlur(16);
  ctx.fill();
  ctx.strokeStyle = '#fb7185';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Armor plating rivets
  ctx.fillStyle = '#fda4af';
  for (let i = 0; i < 6; i++) {
    const ax = -r * 0.65 + (i % 3) * r * 0.65;
    const ay = -r * 0.35 + Math.floor(i / 3) * r * 0.5;
    ctx.beginPath();
    ctx.arc(ax, ay, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main bombardment cannon — muzzle glow scales with charge
  ctx.fillStyle = '#170210';
  ctx.fillRect(-r * 0.22, r * 0.35, r * 0.44, r * 0.55);
  ctx.strokeStyle = '#fb7185';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-r * 0.22, r * 0.35, r * 0.44, r * 0.55);
  if (charge > 0.15) {
    ctx.fillStyle = `rgba(251, 113, 133, ${charge * 0.85})`;
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = qBlur(charge * 18);
    ctx.beginPath();
    ctx.arc(0, r * 0.85, r * 0.16 + charge * r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  // Twin prow cutter blades
  [-1, 1].forEach((dir) => {
    ctx.fillStyle = '#67011f';
    ctx.beginPath();
    ctx.moveTo(dir * r * 0.9, -r * 0.6);
    ctx.lineTo(dir * r * 1.25, -r * 0.15);
    ctx.lineTo(dir * r * 0.75, -r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fecdd3';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  ctx.restore();
}

function renderSpaceshipHull(
  ctx: CanvasRenderingContext2D,
  theme: string,
  r: number,
  primaryColor: string,
  timeSec: number,
  isEnraged: boolean
) {
  ctx.save();

  if (theme === 'asteroid_drill') {
    // Industrial Drill Marauder: Heavy armor with spinning titanium drill saws
    ctx.beginPath();
    ctx.moveTo(0, r * 0.9);
    ctx.lineTo(r * 0.6, r * 0.3);
    ctx.lineTo(r * 0.95, -r * 0.3);
    ctx.lineTo(r * 0.7, -r * 0.8);
    ctx.lineTo(-r * 0.7, -r * 0.8);
    ctx.lineTo(-r * 0.95, -r * 0.3);
    ctx.lineTo(-r * 0.6, r * 0.3);
    ctx.closePath();

    const g = ctx.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, '#064e3b');
    g.addColorStop(0.5, '#059669');
    g.addColorStop(1, '#022c22');
    ctx.fillStyle = g;
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = qBlur(14);
    ctx.fill();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Spinning Serrated Drill Saws on left and right flanks
    const drillRot = timeSec * 16;
    [-r * 0.85, r * 0.85].forEach((dx) => {
      ctx.save();
      ctx.translate(dx, 0);
      ctx.rotate(drillRot);
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const ang = (s / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * 9, Math.sin(ang) * 9);
        ctx.lineTo(Math.cos(ang + 0.3) * 14, Math.sin(ang + 0.3) * 14);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  } else if (theme === 'solar_wing') {
    // Solar Flare Cruiser: Angled sweeping flame wings
    ctx.beginPath();
    ctx.moveTo(0, r * 1.05);
    ctx.lineTo(r * 1.15, -r * 0.2); // Long swept solar wing
    ctx.lineTo(r * 0.8, -r * 0.75);
    ctx.lineTo(0, -r * 0.5);
    ctx.lineTo(-r * 0.8, -r * 0.75);
    ctx.lineTo(-r * 1.15, -r * 0.2);
    ctx.closePath();

    const g = ctx.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, '#7c2d12');
    g.addColorStop(0.5, '#ea580c');
    g.addColorStop(1, '#431407');
    ctx.fillStyle = g;
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = qBlur(16);
    ctx.fill();
    ctx.strokeStyle = '#fdba74';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if (theme === 'chrome_saucer') {
    // Chrome Saucer Mothership: Concentric flying saucer rings with rotating LED rim
    ctx.fillStyle = '#14b8a6';
    ctx.shadowColor = '#2dd4bf';
    ctx.shadowBlur = qBlur(16);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#99f6e4';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Rotating perimeter beacon lights
    const numLeds = 8;
    for (let i = 0; i < numLeds; i++) {
      const a = (i / numLeds) * Math.PI * 2 + timeSec * 4;
      const lx = Math.cos(a) * r * 0.95;
      const ly = Math.sin(a) * r * 0.72;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (theme === 'solar_titan') {
    // HELIOS PRIME: blazing coronal ring + radiant core furnace
    const pulse = Math.sin(timeSec * 6) * 0.12 + 0.88;
    const corona = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.15);
    corona.addColorStop(0, '#fffbeb');
    corona.addColorStop(0.45, '#f59e0b');
    corona.addColorStop(0.8, '#ea580c');
    corona.addColorStop(1, 'rgba(124, 45, 18, 0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15 * pulse, 0, Math.PI * 2);
    ctx.fill();
    // Rotating flare spikes
    ctx.strokeStyle = '#fdba74';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + timeSec * 1.4;
      const len = r * (1.25 + 0.25 * Math.sin(timeSec * 9 + i));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    // Dark core with white-hot eye
    ctx.fillStyle = '#7c2d12';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fed7aa';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (theme === 'nebula_leviathan') {
    // ABYSSUS MAW: bio-metallic whale-shark hull with glowing lure lights
    ctx.beginPath();
    ctx.moveTo(0, r * 1.05);
    ctx.quadraticCurveTo(r * 1.1, r * 0.25, r * 0.55, -r * 0.85);
    ctx.quadraticCurveTo(0, -r * 1.05, -r * 0.55, -r * 0.85);
    ctx.quadraticCurveTo(-r * 1.1, r * 0.25, 0, r * 1.05);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, '#155e75');
    g.addColorStop(0.55, '#0e7490');
    g.addColorStop(1, '#083344');
    ctx.fillStyle = g;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = qBlur(18);
    ctx.fill();
    ctx.strokeStyle = '#a5f3fc';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    // Bioluminescent lure spots down the spine
    for (let i = 0; i < 5; i++) {
      const ly = -r * 0.5 + i * r * 0.32;
      const glow = 0.5 + 0.5 * Math.sin(timeSec * 4 + i * 1.2);
      ctx.fillStyle = `rgba(103, 232, 249, ${glow})`;
      ctx.beginPath();
      ctx.arc(0, ly, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (theme === 'chrono_flagship') {
    // CHRONARCH ZETA: rotating clockwork gears + stalled-time halo
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.18, timeSec * 0.8, timeSec * 0.8 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Twin counter-rotating gears
    [-1, 1].forEach((dir) => {
      ctx.save();
      ctx.rotate(timeSec * dir * 1.6);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(dir * r * 0.55, 0, r * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      // Gear teeth
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(dir * r * 0.55 + Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
        ctx.lineTo(dir * r * 0.55 + Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52);
        ctx.stroke();
      }
      ctx.restore();
    });
    // Golden hourglass core
    ctx.fillStyle = '#854d0e';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.4, 0);
    ctx.lineTo(0, r * 0.55);
    ctx.lineTo(-r * 0.4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else if (theme === 'void_legion') {
    // DREAD EMPEROR NOX — HELL-DEMON WARSHIP: horned skull silhouette wreathed
    // in hellfire. Deliberately the most terrifying craft in the fleet: a
    // demon face straight out of the inferno, ram horns, blazing eye sockets,
    // a fanged jaw that breathes fire when enraged.
    // Outer hellfire aura (flickering inferno corona)
    const auraPulse = 0.6 + 0.4 * Math.sin(timeSec * 9);
    const aura = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.6);
    aura.addColorStop(0, `rgba(225, 29, 72, ${0.28 * auraPulse})`);
    aura.addColorStop(0.6, `rgba(190, 18, 60, ${0.16 * auraPulse})`);
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Massive curved RAM HORNS flanking the skull
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.55, -r * 0.55);
      ctx.quadraticCurveTo(side * r * 1.5, -r * 1.0, side * r * 1.05, -r * 1.55);
      ctx.quadraticCurveTo(side * r * 0.95, -r * 0.95, side * r * 0.3, -r * 0.72);
      ctx.closePath();
      const hg = ctx.createLinearGradient(side * r * 0.4, -r * 0.6, side * r * 1.2, -r * 1.4);
      hg.addColorStop(0, '#450a0a');
      hg.addColorStop(0.5, '#7f1d1d');
      hg.addColorStop(1, '#180204');
      ctx.fillStyle = hg;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = qBlur(14);
      ctx.fill();
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Horn ridge rings
      ctx.strokeStyle = 'rgba(254, 205, 211, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(side * r * (0.55 + i * 0.12), -r * (0.62 + i * 0.2));
        ctx.lineTo(side * r * (0.78 + i * 0.1), -r * (0.72 + i * 0.2));
        ctx.stroke();
      }
    });

    // Skull hull: cranium + cheekbones + fanged jaw
    ctx.beginPath();
    // cranium dome
    ctx.moveTo(-r * 0.62, -r * 0.35);
    ctx.quadraticCurveTo(0, -r * 0.95, r * 0.62, -r * 0.35);
    // right cheekbone out
    ctx.lineTo(r * 0.78, r * 0.05);
    ctx.lineTo(r * 0.45, r * 0.12);
    // jaw line down
    ctx.lineTo(r * 0.52, r * 0.75);
    // fanged jaw arc
    ctx.quadraticCurveTo(0, r * 1.05, -r * 0.52, r * 0.75);
    ctx.lineTo(-r * 0.45, r * 0.12);
    ctx.lineTo(-r * 0.78, r * 0.05);
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, -r, 0, r);
    sg.addColorStop(0, '#2a0a10');
    sg.addColorStop(0.45, '#5b0f1c');
    sg.addColorStop(1, '#150307');
    ctx.fillStyle = sg;
    ctx.shadowColor = '#e11d48';
    ctx.shadowBlur = qBlur(18);
    ctx.fill();
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Blazing EYE SOCKETS (twin infernos — flare when enraged)
    [-r * 0.3, r * 0.3].forEach((ex) => {
      const blaze = 0.65 + 0.35 * Math.sin(timeSec * 11 + ex);
      const eye = ctx.createRadialGradient(ex, -r * 0.22, 0, ex, -r * 0.22, r * 0.2);
      eye.addColorStop(0, isEnraged ? '#ffffff' : '#fde047');
      eye.addColorStop(0.35, isEnraged ? '#ff4d0f' : '#f97316');
      eye.addColorStop(1, 'rgba(190, 18, 60, 0)');
      ctx.fillStyle = eye;
      ctx.beginPath();
      ctx.ellipse(ex, -r * 0.22, r * 0.17, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Nasal cavity slit
    ctx.fillStyle = '#0c0206';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.05);
    ctx.lineTo(-r * 0.07, r * 0.3);
    ctx.lineTo(r * 0.07, r * 0.3);
    ctx.closePath();
    ctx.fill();

    // FANG ROW on the jaw (interlocking teeth)
    ctx.fillStyle = '#fecdd3';
    for (let i = -3; i <= 3; i++) {
      const fx = i * r * 0.13;
      const toothH = r * 0.18 * (1 - Math.abs(i) * 0.12);
      ctx.beginPath();
      ctx.moveTo(fx - r * 0.05, r * 0.58);
      ctx.lineTo(fx, r * 0.58 + toothH);
      ctx.lineTo(fx + r * 0.05, r * 0.58);
      ctx.closePath();
      ctx.fill();
    }

    // Enraged: fire breath through the jaw + falling ember chains
    if (isEnraged) {
      const breath = ctx.createLinearGradient(0, r * 0.75, 0, r * 1.4);
      breath.addColorStop(0, 'rgba(255, 190, 60, 0.85)');
      breath.addColorStop(0.5, 'rgba(239, 68, 68, 0.55)');
      breath.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = breath;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, r * 0.7);
      ctx.quadraticCurveTo(0, r * (1.25 + 0.12 * Math.sin(timeSec * 13)), r * 0.3, r * 0.7);
      ctx.closePath();
      ctx.fill();
      // Chain shackles swinging from the horns
      [-1, 1].forEach((side) => {
        const sway = Math.sin(timeSec * 5 + side) * 0.25;
        ctx.save();
        ctx.translate(side * r * 1.0, -r * 1.5);
        ctx.rotate(sway);
        ctx.strokeStyle = '#57534e';
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(0, i * 7 + 4, 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      });
    }
  } else if (theme === 'omega_core') {
    // OMEGA PRIME: prismatic convergence spire — every theme fused
    const rainbow = ['#f43f5e', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#818cf8'];
    rainbow.forEach((c, i) => {
      const a = (i / rainbow.length) * Math.PI * 2 + timeSec * 1.1;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.12, a, a + Math.PI * 0.45);
      ctx.stroke();
    });
    // Central nexus diamond
    ctx.rotate(timeSec * 0.9);
    const g = ctx.createLinearGradient(-r * 0.7, -r * 0.7, r * 0.7, r * 0.7);
    g.addColorStop(0, '#e0e7ff');
    g.addColorStop(0.5, '#818cf8');
    g.addColorStop(1, '#4c1d95');
    ctx.fillStyle = g;
    ctx.shadowColor = '#a5b4fc';
    ctx.shadowBlur = qBlur(22);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.85);
    ctx.lineTo(r * 0.62, 0);
    ctx.lineTo(0, r * 0.85);
    ctx.lineTo(-r * 0.62, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0e7ff';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (theme === 'armada_cruiser') {
    // HIGH INQUISITOR VEX — Imperial naval battleship: long gun-deck hull, three
    // triple-turret main batteries, conning tower with radar mast + fleet
    // pennant, blinking running lights along the waterline.
    ctx.save();
    ctx.rotate(Math.PI / 2); // bow-forward vertical silhouette
    // Long armored hull
    ctx.beginPath();
    ctx.moveTo(0, r * 1.35); // bow
    ctx.quadraticCurveTo(r * 0.55, r * 0.5, r * 0.5, -r * 0.9);
    ctx.lineTo(-r * 0.5, -r * 0.9); // flat stern
    ctx.quadraticCurveTo(-r * 0.55, r * 0.5, 0, r * 1.35);
    ctx.closePath();
    const ag = ctx.createLinearGradient(-r * 0.5, 0, r * 0.5, 0);
    ag.addColorStop(0, '#0c4a6e');
    ag.addColorStop(0.5, '#0369a1');
    ag.addColorStop(1, '#082f49');
    ctx.fillStyle = ag;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = qBlur(12);
    ctx.fill();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Hull waterline stripe + running lights
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(-r * 0.48, r * 0.55, r * 0.96, 2.5);
    for (let i = -2; i <= 2; i++) {
      const on = Math.sin(timeSec * 6 + i * 1.3) > 0;
      ctx.fillStyle = on ? '#fde047' : '#0f172a';
      ctx.beginPath();
      ctx.arc(i * r * 0.3, r * 0.72, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Three triple-turret main batteries down the centerline
    [r * 0.45, -r * 0.05, -r * 0.55].forEach((ty) => {
      ctx.fillStyle = '#0c1329';
      ctx.fillRect(-r * 0.3, ty - 5, r * 0.6, 10);
      ctx.fillStyle = '#38bdf8';
      [-1, 0, 1].forEach((b) => {
        ctx.fillRect(b * r * 0.2 - 2, ty - 8, 4, 9);
      });
    });
    // Conning tower + radar mast
    ctx.fillStyle = '#075985';
    ctx.fillRect(-r * 0.16, -r * 1.35, r * 0.32, r * 0.5);
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.35);
    ctx.lineTo(0, -r * 1.6);
    ctx.stroke();
    // Sweeping radar dish
    ctx.save();
    ctx.translate(0, -r * 1.6);
    ctx.rotate(timeSec * 3);
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, -0.6, 0.6);
    ctx.stroke();
    ctx.restore();
    // Fleet pennant flag (ripples)
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(r * 0.16, -r * 1.55);
    ctx.quadraticCurveTo(r * 0.4, -r * 1.5 + Math.sin(timeSec * 8) * 2, r * 0.52, -r * 1.42);
    ctx.lineTo(r * 0.16, -r * 1.38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (theme === 'scrap_titan') {
    // RUSTJAW — Junkyard golem: asymmetric stacked scrap plates, one giant
    // crane claw arm, exhaust stacks belching smoke, live welding sparks.
    // Asymmetry is the point — this thing was welded together from wrecks.
    // Bulky misaligned torso plates (deliberately off-center)
    const plates = [
      { x: -r * 0.45, y: -r * 0.55, w: r * 0.7, h: r * 0.5, c: '#57534e', rot: -0.12 },
      { x: r * 0.05, y: -r * 0.3, w: r * 0.85, h: r * 0.55, c: '#6b7280', rot: 0.09 },
      { x: -r * 0.3, y: r * 0.18, w: r * 0.75, h: r * 0.5, c: '#4b5563', rot: -0.05 },
      { x: r * 0.25, y: r * 0.42, w: r * 0.6, h: r * 0.45, c: '#78716c', rot: 0.14 },
    ];
    plates.forEach((p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.strokeStyle = '#a8a29e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-p.w / 2, -p.h / 2);
      ctx.lineTo(p.w / 2, -p.h / 2 + 4);
      ctx.lineTo(p.w / 2 - 3, p.h / 2);
      ctx.lineTo(-p.w / 2 - 2, p.h / 2 - 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Rivets
      ctx.fillStyle = '#d6d3d1';
      [-1, 1].forEach((sx) => {
        [-1, 1].forEach((sy) => {
          ctx.beginPath();
          ctx.arc((sx * p.w) / 2.6, (sy * p.h) / 3, 1.6, 0, Math.PI * 2);
          ctx.fill();
        });
      });
      ctx.restore();
    });
    // Exhaust stacks + rolling smoke
    [-r * 0.25, r * 0.15].forEach((sx) => {
      ctx.fillStyle = '#292524';
      ctx.fillRect(sx - 3, -r * 0.85, 6, r * 0.3);
      const puff = (timeSec * 0.8) % 1;
      ctx.fillStyle = `rgba(120, 113, 108, ${0.5 * (1 - puff)})`;
      ctx.beginPath();
      ctx.arc(sx, -r * (0.9 + puff * 0.5), 3 + puff * 5, 0, Math.PI * 2);
      ctx.fill();
    });
    // GIANT CRANE CLAW arm (right side) — opens and snaps
    const clawSnap = 0.5 + 0.5 * Math.sin(timeSec * 4);
    ctx.save();
    ctx.translate(r * 0.75, r * 0.1);
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.3);
    ctx.lineTo(0, 0);
    ctx.stroke();
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.rotate(side * (0.5 - clawSnap * 0.35));
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(side * r * 0.16, -r * 0.28);
      ctx.lineTo(side * r * 0.05, -r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
    // Live welding sparks (random flicker points)
    ctx.fillStyle = '#fde047';
    for (let i = 0; i < 4; i++) {
      if (Math.sin(timeSec * 21 + i * 2.7) > 0.3) {
        ctx.beginPath();
        ctx.arc(-r * 0.4 + i * r * 0.25, r * 0.25 + Math.sin(i * 3) * r * 0.2, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (theme === 'ai_matrix') {
    // SYNTH-PRIME 09 — Digital AI construct: floating hexagonal core,
    // counter-rotating data rings, circuit traces, glitch-scanline tear.
    // Hex core
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const hx = Math.cos(a) * r * 0.72;
      const hy = Math.sin(a) * r * 0.72;
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    const dg = ctx.createLinearGradient(-r * 0.7, -r * 0.7, r * 0.7, r * 0.7);
    dg.addColorStop(0, '#064e3b');
    dg.addColorStop(0.5, '#10b981');
    dg.addColorStop(1, '#022c22');
    ctx.fillStyle = dg;
    ctx.shadowColor = '#34d399';
    ctx.shadowBlur = qBlur(18);
    ctx.fill();
    ctx.strokeStyle = '#6ee7b7';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Circuit traces on the core
    ctx.strokeStyle = 'rgba(167, 243, 208, 0.7)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const yy = -r * 0.4 + i * r * 0.2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, yy);
      ctx.lineTo(-r * 0.2, yy);
      ctx.lineTo(-r * 0.1, yy + r * 0.08);
      ctx.lineTo(r * 0.4, yy + r * 0.08);
      ctx.stroke();
      ctx.fillStyle = '#a7f3d0';
      ctx.beginPath();
      ctx.arc(r * 0.4, yy + r * 0.08, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Counter-rotating data rings (dashed arcs)
    [-1, 1].forEach((dir) => {
      ctx.save();
      ctx.rotate(timeSec * dir * 1.2);
      ctx.strokeStyle = dir === 1 ? '#34d399' : '#a7f3d0';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
    // Glitch tear — horizontal RGB-split slices that jump around
    const glitchY = ((Math.floor(timeSec * 6) * 37) % 100 / 100 - 0.5) * r * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
    ctx.fillRect(-r * 1.0, glitchY - 3, r * 2.0, 6);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.fillRect(-r * 1.0, glitchY + 3, r * 2.0, 6);
    ctx.restore();
    // Scanning eye — single sweeping bar inside a visor slit
    ctx.fillStyle = '#022c22';
    ctx.fillRect(-r * 0.45, -r * 0.14, r * 0.9, r * 0.2);
    const scanX = Math.sin(timeSec * 5) * r * 0.35;
    const scan = ctx.createRadialGradient(scanX, -r * 0.04, 0, scanX, -r * 0.04, r * 0.14);
    scan.addColorStop(0, '#ffffff');
    scan.addColorStop(0.5, '#34d399');
    scan.addColorStop(1, 'rgba(52, 211, 153, 0)');
    ctx.fillStyle = scan;
    ctx.beginPath();
    ctx.arc(scanX, -r * 0.04, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else if (theme === 'quantum_rift') {
    // VOID WEAVER NYX — Reality tear: a vertical slit into nothing ringed by
    // spider-like weaver legs of light, with orbiting crystal shards that
    // shear off the tear itself. Not a ship — a wound in space.
    // Warped space halo behind the tear
    const warp = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.5);
    warp.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
    warp.addColorStop(0.5, 'rgba(126, 34, 206, 0.18)');
    warp.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = warp;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Spider weaver legs — 8 jagged light-legs splaying from the slit
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.sin(timeSec * 2 + i) * 0.15;
      const legLen = r * (1.1 + 0.25 * Math.sin(timeSec * 3 + i * 1.7));
      const jx = Math.cos(a) * legLen;
      const jy = Math.sin(a) * legLen;
      const kx = Math.cos(a + 0.35) * legLen * 0.55;
      const ky = Math.sin(a + 0.35) * legLen * 0.55;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(216, 180, 254, 0.9)' : 'rgba(168, 85, 247, 0.75)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(kx, ky);
      ctx.lineTo(jx, jy);
      ctx.stroke();
      // Claw tip glint
      ctx.fillStyle = '#f5f3ff';
      ctx.beginPath();
      ctx.arc(jx, jy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // The rift itself — a pulsing vertical void slit with light bleed
    const slitW = r * (0.16 + 0.06 * Math.sin(timeSec * 6));
    const bleed = ctx.createLinearGradient(-slitW, 0, slitW, 0);
    bleed.addColorStop(0, 'rgba(88, 28, 135, 0)');
    bleed.addColorStop(0.35, 'rgba(192, 132, 252, 0.9)');
    bleed.addColorStop(0.5, '#ffffff');
    bleed.addColorStop(0.65, 'rgba(192, 132, 252, 0.9)');
    bleed.addColorStop(1, 'rgba(88, 28, 135, 0)');
    ctx.fillStyle = bleed;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.quadraticCurveTo(slitW, 0, 0, r * 1.05);
    ctx.quadraticCurveTo(-slitW, 0, 0, -r * 1.05);
    ctx.fill();
    // Void core — pure black center
    ctx.fillStyle = '#030014';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.85);
    ctx.quadraticCurveTo(slitW * 0.5, 0, 0, r * 0.85);
    ctx.quadraticCurveTo(-slitW * 0.5, 0, 0, -r * 0.85);
    ctx.fill();
    // Orbiting crystal shards (sheared-off reality fragments)
    for (let i = 0; i < 5; i++) {
      const a = timeSec * 1.4 + (i / 5) * Math.PI * 2;
      const orbR = r * (0.85 + 0.15 * Math.sin(timeSec * 2 + i));
      const sx = Math.cos(a) * orbR;
      const sy = Math.sin(a) * orbR * 0.6;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a * 2);
      ctx.fillStyle = i % 2 ? '#e9d5ff' : '#c084fc';
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(3, 0);
      ctx.lineTo(0, 5);
      ctx.lineTo(-3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if (theme === 'cryo_leviathan') {
    // LORD GLACIUS — Ice serpent leviathan: a curving segmented crystal spine
    // with frost spikes, an icy maw that breathes freezing vapor, and hide
    // that crystallizes brighter as it rages.
    // Frozen vapor breath (behind)
    const vap = ctx.createRadialGradient(0, r * 0.9, 0, 0, r * 0.9, r * 1.5);
    vap.addColorStop(0, 'rgba(186, 230, 253, 0.35)');
    vap.addColorStop(1, 'rgba(186, 230, 253, 0)');
    ctx.fillStyle = vap;
    ctx.beginPath();
    ctx.arc(0, r * 0.9, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Serpentine spine: 6 segments curving in an S
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const segX = Math.sin(t * Math.PI * 1.6 + timeSec * 1.1) * r * 0.55;
      const segY = r * 0.9 - t * r * 1.7;
      const segR = r * (0.62 - t * 0.32);
      const ig = ctx.createLinearGradient(segX - segR, segY - segR, segX + segR, segY + segR);
      ig.addColorStop(0, '#e0f2fe');
      ig.addColorStop(0.5, '#7dd3fc');
      ig.addColorStop(1, '#0369a1');
      ctx.fillStyle = ig;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = qBlur(12);
      ctx.beginPath();
      ctx.ellipse(segX, segY, segR, segR * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // Frost spikes on each segment (point outward)
      ctx.fillStyle = '#bae6fd';
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(segX + side * segR * 0.5, segY - segR * 0.55);
        ctx.lineTo(segX + side * segR * 0.75, segY - segR * 1.05);
        ctx.lineTo(segX + side * segR * 0.85, segY - segR * 0.4);
        ctx.closePath();
        ctx.fill();
      });
    }
    // Head: icy maw with fangs + glowing deep-blue eyes
    const headY = r * 0.75;
    const hgd = ctx.createLinearGradient(0, headY - r * 0.5, 0, headY + r * 0.5);
    hgd.addColorStop(0, '#f0f9ff');
    hgd.addColorStop(0.5, '#38bdf8');
    hgd.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = hgd;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, headY - r * 0.15);
    ctx.quadraticCurveTo(0, headY - r * 0.65, r * 0.5, headY - r * 0.15);
    ctx.quadraticCurveTo(r * 0.4, headY + r * 0.45, 0, headY + r * 0.55);
    ctx.quadraticCurveTo(-r * 0.4, headY + r * 0.45, -r * 0.5, headY - r * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // Ice fangs in the maw
    ctx.fillStyle = '#f0f9ff';
    [-2, -1, 0, 1, 2].forEach((i) => {
      const fx = i * r * 0.16;
      const fh = r * 0.16 * (1 - Math.abs(i) * 0.15);
      ctx.beginPath();
      ctx.moveTo(fx - r * 0.045, headY + r * 0.12);
      ctx.lineTo(fx, headY + r * 0.12 + fh);
      ctx.lineTo(fx + r * 0.045, headY + r * 0.12);
      ctx.closePath();
      ctx.fill();
    });
    // Glacial eyes (pale furious blue)
    [-r * 0.26, r * 0.26].forEach((ex) => {
      ctx.fillStyle = isEnraged ? '#ffffff' : '#bae6fd';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = qBlur(8);
      ctx.beginPath();
      ctx.ellipse(ex, headY - r * 0.18, r * 0.1, r * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = qBlur(0);
    });
  } else if (theme === 'bio_organism') {
    // QUEEN XOL'ZARA — Hive mother: a LIVING creature, not a ship. Pulsing
    // biomass sacs, glistening egg clusters, a crown of chitin, waving
    // feeding tendrils and a fanged ovipositor maw. Genuinely an alien
    // monster bursting out of the cockpit convention.
    // Membrane aura (organic sheen)
    const skin = 0.5 + 0.5 * Math.sin(timeSec * 3.2);
    const bio = ctx.createRadialGradient(0, -r * 0.1, r * 0.2, 0, 0, r * 1.5);
    bio.addColorStop(0, `rgba(190, 24, 93, ${0.22 + skin * 0.12})`);
    bio.addColorStop(1, 'rgba(190, 24, 93, 0)');
    ctx.fillStyle = bio;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Main pulsing body — two fused abdominal sacs (heartbeat scale)
    const beat = 1 + 0.05 * Math.sin(timeSec * 4.5);
    ctx.save();
    ctx.scale(beat, beat);
    const bodyG = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r * 0.95);
    bodyG.addColorStop(0, '#be185d');
    bodyG.addColorStop(0.55, '#831843');
    bodyG.addColorStop(1, '#4c0519');
    ctx.fillStyle = bodyG;
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = qBlur(16);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.78, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f9a8d4';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Bioluminescent veins (branching glow lines)
    ctx.strokeStyle = `rgba(249, 168, 212, ${0.5 + skin * 0.3})`;
    ctx.lineWidth = 1.4;
    [[-0.5, -0.3, -0.75, 0.1], [-0.3, 0.2, -0.55, 0.55], [0.3, -0.35, 0.7, -0.05], [0.45, 0.25, 0.65, 0.6]].forEach(
      (v) => {
        ctx.beginPath();
        ctx.moveTo(v[0] * r, v[1] * r);
        ctx.quadraticCurveTo((v[0] + v[2]) / 2 * r, (v[1] + v[3]) / 2 * r + Math.sin(timeSec * 2 + v[0] * 9) * 3, v[2] * r, v[3] * r);
        ctx.stroke();
      }
    );
    ctx.restore();
    // Egg cluster sacs along the underside (glistening orbs)
    for (let i = -2; i <= 2; i++) {
      const eggX = i * r * 0.32;
      const eggY = r * (0.55 + Math.abs(i) * 0.06);
      const eggG = ctx.createRadialGradient(eggX - 2, eggY - 3, 1, eggX, eggY, r * 0.16);
      eggG.addColorStop(0, '#fbcfe8');
      eggG.addColorStop(0.6, '#ec4899');
      eggG.addColorStop(1, '#701a3f');
      ctx.fillStyle = eggG;
      ctx.beginPath();
      ctx.ellipse(eggX, eggY, r * 0.13, r * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      // Hatching twitch on random eggs
      if (Math.sin(timeSec * 7 + i * 4.1) > 0.55) {
        ctx.strokeStyle = '#f9a8d4';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(eggX, eggY - r * 0.16);
        ctx.lineTo(eggX + Math.sin(timeSec * 9 + i) * 4, eggY - r * 0.26);
        ctx.stroke();
      }
    }
    // Chitin crown plate on top
    ctx.fillStyle = '#500724';
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.45);
    ctx.lineTo(-r * 0.35, -r * 0.95);
    ctx.lineTo(-r * 0.12, -r * 0.55);
    ctx.lineTo(0, -r * 1.1);
    ctx.lineTo(r * 0.12, -r * 0.55);
    ctx.lineTo(r * 0.35, -r * 0.95);
    ctx.lineTo(r * 0.5, -r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Waving feeding tendrils (4, two per side, sinusoid swim)
    [-1, 1].forEach((side) => {
      [0.35, 0.6].forEach((ty, k) => {
        ctx.strokeStyle = k === 0 ? '#f472b6' : '#db2777';
        ctx.lineWidth = 2.6 - k * 0.6;
        ctx.beginPath();
        ctx.moveTo(side * r * 0.7, -r * ty);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const tt = s / segs;
          const wig = Math.sin(timeSec * 5 + side * k * 2 + tt * 4) * r * 0.22 * tt;
          ctx.quadraticCurveTo(
            side * r * (0.7 + tt * 0.35),
            -r * ty + tt * r * 0.5 + wig * 0.5,
            side * r * (0.75 + tt * 0.55),
            -r * ty + tt * r * 1.1 + wig
          );
        }
        ctx.stroke();
      });
    });
    // Fanged ovipositor maw (bottom — the part that faces Gaia)
    ctx.fillStyle = '#4c0519';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, r * 0.78);
    ctx.quadraticCurveTo(0, r * 1.15, r * 0.3, r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f9a8d4';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#fce7f3';
    [-2, -1, 0, 1, 2].forEach((i) => {
      const fx = i * r * 0.1;
      ctx.beginPath();
      ctx.moveTo(fx - 2, r * 0.82);
      ctx.lineTo(fx, r * 0.82 + r * 0.1 * (1 - Math.abs(i) * 0.18));
      ctx.lineTo(fx + 2, r * 0.82);
      ctx.closePath();
      ctx.fill();
    });
  } else if (theme === 'singularity_core') {
    // SOVEREIGN CHRONOS — Singularity engine: a black hole flagship. Event
    // horizon sphere, swirling accretion disk, lensed light ring, and orbiting
    // star specks being devoured. The ultimate "not a ship" flagship.
    // Lensed light ring (Einstein ring)
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
    ctx.stroke();
    // Accretion disk — swirling elliptical bands
    for (let i = 0; i < 3; i++) {
      const diskR = r * (0.95 + i * 0.18);
      const rot = timeSec * (1.6 - i * 0.4);
      ctx.save();
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, diskR, diskR * 0.38, 0, 0, Math.PI * 2);
      const acg = ctx.createLinearGradient(-diskR, 0, diskR, 0);
      acg.addColorStop(0, 'rgba(251, 191, 36, 0.05)');
      acg.addColorStop(0.25, `rgba(253, 224, 71, ${0.55 - i * 0.13})`);
      acg.addColorStop(0.5, 'rgba(249, 115, 22, 0.7)');
      acg.addColorStop(0.75, `rgba(253, 224, 71, ${0.55 - i * 0.13})`);
      acg.addColorStop(1, 'rgba(251, 191, 36, 0.05)');
      ctx.fillStyle = acg;
      ctx.fill();
      ctx.restore();
    }
    // Hot inner disk rim — brightest at the horizon edge
    const rim = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 0.75);
    rim.addColorStop(0, 'rgba(255, 255, 255, 0)');
    rim.addColorStop(0.7, 'rgba(254, 240, 138, 0.8)');
    rim.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
    ctx.fill();
    // Event horizon — pure void sphere
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Chronal eye — a single golden slit INSIDE the void (it watches)
    const gaze = 0.6 + 0.4 * Math.sin(timeSec * 2.4);
    ctx.fillStyle = `rgba(253, 224, 71, ${gaze})`;
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = qBlur(10);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.16, r * 0.045, Math.sin(timeSec * 0.7) * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = qBlur(0);
    // Devoured star specks spiraling in
    for (let i = 0; i < 4; i++) {
      const phase = timeSec * 0.9 + (i / 4) * Math.PI * 2;
      const spiral = (phase % (Math.PI * 2)) / (Math.PI * 2);
      const starR = r * (1.45 - spiral * 0.9);
      const sa = phase * 2;
      ctx.fillStyle = `rgba(226, 232, 240, ${0.9 - spiral * 0.5})`;
      ctx.beginPath();
      ctx.arc(Math.cos(sa) * starR, Math.sin(sa) * starR * 0.6, 1.8 - spiral, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Universal Imperial Battle Cruiser hull (fallback)
    ctx.beginPath();
    ctx.moveTo(0, r * 1.1);
    ctx.lineTo(r * 0.65, r * 0.4);
    ctx.lineTo(r * 1.1, -r * 0.35);
    ctx.lineTo(r * 0.75, -r * 0.8);
    ctx.lineTo(-r * 0.75, -r * 0.8);
    ctx.lineTo(-r * 1.1, -r * 0.35);
    ctx.lineTo(-r * 0.65, r * 0.4);
    ctx.closePath();

    const g = ctx.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, '#1e1b4b');
    g.addColorStop(0.5, primaryColor);
    g.addColorStop(1, '#0f172a');
    ctx.fillStyle = g;
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = qBlur(16);
    ctx.fill();
    ctx.strokeStyle = isEnraged ? '#fca5a5' : '#e0e7ff';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Forward Turret Sponsons
    [-r * 0.65, r * 0.65].forEach((tx) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(tx - 3, r * 0.1, 6, 12);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(tx, r * 0.1, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}

// --- Hypersonic Cruise Missile (boss ordnance) ---
function renderHypersonicMissile(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;

  ctx.save();
  // Nose points along the live flight path (t.angle is maintained by the
  // engine's guidance code, already in screen space).
  ctx.rotate(t.angle + Math.PI / 2);

  // Ramjet exhaust plume behind the tail
  const plume = 0.7 + Math.sin(timeSec * 30 + (t.missileWeavePhase ?? 0)) * 0.3;
  const plumeGrad = ctx.createLinearGradient(0, r * 1.2, 0, r * 2.6);
  plumeGrad.addColorStop(0, `rgba(251, 146, 60, ${0.85 * plume})`);
  plumeGrad.addColorStop(0.5, `rgba(244, 63, 94, ${0.5 * plume})`);
  plumeGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');
  ctx.fillStyle = plumeGrad;
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, r * 1.2);
  ctx.lineTo(r * 0.45, r * 1.2);
  ctx.lineTo(0, r * 2.6);
  ctx.closePath();
  ctx.fill();

  // Sleek dart warhead hull
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, '#450a0a');
  hull.addColorStop(0.5, '#e11d48');
  hull.addColorStop(1, '#450a0a');
  ctx.fillStyle = hull;
  ctx.shadowColor = '#f43f5e';
  ctx.shadowBlur = qBlur(12);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.35);
  ctx.lineTo(r * 0.62, r * 0.25);
  ctx.lineTo(r * 0.4, r * 1.05);
  ctx.lineTo(-r * 0.4, r * 1.05);
  ctx.lineTo(-r * 0.62, r * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = qBlur(0);
  ctx.strokeStyle = '#fecdd3';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Swept stabilizer fins
  ctx.fillStyle = '#7f1d1d';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.55, r * 0.1);
    ctx.lineTo(side * r * 1.25, r * 0.95);
    ctx.lineTo(side * r * 0.42, r * 0.85);
    ctx.closePath();
    ctx.fill();
  });

  // Red-hot seeker nose + blinking guidance light
  const nose = ctx.createRadialGradient(0, -r * 1.1, 0, 0, -r * 1.1, r * 0.75);
  nose.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  nose.addColorStop(0.4, 'rgba(254, 205, 211, 0.7)');
  nose.addColorStop(1, 'rgba(244, 63, 94, 0)');
  ctx.fillStyle = nose;
  ctx.beginPath();
  ctx.arc(0, -r * 1.1, r * 0.75, 0, Math.PI * 2);
  ctx.fill();

  if (Math.sin(timeSec * 14 + (t.missileWeavePhase ?? 0)) > 0) {
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// --- Cluster Bomb & Bomblet (airburst ordnance) ---
function renderClusterBomb(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;
  const isParent = t.type === 'cluster_bomb';
  const fuseLeft = t.clusterFuse ?? 3.4;
  const urgent = isParent && fuseLeft < 1.2;

  ctx.save();
  ctx.rotate(t.angle);

  // Iron bomb body (bomblets are tumbling miniatures)
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, '#431407');
  hull.addColorStop(0.5, '#c2410c');
  hull.addColorStop(1, '#431407');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(0, r * 1.05);
  ctx.quadraticCurveTo(r * 0.85, r * 0.2, r * 0.55, -r * 0.55);
  ctx.quadraticCurveTo(0, -r * 1.25, -r * 0.55, -r * 0.55);
  ctx.quadraticCurveTo(-r * 0.85, r * 0.2, 0, r * 1.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fed7aa';
  ctx.lineWidth = isParent ? 1.4 : 1;
  ctx.stroke();

  // Tail fins
  ctx.fillStyle = '#7c2d12';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.3, -r * 0.75);
    ctx.lineTo(side * r * 0.95, -r * 0.55);
    ctx.lineTo(side * r * 0.3, -r * 0.35);
    ctx.closePath();
    ctx.fill();
  });

  // Warning bands
  ctx.fillStyle = '#fdba74';
  ctx.fillRect(-r * 0.5, r * 0.05, r, isParent ? 3 : 2);

  // Blinking fuse light — strobes urgently in the final second
  const blinkOn = Math.sin(timeSec * (urgent ? 26 : 9)) > 0;
  if (isParent && blinkOn) {
    const glow = ctx.createRadialGradient(0, r * 1.1, 0, 0, r * 1.1, r * 0.9);
    glow.addColorStop(0, urgent ? 'rgba(254, 240, 138, 0.95)' : 'rgba(248, 113, 113, 0.85)');
    glow.addColorStop(1, 'rgba(248, 113, 113, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, r * 1.1, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// --- MIRV Warhead Bus (separable multi-warhead) ---
function renderMirvWarhead(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;
  const stage = Math.min(1, Math.max(0, (430 - t.y) / 430)); // separation imminence

  ctx.save();
  ctx.rotate(t.angle + Math.PI / 2);

  // Separation staging: the trident nose splits visibly as it descends
  const noseSpread = 0.12 + stage * 0.5;

  // Engine plume
  const plume = 0.7 + Math.sin(timeSec * 26 + (t.missileWeavePhase ?? 0)) * 0.3;
  const plumeGrad = ctx.createLinearGradient(0, r * 1.1, 0, r * 2.4);
  plumeGrad.addColorStop(0, `rgba(251, 113, 133, ${0.8 * plume})`);
  plumeGrad.addColorStop(1, 'rgba(251, 113, 133, 0)');
  ctx.fillStyle = plumeGrad;
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, r * 1.1);
  ctx.lineTo(r * 0.5, r * 1.1);
  ctx.lineTo(0, r * 2.4);
  ctx.closePath();
  ctx.fill();

  // Trident nose cones (the 3 child seekers peeking from the bus)
  [-1, 0, 1].forEach((lane) => {
    const lx = lane * r * noseSpread;
    const hull = ctx.createLinearGradient(lx - r * 0.4, 0, lx + r * 0.4, 0);
    hull.addColorStop(0, '#4c0519');
    hull.addColorStop(0.5, '#fb7185');
    hull.addColorStop(1, '#4c0519');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(lx, -r * 1.35);
    ctx.lineTo(lx + r * 0.42, r * 0.3);
    ctx.lineTo(lx - r * 0.42, r * 0.3);
    ctx.closePath();
    ctx.fill();
  });

  // Bus body ring
  ctx.fillStyle = '#881337';
  ctx.fillRect(-r * 0.62, r * 0.3, r * 1.24, r * 0.62);
  ctx.strokeStyle = '#fecdd3';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-r * 0.62, r * 0.3, r * 1.24, r * 0.62);

  // Staging indicator — lights chase faster as separation nears
  for (let s = 0; s < 3; s++) {
    const on = (timeSec * (4 + stage * 10) + s * 0.33) % 1 < 0.5;
    if (on) {
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(-r * 0.35 + s * r * 0.35, r * 0.61, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// --- Railgun Slug (hypervelocity kinetic dart) ---
function renderRailgunSlug(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;
  const charging = (t.vy ?? 0) === 0;

  ctx.save();
  ctx.rotate(t.angle + Math.PI / 2);

  if (charging) {
    // Pre-fire charge bloom — the slug glows white-hot with rings
    const charge = Math.min(1, ((t.specialTimer ?? 0) % 1) / 0.9);
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
    bloom.addColorStop(0, 'rgba(165, 243, 252, 0.85)');
    bloom.addColorStop(0.4, `rgba(34, 211, 238, ${0.4 + charge * 0.3})`);
    bloom.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    for (let ring = 0; ring < 2; ring++) {
      ctx.strokeStyle = `rgba(165, 243, 252, ${0.5 - ring * 0.2})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.4 + ring * 0.6) - (timeSec * 20 % r), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    // In flight: long ionized bore streak behind the dart
    const streak = ctx.createLinearGradient(0, r, 0, r * 7);
    streak.addColorStop(0, 'rgba(34, 211, 238, 0.55)');
    streak.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = streak;
    ctx.fillRect(-r * 0.3, r, r * 0.6, r * 6);
  }

  // Tungsten dart hull
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, '#083344');
  hull.addColorStop(0.5, '#22d3ee');
  hull.addColorStop(1, '#083344');
  ctx.fillStyle = hull;
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = qBlur(charging ? 18 : 12);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.5);
  ctx.lineTo(r * 0.45, r * 0.1);
  ctx.lineTo(r * 0.3, r * 0.95);
  ctx.lineTo(-r * 0.3, r * 0.95);
  ctx.lineTo(-r * 0.45, r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = qBlur(0);
  ctx.strokeStyle = '#cffafe';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Sabot petals
  ctx.fillStyle = '#155e75';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.4, -r * 0.2);
    ctx.lineTo(side * r * 0.85, r * 0.5);
    ctx.lineTo(side * r * 0.35, r * 0.55);
    ctx.closePath();
    ctx.fill();
  });

  // Hot nose
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -r * 1.2, r * 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- Plasma Torpedo (slow homing energy weapon) ---
function renderPlasmaTorpedo(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;
  const pulse = Math.sin(timeSec * 7 + idPhase(t.id)) * 0.5 + 0.5;

  ctx.save();

  // Outer plasma sheath — living energy halo
  const sheath = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.1);
  sheath.addColorStop(0, `rgba(217, 70, 239, ${0.5 + pulse * 0.25})`);
  sheath.addColorStop(0.45, `rgba(240, 171, 252, ${0.25 + pulse * 0.15})`);
  sheath.addColorStop(1, 'rgba(217, 70, 239, 0)');
  ctx.fillStyle = sheath;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(t.angle + Math.PI / 2);

  // torpedo core
  const core = ctx.createLinearGradient(0, -r, 0, r);
  core.addColorStop(0, '#f0abfc');
  core.addColorStop(0.5, '#a21caf');
  core.addColorStop(1, '#4a044e');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.2);
  ctx.quadraticCurveTo(r * 0.75, -r * 0.1, r * 0.5, r * 0.75);
  ctx.quadraticCurveTo(0, r * 1.15, -r * 0.5, r * 0.75);
  ctx.quadraticCurveTo(-r * 0.75, -r * 0.1, 0, -r * 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(240, 171, 252, ${0.7 + pulse * 0.3})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Arcing energy tendrils over the hull
  ctx.strokeStyle = `rgba(250, 232, 255, ${0.5 + pulse * 0.4})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, -r * 0.5);
  ctx.quadraticCurveTo(0, -r * 0.1 + Math.sin(timeSec * 11) * 4, r * 0.4, -r * 0.5);
  ctx.moveTo(-r * 0.3, r * 0.2);
  ctx.quadraticCurveTo(0, r * 0.55 + Math.cos(timeSec * 9) * 4, r * 0.3, r * 0.2);
  ctx.stroke();

  // Bright reactor heart
  ctx.fillStyle = `rgba(253, 244, 255, ${0.8 + pulse * 0.2})`;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3 + pulse * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- Siege Carrier (drone-launching mothership) ---
function renderSiegeCarrier(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;

  ctx.save();

  // Wide flat-top hull — an aerial aircraft carrier
  const hull = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
  hull.addColorStop(0, '#0c4a6e');
  hull.addColorStop(0.5, '#0369a1');
  hull.addColorStop(1, '#082f49');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-r * 1.45, -r * 0.15);
  ctx.quadraticCurveTo(-r * 1.2, -r * 0.55, 0, -r * 0.5);
  ctx.quadraticCurveTo(r * 1.2, -r * 0.55, r * 1.45, -r * 0.15);
  ctx.quadraticCurveTo(r * 1.1, r * 0.55, 0, r * 0.6);
  ctx.quadraticCurveTo(-r * 1.1, r * 0.55, -r * 1.45, -r * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Twin hangar bays with landing lights
  [-0.62, 0.62].forEach((bx) => {
    const bxr = bx * r;
    ctx.fillStyle = '#062c45';
    ctx.beginPath();
    ctx.ellipse(bxr, r * 0.12, r * 0.42, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // Runway strobes chase toward the bay mouth
    for (let s = 0; s < 3; s++) {
      const on = (timeSec * 5 + s * 0.33 + (bx > 0 ? 0.5 : 0)) % 1 < 0.5;
      if (on) {
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(bxr, r * 0.12 - r * 0.14 + s * r * 0.14, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  // Island command tower
  ctx.fillStyle = '#0e7490';
  ctx.fillRect(-r * 0.14, -r * 0.85, r * 0.28, r * 0.4);
  ctx.fillStyle = '#fde047';
  if (Math.sin(timeSec * 6) > 0) {
    ctx.beginPath();
    ctx.arc(0, -r * 0.9, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Engine pods under the stern
  ctx.fillStyle = '#0c4a6e';
  [-0.95, 0.95].forEach((ex) => {
    ctx.beginPath();
    ctx.ellipse(ex * r, r * 0.45, r * 0.2, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  // Thruster glows
  [-0.95, 0.95].forEach((ex) => {
    const thrust = ctx.createRadialGradient(ex * r, r * 0.55, 0, ex * r, r * 0.55, r * 0.35);
    thrust.addColorStop(0, 'rgba(56, 189, 248, 0.7)');
    thrust.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = thrust;
    ctx.beginPath();
    ctx.arc(ex * r, r * 0.55, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

// --- Tesla Node (chain-lightning arc satellite) ---
function renderTeslaNode(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;
  const charge = Math.min(1, (t.teslaCharge ?? 0) / 3.4);
  const arc = charge > 0.6 ? Math.sin(timeSec * 30) * 0.5 + 0.5 : 0;

  ctx.save();

  // Tesla coil tower: base disc → secondary winding → topload toroid
  ctx.fillStyle = '#422006';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // Secondary coil windings
  for (let wgt = 0; wgt < 5; wgt++) {
    const wy = r * 0.35 - wgt * r * 0.22;
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(0, wy, r * (0.42 - wgt * 0.045), r * 0.09, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Topload toroid — glows with accumulated charge
  const glow = 0.45 + charge * 0.55;
  ctx.strokeStyle = `rgba(250, 204, 21, ${glow})`;
  ctx.lineWidth = 3;
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = qBlur(6 + charge * 16);
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.75, r * 0.55, r * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = qBlur(0);

  // Crackling mini-arcs between topload and mast as the charge peaks
  if (arc > 0) {
    ctx.strokeStyle = `rgba(253, 224, 71, ${arc})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let s = 0; s < 3; s++) {
      const sx = (s - 1) * r * 0.35;
      ctx.moveTo(sx, -r * 0.75);
      ctx.lineTo(sx + (Math.random() - 0.5) * 10, -r * 1.05 + Math.random() * 6);
    }
    ctx.stroke();
  }

  // Charged particle orbit ring
  ctx.strokeStyle = `rgba(250, 204, 21, ${0.3 + charge * 0.4})`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.35, timeSec * 2, timeSec * 2 + Math.PI * 1.6);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

// --- Hunter-Killer (lock-on stalker craft) ---
function renderHunterKiller(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;
  const diving = !!t.isDiving;

  ctx.save();
  ctx.rotate(t.angle + Math.PI / 2);

  // Afterburner flare (stronger in the terminal dive)
  if (diving) {
    const flare = 0.7 + Math.sin(timeSec * 32) * 0.3;
    const fg = ctx.createLinearGradient(0, r * 0.9, 0, r * 2.5);
    fg.addColorStop(0, `rgba(248, 113, 113, ${0.8 * flare})`);
    fg.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, r * 0.9);
    ctx.lineTo(r * 0.45, r * 0.9);
    ctx.lineTo(0, r * 2.5);
    ctx.closePath();
    ctx.fill();
  }

  // Angular stealth dart hull — black-red faceted
  const hull = ctx.createLinearGradient(-r, 0, r, 0);
  hull.addColorStop(0, '#450a0a');
  hull.addColorStop(0.5, '#b91c1c');
  hull.addColorStop(1, '#450a0a');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.4);
  ctx.lineTo(r * 0.9, r * 0.2);
  ctx.lineTo(r * 0.35, r * 0.9);
  ctx.lineTo(-r * 0.35, r * 0.9);
  ctx.lineTo(-r * 0.9, r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Facet lines
  ctx.strokeStyle = 'rgba(252, 165, 165, 0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.4);
  ctx.lineTo(0, r * 0.9);
  ctx.moveTo(-r * 0.9, r * 0.2);
  ctx.lineTo(r * 0.9, r * 0.2);
  ctx.stroke();

  // Sensor eye — pulses while tracking, locks solid red when diving
  const eye = diving ? 1 : Math.sin(timeSec * 8) * 0.5 + 0.5;
  ctx.fillStyle = `rgba(254, 226, 226, ${eye})`;
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = qBlur(diving ? 14 : 6);
  ctx.beginPath();
  ctx.arc(0, -r * 0.35, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = qBlur(0);

  ctx.restore();
}

// --- Mirror Shade (holographic decoy pair) ---
function renderMirrorShade(ctx: CanvasRenderingContext2D, t: Threat, timeSec: number) {
  const r = t.radius;

  ctx.save();

  // Hologram tell: the DECOY stutters its opacity; the real one stays solid
  if (t.isHoloDecoy) {
    const stutter = Math.sin(timeSec * 17 + idPhase(t.id)) > -0.25 ? 0.75 : 0.35;
    ctx.globalAlpha = stutter;
    // Scanline shimmer band sweeping the hull
    const scanY = ((timeSec * 0.6) % 1) * r * 2 - r;
    ctx.strokeStyle = 'rgba(196, 181, 253, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, scanY);
    ctx.lineTo(r * 1.1, scanY);
    ctx.stroke();
  }

  // Crystalline faceted hull
  const hull = ctx.createLinearGradient(-r, -r, r, r);
  hull.addColorStop(0, '#4c1d95');
  hull.addColorStop(0.5, '#8b5cf6');
  hull.addColorStop(1, '#312e81');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.lineTo(r * 0.95, -r * 0.1);
  ctx.lineTo(r * 0.55, r * 0.95);
  ctx.lineTo(-r * 0.55, r * 0.95);
  ctx.lineTo(-r * 0.95, -r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = t.isHoloDecoy ? 'rgba(196, 181, 253, 0.8)' : '#c4b5fd';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Crystal facet edges
  ctx.strokeStyle = 'rgba(237, 233, 254, 0.55)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, -r * 0.1);
  ctx.lineTo(0, r * 0.35);
  ctx.lineTo(r * 0.95, -r * 0.1);
  ctx.moveTo(0, -r * 1.25);
  ctx.lineTo(0, r * 0.95);
  ctx.stroke();

  // Glinting core — the "mirror heart"
  const glint = Math.sin(timeSec * 5 + idPhase(t.id)) * 0.5 + 0.5;
  const core = ctx.createRadialGradient(0, r * 0.35, 0, 0, r * 0.35, r * 0.55);
  core.addColorStop(0, `rgba(237, 233, 254, ${0.7 + glint * 0.3})`);
  core.addColorStop(1, 'rgba(139, 92, 246, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, r * 0.35, r * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

