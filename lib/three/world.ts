// lib/three/world.ts — Three.js presentation layer for Gaia Frontier.
//
// The 2D gameEngine keeps simulating in its logical (x, y) space; this world
// maps that plane into a tilted 3D battlefield (screen-up = into the distance)
// and paints the same entities with real meshes, lighting and depth.
//
// Mapping contract (kept EXACT so aim/hit-tests stay fair):
//   world.x = logical.x - L_WIDTH/2
//   world.z = L_HEIGHT/2 - logical.y
//   entities live on the gameplay plane y = PLAY_Y (bobbing ±small),
//   pointer input is ray-cast against that same plane (screenToLogical).
//
// Scene concept — "the last orbital battery over Earth":
//   a holographic defense-grid corridor floats above the planet; the hero
//   railcannon and the Gaia citadel sit on its near deck, and incoming waves
//   descend from deep space toward Earth's glowing limb at the far horizon.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildEarth, buildFlareStars, buildNebula, buildStarShells, buildSun, EarthGroup } from './earth';
import { EraInfo, FloatingText, Goodie, GroundHazard, Particle, Projectile, Threat } from '../types';
import {
  buildGoodieMesh,
  buildProjectileMesh,
  buildStarfallComet,
  buildThreatMesh,
  buildTurret,
  glowSprite,
} from './enemyMeshes';

const PLAY_Y = 42;
const MAX_PARTICLES = 520;
const MAX_COMETS = 24;

export interface StarfallShardLike {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  impactY: number;
  fuse: number;
  plungeSpeed: number;
}

/** Structural view of the GameEngine state the renderer reads each frame. */
export interface WorldState {
  L_WIDTH: number;
  L_HEIGHT: number;
  threats: Threat[];
  goodies: Goodie[];
  projectiles: Projectile[];
  particles: Particle[];
  pLive: number;
  floatingTexts: FloatingText[];
  groundHazards: GroundHazard[];
  starfallShards: StarfallShardLike[];
  cannonX: number;
  cannonY: number;
  aimAngle: number;
  recoilOffset: number;
  screenShake: number;
  corridorHalf: number;
  currentEra: EraInfo;
  isOverdrive: boolean;
  voidFogTimer: number;
  renderQuality: number;
  currentBaseHp: number;
  maxBaseHp: number;
  currentShieldHp: number;
  skinColors: { cannon: string; base: string; projectile: string };
}

const worldRegistry = new WeakMap<HTMLCanvasElement, ThreeWorld>();
export function registerWorld(canvas: HTMLCanvasElement, world: ThreeWorld) {
  worldRegistry.set(canvas, world);
}
export function getRegisteredWorld(canvas: HTMLCanvasElement): ThreeWorld | null {
  return worldRegistry.get(canvas) ?? null;
}

const colorCache = new Map<string, THREE.Color>();
function cachedColor(hex: string): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export class ThreeWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private LW = 450;
  private LH = 800;
  private cssW = 450;
  private cssH = 800;
  private quality = 0;

  // Camera choreography
  private camBasePos = new THREE.Vector3(0, 600, -700);
  private camTarget = new THREE.Vector3(0, PLAY_Y * 0.35, 0);
  private aimLean = 0;

  // Post pipeline
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private bloomOn = true;

  // World furniture
  private corridor!: THREE.Mesh;
  private corridorMat!: THREE.ShaderMaterial;
  private platformGroup!: THREE.Group;
  private baseSpire!: THREE.Mesh;
  private shieldDome!: THREE.Mesh;
  private shieldMat!: THREE.ShaderMaterial;
  private nebula!: THREE.Mesh;
  private sun!: THREE.Group;
  private stars: THREE.Points[] = [];
  private keyLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private muzzleLight!: THREE.PointLight;
  private platformFlood!: THREE.PointLight;

  // Earth
  private earth: EarthGroup | null = null;
  private earthTextures: THREE.Texture[] = [];
  private EARTH_R = 2400;

  // Turret
  private turretGroup: THREE.Group | null = null;
  private turretBarrel: THREE.Group | null = null;
  private muzzle: THREE.Sprite | null = null;
  private turretColor = '';

  // Entity pools
  private threatMeshes = new Map<number, THREE.Group>();
  private goodieMeshes = new Map<number, THREE.Group>();
  private projectileMeshes = new Map<number, THREE.Group>();
  private hazardMeshes = new Map<number, THREE.Mesh>();
  private comets: THREE.Group[] = [];

  // Particles (single draw call, per-point size/alpha/color)
  private particleGeo = new THREE.BufferGeometry();
  private particlePts!: THREE.Points;
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pCol = new Float32Array(MAX_PARTICLES * 3);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pAlpha = new Float32Array(MAX_PARTICLES);

  // Danger telegraph pool (sniper locks, dive paths, tesla arcs, warnings)
  private telegraphLines: THREE.Line[] = [];
  private telegraphRings: THREE.Mesh[] = [];

  // Bookkeeping
  private lastTimeSec = 0;
  private lastDrivenAt = 0;
  private lastEra = -1;
  private idleRaf = 0;
  private idleLast = 0;
  private disposed = false;
  private vignetteKey = '';
  private vignetteGrad: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.camera = new THREE.PerspectiveCamera(42, 1, 10, 12000);
    this.scene.fog = new THREE.Fog('#050b14', 500, 2600);

    // HDR post pipeline: scene → UnrealBloom → ACES/sRGB output. The MSAA
    // render target keeps edges clean now that the canvas is no longer the
    // direct render surface.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.44, 0.5, 0.9);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.buildWorld();
    this.buildParticles();
    this.buildTelegraphs();
    this.fitCamera();
    this.layoutFurniture();
    this.startIdleLoop();
  }

  // -------------------------------------------------------------------------
  // Scene construction
  // -------------------------------------------------------------------------

  private buildWorld() {
    // Lighting: warm key from the distant sun (upper-left, matches the sun
    // sprite), cyan earthshine bounce from the planet below, soft sky fill.
    this.hemiLight = new THREE.HemisphereLight('#7dd3fc', '#0b1220', 0.85);
    this.scene.add(this.hemiLight);
    // The sun stays warm-white year-round: the planet must read as a bright
    // "Blue Marble". (It used to inherit the era's ambientGlow — a dark
    // saturated blue that drowned the whole disk during gameplay.)
    this.keyLight = new THREE.DirectionalLight('#fff3e0', 2.4);
    this.keyLight.position.set(-2300, 1900, 2900);
    this.scene.add(this.keyLight);
    // Camera-side photographic fill so the visible disk never goes pitch
    // dark regardless of which longitude rotates into view.
    const earthFill = new THREE.DirectionalLight('#a8c8ff', 0.6);
    earthFill.position.set(400, 1500, -900);
    this.scene.add(earthFill);
    const earthshine = new THREE.DirectionalLight('#38bdf8', 0.45);
    earthshine.position.set(150, -900, 400);
    this.scene.add(earthshine);

    // Deep-space dressing. Every material here opts out of scene fog — the
    // battlefield fog band (500–2600) used to swallow the entire starfield,
    // leaving an empty void sky.
    this.nebula = buildNebula(4400);
    this.scene.add(this.nebula);
    this.stars = buildStarShells();
    for (const s of this.stars) this.scene.add(s);
    this.scene.add(buildFlareStars());
    this.sun = buildSun();
    this.scene.add(this.sun);

    // Holographic defense-grid corridor (replaces the old GridHelper floor).
    this.corridorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTint: { value: new THREE.Color('#67e8f9') },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(630, 1120) },
        uPlay: { value: new THREE.Vector2(450, 800) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTint;
        uniform float uTime;
        uniform vec2 uSize;
        uniform vec2 uPlay;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * uSize;
          // minor 56u grid + major 280u grid
          vec2 g1 = abs(fract(p / 56.0) - 0.5);
          float minor = 1.0 - smoothstep(0.0, 0.06, min(g1.x, g1.y));
          vec2 g2 = abs(fract(p / 280.0) - 0.5);
          float major = 1.0 - smoothstep(0.0, 0.022, min(g2.x, g2.y));
          // fade to nothing beyond the playfield rect
          vec2 q = abs(p) - uPlay * 0.5;
          float fade = 1.0 - smoothstep(0.0, uPlay.x * 0.42, max(q.x, q.y));
          // corridor boundary rails at the playfield edges (subtle hint —
          // bright rails read as harsh glare columns on portrait screens)
          float edge = smoothstep(48.0, 5.0, abs(abs(p.x) - uPlay.x * 0.5)) * 0.5;
          // radar sweep running far -> near
          float sp = fract(uTime * 0.1);
          float band = exp(-pow((vUv.y - (0.96 - sp * 0.92)) * 10.0, 2.0)) * 0.22;
          // far-edge melt into the planet haze
          float farFade = 1.0 - smoothstep(0.78, 1.0, vUv.y);
          float a = fade * farFade * (0.2 + minor * 0.26 + major * 0.24 + edge * 0.4 + band);
          vec3 col = uTint * (0.22 + minor * 0.38 + major * 0.42 + edge * 0.22)
                   + vec3(0.8) * band;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.corridor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.corridorMat);
    this.corridor.rotation.x = -Math.PI / 2;
    this.corridor.position.y = -0.6;
    this.scene.add(this.corridor);

    // Gaia citadel platform + atmospheric shield (bottom of the field)
    this.platformGroup = this.buildPlatform();
    this.scene.add(this.platformGroup);

    this.shieldMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color('#38bdf8') },
        uPulse: { value: 1 },
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
        uniform float uPulse;
        varying vec3 vNw;
        varying vec3 vPw;
        void main() {
          vec3 v = normalize(cameraPosition - vPw);
          float rim = pow(1.0 - clamp(abs(dot(normalize(vNw), v)), 0.0, 1.0), 3.2);
          gl_FragColor = vec4(uColor * (0.4 + rim * 1.0), (0.03 + rim * 0.82) * uPulse);
        }`,
    });
    this.shieldDome = new THREE.Mesh(
      new THREE.SphereGeometry(215, 36, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      this.shieldMat
    );
    this.scene.add(this.shieldDome);

    // The hero planet
    this.earth = buildEarth(this.EARTH_R);
    this.earthTextures = this.earth.textures;
    this.scene.add(this.earth.group);

    // Muzzle flash light (pulsed with recoil in syncTurret)
    this.muzzleLight = new THREE.PointLight('#ffdfb0', 0, 520, 2);
    this.scene.add(this.muzzleLight);
    // Platform floodlight: keeps the hero cannon + citadel out of silhouette
    // at the near end of the field (they sit far from the key light).
    this.platformFlood = new THREE.PointLight('#cfe4ff', 26000, 700, 2);
    this.scene.add(this.platformFlood);
  }

  private buildPlatform(): THREE.Group {
    const g = new THREE.Group();
    const mkHull = (color: string, metal = 0.6, rough = 0.45) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: metal,
        roughness: rough,
      });
    const mkGlow = (color: string, intensity = 1.6) => {
      const c = new THREE.Color(color);
      return new THREE.MeshStandardMaterial({
        color: c,
        emissive: c,
        emissiveIntensity: intensity,
        metalness: 0.1,
        roughness: 0.5,
        toneMapped: false,
      });
    };

    // Hexagonal slab + raised deck
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(150, 170, 18, 6), mkHull('#16233c', 0.65, 0.5));
    slab.position.y = 9;
    g.add(slab);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(120, 133, 10, 6), mkHull('#1d2d4a', 0.6, 0.42));
    deck.position.y = 22;
    g.add(deck);
    // Hex trim ring (6-segment torus hugging the slab edge)
    const trim = new THREE.Mesh(new THREE.TorusGeometry(140, 1.6, 6, 6), mkGlow('#38bdf8', 1.5));
    trim.rotation.x = Math.PI / 2;
    trim.rotation.z = Math.PI / 6;
    trim.position.y = 26.5;
    g.add(trim);

    // Central command citadel — the spire is the base-HP indicator
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(15, 21, 56, 6), mkHull('#22355a', 0.55, 0.4));
    tower.position.set(0, 55, -26);
    g.add(tower);
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 30, 1), mkGlow('#7dd3fc', 1.2));
      const a = (i / 3) * Math.PI * 2 + 0.5;
      strip.position.set(Math.cos(a) * 18.5, 55, -26 + Math.sin(a) * 18.5);
      strip.rotation.y = -a;
      g.add(strip);
    }
    this.baseSpire = new THREE.Mesh(new THREE.ConeGeometry(9, 46, 6), mkGlow('#38bdf8', 1.3));
    this.baseSpire.position.set(0, 106, -26);
    g.add(this.baseSpire);
    const spireGlow = glowSprite('#7dd3fc', 34, 0.4);
    spireGlow.position.set(0, 118, -26);
    g.add(spireGlow);

    // Corner towers (the front pair frames the cannon's fire line)
    for (const [tx, tz] of [
      [-64, 66],
      [64, 66],
      [-64, -96],
      [64, -96],
    ] as const) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(13, 30, 13), mkHull('#1d2d4a', 0.6, 0.42));
      t.position.set(tx, 38, tz);
      g.add(t);
      const capT = new THREE.Mesh(new THREE.BoxGeometry(15, 2, 15), mkHull('#31446b', 0.65, 0.4));
      capT.position.set(tx, 54, tz);
      g.add(capT);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), mkGlow('#fbbf24', 2));
      lamp.position.set(tx, 58, tz);
      g.add(lamp);
    }
    return g;
  }

  private buildParticles() {
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.particleGeo.setAttribute('pcolor', new THREE.BufferAttribute(this.pCol, 3));
    this.particleGeo.setAttribute('psize', new THREE.BufferAttribute(this.pSize, 1));
    this.particleGeo.setAttribute('palpha', new THREE.BufferAttribute(this.pAlpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixPerUnit: { value: 1000 } },
      vertexShader: `
        attribute vec3 pcolor;
        attribute float psize;
        attribute float palpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixPerUnit;
        void main() {
          vColor = pcolor;
          vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.5, psize * uPixPerUnit / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.06, d) * vAlpha;
          if (a < 0.012) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.particlePts = new THREE.Points(this.particleGeo, mat);
    this.particlePts.frustumCulled = false;
    this.scene.add(this.particlePts);

    for (let i = 0; i < MAX_COMETS; i++) {
      const comet = buildStarfallComet();
      comet.visible = false;
      this.scene.add(comet);
      this.comets.push(comet);
    }
  }

  private buildTelegraphs() {
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: '#f87171',
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          toneMapped: false,
        })
      );
      line.visible = false;
      line.frustumCulled = false;
      this.scene.add(line);
      this.telegraphLines.push(line);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 26),
        new THREE.MeshBasicMaterial({
          color: '#f87171',
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.telegraphRings.push(ring);
    }
  }

  // -------------------------------------------------------------------------
  // Sizing & camera
  // -------------------------------------------------------------------------

  attachOverlay(canvas: HTMLCanvasElement) {
    this.overlay = canvas;
    this.overlayCtx = canvas.getContext('2d');
    this.setSize(this.cssW, this.cssH);
  }

  setQuality(level: number) {
    this.quality = clamp(level, 0, 2);
    // Quality 0 = best (governor convention): full bloom. 2 = struggling
    // device: bypass the composer entirely and render direct.
    this.bloomOn = this.quality <= 1;
    this.bloomPass.strength = this.quality === 0 ? 0.44 : 0.36;
    this.setSize(this.cssW, this.cssH);
  }

  setSize(cssW: number, cssH: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    const cap = this.quality >= 2 ? 1.25 : this.quality === 1 ? 1.6 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.cssW, this.cssH);
    if (this.overlay) {
      this.overlay.width = Math.round(this.cssW * dpr);
      this.overlay.height = Math.round(this.cssH * dpr);
      this.overlay.style.width = `${this.cssW}px`;
      this.overlay.style.height = `${this.cssH}px`;
    }
    this.fitCamera();
    this.layoutFurniture();
  }

  setLogicalSize(w: number, h: number) {
    this.LW = Math.max(1, w);
    this.LH = Math.max(1, h);
    this.fitCamera();
    this.layoutFurniture();
  }

  /** Place the platform, corridor and — critically — frame the Earth's limb
   *  inside the sky band between the top screen edge and the corridor's far
   *  melt line. Solving the limb height from the fitted camera keeps the
   *  horizon framed correctly across portrait and landscape pitches. */
  private layoutFurniture() {
    const bz = -this.LH / 2 + 24;
    this.platformGroup.position.set(0, 0, bz);
    this.shieldDome.position.set(0, 8, bz + 26);
    this.platformFlood.position.set(0, 210, bz + 64);

    const w = this.LW * 1.4;
    const d = this.LH * 1.4;
    this.corridor.scale.set(w, d, 1);
    this.corridorMat.uniforms.uSize.value.set(w, d);
    this.corridorMat.uniforms.uPlay.value.set(this.LW, this.LH);

    // --- Earth framing ------------------------------------------------------
    const cam = this.camBasePos;
    // Camera looks from behind/above toward +z; the positive look-ahead
    // distance is target.z - cam.z (cam.z is the negative side).
    const pitch = Math.atan2(cam.y - this.camTarget.y, Math.max(1, this.camTarget.z - cam.z));
    const fovHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const topAngle = pitch - fovHalf;
    const farZ = this.LH * 0.7;
    const farAngle = Math.atan2(cam.y + 1, Math.max(1, farZ - cam.z));
    const limbAngle = topAngle + (farAngle - topAngle) * 0.42;
    const earthZ = this.LH * 1.2;
    const limbY = cam.y - Math.tan(limbAngle) * (earthZ - cam.z);
    this.earth?.group.position.set(0, limbY - this.EARTH_R, earthZ);

    // --- Sun: hover just above the limb, left of center --------------------
    const el = Math.max(0.05, limbAngle - 0.05);
    const az = -0.62;
    const dist = 3800;
    this.sun.position.set(
      cam.x + dist * Math.cos(el) * Math.sin(az),
      cam.y + dist * Math.sin(el),
      cam.z + dist * Math.cos(el) * Math.cos(az)
    );
    this.keyLight.position.copy(this.sun.position);
  }

  /** Iteratively fit the tilted camera so the whole play rect stays on screen. */
  private fitCamera() {
    const aspect = this.cssW / this.cssH;
    this.camera.aspect = aspect;
    const pitchDeg = aspect < 0.8 ? 42 : aspect < 1.35 ? 48 : 54;
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const dir = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));

    this.camTarget.set(0, PLAY_Y * 0.35, this.LH * 0.04);
    const hw = this.LW / 2;
    const hh = this.LH / 2;
    const corners = [
      new THREE.Vector3(-hw, PLAY_Y, -hh),
      new THREE.Vector3(hw, PLAY_Y, -hh),
      new THREE.Vector3(-hw, PLAY_Y, hh),
      new THREE.Vector3(hw, PLAY_Y, hh),
      new THREE.Vector3(-hw, PLAY_Y + 90, -hh),
      new THREE.Vector3(hw, PLAY_Y + 90, -hh),
      new THREE.Vector3(0, PLAY_Y + 110, hh),
      new THREE.Vector3(0, 0, -hh - 120),
    ];

    let R = Math.max(this.LH, this.LW) * 1.15;
    const v = new THREE.Vector3();
    for (let iter = 0; iter < 30; iter++) {
      this.camera.position.copy(this.camTarget).addScaledVector(dir, R);
      this.camera.lookAt(this.camTarget);
      this.camera.updateMatrixWorld();
      let maxNdc = 0;
      for (const c of corners) {
        v.copy(c).project(this.camera);
        maxNdc = Math.max(maxNdc, Math.abs(v.x), Math.abs(v.y));
      }
      if (maxNdc > 0.94) R *= 1.045;
      else if (maxNdc < 0.86) R *= 0.965;
      else break;
    }
    this.camBasePos.copy(this.camera.position);
    this.camera.updateProjectionMatrix();

    const mat = this.particlePts?.material as THREE.ShaderMaterial | undefined;
    if (mat?.uniforms) {
      mat.uniforms.uPixPerUnit.value =
        this.renderer.domElement.height /
        (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    }
  }

  // -------------------------------------------------------------------------
  // Coordinate mapping & input
  // -------------------------------------------------------------------------

  private wx(lx: number) {
    return lx - this.LW / 2;
  }
  private wz(ly: number) {
    return this.LH / 2 - ly;
  }

  /** Pointer → logical coords (exact inverse of the current camera projection). */
  screenToLogical(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLAY_Y);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) {
      return { x: this.LW / 2, y: 0 };
    }
    return {
      x: clamp(hit.x + this.LW / 2, -40, this.LW + 40),
      y: clamp(this.LH / 2 - hit.z, -60, this.LH + 40),
    };
  }

  // -------------------------------------------------------------------------
  // Pools
  // -------------------------------------------------------------------------

  resetPools() {
    for (const map of [this.threatMeshes, this.goodieMeshes, this.projectileMeshes]) {
      for (const m of map.values()) this.destroy(m);
      map.clear();
    }
    for (const m of this.hazardMeshes.values()) this.destroy(m);
    this.hazardMeshes.clear();
  }

  private releaseStale(map: Map<number, THREE.Group | THREE.Mesh>, seen: Set<number>) {
    for (const [id, mesh] of map) {
      if (!seen.has(id)) {
        this.destroy(mesh);
        map.delete(id);
      }
    }
  }

  /** Removes an entity mesh from the scene AND frees its GPU-side
   *  geometry/material allocations. Every mesh is built from fresh
   *  geometries/materials (only the glow/icon textures are shared and cached),
   *  so a bare scene.remove() leaks WebGL buffers for every retired entity —
   *  at auto-fire cadence a 10-minute run leaked thousands of them.
   *  (material.dispose() does NOT dispose shared textures — safe.) */
  private destroy(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.scene.remove(obj);
  }

  // -------------------------------------------------------------------------
  // Per-frame sync (called from GameEngine3D.render)
  // -------------------------------------------------------------------------

  sync(state: WorldState, timeSec: number) {
    if (this.disposed) return;
    this.lastDrivenAt = performance.now();
    const dt = Math.min(0.1, Math.max(0, timeSec - this.lastTimeSec));
    this.lastTimeSec = timeSec;

    this.applyEraMood(state);
    this.syncCamera(state);
    this.syncTurret(state);
    this.syncThreats(state, timeSec, dt);
    this.syncProjectiles(state, timeSec, dt);
    this.syncGoodies(state, timeSec, dt);
    this.syncHazards(state);
    this.syncComets(state);
    this.syncParticles(state);
    this.syncTelegraphs(state, timeSec);
    this.syncBase(state, timeSec);
    this.syncStars(dt, state);
    this.earth?.update(dt);
    this.corridorMat.uniforms.uTime.value = timeSec;
    this.drawOverlay(state, timeSec);

    this.renderFrame();
  }

  private renderFrame() {
    if (this.bloomOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private applyEraMood(state: WorldState) {
    const era = state.currentEra;
    if (!era) return;
    const fog = this.scene.fog as THREE.Fog;
    const overdrive = state.isOverdrive;
    if (era.eraNumber !== this.lastEra) {
      this.lastEra = era.eraNumber;
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.setStyle(era.palette.bgTop);
      } else {
        this.scene.background = new THREE.Color(era.palette.bgTop);
      }
      fog.color.setStyle(era.palette.bgBottom);
      this.hemiLight.color.setStyle(era.palette.starsColor || '#7dd3fc');
      this.corridorMat.uniforms.uTint.value.setStyle(era.palette.starsColor || '#67e8f9');
    }
    fog.near = state.voidFogTimer > 0 ? 240 : 500;
    fog.far = state.voidFogTimer > 0 ? 1500 : 2600;
    this.keyLight.intensity = overdrive ? 3.0 : 2.4;
    this.hemiLight.intensity = overdrive ? 1.15 : 0.85;
  }

  private syncCamera(state: WorldState) {
    this.camera.position.copy(this.camBasePos);
    // Subtle parallax lean toward the aim point — keeps the 3D feel alive.
    const aimX = state.cannonX + Math.cos(state.aimAngle) * 220;
    const leanTarget = this.wx(aimX) * 0.055;
    this.aimLean += (leanTarget - this.aimLean) * 0.06;
    this.camera.position.x += this.aimLean;
    if (state.screenShake > 0) {
      const s = state.screenShake * 0.65;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.35;
    }
    this.camera.lookAt(
      this.camTarget.x + this.aimLean * 0.4,
      this.camTarget.y,
      this.camTarget.z
    );
    this.camera.updateMatrixWorld();
  }

  private syncTurret(state: WorldState) {
    if (!this.turretGroup || this.turretColor !== state.skinColors.cannon) {
      if (this.turretGroup) this.destroy(this.turretGroup);
      const built = buildTurret(state.skinColors.cannon);
      this.turretGroup = built.group;
      this.turretBarrel = built.barrel;
      this.muzzle = built.muzzle;
      this.turretColor = state.skinColors.cannon;
      this.scene.add(this.turretGroup);
    }
    this.turretGroup.position.set(this.wx(state.cannonX), 0, this.wz(state.cannonY));
    if (this.turretBarrel) {
      // aimAngle: -PI/2 = straight up-field. Logical (cos a, sin a) → world (cos a, -sin a).
      const yaw = Math.atan2(Math.cos(state.aimAngle), -Math.sin(state.aimAngle));
      this.turretBarrel.rotation.y = yaw;
      const recoil = clamp(state.recoilOffset, 0, 8);
      this.turretBarrel.position.z = -recoil * 1.6;
      this.turretBarrel.position.y = 22 - recoil * 0.35;
      if (this.muzzle) {
        const flashing = recoil > 0.4;
        const mat = this.muzzle.material as THREE.SpriteMaterial;
        mat.opacity = flashing ? 0.9 : 0;
        this.muzzle.scale.setScalar(flashing ? 18 + recoil * 1.6 : 14);
      }
      // Coil heat: accelerator rings glow hotter while the gun is cycling.
      const coils = this.turretBarrel.userData.coils as THREE.Mesh[] | undefined;
      if (coils) {
        const heat = 1.6 + recoil * 0.5;
        for (const c of coils) {
          (c.material as THREE.MeshStandardMaterial).emissiveIntensity = heat;
        }
      }
      // Muzzle flash point light (physical units: candela with decay²).
      this.muzzleLight.position.set(
        this.wx(state.cannonX) + Math.sin(yaw) * 58,
        30,
        this.wz(state.cannonY) + Math.cos(yaw) * 58
      );
      this.muzzleLight.intensity = recoil > 0.05 ? Math.min(52000, recoil * 9000) : 0;
    }
  }

  private syncThreats(state: WorldState, timeSec: number, dt: number) {
    const seen = new Set<number>();
    for (let i = 0; i < state.threats.length; i++) {
      const t = state.threats[i];
      seen.add(t.id);
      let mesh = this.threatMeshes.get(t.id);
      if (!mesh || mesh.userData.builtType !== t.type) {
        if (mesh) this.destroy(mesh);
        mesh = buildThreatMesh(t);
        this.threatMeshes.set(t.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      const bob = Math.sin(timeSec * 2.1 + (t.phaseSeed ?? t.id)) * 2.4;
      mesh.position.set(this.wx(t.x), PLAY_Y + 16 + bob, this.wz(t.y));
      mesh.rotation.y = Math.atan2(t.vx, -t.vy);

      if (Math.abs(t.rotationSpeed) > 0) {
        // Rocks & spinners: direct mapping of the 2D sprite rotation
        mesh.rotation.x = t.angle * 0.62;
        mesh.rotation.z = t.angle;
      } else {
        mesh.rotation.z = clamp(-t.vx * 0.0016, -0.55, 0.55);
        mesh.rotation.x = clamp(-t.vy * 0.0006, -0.35, 0.35);
      }

      const dome = mesh.userData.shieldDome as THREE.Mesh | undefined;
      if (dome) dome.visible = t.shieldHp > 0;
      if (t.isPhasedOut || t.isStealth) {
        mesh.visible = Math.sin(timeSec * 22 + t.id * 1.7) > -0.35;
      }
      const hurtPulse = t.lastDamagedAt !== undefined && timeSec - t.lastDamagedAt < 0.12;
      mesh.scale.setScalar(t.radius * (hurtPulse ? 1.12 : 1));

      if (t.type === 'chrono_wraith' && mesh.userData.chronoRing) {
        (mesh.userData.chronoRing as THREE.Mesh).rotation.z += dt * 2.4;
      }
      if (t.type === 'healer_ship' && mesh.userData.healRing) {
        (mesh.userData.healRing as THREE.Mesh).rotation.z += dt * 1.6;
      }
      if (t.type === 'tesla_node' && mesh.userData.teslaMast) {
        (mesh.userData.teslaMast as THREE.Mesh).scale.y = 1 + 0.25 * Math.sin(timeSec * 18 + t.id);
      }
    }
    this.releaseStale(this.threatMeshes, seen);
  }

  private syncProjectiles(state: WorldState, timeSec: number, dt: number) {
    const seen = new Set<number>();
    for (let i = 0; i < state.projectiles.length; i++) {
      const p = state.projectiles[i];
      seen.add(p.id);
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = buildProjectileMesh(p);
        this.projectileMeshes.set(p.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(this.wx(p.x), PLAY_Y + 10, this.wz(p.y));
      mesh.rotation.y = Math.atan2(p.vx, -p.vy);
      if (p.isGrenade) mesh.rotation.x += dt * 9;
      const beam = mesh.getObjectByName('beam');
      if (beam) beam.scale.z = p.length || 24;
    }
    this.releaseStale(this.projectileMeshes, seen);
  }

  private syncGoodies(state: WorldState, timeSec: number, dt: number) {
    const seen = new Set<number>();
    for (let i = 0; i < state.goodies.length; i++) {
      const g = state.goodies[i];
      seen.add(g.id);
      let mesh = this.goodieMeshes.get(g.id);
      if (!mesh) {
        mesh = buildGoodieMesh(g);
        this.goodieMeshes.set(g.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      const bob = Math.sin(timeSec * 2.6 + g.id) * 3.2;
      mesh.position.set(this.wx(g.x), PLAY_Y + 18 + bob, this.wz(g.y));
      mesh.rotation.y += dt * 1.9;
      const core = mesh.getObjectByName('core');
      if (core) core.rotation.x += dt * 1.2;
    }
    this.releaseStale(this.goodieMeshes, seen);
  }

  private syncHazards(state: WorldState) {
    const seen = new Set<number>();
    for (let i = 0; i < state.groundHazards.length; i++) {
      const h = state.groundHazards[i];
      seen.add(h.id);
      let mesh = this.hazardMeshes.get(h.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            color: '#fb923c',
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          })
        );
        mesh.rotation.x = -Math.PI / 2;
        this.hazardMeshes.set(h.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(this.wx(h.x + h.width / 2), 1.2, this.wz(h.y + h.height / 2));
      mesh.scale.set(h.width, h.height, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        0.55 * (h.duration / Math.max(0.001, h.maxDuration));
    }
    this.releaseStale(this.hazardMeshes, seen);
  }

  private syncComets(state: WorldState) {
    const shards = state.starfallShards;
    for (let i = 0; i < this.comets.length; i++) {
      const comet = this.comets[i];
      const s = shards[i];
      if (!s) {
        comet.visible = false;
        continue;
      }
      comet.visible = true;
      comet.position.set(this.wx(s.x), PLAY_Y + 26, this.wz(s.y));
      comet.rotation.y = Math.atan2(s.vx, -s.vy);
      comet.rotation.x = s.fuse > 0 ? 0.25 : -0.4;
    }
  }

  private syncParticles(state: WorldState) {
    const cap = this.quality >= 2 ? 110 : this.quality >= 1 ? 220 : 420;
    const n = Math.min(state.pLive, cap, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const p = state.particles[i];
      this.pPos[i * 3] = this.wx(p.x);
      this.pPos[i * 3 + 1] = PLAY_Y + 12;
      this.pPos[i * 3 + 2] = this.wz(p.y);
      const c = cachedColor(p.color);
      this.pCol[i * 3] = c.r;
      this.pCol[i * 3 + 1] = c.g;
      this.pCol[i * 3 + 2] = c.b;
      this.pSize[i] = Math.max(0.6, p.radius * 2);
      this.pAlpha[i] = p.alpha;
    }
    this.particleGeo.setDrawRange(0, n);
    (this.particleGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeo.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeo.attributes.palpha as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Sniper locks, hunter dives, tesla charges, proximity warnings. */
  private syncTelegraphs(state: WorldState, timeSec: number) {
    let li = 0;
    let ri = 0;
    const turretTop = new THREE.Vector3(this.wx(state.cannonX), PLAY_Y + 30, this.wz(state.cannonY));
    const baseTop = new THREE.Vector3(0, PLAY_Y + 10, this.wz(state.L_HEIGHT - 60));

    for (const t of state.threats) {
      const pos = new THREE.Vector3(this.wx(t.x), PLAY_Y + 16, this.wz(t.y));
      const sniperCharging = (t.sniperCharge ?? 0) > 0;
      const diving = t.isDiving || (t.lockOnTimer !== undefined && t.lockOnTimer > 0);
      const teslaCharging = (t.teslaCharge ?? 0) > 0.45;
      const nearBase = t.y > state.L_HEIGHT - 210;

      if ((sniperCharging || teslaCharging) && li < this.telegraphLines.length) {
        const line = this.telegraphLines[li++];
        line.visible = true;
        const attr = line.geometry.attributes.position as THREE.BufferAttribute;
        const target = sniperCharging ? turretTop : baseTop;
        attr.setXYZ(0, pos.x, pos.y, pos.z);
        attr.setXYZ(1, target.x, target.y, target.z);
        attr.needsUpdate = true;
        const mat = line.material as THREE.LineBasicMaterial;
        mat.color.set(teslaCharging ? '#fde047' : '#f87171');
        mat.opacity = 0.35 + 0.35 * Math.sin(timeSec * 14);
      }
      if (diving && li < this.telegraphLines.length) {
        const line = this.telegraphLines[li++];
        line.visible = true;
        const attr = line.geometry.attributes.position as THREE.BufferAttribute;
        attr.setXYZ(0, pos.x, pos.y, pos.z);
        attr.setXYZ(1, baseTop.x, baseTop.y, baseTop.z);
        attr.needsUpdate = true;
        const mat = line.material as THREE.LineBasicMaterial;
        mat.color.set('#fb923c');
        mat.opacity = 0.5;
      }
      if (nearBase && ri < this.telegraphRings.length) {
        const ring = this.telegraphRings[ri++];
        ring.visible = true;
        ring.position.set(pos.x, 1.5, pos.z);
        const pulse = 1 + 0.18 * Math.sin(timeSec * 10);
        ring.scale.setScalar(t.radius * 2.2 * pulse);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.45;
      }
    }
    for (let i = li; i < this.telegraphLines.length; i++) this.telegraphLines[i].visible = false;
    for (let i = ri; i < this.telegraphRings.length; i++) this.telegraphRings[i].visible = false;
  }

  private syncBase(state: WorldState, timeSec: number) {
    const hpRatio = clamp(state.currentBaseHp / Math.max(1, state.maxBaseHp), 0, 1);
    const spireMat = this.baseSpire.material as THREE.MeshStandardMaterial;
    const baseColor = cachedColor(state.skinColors.base);
    spireMat.color.copy(baseColor);
    spireMat.emissive.copy(baseColor);
    spireMat.emissive.lerp(cachedColor('#ef4444'), (1 - hpRatio) * 0.85);
    spireMat.emissiveIntensity = 1.2 + 0.35 * Math.sin(timeSec * (hpRatio < 0.35 ? 9 : 2.5));
    this.shieldDome.visible = state.currentShieldHp > 0;
    if (this.shieldDome.visible) {
      this.shieldMat.uniforms.uPulse.value =
        0.85 + 0.25 * Math.sin(timeSec * 3.2) +
        0.3 * (state.currentShieldHp / Math.max(1, state.currentShieldHp + 60));
    }
  }

  private syncStars(dt: number, state: WorldState) {
    for (let i = 0; i < this.stars.length; i++) {
      this.stars[i].rotation.y += dt * (i === 0 ? 0.008 : 0.016);
    }
    this.scene.rotation.z = state.isOverdrive ? Math.sin(this.lastTimeSec * 9) * 0.004 : 0;
  }

  // -------------------------------------------------------------------------
  // 2D overlay — tactical reticle, aim guide, vignette + floating combat text
  // -------------------------------------------------------------------------

  private drawOverlay(state: WorldState, timeSec: number) {
    const ctx = this.overlayCtx;
    const canvas = this.overlay;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.height / state.L_HEIGHT;

    this.paintVignette(ctx, canvas, state, timeSec);

    // Aim guide: soft dots tracing the barrel's fire line to the aim point —
    // depth feedback that the 3D tilt used to hide.
    const aimLx = state.cannonX + Math.cos(state.aimAngle) * 260;
    const aimLy = state.cannonY + Math.sin(state.aimAngle) * 260;
    const muzzleLx = state.cannonX + Math.cos(state.aimAngle) * 58;
    const muzzleLy = state.cannonY + Math.sin(state.aimAngle) * 58;
    const STEPS = 7;
    ctx.fillStyle = '#7dd3fc';
    for (let i = 1; i <= STEPS; i++) {
      const t = i / (STEPS + 1);
      const px = this.projectToOverlay(
        muzzleLx + (aimLx - muzzleLx) * t,
        muzzleLy + (aimLy - muzzleLy) * t,
        PLAY_Y + 8
      );
      if (!px) continue;
      ctx.globalAlpha = 0.3 * (1 - t * 0.72);
      ctx.beginPath();
      ctx.arc(px.x, px.y, Math.max(1, 2 * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Tactical reticle with target-lock brackets
    const aimPx = this.projectToOverlay(aimLx, aimLy, PLAY_Y + 6);
    if (aimPx) {
      let hover: Threat | null = null;
      let bestD = Infinity;
      for (const t of state.threats) {
        const dx = t.x - aimLx;
        const dy = t.y - aimLy;
        const d = dx * dx + dy * dy;
        const rr = (t.radius + 26) * (t.radius + 26);
        if (d < rr && d < bestD) {
          bestD = d;
          hover = t;
        }
      }
      const col = hover ? '#ff5f6b' : '#a5dcff';
      const r = 12 * scale;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.2, 1.5 * scale);
      ctx.beginPath();
      ctx.arc(aimPx.x, aimPx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Rotating cardinal ticks
      const rot = timeSec * 1.5;
      for (let k = 0; k < 4; k++) {
        const a = rot + (k * Math.PI) / 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(aimPx.x + c * (r + 3 * scale), aimPx.y + s * (r + 3 * scale));
        ctx.lineTo(aimPx.x + c * (r + 9 * scale), aimPx.y + s * (r + 9 * scale));
        ctx.stroke();
      }
      // Center dot
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(aimPx.x, aimPx.y, Math.max(1.2, 1.7 * scale), 0, Math.PI * 2);
      ctx.fill();
      // Target lock: corner brackets + soft glow ring
      if (hover) {
        const br = 21 * scale;
        const arm = 7 * scale;
        ctx.lineWidth = Math.max(1.6, 2.2 * scale);
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(aimPx.x + sx * br - sx * arm, aimPx.y + sy * br);
          ctx.lineTo(aimPx.x + sx * br, aimPx.y + sy * br);
          ctx.lineTo(aimPx.x + sx * br, aimPx.y + sy * br - sy * arm);
          ctx.stroke();
        }
      }
      // Fire pulse: expanding ring on recoil
      if (state.recoilOffset > 0.5) {
        ctx.globalAlpha = clamp(state.recoilOffset / 8, 0, 0.6);
        ctx.lineWidth = Math.max(1, 1.4 * scale);
        ctx.beginPath();
        ctx.arc(aimPx.x, aimPx.y, r + 5 * scale + state.recoilOffset * 2.4 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Floating combat text — dark stroke keeps it readable over bright blooms
    for (let i = 0; i < state.floatingTexts.length; i++) {
      const ft = state.floatingTexts[i];
      const px = this.projectToOverlay(ft.x, ft.y, PLAY_Y + 46);
      if (!px) continue;
      ctx.globalAlpha = ft.alpha;
      const fs = Math.max(8, Math.round(14 * ft.scale * scale));
      ctx.font = `bold ${fs}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, fs * 0.2);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.strokeText(ft.text, px.x, px.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, px.x, px.y);
      ctx.globalAlpha = 1;
    }
  }

  /** Cinematic corner vignette (cached) + low-HP red danger pulse. */
  private paintVignette(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: WorldState, timeSec: number) {
    const key = `${canvas.width}x${canvas.height}`;
    if (this.vignetteKey !== key || !this.vignetteGrad) {
      const g = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) * 0.42,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.74
      );
      g.addColorStop(0, 'rgba(3, 7, 18, 0)');
      g.addColorStop(1, 'rgba(3, 7, 18, 0.34)');
      this.vignetteGrad = g;
      this.vignetteKey = key;
    }
    ctx.fillStyle = this.vignetteGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hp = clamp(state.currentBaseHp / Math.max(1, state.maxBaseHp), 0, 1);
    if (hp < 0.4) {
      const k = (0.4 - hp) / 0.4;
      const a = k * (0.17 + 0.11 * Math.sin(timeSec * 6.5));
      const rg = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) * 0.34,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.7
      );
      rg.addColorStop(0, 'rgba(239, 68, 68, 0)');
      rg.addColorStop(1, `rgba(239, 68, 68, ${a.toFixed(3)})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  private projectToOverlay(lx: number, ly: number, y: number): { x: number; y: number } | null {
    const canvas = this.overlay;
    if (!canvas) return null;
    const v = new THREE.Vector3(this.wx(lx), y, this.wz(ly)).project(this.camera);
    if (v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * canvas.width,
      y: (1 - (v.y * 0.5 + 0.5)) * canvas.height,
    };
  }

  // -------------------------------------------------------------------------
  // Attract mode — the battlefield stays alive on the menu before a run starts
  // -------------------------------------------------------------------------

  private startIdleLoop() {
    let overlayCleared = false;
    const tick = () => {
      if (this.disposed) return;
      this.idleRaf = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - this.lastDrivenAt < 350) {
        overlayCleared = false;
        return; // engine is driving frames
      }
      // Clear any stale reticle/text the last gameplay frame left behind.
      if (!overlayCleared && this.overlay && this.overlayCtx) {
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        overlayCleared = true;
      }
      const t = now / 1000;
      const dt = this.idleLast ? Math.min(0.05, (now - this.idleLast) / 1000) : 0.016;
      this.idleLast = now;
      this.camera.position.set(
        this.camBasePos.x + Math.sin(t * 0.12) * 90,
        this.camBasePos.y + Math.sin(t * 0.09) * 30,
        this.camBasePos.z
      );
      this.camera.lookAt(this.camTarget);
      this.camera.updateMatrixWorld();
      for (let i = 0; i < this.stars.length; i++) this.stars[i].rotation.y += 0.0016;
      this.earth?.update(dt);
      this.corridorMat.uniforms.uTime.value = t;
      this.renderFrame();
    };
    this.idleRaf = requestAnimationFrame(tick);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.idleRaf);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    for (const tex of this.earthTextures) tex.dispose();
    (this.nebula.userData.tex as THREE.Texture | undefined)?.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

