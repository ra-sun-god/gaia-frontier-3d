// lib/three/world.ts — Three.js presentation layer for Gaia Frontier.
//
// The 2D gameEngine keeps simulating in its logical (x, y) space; this world
// maps that plane onto a VERTICAL battlefield wall rising from the defense
// line into the sky, and paints the same entities with real meshes, lighting
// and depth.
//
// Mapping contract (kept EXACT so aim/hit-tests stay fair):
//   world.x = logical.x - L_WIDTH/2
//   world.y = L_HEIGHT/2 - logical.y        (logical-up = world-up)
//   world.z = depthOf(logical.y)            (high altitude sits deeper into
//                                            the sky — approach parallax)
//   pointer input is ray-cast against the z=0 wall plane (screenToLogical).
//
// Scene concept — "the last defense battery of Earth":
//   the camera hovers just below the defense line and is tilted UP into the
//   sky the invaders descend from. The hero railcannon and the Gaia citadel
//   guard the bottom of the frame; Earth's glowing limb curves along the
//   bottom edge beneath them; nebulae and stars fill the sky above.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildEarth, buildFlareStars, buildNebula, buildStarfield, buildSun, EarthGroup, Starfield } from './earth';
import { EraInfo, FloatingText, Goodie, GroundHazard, Particle, Projectile, Threat } from '../types';
import {
  buildGoodieMesh,
  buildProjectileMesh,
  buildStarfallComet,
  buildThreatMesh,
  buildTurret,
  glowSprite,
} from './enemyMeshes';

// Entity lanes: slight z offsets off the gameplay wall so sprites, shots
// and the hologram never z-fight.
const LANE_HOLO = -64;   // defense-grid hologram (behind everything)
const LANE_SHOT = 8;    // player projectiles
const LANE_THREAT = 14; // hostiles (halo sprite sits a bit further back)
const LANE_GOODIE = 20; // pickups
const LANE_TEXT = 34;   // floating combat text
const DEFENSE_Z = 20;   // turret / citadel plane (just in front of the wall)
const PLATFORM_Z = 52;  // Gaia citadel platform
const MAX_PARTICLES = 520;
const MAX_COMETS = 24;

/** Visual presence multiplier for hostiles: threat meshes are authored at
 *  1 world unit per logical radius, which reads tiny at rig distance. This
 *  blows the DRAWN size up only — the 2D engine's collision & hit tests
 *  stay logical, so gameplay difficulty is completely untouched. */
const THREAT_VIZ = 1.42;

/** LOCAL scale for the per-threat detection halo sprite. The halo lives
 *  INSIDE the scaled threat group, so the parent already applies
 *  radius·THREAT_VIZ·boost — multiplying by radius/boost again (the old
 *  quadratic form) blew single halos up to thousands of world units: a
 *  sky-drowning orange wash that hid the starfield and flattened enemy
 *  contrast. Keep it a constant; world halo ≈ 4.6× the body. */
const HALO_LOCAL = 4.6;

/** Absolute WORLD-size cap for the detection halo (flagships included). */
const HALO_WORLD_CAP = 150;
/** Other glow sprites (boss aura, engine flames, misc): never wider than
 *  GLOW_BODY_FACTOR× the drawn body, and their size²·opacity “energy” is
 *  bounded — bright glows get proportionally tighter. Era flagships run
 *  radius 50+; without these caps their 0.8-opacity engine flames become
 *  400-unit floodlights that wash the whole sky red. */
const GLOW_BODY_FACTOR = 2.4;
const GLOW_ENERGY_WORLD = 130; // world cap for a 0.2-opacity glow

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
  /** Fire-control assist readout (see GameEngine.updateAimAssist). */
  aimAssistTarget: Threat | null;
  aimAssistIntercept: { x: number; y: number } | null;
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

  // Camera choreography — rig hovers below/behind the defense line, aimed up.
  private camBasePos = new THREE.Vector3(0, -350, -800);
  private camTarget = new THREE.Vector3(0, 0, 0);
  private aimLean = 0;
  private aimRise = 0;

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
  private starfield: Starfield | null = null;
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
  private turretHead: THREE.Group | null = null;
  private turretBarrel: THREE.Group | null = null;
  private muzzle: THREE.Sprite | null = null;
  private turretColor = '';
  private tmpV = new THREE.Vector3();

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

  // Hit-confirm markers: hp snapshots per threat id feed a short-lived list
  // of impact points rendered as crisp X ticks on the overlay — instant
  // "that connected" feedback that particles alone don't deliver.
  private hpSnapshot = new Map<number, number>();
  private hitMarkers: { x: number; y: number; z: number; t: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.camera = new THREE.PerspectiveCamera(52, 1, 10, 12000);
    // Fog band starts far behind the battlefield: the action band stays
    // crisp (distant enemies must remain easy to spot), while the void-fog
    // power still blankets the sky when a void cruiser shrouds the field.
    this.scene.fog = new THREE.Fog('#050b14', 2400, 5600);

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

    // QA/debug handle (window.__earthDefender.world), mirroring the engine's
    // qaSpawn handle: lets a harness inspect camera/world state live.
    if (typeof window !== 'undefined') {
      (window as unknown as { __earthDefender: Record<string, unknown> })
        .__earthDefender ??= { };
      (window as unknown as { __earthDefender: Record<string, unknown> })
        .__earthDefender.world = this;
    }
  }

  // -------------------------------------------------------------------------
  // Scene construction
  // -------------------------------------------------------------------------

  private buildWorld() {
    // Lighting: warm key from the sun hanging in the upper-left sky, cyan
    // earthshine bouncing UP off the planet below (lights hostile bellies
    // and the citadel's underside), soft sky fill from above.
    this.hemiLight = new THREE.HemisphereLight('#7dd3fc', '#0e2a3f', 0.85);
    this.scene.add(this.hemiLight);
    // The sun stays warm-white year-round — the planet must read as a bright
    // "Blue Marble".
    this.keyLight = new THREE.DirectionalLight('#fff3e0', 2.4);
    this.keyLight.position.set(-1400, 2300, 900);
    this.scene.add(this.keyLight);
    // Camera-side fill so nothing in the action band goes pitch dark.
    const frontFill = new THREE.DirectionalLight('#a8c8ff', 0.55);
    frontFill.position.set(300, 500, -900);
    this.scene.add(frontFill);
    // Earthshine: the planet's glow rises from below the defense line.
    const earthshine = new THREE.DirectionalLight('#38bdf8', 0.5);
    earthshine.position.set(0, -900, 300);
    this.scene.add(earthshine);

    // Deep-space dressing. Every material here opts out of scene fog — the
    // battlefield fog band (500–2600) used to swallow the entire starfield,
    // leaving an empty void sky.
    this.nebula = buildNebula(4400);
    this.scene.add(this.nebula);
    this.starfield = buildStarfield();
    this.stars = this.starfield.points;
    for (const s of this.stars) this.scene.add(s);
    this.scene.add(buildFlareStars());
    this.sun = buildSun();
    this.scene.add(this.sun);

    // Holographic defense-grid corridor — a faint vertical holo wall the
    // invaders descend through. Deliberately LOW contrast inside the action
    // band: the grid must never compete with hostile silhouettes.
    this.corridorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTint: { value: new THREE.Color('#67e8f9') },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(675, 1056) },
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
          // altitude rungs (horizontal, every 64u) + faint vertical lanes
          float rung = 1.0 - smoothstep(0.0, 0.05, abs(fract(p.y / 64.0) - 0.5));
          float lane = 1.0 - smoothstep(0.0, 0.028, abs(fract(p.x / 56.0) - 0.5));
          // fade to nothing beyond the playfield rect
          vec2 q = abs(p) - uPlay * 0.5;
          float fade = 1.0 - smoothstep(0.0, uPlay.x * 0.42, max(q.x, q.y));
          // corridor boundary rails at the playfield side edges (the
          // bounce walls — real gameplay information, worth the brightness)
          float rail = smoothstep(42.0, 4.0, abs(abs(p.x) - uPlay.x * 0.5)) * 0.55;
          // radar sweep climbing from the defense line into the sky
          float sp = fract(uTime * 0.085);
          float band = exp(-pow((vUv.y - (0.10 + sp * 0.86)) * 11.0, 2.0)) * 0.16;
          // melt into open sky at the top, into the planetary haze below
          float topFade = 1.0 - smoothstep(0.68, 0.97, vUv.y);
          float botFade = smoothstep(0.015, 0.16, vUv.y);
          float a = fade * topFade * botFade * (0.10 + rung * 0.13 + lane * 0.045 + rail * 0.5 + band);
          vec3 col = uTint * (0.20 + rung * 0.30 + lane * 0.10 + rail * 0.30) + vec3(0.8) * band;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.corridor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.corridorMat);
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
    this.platformFlood = new THREE.PointLight('#cfe4ff', 38000, 780, 2);
    this.scene.add(this.platformFlood);

    // Hero cannon on the menu too: pre-build the turret at its default skin
    // so the attract-mode framing already sells "the last defense battery".
    // syncTurret() rebuilds it the moment gameplay starts if the player's
    // skin differs (turretColor mismatch path).
    const built = buildTurret('#38bdf8');
    this.turretGroup = built.group;
    this.turretHead = built.head;
    this.turretBarrel = built.barrel;
    this.muzzle = built.muzzle;
    this.turretColor = '#38bdf8';
    this.scene.add(this.turretGroup);
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
    this.starfield?.setDpr(dpr);
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

  /** Place the citadel, corridor and — critically — solve Earth's limb to
   *  curve through the BOTTOM band of the frame: the camera looks up into
   *  the sky, so the planet hangs beneath the defense line like a glowing
   *  shield, its atmosphere rim facing the action. All positions derive
   *  from the fitted camera, so portrait and landscape stay framed. */
  private layoutFurniture() {
    const defY = this.wy(this.LH - 185); // defense line (cannon altitude)

    // Gaia citadel platform: floats just below the defense line, slightly
    // in front of the wall so the hero cannon reads as standing on its deck.
    this.platformGroup.position.set(0, defY - 34, PLATFORM_Z);
    this.platformGroup.scale.setScalar(1.35);
    this.shieldDome.position.set(0, defY - 26, PLATFORM_Z);
    this.shieldDome.scale.setScalar(0.78);
    // Floodlight: keeps the cannon + citadel out of silhouette from the
    // camera's low vantage point.
    this.platformFlood.position.set(0, defY + 130, -80);
    this.platformFlood.distance = 760;

    // Vertical holo corridor centered on the gameplay wall.
    const w = this.LW * 1.5;
    const h = this.LH * 1.32;
    this.corridor.position.set(0, this.LH * 0.02, LANE_HOLO);
    this.corridor.scale.set(w, h, 1);
    this.corridorMat.uniforms.uSize.value.set(w, h);
    this.corridorMat.uniforms.uPlay.value.set(this.LW, this.LH);

    // --- Earth framing ------------------------------------------------------
    // Solve the sphere so its silhouette (limb) appears at a fixed fraction
    // up from the bottom edge of the frame. Tangency: a ray from the camera
    // at elevation `limbAngle` grazes the sphere of radius EARTH_R whose
    // center sits `limbZ` ahead. Solved for center.y:
    //   u = (w·sin(limbAngle) − R) / cos(limbAngle),  w = limbZ − cam.z
    const cam = this.camBasePos;
    const fovHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const pitch = Math.atan2(this.camTarget.y - cam.y, Math.max(1, this.camTarget.z - cam.z));
    // Limb at ~17% up from the bottom edge of the view.
    const limbAngle = pitch - fovHalf + 2 * fovHalf * 0.17;
    const limbZ = this.LH * 1.75;
    const wRay = limbZ - cam.z;
    // cam.y + u is the sphere CENTER height (the tangent solve is against
    // the center — the group origin IS the center, no radius offset).
    const u = (wRay * Math.sin(limbAngle) - this.EARTH_R) / Math.cos(limbAngle);
    this.earth?.group.position.set(0, cam.y + u, limbZ);

    // --- Sun: hang in the upper-left sky so the key light rakes the
    //     invaders from above-left and kisses the planet's limb. ----------
    const el = Math.max(0.12, pitch + fovHalf * 0.55);
    const az = -0.58;
    const dist = 3800;
    this.sun.position.set(
      cam.x + dist * Math.cos(el) * Math.sin(az),
      cam.y + dist * Math.sin(el),
      cam.z + dist * Math.cos(el) * Math.cos(az)
    );
    this.keyLight.position.copy(this.sun.position);
  }

  /** Iteratively fit the upward-facing camera so the action band (spawn
   *  depth up top, citadel at the bottom) stays on screen. The rig sits
   *  below and behind the defense line, aimed UP into the sky. */
  private fitCamera() {
    const aspect = this.cssW / this.cssH;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.8 ? 52 : aspect < 1.35 ? 48 : 46;
    this.camera.updateProjectionMatrix();
    // Upward tilt of the rig: steeper on portrait (tall corridor), gentler
    // on widescreen so the horizon keeps some presence.
    const tiltDeg = aspect < 0.8 ? 27 : aspect < 1.35 ? 21 : 16;
    const tilt = THREE.MathUtils.degToRad(tiltDeg);
    // Direction from look-target back to the camera: below + behind.
    const dir = new THREE.Vector3(0, -Math.sin(tilt), -Math.cos(tilt));

    this.camTarget.set(0, this.LH * 0.05, 0);
    const defY = this.wy(this.LH - 185);
    const hw = Math.min(this.LW / 2, 380);
    const probes = [
      // deep top corners — spawn band sits ~170u into the sky
      new THREE.Vector3(-hw, this.wy(-60), -170),
      new THREE.Vector3(hw, this.wy(-60), -170),
      // deep volley spawns (hypersonic stacks start even higher)
      new THREE.Vector3(-hw * 0.7, this.wy(-130), -205),
      new THREE.Vector3(hw * 0.7, this.wy(-130), -205),
      // bottom of the citadel platform
      new THREE.Vector3(-hw, defY - 70, PLATFORM_Z),
      new THREE.Vector3(hw, defY - 70, PLATFORM_Z),
      // turret muzzle at max elevation (straight up)
      new THREE.Vector3(0, defY + 150, DEFENSE_Z),
    ];

    let R = Math.max(this.LH, this.LW) * 0.9;
    const v = new THREE.Vector3();
    for (let iter = 0; iter < 34; iter++) {
      this.camera.position.copy(this.camTarget).addScaledVector(dir, R);
      this.camera.lookAt(this.camTarget);
      this.camera.updateMatrixWorld();
      let maxNdc = 0;
      for (const c of probes) {
        v.copy(c).project(this.camera);
        maxNdc = Math.max(maxNdc, Math.abs(v.x), Math.abs(v.y));
      }
      // Tighter frame margins pull the rig ~5% closer to the wall: every
      // hostile reads larger and more in-your-face without cropping the
      // spawn band (offscreen threats are already chevron-marked).
      if (maxNdc > 0.97) R *= 1.045;
      else if (maxNdc < 0.89) R *= 0.965;
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
  private wy(ly: number) {
    return this.LH / 2 - ly;
  }
  /** High-altitude entities sit deeper into the sky (negative z): the
   *  invaders visibly TOWARD the camera as they descend the top third of
   *  the corridor — cheap, deterministic approach parallax. */
  private depthOf(ly: number) {
    return -clamp((this.LH * 0.34 - ly) * 0.62, 0, 205);
  }

  /** Drawn (visual) radius of a threat — syncThreats scales meshes by
   *  THREAT_VIZ plus distance compensation; the overlay HUD needs the same
   *  number so HP pips and lock brackets hug the body silhouette. */
  private vizRadius(t: { x: number; y: number; radius: number }): number {
    const zT = this.depthOf(t.y) + LANE_THREAT;
    const dCam = this.tmpV.set(this.wx(t.x), this.wy(t.y), zT).distanceTo(this.camera.position);
    const boost = 1 + clamp((dCam - 560) / 1500, 0, 0.85);
    return t.radius * THREAT_VIZ * boost;
  }

  /** Pointer → logical coords (exact inverse of the current camera projection).
   *  The ray hits the vertical gameplay wall (z = 0). */
  screenToLogical(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) {
      return { x: this.LW / 2, y: 0 };
    }
    return {
      x: clamp(hit.x + this.LW / 2, -40, this.LW + 40),
      y: clamp(this.LH / 2 - hit.y, -60, this.LH + 40),
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
    fog.near = state.voidFogTimer > 0 ? 900 : 2400;
    fog.far = state.voidFogTimer > 0 ? 2200 : 5600;
    this.keyLight.intensity = overdrive ? 3.0 : 2.4;
    this.hemiLight.intensity = overdrive ? 1.15 : 0.85;
  }

  private syncCamera(state: WorldState) {
    this.camera.position.copy(this.camBasePos);
    // Parallax response to the aim: lateral lean toward the point, plus a
    // subtle vertical rise when the barrel climbs — keeps the 3D alive.
    const aimX = state.cannonX + Math.cos(state.aimAngle) * 220;
    const leanTarget = this.wx(aimX) * 0.05;
    this.aimLean += (leanTarget - this.aimLean) * 0.06;
    const riseTarget = (state.aimAngle + Math.PI / 2) * 30;
    this.aimRise += (riseTarget - this.aimRise) * 0.05;
    this.camera.position.x += this.aimLean;
    this.camera.position.y += this.aimRise;
    if (state.screenShake > 0) {
      const s = state.screenShake * 0.65;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.35;
    }
    this.camera.lookAt(
      this.camTarget.x + this.aimLean * 0.4,
      this.camTarget.y + this.aimRise * 0.5,
      this.camTarget.z
    );
    this.camera.updateMatrixWorld();
  }

  private syncTurret(state: WorldState) {
    if (!this.turretGroup || this.turretColor !== state.skinColors.cannon) {
      if (this.turretGroup) this.destroy(this.turretGroup);
      const built = buildTurret(state.skinColors.cannon);
      this.turretGroup = built.group;
      this.turretHead = built.head;
      this.turretBarrel = built.barrel;
      this.muzzle = built.muzzle;
      this.turretColor = state.skinColors.cannon;
      this.scene.add(this.turretGroup);
    }
    const defY = this.wy(state.cannonY);
    this.turretGroup.position.set(this.wx(state.cannonX), defY + 6, DEFENSE_Z);
    if (this.turretHead && this.turretBarrel) {
      const a = state.aimAngle; // [-0.91π, -0.09π] — upper hemisphere
      // Yaw: heading around the vertical; atan2(x, small ε) keeps the slew
      // continuous through the straight-up singularity.
      this.turretHead.rotation.y = Math.atan2(Math.cos(a), 0.16);
      // Elevation: barrel pitches up the wall (aimAngle -π/2 = straight up).
      const elev = Math.asin(clamp(-Math.sin(a), -1, 1));
      this.turretBarrel.rotation.x = -elev;
      // Recoil: kick back along the barrel axis.
      const recoil = clamp(state.recoilOffset, 0, 8);
      this.turretBarrel.position.y = 22 - Math.sin(elev) * recoil * 1.5;
      this.turretBarrel.position.z = -Math.cos(elev) * recoil * 1.5;
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
    }
    // Muzzle flash point light at the true barrel tip (physical units).
    this.turretGroup.updateMatrixWorld(true);
    if (this.muzzle) {
      this.muzzle.getWorldPosition(this.tmpV);
      this.muzzleLight.position.copy(this.tmpV);
    } else {
      this.muzzleLight.position.set(this.wx(state.cannonX), this.wy(state.cannonY) + 60, DEFENSE_Z);
    }
    this.muzzleLight.intensity =
      state.recoilOffset > 0.05 ? Math.min(52000, state.recoilOffset * 9000) : 0;
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
        // Detection halo: a soft additive glow behind every hostile so
        // silhouettes pop against the dark sky at ANY distance — the single
        // biggest "I can't see them" fix. LOCAL scale only (see HALO_LOCAL):
        // the parent group's scale carries radius·THREAT_VIZ·boost.
        const halo = glowSprite(
          t.isBoss ? '#ff4d6d' : t.isElite ? '#ffd166' : '#ff8a5c',
          1,
          0.15
        );
        halo.position.y = -0.5; // local −Y → world −z, just behind the body
        mesh.add(halo);
        mesh.userData.halo = halo;
        this.threatMeshes.set(t.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      const bob = Math.sin(timeSec * 2.1 + (t.phaseSeed ?? t.id)) * 2.4;
      const zNow = this.depthOf(t.y) + LANE_THREAT;
      mesh.position.set(this.wx(t.x), this.wy(t.y) + bob, zNow);
      mesh.rotation.order = 'ZYX';
      if (Math.abs(t.rotationSpeed) > 0) {
        // Rocks & spinners: tumble around the sight axis (matches the 2D
        // sprite rotation semantics).
        mesh.rotation.set(Math.PI / 2, 0, t.angle);
      } else {
        // Craft: nose toward the travel direction, belly to the camera —
        // the full silhouette is always visible (easy to track & aim).
        mesh.rotation.set(Math.PI / 2, 0, Math.atan2(t.vx, t.vy));
      }

      const dome = mesh.userData.shieldDome as THREE.Mesh | undefined;
      if (dome) dome.visible = t.shieldHp > 0;
      if (t.isPhasedOut || t.isStealth) {
        mesh.visible = Math.sin(timeSec * 22 + t.id * 1.7) > -0.35;
      }
      const hurtPulse = t.lastDamagedAt !== undefined && timeSec - t.lastDamagedAt < 0.12;
      // Distance size compensation, strengthened: perspective shrinks
      // high-altitude spawns hard — pad them up to +85% (was +55%) so
      // distant intercepts stay comfortably visible and clickable.
      const dCam = mesh.position.distanceTo(this.camera.position);
      const boost = 1 + clamp((dCam - 560) / 1500, 0, 0.85);
      // THREAT_VIZ adds a global visual presence blowup (gameplay-neutral,
      // see its doc comment) — hostiles finally read CLOSE.
      mesh.scale.setScalar(t.radius * THREAT_VIZ * boost * (hurtPulse ? 1.12 : 1));
      const halo = mesh.userData.halo as THREE.Sprite | undefined;
      if (halo) {
        // CONSTANT local scale — the parent group already scales by
        // radius·THREAT_VIZ·boost. (Quadratic historical bug: this used to
        // read t.radius * 6.2 * boost, which made every halo a fullscreen
        // orange wash that erased the starfield and enemy contrast.)
        // Flagships additionally clamp to HALO_WORLD_CAP world units.
        const parentScale0 = mesh.scale.x;
        halo.scale.setScalar(
          parentScale0 > 0 ? Math.min(HALO_LOCAL, HALO_WORLD_CAP / parentScale0) : HALO_LOCAL
        );
        (halo.material as THREE.SpriteMaterial).opacity =
          0.15 + 0.06 * Math.sin(timeSec * 3.1 + (t.phaseSeed ?? t.id));
      }
      // Glow energy guard: every OTHER additive sprite inside the scaled
      // group (boss aura, engine flames, misc glows) is clamped to
      // min(GLOW_BODY_FACTOR× body, opacity-scaled energy cap) in WORLD
      // units — big-radius flagships would otherwise turn their glows
      // into sky-washing floodlights.
      const parentScale = mesh.scale.x;
      if (parentScale > 0) {
        mesh.traverse((o) => {
          const spr = o as THREE.Sprite;
          if (!spr.isSprite || spr === halo) return;
          const op = Math.max(0.05, (spr.material as THREE.SpriteMaterial).opacity);
          const worldCap = Math.min(
            parentScale * GLOW_BODY_FACTOR,
            GLOW_ENERGY_WORLD * Math.sqrt(0.2 / op)
          );
          const localCap = worldCap / parentScale;
          if (spr.scale.x > localCap) spr.scale.setScalar(localCap);
        });
      }

      // Hit-confirm feed for the overlay markers.
      const prevHp = this.hpSnapshot.get(t.id);
      if (prevHp !== undefined && t.hp < prevHp && this.hitMarkers.length < 28) {
        this.hitMarkers.push({ x: t.x, y: t.y, z: zNow, t: timeSec });
      }
      this.hpSnapshot.set(t.id, t.hp);

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
    if (this.hpSnapshot.size > 500) {
      for (const id of this.hpSnapshot.keys()) {
        if (!seen.has(id)) this.hpSnapshot.delete(id);
      }
    }
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
      mesh.position.set(this.wx(p.x), this.wy(p.y), this.depthOf(p.y) + LANE_SHOT);
      mesh.rotation.order = 'ZYX';
      mesh.rotation.set(Math.PI / 2, 0, Math.atan2(p.vx, p.vy));
      if (p.isGrenade) mesh.rotation.y += dt * 9;
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
      mesh.position.set(this.wx(g.x), this.wy(g.y) + bob, this.depthOf(g.y) + LANE_GOODIE);
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
            side: THREE.DoubleSide,
            toneMapped: false,
          })
        );
        this.hazardMeshes.set(h.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      // Containment-field quad on the wall at the hazard rect (matches the
      // 2D renderer's screen-space danger patches).
      mesh.position.set(
        this.wx(h.x + h.width / 2),
        this.wy(h.y + h.height / 2),
        this.depthOf(h.y) + LANE_SHOT - 2
      );
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
      comet.position.set(this.wx(s.x), this.wy(s.y), this.depthOf(s.y) + LANE_GOODIE + 6);
      comet.rotation.order = 'ZYX';
      comet.rotation.set(Math.PI / 2, 0, Math.atan2(s.vx, s.vy));
    }
  }

  private syncParticles(state: WorldState) {
    const cap = this.quality >= 2 ? 110 : this.quality >= 1 ? 220 : 420;
    const n = Math.min(state.pLive, cap, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const p = state.particles[i];
      this.pPos[i * 3] = this.wx(p.x);
      this.pPos[i * 3 + 1] = this.wy(p.y);
      this.pPos[i * 3 + 2] = this.depthOf(p.y) + LANE_SHOT + 4;
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
    const turretTop = new THREE.Vector3(
      this.wx(state.cannonX),
      this.wy(state.cannonY) + 70,
      DEFENSE_Z
    );
    const baseTop = new THREE.Vector3(0, this.wy(state.L_HEIGHT - 60), PLATFORM_Z);

    for (const t of state.threats) {
      const pos = new THREE.Vector3(
        this.wx(t.x),
        this.wy(t.y),
        this.depthOf(t.y) + LANE_THREAT
      );
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
        ring.position.set(pos.x, pos.y, pos.z - 2);
        const pulse = 1 + 0.18 * Math.sin(timeSec * 10);
        ring.scale.setScalar(this.vizRadius(t) * 2.1 * pulse);
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
    // Whole-sky drift. Layer 0 carries the Milky Way (stars + haze in one
    // group) so the band drifts as a unit and can never tear; the inner
    // uniform shells spin a touch faster for parallax. Speeds are slow —
    // real skies don't spin like a carousel.
    for (let i = 0; i < this.stars.length; i++) {
      this.stars[i].rotation.y += dt * (i === 0 ? 0.0025 : 0.006);
    }
    this.starfield?.update(dt); // scintillation clock
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

    const lockT = state.aimAssistTarget;
    const lockIx = state.aimAssistIntercept;

    // Aim guide: soft dots tracing the barrel's fire line toward the aim
    // point, riding the same depth curve as the projectiles.
    const aimLx = state.cannonX + Math.cos(state.aimAngle) * 260;
    const aimLy = state.cannonY + Math.sin(state.aimAngle) * 260;
    const muzzleLx = state.cannonX + Math.cos(state.aimAngle) * 58;
    const muzzleLy = state.cannonY + Math.sin(state.aimAngle) * 58;
    const STEPS = 7;
    ctx.fillStyle = '#7dd3fc';
    for (let i = 1; i <= STEPS; i++) {
      const t = i / (STEPS + 1);
      const lx = muzzleLx + (aimLx - muzzleLx) * t;
      const ly = muzzleLy + (aimLy - muzzleLy) * t;
      const px = this.projectToOverlay(lx, ly, this.depthOf(ly) + LANE_SHOT);
      if (!px) continue;
      ctx.globalAlpha = 0.3 * (1 - t * 0.72);
      ctx.beginPath();
      ctx.arc(px.x, px.y, Math.max(1, 2 * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- Threat scan: incoming chevrons (above frame) + HP pips ----------
    for (let i = 0; i < state.threats.length; i++) {
      const t = state.threats[i];
      if (t.isPhasedOut || t.isStealth) continue;
      const zT = this.depthOf(t.y) + LANE_THREAT;
      const px = this.projectToOverlay(t.x, t.y, zT);
      if (!px) continue;
      const offTop = px.y < -8;
      const offX = px.x < -20 || px.x > canvas.width + 20;
      if (offTop || offX) {
        // Incoming chevron pinned to the screen edge: shows WHERE the next
        // hostile is about to enter from. Pulses red for closing threats.
        const cx = clamp(px.x, 26 * scale + 8, canvas.width - 26 * scale - 8);
        const cy = 15 * scale + 6;
        const danger = t.y > state.L_HEIGHT * 0.45 || t.type === 'hypersonic_missile';
        ctx.globalAlpha = 0.5 + 0.35 * Math.sin(timeSec * 6 + t.id);
        ctx.fillStyle = danger ? '#ff5f6b' : '#fbbf24';
        ctx.beginPath();
        const w = 9 * scale + 3;
        ctx.moveTo(cx - w, cy - w * 0.7);
        ctx.lineTo(cx + w, cy - w * 0.7);
        ctx.lineTo(cx, cy + w * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      // HP pip bar above damaged threats (bosses keep their HUD bar).
      if (t.isBoss || t.hp >= t.maxHp) continue;
      const vr = this.vizRadius(t);
      const left = this.projectToOverlay(t.x - vr, t.y, zT);
      const right = this.projectToOverlay(t.x + vr, t.y, zT);
      const top = this.projectToOverlay(t.x, t.y - vr, zT);
      if (!left || !right || !top) continue;
      const bw = Math.abs(right.x - left.x);
      if (bw < 16) continue;
      const bh = Math.max(2.2, 2.6 * scale);
      const bx = (left.x + right.x) / 2 - bw / 2;
      const by = top.y - bh * 3.1;
      const ratio = clamp(t.hp / Math.max(1, t.maxHp), 0, 1);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.66)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = ratio > 0.55 ? '#4ade80' : ratio > 0.28 ? '#fbbf24' : '#f87171';
      ctx.fillRect(bx, by, bw * ratio, bh);
      ctx.globalAlpha = 1;
    }

    // --- Hit-confirm markers: crisp X ticks at fresh impact points --------
    for (let i = this.hitMarkers.length - 1; i >= 0; i--) {
      const age = timeSec - this.hitMarkers[i].t;
      if (age > 0.24 || age < 0) {
        if (age > 0.24) this.hitMarkers.splice(i, 1);
        continue;
      }
      const m = this.hitMarkers[i];
      const px = this.projectToOverlay(m.x, m.y, m.z);
      if (!px) continue;
      const k = age / 0.24;
      const r0 = (7 + k * 9) * scale;
      const tick = (4.6 - k * 2.2) * scale;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = Math.max(1.3, 1.8 * scale);
      ctx.beginPath();
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        ctx.moveTo(px.x + dx * r0 * 0.45, px.y + dy * r0 * 0.45);
        ctx.lineTo(px.x + dx * (r0 * 0.45 + tick), px.y + dy * (r0 * 0.45 + tick));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- Fire-control assist readout ---------------------------------------
    // Orange brackets frame the tracked target; the diamond pip marks the
    // PREDICTED intercept (where the shots actually go).
    if (lockT && lockIx) {
      const zT = this.depthOf(lockT.y) + LANE_THREAT;
      const tpx = this.projectToOverlay(lockT.x, lockT.y, zT);
      const vr = this.vizRadius(lockT);
      const lpx = this.projectToOverlay(lockT.x - vr, lockT.y, zT);
      const rpx = this.projectToOverlay(lockT.x + vr, lockT.y, zT);
      const ipx = this.projectToOverlay(lockIx.x, lockIx.y, this.depthOf(lockIx.y) + LANE_SHOT);
      if (tpx && lpx && rpx) {
        const br = Math.max(14, Math.abs(rpx.x - lpx.x) * 0.62);
        const arm = br * 0.34;
        ctx.strokeStyle = '#ffb454';
        ctx.lineWidth = Math.max(1.6, 2.2 * scale);
        const pulse = 1 + 0.05 * Math.sin(timeSec * 9);
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(tpx.x + sx * br * pulse - sx * arm, tpx.y + sy * br * pulse);
          ctx.lineTo(tpx.x + sx * br * pulse, tpx.y + sy * br * pulse);
          ctx.lineTo(tpx.x + sx * br * pulse, tpx.y + sy * br * pulse - sy * arm);
          ctx.stroke();
        }
        // Lead pip: rotating diamond at the intercept point.
        if (ipx) {
          const s2 = (5.5 + Math.sin(timeSec * 7) * 0.9) * scale;
          const rot = timeSec * 2.2;
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            const a = rot + (k * Math.PI) / 2;
            const pxk = ipx.x + Math.cos(a) * s2;
            const pyk = ipx.y + Math.sin(a) * s2;
            if (k === 0) ctx.moveTo(pxk, pyk);
            else ctx.lineTo(pxk, pyk);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Tactical reticle — orange while the assist holds a lock.
    const aimPx = this.projectToOverlay(aimLx, aimLy, this.depthOf(aimLy) + LANE_SHOT);
    if (aimPx) {
      const col = lockT ? '#ffb454' : '#a5dcff';
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
      // Dotted connector reticle → intercept while locked (reads as "the
      // computer is walking your fire onto the target").
      if (lockT && lockIx) {
        const ipx = this.projectToOverlay(lockIx.x, lockIx.y, this.depthOf(lockIx.y) + LANE_SHOT);
        if (ipx) {
          ctx.globalAlpha = 0.35;
          ctx.setLineDash([3, 5]);
          ctx.lineWidth = Math.max(1, 1.2 * scale);
          ctx.beginPath();
          ctx.moveTo(aimPx.x, aimPx.y);
          ctx.lineTo(ipx.x, ipx.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
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
      const px = this.projectToOverlay(ft.x, ft.y, this.depthOf(ft.y) + LANE_TEXT);
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

  /** Project a logical-space point at world depth `z` to overlay pixels. */
  private projectToOverlay(lx: number, ly: number, z: number): { x: number; y: number } | null {
    const canvas = this.overlay;
    if (!canvas) return null;
    const v = new THREE.Vector3(this.wx(lx), this.wy(ly), z).project(this.camera);
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
      // Attract mode: slow drift across the battery, gazing up the corridor
      // into the sky — sells the "look up, they're coming" fantasy on the
      // menu screen.
      this.camera.position.set(
        this.camBasePos.x + Math.sin(t * 0.12) * 90,
        this.camBasePos.y + Math.sin(t * 0.09) * 26,
        this.camBasePos.z
      );
      this.camera.lookAt(
        this.camTarget.x + Math.sin(t * 0.07) * 60,
        this.camTarget.y + 120,
        this.camTarget.z
      );
      this.camera.updateMatrixWorld();
      // Attract-mode turret pose: stands guard on the citadel deck, slowly
      // sweeping the horizon while the camera drifts past it.
      if (this.turretGroup && this.turretHead && this.turretBarrel) {
        this.turretGroup.position.set(0, this.wy(this.LH - 185) + 6, DEFENSE_Z);
        this.turretHead.rotation.y = Math.sin(t * 0.22) * 0.65;
        this.turretBarrel.rotation.x = -0.62 + Math.sin(t * 0.13) * 0.1;
      }
      for (let i = 0; i < this.stars.length; i++) this.stars[i].rotation.y += 0.0012;
      this.starfield?.update(dt);
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

