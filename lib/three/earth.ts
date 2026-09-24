// lib/three/earth.ts — procedural Earth, atmosphere, and deep-space dressing.
//
// No external texture assets: every map is painted once onto 2D canvases at
// world-construction time (a few ms), keeping the bundle PWA-tiny while giving
// the planet real continents, ice caps, night-side city lights and drifting
// clouds. All materials opt out of scene fog (fog:false) — space objects are
// not affected by the battlefield's void fog, which previously fogged the
// starfield into invisibility.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded RNG + tiny canvas helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const texCache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

/** Soft radial glow texture (shared by sun, flares, muzzle). */
export function softGlowTexture(): THREE.Texture {
  return cached('__softglow', () => {
    const [c, g] = makeCanvas(128, 128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.28, 'rgba(255,255,255,0.65)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.14)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Four-point star flare texture for the brightest stars. Spikes kept
 *  SHORT and soft — long spikes read as light-saber beams once bloom
 *  gets hold of them. */
function flareTexture(): THREE.Texture {
  return cached('__flare', () => {
    const [c, g] = makeCanvas(128, 128);
    g.translate(64, 64);
    // Core
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 16);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.fillRect(-64, -64, 128, 128);
    // Short cross spikes
    for (const rot of [0, Math.PI / 2]) {
      g.save();
      g.rotate(rot);
      const spike = g.createLinearGradient(0, -34, 0, 34);
      spike.addColorStop(0, 'rgba(255,255,255,0)');
      spike.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      spike.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = spike;
      g.beginPath();
      g.moveTo(0, -34);
      g.quadraticCurveTo(3, 0, 0, 34);
      g.quadraticCurveTo(-3, 0, 0, -34);
      g.fill();
      g.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

// ---------------------------------------------------------------------------
// Earth surface maps
// ---------------------------------------------------------------------------

interface LandBlob {
  x: number;
  y: number;
  r: number;
}

function paintEarthMaps(seed: number): {
  day: THREE.CanvasTexture;
  night: THREE.CanvasTexture;
} {
  // 1536×768 equirect — the planet limb is seen at a grazing angle, so the
  // surface texture gets magnified hard; extra resolution keeps the horizon
  // from dissolving into blur.
  const W = 1536;
  const H = 768;
  const rnd = mulberry32(seed);

  // ---- Day map -------------------------------------------------------------
  const [day, d] = makeCanvas(W, H);

  // Deep-ocean vertical gradient (darker at poles, brighter tropical band)
  const ocean = d.createLinearGradient(0, 0, 0, H);
  ocean.addColorStop(0, '#0e3f70');
  ocean.addColorStop(0.32, '#155a94');
  ocean.addColorStop(0.5, '#1a6aa8');
  ocean.addColorStop(0.68, '#155a94');
  ocean.addColorStop(1, '#0e3f70');
  d.fillStyle = ocean;
  d.fillRect(0, 0, W, H);
  // Abyssal speckle so the ocean is not flat
  for (let i = 0; i < 1800; i++) {
    const y = rnd() * H;
    d.fillStyle = rnd() > 0.5 ? 'rgba(8,34,60,0.25)' : 'rgba(30,90,140,0.14)';
    const s = 2 + rnd() * 26;
    d.beginPath();
    d.ellipse(rnd() * W, y, s, s * 0.45, 0, 0, Math.PI * 2);
    d.fill();
  }

  // Continents: seeded random-walk blob chains with x-wrap
  const LAND = ['#4a8f52', '#58a058', '#6aa75c', '#8fa05a', '#a59463', '#639a49'];
  const blobs: LandBlob[] = [];
  const continents = 9;
  for (let ci = 0; ci < continents; ci++) {
    let x = rnd() * W;
    let y = H * (0.2 + rnd() * 0.6);
    const steps = 16 + Math.floor(rnd() * 26);
    const dir = rnd() * Math.PI * 2;
    let lat = y;
    for (let s = 0; s < steps; s++) {
      const r = 9 + rnd() * 30;
      blobs.push({ x, y, r });
      const a = dir + (rnd() - 0.5) * 1.5;
      x += Math.cos(a) * r * 1.1;
      lat += Math.sin(a) * r * 0.8;
      lat = Math.max(H * 0.12, Math.min(H * 0.88, lat));
      y = lat;
      if (x > W) x -= W;
      if (x < 0) x += W;
    }
  }

  const wrapDraw = (fn: (dx: number) => void) => {
    fn(0);
    fn(-W);
    fn(W);
  };

  // Continental shelf halo (drawn before land)
  for (const b of blobs) {
    wrapDraw((dx) => {
      const shelf = d.createRadialGradient(b.x + dx, b.y, b.r * 0.6, b.x + dx, b.y, b.r * 1.55);
      shelf.addColorStop(0, 'rgba(46,120,170,0.55)');
      shelf.addColorStop(1, 'rgba(46,120,170,0)');
      d.fillStyle = shelf;
      d.beginPath();
      d.arc(b.x + dx, b.y, b.r * 1.55, 0, Math.PI * 2);
      d.fill();
    });
  }

  // Landmasses (layered circles, slight per-blob color)
  for (const b of blobs) {
    const col = LAND[Math.floor(rnd() * LAND.length)];
    wrapDraw((dx) => {
      d.fillStyle = col;
      d.beginPath();
      d.arc(b.x + dx, b.y, b.r, 0, Math.PI * 2);
      d.fill();
    });
  }
  // Terrain mottling + latitude biomes (desert band, forests, tundra)
  for (let i = 0; i < 9000; i++) {
    const b = blobs[Math.floor(rnd() * blobs.length)];
    const a = rnd() * Math.PI * 2;
    const rr = rnd() * b.r;
    const x = b.x + Math.cos(a) * rr;
    const y = b.y + Math.sin(a) * rr * 0.9;
    const lat = Math.abs(y / H - 0.5) * 2; // 0 equator .. 1 poles
    const shade = rnd();
    let col: string;
    if (lat < 0.22 && rnd() > 0.45) col = 'rgba(196,168,102,0.20)'; // equatorial desert
    else if (lat > 0.62) col = shade > 0.5 ? 'rgba(110,130,110,0.20)' : 'rgba(150,150,135,0.18)'; // tundra
    else if (shade > 0.66) col = 'rgba(24,58,32,0.24)'; // deep forest
    else if (shade > 0.38) col = 'rgba(120,146,84,0.18)'; // grassland
    else col = 'rgba(146,128,84,0.16)'; // arid highland
    d.fillStyle = col;
    const s = 2 + rnd() * 10;
    wrapDraw((dx) => {
      d.beginPath();
      d.arc(x + dx, y, s, 0, Math.PI * 2);
      d.fill();
    });
  }

  // Polar ice caps with noisy fringe
  const iceCap = (top: boolean) => {
    const baseY = top ? 0 : H;
    const dirY = top ? 1 : -1;
    d.fillStyle = 'rgba(235,244,250,0.96)';
    d.beginPath();
    d.moveTo(0, baseY);
    for (let x = 0; x <= W; x += 16) {
      const depth = (top ? 1 : -1) * (14 + rnd() * 26);
      d.lineTo(x, baseY + dirY * depth);
    }
    d.lineTo(W, baseY);
    d.closePath();
    d.fill();
  };
  iceCap(true);
  iceCap(false);

  // ---- Night map (city lights) ---------------------------------------------
  const [night, n] = makeCanvas(W, H);
  n.fillStyle = '#000000';
  n.fillRect(0, 0, W, H);
  for (const b of blobs) {
    const dots = Math.floor(b.r * 1.4);
    for (let i = 0; i < dots; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.6) * b.r * 1.05;
      const x = b.x + Math.cos(a) * rr;
      const y = b.y + Math.sin(a) * rr * 0.9;
      if (y < H * 0.09 || y > H * 0.91) continue; // not on the ice caps
      const warm = rnd();
      n.fillStyle =
        warm > 0.7 ? 'rgba(255,214,140,0.95)' : warm > 0.35 ? 'rgba(255,190,110,0.8)' : 'rgba(255,235,180,0.65)';
      const s = rnd() > 0.9 ? 2.2 : 1.3;
      wrapDraw((dx) => {
        n.beginPath();
        n.arc(x + dx, y, s, 0, Math.PI * 2);
        n.fill();
      });
    }
  }

  const dayTex = new THREE.CanvasTexture(day);
  dayTex.colorSpace = THREE.SRGBColorSpace;
  dayTex.anisotropy = 4;
  const nightTex = new THREE.CanvasTexture(night);
  nightTex.colorSpace = THREE.SRGBColorSpace;
  return { day: dayTex, night: nightTex };
}

function paintCloudMap(seed: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);

  // Swirling storm systems
  const puff = (x: number, y: number, rx: number, ry: number, alpha: number) => {
    for (const dx of [-W, 0, W]) {
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, Math.max(rx, ry));
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.5})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.save();
      g.translate(x + dx, y);
      g.scale(1, ry / Math.max(1, rx));
      g.translate(-(x + dx), -y);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x + dx, y, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };

      // Banded cloud lanes + cyclones
  for (let i = 0; i < 46; i++) {
    const y = H * (0.08 + rnd() * 0.84);
    puff(rnd() * W, y, 30 + rnd() * 110, 10 + rnd() * 26, 0.16 + rnd() * 0.2);
  }
  for (let i = 0; i < 16; i++) {
    const y = H * (0.15 + rnd() * 0.7);
    puff(rnd() * W, y, 12 + rnd() * 26, 10 + rnd() * 22, 0.3 + rnd() * 0.3);
  }
  // Equatorial bright band
  const band = g.createLinearGradient(0, H * 0.4, 0, H * 0.6);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band;
  g.fillRect(0, H * 0.4, W, H * 0.2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintNebulaMap(seed: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const rnd = mulberry32(seed ^ 0x51ab3f);
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#010208';
  g.fillRect(0, 0, W, H);

  // Sparse, very dim deep-space nebulae — pure background texture. The
  // Milky Way itself is rendered as a real star/haze overdensity in
  // buildStarfield() (keeping dome texture and star band in lockstep by
  // construction), so the dome stays recessive.
  const tints: Array<[string, number]> = [
    ['#3b2a7a', 0.15],
    ['#123a5e', 0.18],
    ['#5b2a86', 0.12],
    ['#0e4a5e', 0.16],
    ['#4a1e50', 0.13],
    ['#1a2f6e', 0.15],
  ];
  for (const [color, alpha] of tints) {
    const x = rnd() * W;
    const y = H * (0.15 + rnd() * 0.7);
    const r = 130 + rnd() * 300;
    for (const dx of [-W, 0, W]) {
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grad.addColorStop(0, `${color}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')}`);
      grad.addColorStop(1, `${color}00`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x + dx, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface EarthGroup {
  group: THREE.Group;
  surface: THREE.Mesh;
  clouds: THREE.Mesh;
  /** Per-world procedural maps (disposed with the world). */
  textures: THREE.Texture[];
  update: (dt: number) => void;
}

/**
 * The hero planet. A big textured sphere whose glowing limb arcs behind the
 * defense platform, wrapped in a drifting cloud shell and a two-part fresnel
 * atmosphere (surface rim + outer halo). Axis-tilted and slowly rotating.
 */
export function buildEarth(radius: number, seed = 1337): EarthGroup {
  const group = new THREE.Group();
  const { day, night } = paintEarthMaps(seed);

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 72, 48),
    new THREE.MeshStandardMaterial({
      map: day,
      emissiveMap: night,
      emissive: new THREE.Color('#ffca7a'),
      emissiveIntensity: 0.5,
      roughness: 0.82,
      metalness: 0.04,
      fog: false,
    })
  );
  group.add(surface);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.012, 48, 32),
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      alphaMap: paintCloudMap(seed),
      transparent: true,
      opacity: 0.85,
      roughness: 1,
      metalness: 0,
      depthWrite: false,
      fog: false,
    })
  );
  group.add(clouds);

  // Inner atmosphere rim — brightest at the limb, painted onto a shell just
  // above the surface (fresnel).
  const atmoInner = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.025, 48, 32),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color('#5db4ff') },
        uIntensity: { value: 1.8 },
      },
      vertexShader: `
        varying vec3 vNw;
        varying vec3 vPw;
        void main() {
          vNw = normalize(mat3(modelMatrix) * normal);
          vec4 pw = modelMatrix * vec4(position, 1.0);
          vPw = pw.xyz;
          gl_Position = projectionMatrix * viewMatrix * pw;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNw;
        varying vec3 vPw;
        void main() {
          vec3 v = normalize(cameraPosition - vPw);
          float rim = pow(1.0 - clamp(abs(dot(normalize(vNw), v)), 0.0, 1.0), 3.2);
          gl_FragColor = vec4(uColor * rim * uIntensity, rim);
        }`,
    })
  );
  group.add(atmoInner);

  // Outer halo — BackSide shell; the planet itself occludes everything but
  // the glow ring beyond the limb.
  const atmoOuter = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.13, 48, 32),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color('#3d8fff') },
        uIntensity: { value: 0.62 },
      },
      vertexShader: `
        varying vec3 vNv;
        void main() {
          vNv = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNv;
        void main() {
          float intensity = pow(clamp(0.62 - dot(vNv, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
          gl_FragColor = vec4(uColor, 1.0) * intensity * uIntensity;
        }`,
    })
  );
  group.add(atmoOuter);

  // Tilt the spin axis so an interesting mix of pole + mid-latitudes shows.
  group.rotation.z = 0.38;
  group.rotation.x = 0.1;

  const update = (dt: number) => {
    surface.rotation.y += dt * 0.0045;
    clouds.rotation.y += dt * 0.0072;
  };

  return { group, surface, clouds, textures: [day, night, clouds.material.alphaMap!], update };
}

/** Deep-space nebula skydome (BackSide, subtle, never fogged). */
export function buildNebula(radius: number): THREE.Mesh {
  const tex = paintNebulaMap(4242);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24),
    new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      opacity: 0.85,
      transparent: true,
    })
  );
  mesh.userData.tex = tex; // disposed by the owning ThreeWorld
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** Distant sun: compact hot core + tight warm halo — kept small so bloom
 *  doesn't blow out the whole sky band around the planet limb. */
export function buildSun(): THREE.Group {
  const group = new THREE.Group();
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: new THREE.Color('#fff6e0'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
  );
  core.scale.setScalar(230);
  group.add(core);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: new THREE.Color('#ffc87a'),
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
  );
  halo.scale.setScalar(640);
  group.add(halo);
  return group;
}

// ---------------------------------------------------------------------------
// Starfield — realism kit
// ---------------------------------------------------------------------------

/** Naked-eye stellar color mix. Real night skies are dominated by white and
 *  warm-white stars with scattering blue-white and orange notes — not the
 *  uniform cyan of sci-fi wallpapers. Weights sum to 1. */
const STAR_MIX: Array<[string, number]> = [
  ['#ffffff', 0.18],
  ['#f8f7ff', 0.14],
  ['#dfe8ff', 0.12],
  ['#c3d2ff', 0.07],
  ['#fff5e8', 0.16],
  ['#ffe8c2', 0.13],
  ['#ffd49e', 0.1],
  ['#ffb87a', 0.07],
  ['#ff9e6e', 0.03],
];

const STAR_VERT = /* glsl */ `
  attribute vec3 acolor;
  attribute float asize;
  attribute float aphase;
  attribute float abright;
  attribute float ahaze;
  uniform float uTime;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vBright;
  varying float vHaze;
  void main() {
    vColor = acolor;
    vHaze = ahaze;
    // Gentle scintillation — only bright stars shimmer; the faint mass is
    // already at the visibility floor (real scintillation hits bright
    // point sources hardest, and haze never shimmers).
    float amp = 0.15 * smoothstep(0.3, 0.85, abright) * (1.0 - ahaze);
    float tw = sin(uTime * (0.45 + fract(aphase * 5.13) * 1.35) + aphase * 41.7);
    vBright = abright * (1.0 - amp * (0.5 + 0.5 * tw));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = asize * uDpr;
    gl_Position = projectionMatrix * mv;
  }`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vBright;
  varying float vHaze;
  void main() {
    vec2 q = gl_PointCoord - vec2(0.5);
    float d2 = dot(q, q);
    // Gaussian point: crisp photosphere core + faint airy halo — never a
    // square (the #1 tell of a fake starfield).
    float star = exp(-d2 * 46.0) + exp(-d2 * 8.0) * 0.16;
    // Milky Way haze blobs: broad, soft, dim.
    float haze = exp(-d2 * 5.0) * 0.5;
    float a = mix(star, haze, vHaze) * vBright;
    if (a < 0.012) discard;
    gl_FragColor = vec4(vColor, a);
  }`;

export interface Starfield {
  /** Parallax layers; the owner rotates them for slow sky drift. */
  points: THREE.Points[];
  /** Advance the scintillation clock. */
  update: (dt: number) => void;
  /** Keep apparent sizes constant across device pixel ratios. */
  setDpr: (dpr: number) => void;
}

/**
 * Photoreal-ish starfield, replacing the old flat "space wallpaper":
 *  - power-law magnitudes: thousands of barely-resolved pinpricks, a
 *    handful of beacons (uniform-brightness skies read as fake);
 *  - gaussian round sprites with a hot core, square-edge-free;
 *  - blackbody color mix, faint stars desaturating toward slate;
 *  - a Milky Way great-circle overdensity of dim stars PLUS soft haze
 *    blobs in the SAME layer — band and glow can never drift apart;
 *  - gentle per-star scintillation on bright stars only.
 */
export function buildStarfield(): Starfield {
  // Great-circle pole of the galactic band (tilted so the band arcs
  // diagonally across the visible sky instead of hugging the horizon).
  const pole = new THREE.Vector3(0.44, 0.58, 0.68).normalize();
  const dir = new THREE.Vector3();
  const gray = new THREE.Color('#93a7c8');

  const layers = [
    { count: 2100, band: 2400, haze: 900, radius: 3400, sizeBase: 0.95, sizeRange: 1.35 },
    { count: 900, band: 0, haze: 0, radius: 2200, sizeBase: 1.35, sizeRange: 1.7 },
    { count: 300, band: 0, haze: 0, radius: 1200, sizeBase: 1.85, sizeRange: 2.1 },
  ];

  const mats: THREE.ShaderMaterial[] = [];
  const points: THREE.Points[] = [];

  for (let li = 0; li < layers.length; li++) {
    const { count, band, haze, radius, sizeBase, sizeRange } = layers[li];
    const n = count + band + haze;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);
    const brights = new Float32Array(n);
    const hazes = new Float32Array(n);
    const rnd = mulberry32(77 + li * 31);
    const tmp = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const isBand = i >= count && i < count + band;
      const isHaze = i >= count + band;

      // --- Direction ------------------------------------------------------
      // Sky-biased uniform sampling (cos φ on [-0.25, 1] keeps stars above
      // the horizon plane). Band/haze stars additionally rejection-sample
      // until they land within ~σ≈8° of the galactic great circle.
      let ok = false;
      for (let tries = 0; tries < 14 && !ok; tries++) {
        const phi = Math.acos(rnd() * 1.25 - 0.25);
        const theta = rnd() * Math.PI * 2;
        dir.set(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );
        if (!isBand && !isHaze) ok = true;
        else {
          const off = Math.abs(dir.angleTo(pole) - Math.PI / 2);
          ok = rnd() < Math.exp(-(off * off) / 0.045);
        }
      }
      if (!ok) {
        // Rejection gave up (band runs nearly parallel to the folded
        // horizon): project straight onto the great-circle plane.
        dir.addScaledVector(pole, -dir.dot(pole));
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
        dir.normalize();
      }
      const rr = radius * (0.82 + rnd() * 0.3);
      positions[i * 3] = dir.x * rr;
      positions[i * 3 + 1] = Math.abs(dir.y) * rr * 0.82 + 90;
      positions[i * 3 + 2] = dir.z * rr;

      if (isHaze) {
        // --- Milky Way haze blob -------------------------------------------
        tmp.set('#8fa3d8').lerp(new THREE.Color('#b8c6ef'), rnd());
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
        sizes[i] = 14 + rnd() * 16;
        phases[i] = rnd() * 100;
        brights[i] = 0.11 + rnd() * 0.08;
        hazes[i] = 1;
        continue;
      }

      // --- Magnitude: power-law — the realism keystone. Most stars are
      //     barely-resolved pinpricks; band stars run a touch dimmer (the
      //     unresolved distant host of the galaxy) but dense enough that
      //     the great circle reads as a true star cloud, not just haze.
      const b = isBand ? Math.pow(rnd(), 2.6) * 0.9 : Math.pow(rnd(), 2.7);

      // --- Color ------------------------------------------------------------
      let acc = rnd();
      let hex = '#ffffff';
      for (const [h, w] of STAR_MIX) {
        acc -= w;
        if (acc <= 0) {
          hex = h;
          break;
        }
      }
      tmp.set(hex);
      if (b < 0.35) tmp.lerp(gray, (0.35 - b) * 0.9); // faint stars gray out
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;

      sizes[i] = sizeBase + b * sizeRange * (0.6 + 0.4 * rnd());
      phases[i] = rnd() * 100;
      brights[i] = 0.16 + 0.84 * b;
      hazes[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('acolor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('asize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aphase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('abright', new THREE.BufferAttribute(brights, 1));
    geo.setAttribute('ahaze', new THREE.BufferAttribute(hazes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDpr: {
          value: Math.min(
            typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
            2
          ),
        },
      },
    });
    mats.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    points.push(pts);
  }

  let elapsed = 0;
  return {
    points,
    update: (dt: number) => {
      elapsed += dt;
      for (const m of mats) m.uniforms.uTime.value = elapsed;
    },
    setDpr: (dpr: number) => {
      for (const m of mats) m.uniforms.uDpr.value = Math.max(1, dpr);
    },
  };
}

/** A handful of bright cross-flare hero stars for depth cues. Kept compact
 *  and subtle — real bright stars are still pinpoints with a small diffraction
 *  cross; oversized flares bloom into fake "god ray" beams. */
export function buildFlareStars(): THREE.Group {
  const group = new THREE.Group();
  const rnd = mulberry32(9091);
  const tints = ['#ffffff', '#dcebff', '#ffeeda', '#cfe2ff', '#ffe3b8'];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flareTexture(),
        color: new THREE.Color(tints[Math.floor(rnd() * tints.length)]),
        transparent: true,
        opacity: 0.42 + rnd() * 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      })
    );
    const el = 0.1 + rnd() * 0.85; // radians above the horizon plane
    const az = rnd() * Math.PI * 2;
    const rr = 1500 + rnd() * 2100;
    s.position.set(
      rr * Math.cos(el) * Math.sin(az),
      rr * Math.sin(el) + 60,
      rr * Math.cos(el) * Math.cos(az)
    );
    s.scale.setScalar(20 + rnd() * 26);
    group.add(s);
  }
  return group;
}
