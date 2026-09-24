// lib/three/enemyMeshes.ts — procedural 3D mesh factory for Gaia Frontier.
//
// Every hostile, goodie, projectile and turret from the 2D canvas game gets a
// real WebGL mesh built from primitives (no external model assets, so the
// bundle stays tiny and PWA-friendly). Ships face +Z ("nose forward") and are
// authored at ~1 world unit per logical pixel of threat radius, so the
// renderer can scale a group straight from `t.radius`.
import * as THREE from 'three';
import { Goodie, Threat, ThreatType, Projectile } from '../types';

// ---------------------------------------------------------------------------
// Materials & shared textures
// ---------------------------------------------------------------------------

const texCache = new Map<string, THREE.Texture>();

function glowTexture(): THREE.Texture {
  let tex = texCache.get('__glow');
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    texCache.set('__glow', tex);
  }
  return tex;
}

/** Billboard glow sprite (additive) — the workhorse for engines, bullets, orbs. */
export function glowSprite(color: string | number, scale: number, opacity = 0.9): THREE.Sprite {
  const sm = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const s = new THREE.Sprite(sm);
  s.scale.set(scale, scale, 1);
  return s;
}

/** Emoji icon texture for goodies (cached per glyph). */
function iconTexture(icon: string): THREE.Texture {
  let tex = texCache.get(`icon:${icon}`);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '48px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, 32, 36);
    tex = new THREE.CanvasTexture(c);
    texCache.set(`icon:${icon}`, tex);
  }
  return tex;
}

function hullMat(color: string | number, metalness = 0.45, roughness = 0.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness,
    roughness,
  });
}

function emissiveMat(color: string | number, intensity = 1.4): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.5,
    toneMapped: false,
  });
}

function glassMat(color: string | number, opacity = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.2,
    roughness: 0.15,
    transparent: true,
    opacity,
  });
}

// ---------------------------------------------------------------------------
// Primitive kit
// ---------------------------------------------------------------------------

/** Sleek fighter hull: cone body with a pointed nose toward +Z. */
function fighterHull(color: string, len: number, wid: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(wid, len, 6);
  geo.rotateX(Math.PI / 2); // nose → +Z
  geo.translate(0, 0, len * 0.1);
  return new THREE.Mesh(geo, hullMat(color));
}

function wingPair(color: string, span: number, chord: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(span, 1.6, chord);
  const m = new THREE.Mesh(geo, hullMat(color, 0.5, 0.5));
  m.position.z = -chord * 0.1;
  return m;
}

function engineBlock(color: string, r: number): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 3, 10), hullMat('#334155'));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const flame = glowSprite(color, r * 6, 0.8);
  flame.position.z = -2.5;
  g.add(flame);
  return g;
}

function canopy(skin: string): THREE.Mesh {
  const geo = new THREE.SphereGeometry(2.6, 10, 8);
  return new THREE.Mesh(geo, glassMat(skin, 0.7));
}

/** Alien pilot bust — visible through the boss canopy (era boss flavour). */
function pilotBust(skinColor: string, eyeColor: string): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), hullMat(skinColor, 0.1, 0.7));
  const eyeMat = emissiveMat(eyeColor, 2.2);
  for (const dx of [-0.9, 0.9]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), eyeMat);
    eye.position.set(dx, 0.3, 2.1);
    g.add(eye);
  }
  g.add(head);
  return g;
}

function fract(n: number) {
  return n - Math.floor(n);
}

function rock(color: string, radius: number, seed: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.78 + 0.44 * fract(Math.sin(seed + i * 12.9898) * 43758.5453);
    pos.setXYZ(i, pos.getX(i) * jitter, pos.getY(i) * jitter, pos.getZ(i) * jitter);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.95,
      metalness: 0.08,
      flatShading: true,
    })
  );
}

function shieldDome(radius: number, color: string): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 18, 12);
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  );
}

function shade(color: string, amt: number): string {
  const c = new THREE.Color(color);
  if (amt >= 0) c.lerp(new THREE.Color('#ffffff'), amt);
  else c.lerp(new THREE.Color('#020617'), -amt);
  return `#${c.getHexString()}`;
}

function mixGold(color: string): string {
  const c = new THREE.Color(color).lerp(new THREE.Color('#fbbf24'), 0.55);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------
// Threat mesh factory
// ---------------------------------------------------------------------------

const ROCKY: ThreatType[] = ['fire_meteor', 'ice_comet', 'asteroid_large', 'asteroid_small', 'debris_junk', 'emp_asteroid', 'gravity_well'];
const MUNITION: ThreatType[] = ['hypersonic_missile', 'cluster_bomb', 'cluster_bomblet', 'mirv_warhead', 'railgun_slug', 'plasma_torpedo'];
const DRONE: ThreatType[] = ['scout', 'mini_drone', 'swarm_pod', 'kamikaze', 'stealth_threat', 'hunter_killer', 'alien_hoverbike'];

/** Build a fresh mesh group for a threat. Unit-scaled: group scale = radius. */
export function buildThreatMesh(t: Threat): THREE.Group {
  const g = new THREE.Group();
  const c = t.isElite ? mixGold(t.color) : t.color;

  if (t.isBoss) {
    buildBoss(g, t, c);
  } else if (ROCKY.includes(t.type)) {
    buildRocky(g, t, c);
  } else if (MUNITION.includes(t.type)) {
    buildMunition(g, t, c);
  } else if (DRONE.includes(t.type)) {
    buildDrone(g, t, c);
  } else {
    buildAlienCraft(g, t, c);
  }

  if (t.isElite) {
    g.add(glowSprite('#fbbf24', 5.2, 0.5));
  }

  if (t.shieldHp > 0 || t.maxShieldHp > 0) {
    const dome = shieldDome(1.45, '#38bdf8');
    dome.name = 'shieldDome';
    dome.visible = t.shieldHp > 0;
    g.add(dome);
    g.userData.shieldDome = dome;
  }

  g.userData.builtType = t.type;
  return g;
}

function buildRocky(g: THREE.Group, t: Threat, c: string): void {
  const rocky: Record<string, string> = {
    fire_meteor: '#b45309',
    ice_comet: '#67e8f9',
    emp_asteroid: '#8b5cf6',
    gravity_well: '#312e81',
    debris_junk: '#64748b',
  };
  const body = rock(rocky[t.type] || c, 1, (t.phaseSeed ?? t.id) * 3.3);
  g.add(body);
  if (t.type === 'fire_meteor') {
    const ember = glowSprite('#fb923c', 4.6, 0.85);
    ember.position.z = -1.2;
    g.add(ember);
  } else if (t.type === 'ice_comet') {
    const tail = glowSprite('#7dd3fc', 5.2, 0.6);
    tail.position.z = -1.6;
    g.add(tail);
  } else if (t.type === 'emp_asteroid') {
    g.add(glowSprite('#a78bfa', 3.6, 0.7));
  } else if (t.type === 'gravity_well') {
    const swirl = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 8, 24), emissiveMat('#6366f1', 2));
    swirl.rotation.x = Math.PI / 2.4;
    g.add(swirl);
  }
}

function buildMunition(g: THREE.Group, t: Threat, c: string): void {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 2.6, 8), hullMat('#475569'));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 8), hullMat(c, 0.6, 0.3));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.7;
  g.add(nose);
  for (const dx of [-0.7, 0.7]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.7), hullMat(c));
    fin.position.set(dx, 0, -1.1);
    g.add(fin);
  }
  const warn =
    t.type === 'plasma_torpedo' ? '#22d3ee' : t.type === 'railgun_slug' ? '#e2e8f0' : '#f97316';
  g.add(glowSprite(warn, 3.2, 0.8));
  if (t.type === 'plasma_torpedo') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), emissiveMat('#22d3ee', 2.4)));
  }
  if (t.type === 'cluster_bomb' && t.clusterFuse !== undefined) {
    const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), emissiveMat('#facc15', 3));
    fuse.position.y = 0.5;
    fuse.name = 'fuseLamp';
    g.add(fuse);
    g.userData.fuseLamp = fuse;
  }
}

function buildDrone(g: THREE.Group, t: Threat, c: string): void {
  g.add(fighterHull(c, 2.8, 0.8));
  g.add(wingPair(shade(c, -0.25), 3.4, 1.1));
  const cockpit = canopy('#0ea5e9');
  cockpit.position.set(0, 0.5, 0.5);
  cockpit.scale.setScalar(0.5);
  g.add(cockpit);
  const eng = engineBlock(t.type === 'kamikaze' ? '#f97316' : '#38bdf8', 0.3);
  eng.position.z = -1.5;
  g.add(eng);
  if (t.type === 'hunter_killer') {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 1.2), hullMat(c));
    fin.position.z = -0.6;
    g.add(fin);
  }
  if (t.type === 'alien_hoverbike') {
    for (const dx of [-1.3, 1.3]) {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.6, 4, 8), hullMat(shade(c, 0.2)));
      pod.rotation.x = Math.PI / 2;
      pod.position.set(dx, -0.2, 0);
      g.add(pod);
    }
  }
}

function buildAlienCraft(g: THREE.Group, t: Threat, c: string): void {
  switch (t.type) {
    case 'shielded_trooper': {
      g.add(fighterHull(c, 3, 1.1));
      g.add(wingPair(shade(c, -0.2), 4.4, 1.4));
      const bulwark = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.4, 0.5), hullMat(shade(c, 0.15)));
      bulwark.position.z = 0.9;
      g.add(bulwark);
      break;
    }
    case 'sniper_ship': {
      const dart = new THREE.Mesh(new THREE.ConeGeometry(0.5, 4.6, 5), hullMat(c));
      dart.rotation.x = Math.PI / 2;
      g.add(dart);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3, 6), emissiveMat('#f87171', 1.8));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, -0.2, 1.2);
      barrel.name = 'sniperBarrel';
      g.add(barrel);
      g.userData.sniperBarrel = barrel;
      g.add(glowSprite('#f87171', 2.4, 0.7));
      break;
    }
    case 'healer_ship': {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.3), emissiveMat('#34d399', 1.6));
      g.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.16, 8, 22), hullMat('#a7f3d0'));
      ring.rotation.x = Math.PI / 2;
      ring.name = 'healRing';
      g.add(ring);
      g.userData.healRing = ring;
      g.add(glowSprite('#34d399', 4.4, 0.55));
      break;
    }
    case 'phase_ghost': {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 10), glassMat(c, 0.5)));
      g.add(glowSprite(c, 4.2, 0.6));
      break;
    }
    case 'magnet_drone': {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), emissiveMat('#f472b6', 1.8));
      g.add(core);
      for (const rot of [0, Math.PI / 2]) {
        const u = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.22, 6, 14, Math.PI), hullMat('#94a3b8'));
        u.rotation.set(Math.PI / 2, rot, 0);
        g.add(u);
      }
      break;
    }
    case 'plasma_raider': {
      g.add(fighterHull(c, 3.6, 1.2));
      g.add(wingPair(shade(c, -0.3), 5, 1.6));
      g.add(glowSprite('#22d3ee', 3.6, 0.7));
      break;
    }
    case 'chrono_wraith': {
      const hullGeo = new THREE.CapsuleGeometry(0.9, 2.4, 4, 10);
      hullGeo.rotateX(Math.PI / 2);
      g.add(new THREE.Mesh(hullGeo, glassMat(c, 0.6)));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.1, 6, 24), emissiveMat('#c084fc', 2.4));
      ring.name = 'chronoRing';
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
      g.userData.chronoRing = ring;
      break;
    }
    case 'void_cruiser': {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 5.2), hullMat(c, 0.6, 0.35)));
      for (const dx of [-2.6, 2.6]) {
        const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 3.4, 4, 8), hullMat(shade(c, -0.2)));
        nac.rotation.x = Math.PI / 2;
        nac.position.set(dx, 0, -0.4);
        g.add(nac);
      }
      g.add(glowSprite('#7c3aed', 5, 0.6));
      break;
    }
    case 'siege_carrier': {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.6, 7), hullMat(c, 0.55, 0.4)));
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2.4), hullMat(shade(c, 0.2)));
      tower.position.set(0, 1.5, -1.4);
      g.add(tower);
      const hangar = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), emissiveMat('#22d3ee', 2));
      hangar.rotation.x = -Math.PI / 2;
      hangar.position.set(0, -0.75, 1.6);
      g.add(hangar);
      break;
    }
    case 'tesla_node': {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), hullMat('#475569')));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), emissiveMat('#facc15', 2));
      mast.position.y = 1.6;
      mast.name = 'teslaMast';
      g.add(mast);
      g.userData.teslaMast = mast;
      g.add(glowSprite('#fde047', 3.4, 0.6));
      break;
    }
    case 'mirror_shade': {
      g.add(fighterHull(c, 3, 1));
      g.add(wingPair(c, 3.8, 1.2));
      g.add(glowSprite('#e879f9', 3.4, 0.5));
      break;
    }
    case 'fake_goodie':
    case 'void_orb': {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(1.3, 14, 12),
        emissiveMat(t.type === 'void_orb' ? '#7c3aed' : '#fbbf24', 1.2)
      );
      g.add(orb);
      g.add(glowSprite(t.type === 'void_orb' ? '#a78bfa' : '#fbbf24', 4.6, 0.7));
      break;
    }
    case 'mini_boss':
    case 'era_boss':
    default: {
      buildBoss(g, t, c);
      break;
    }
  }
}

function buildBoss(g: THREE.Group, t: Threat, c: string): void {
  const scaleUp = t.type === 'era_boss' ? 1.35 : 1;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(7 * scaleUp, 2.2 * scaleUp, 8 * scaleUp), hullMat(c, 0.6, 0.35)));
  for (const dx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6 * scaleUp, 0.7, 3.2 * scaleUp), hullMat(shade(c, -0.25)));
    wing.position.set(dx * 5.2 * scaleUp, -0.3, -0.6);
    wing.rotation.y = dx * 0.35;
    g.add(wing);
    const eng = engineBlock(c, 0.5 * scaleUp);
    eng.position.set(dx * 3 * scaleUp, 0, -4.2 * scaleUp);
    g.add(eng);
  }
  const bridge = new THREE.Mesh(
    new THREE.SphereGeometry(2.2 * scaleUp, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    glassMat('#7dd3fc', 0.45)
  );
  bridge.position.set(0, 1.1 * scaleUp, 1.6 * scaleUp);
  g.add(bridge);
  const pilot = t.alienPilot
    ? pilotBust(t.alienPilot.skinColor, t.alienPilot.eyeColor)
    : pilotBust('#84cc16', '#f97316');
  pilot.position.set(0, 1.2 * scaleUp, 1.6 * scaleUp);
  pilot.scale.setScalar(0.8 * scaleUp);
  g.add(pilot);
  const phases = t.maxBossPhases || 1;
  for (let i = 0; i < phases; i++) {
    const pip = new THREE.Mesh(new THREE.SphereGeometry(0.3 * scaleUp, 6, 6), emissiveMat('#f43f5e', 2.4));
    pip.position.set((i - (phases - 1) / 2) * 1.1 * scaleUp, -1.2 * scaleUp, 3.6 * scaleUp);
    g.add(pip);
  }
  g.add(glowSprite(c, 12 * scaleUp, 0.35));
}

// ---------------------------------------------------------------------------
// Goodies, projectiles, turret, starfall
// ---------------------------------------------------------------------------

export function buildGoodieMesh(g: Goodie): THREE.Group {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1), emissiveMat(g.color, 1.6));
  core.name = 'core';
  grp.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.14, 8, 22), hullMat(g.glowColor, 0.3, 0.4));
  ring.rotation.x = Math.PI / 2;
  grp.add(ring);
  const icon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: iconTexture(g.icon),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  icon.scale.set(2.6, 2.6, 1);
  icon.position.y = 0.2;
  grp.add(icon);
  grp.add(glowSprite(g.glowColor, 5.4, 0.55));
  return grp;
}

export function buildProjectileMesh(p: Projectile): THREE.Group {
  const grp = new THREE.Group();
  if (p.isGrenade) {
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hullMat('#1f2937')));
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), emissiveMat('#fb923c', 3)));
  } else if (p.weaponId === 'laser') {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 1), emissiveMat(p.color, 3));
    beam.name = 'beam';
    grp.add(beam);
    grp.add(glowSprite(p.color, 5, 0.7));
  } else if (p.weaponId === 'missiles') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.28, 2.4, 6), hullMat(p.color, 0.5));
    body.rotation.x = Math.PI / 2;
    grp.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 6), hullMat('#e2e8f0'));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 1.5;
    grp.add(nose);
    grp.add(glowSprite('#fb923c', 4, 0.8));
  } else if (p.isOrbital) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 4, 320, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.color),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    beam.name = 'orbitalBeam';
    grp.add(beam);
  } else if (p.isEmp) {
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), emissiveMat(p.color, 2.6)));
    grp.add(glowSprite(p.color, 6, 0.8));
  } else {
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), emissiveMat(p.color, 2.4)));
    grp.add(glowSprite(p.color, 4.4, 0.75));
  }
  return grp;
}

/** Hero orbital-defense railcannon — the centerpiece of the scene.
 *
 *  Layout contract (driven by ThreeWorld.syncTurret):
 *   - `group`  sits at the cannon's field position; only yaw comes from the
 *     rotating `barrel` child (author children facing +Z, pivot at origin).
 *   - `barrel.userData.coils` lists the emissive coil meshes whose
 *     emissiveIntensity is pulsed with recoil (charge/heat feedback).
 *   - `muzzle` is the additive flash sprite at the barrel tip.
 */
export function buildTurret(cannonColor: string): {
  group: THREE.Group;
  barrel: THREE.Group;
  muzzle: THREE.Sprite;
} {
  const group = new THREE.Group();
  const dark = '#26365a';
  const steel = '#4d6187';
  const accent = cannonColor;

  // --- Static emplacement ---------------------------------------------------
  // Octagonal armored pedestal sunk into the platform
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(19, 24, 12, 8),
    hullMat(dark, 0.65, 0.45)
  );
  pedestal.position.y = 6;
  group.add(pedestal);

  // Glowing trim ring where pedestal meets the platform
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(20.5, 0.9, 8, 40),
    emissiveMat('#38bdf8', 2.2)
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 11.5;
  group.add(trim);

  // Rotating ring collar
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(14.5, 16.5, 6, 10),
    hullMat(steel, 0.7, 0.35)
  );
  collar.position.y = 14.5;
  group.add(collar);
  const collarLight = new THREE.Mesh(
    new THREE.TorusGeometry(15.4, 0.5, 6, 34),
    emissiveMat(accent, 1.9)
  );
  collarLight.rotation.x = Math.PI / 2;
  collarLight.position.y = 17.2;
  group.add(collarLight);

  // Yoke arms that carry the barrel
  for (const dx of [-11.5, 11.5]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(4.5, 12, 9), hullMat(steel, 0.65, 0.4));
    arm.position.set(dx, 23, -2);
    group.add(arm);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.6, 10), hullMat(shade(steel, 0.18), 0.7, 0.35));
    cap.position.set(dx, 29.4, -2);
    group.add(cap);
  }

  // Sensor cluster behind the breech
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 9), hullMat('#232f4a', 0.6, 0.35));
  sensor.position.set(0, 31, -8);
  group.add(sensor);
  const sensorEye = glowSprite('#7dd3fc', 7, 0.65);
  sensorEye.position.set(0, 31, -5.2);
  group.add(sensorEye);
  // Comms antennas
  for (const [ax, h, tilt] of [
    [-7, 16, 0.28],
    [7, 12, -0.34],
  ] as const) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, h, 5), hullMat('#8ea3c4', 0.8, 0.3));
    mast.position.set(ax, 26 + h * 0.4, -10);
    mast.rotation.z = tilt;
    group.add(mast);
    const tipLamp = new THREE.Mesh(new THREE.SphereGeometry(0.65, 6, 6), emissiveMat('#f87171', 2.4));
    tipLamp.position.set(ax - Math.sin(tilt) * h * 0.5, 26 + h * 0.8, -10);
    group.add(tipLamp);
  }

  // --- Rotating barrel assembly (pivot at origin; raised/mounted by world) ---
  const barrel = new THREE.Group();
  const coils: THREE.Mesh[] = [];

  // Breech / receiver block
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(9.5, 8, 13), hullMat(dark, 0.6, 0.42));
  receiver.position.set(0, 0, 1);
  barrel.add(receiver);
  const breechCap = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 3, 8), hullMat(steel, 0.7, 0.35));
  breechCap.rotation.x = Math.PI / 2;
  breechCap.position.set(0, 0, -6.4);
  barrel.add(breechCap);

  // Main barrel tube with flare
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 3.6, 40, 12),
    hullMat(steel, 0.75, 0.32)
  );
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 27;
  barrel.add(tube);

  // Twin rails over the tube (railgun look), tips tinted by the skin
  for (const dx of [-4.4, 4.4]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 46), hullMat(shade(accent, -0.1), 0.7, 0.35));
    rail.position.set(dx, 2.2, 24);
    barrel.add(rail);
    const railGlow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 44), emissiveMat(accent, 2.1));
    railGlow.position.set(dx, 1.2, 24);
    barrel.add(railGlow);
  }

  // Accelerator coils along the tube — these pulse with recoil heat.
  // (TorusGeometry lies in the XY plane with its hole along +Z — exactly
  // what a coil ring around a forward barrel needs.)
  for (const cz of [12, 22, 32, 42]) {
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(4.9, 0.85, 8, 20),
      emissiveMat(accent, 1.6)
    );
    coil.position.z = cz;
    barrel.add(coil);
    coils.push(coil);
  }

  // Cooling fins between coils
  for (const fz of [17, 27, 37]) {
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.5, 12), hullMat('#2c3a57', 0.7, 0.4));
    fin.rotation.x = Math.PI / 2;
    fin.position.z = fz;
    barrel.add(fin);
  }

  // Muzzle brake
  const brake = new THREE.Mesh(
    new THREE.CylinderGeometry(4.6, 4.2, 8, 12),
    hullMat(dark, 0.7, 0.38)
  );
  brake.rotation.x = Math.PI / 2;
  brake.position.z = 50;
  barrel.add(brake);
  const brakeRing = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.7, 8, 18), emissiveMat(accent, 1.3));
  brakeRing.position.z = 53.5;
  barrel.add(brakeRing);

  // Underslung energy cells
  for (const dx of [-5.4, 5.4]) {
    const cell = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 6, 4, 8), hullMat('#243352', 0.6, 0.4));
    cell.rotation.x = Math.PI / 2;
    cell.position.set(dx, -4.4, 4);
    barrel.add(cell);
    const cellGlow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 6.4), emissiveMat('#fbbf24', 1.4));
    cellGlow.position.set(dx, -5.9, 4);
    barrel.add(cellGlow);
  }

  // Muzzle flash sprite (opacity driven by recoil in syncTurret)
  const muzzle = glowSprite('#ffe9c4', 16, 0);
  muzzle.position.z = 56;
  barrel.add(muzzle);

  barrel.userData.coils = coils;
  barrel.position.y = 22;
  group.add(barrel);

  // Hero presence: the cannon is the star of the composition — scale the
  // whole emplacement up so it reads as a heavy orbital battery.
  group.scale.setScalar(1.25);

  return { group, barrel, muzzle };
}

/** Starfall catastrophe shard — burning comet with plasma tail. */
export function buildStarfallComet(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(2.6, 9, 7), emissiveMat('#fb923c', 2.2));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  g.add(glowSprite('#fbbf24', 14, 0.9));
  const tail = glowSprite('#ef4444', 22, 0.5);
  tail.position.z = -8;
  g.add(tail);
  return g;
}
