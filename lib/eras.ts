import { EraInfo } from './types';

export const ERAS_DATA: EraInfo[] = [
  {
    eraNumber: 1,
    name: 'Asteroid Field',
    description: 'Ancient asteroid belt fragment. Splitting space boulders threaten low Earth orbit.',
    palette: {
      bgTop: '#090d16',
      bgBottom: '#0e1e38',
      starsColor: '#e0f2fe',
      ambientGlow: '#0284c7',
    },
    allowedThreats: ['asteroid_large', 'asteroid_small', 'scout'],
  },
  {
    eraNumber: 2,
    name: 'Meteor Storm',
    description: 'Atmospheric burning meteors leaving thermal fire trails across the sky.',
    palette: {
      bgTop: '#14080a',
      bgBottom: '#2d1216',
      starsColor: '#fed7aa',
      ambientGlow: '#ea580c',
    },
    allowedThreats: ['fire_meteor', 'asteroid_small', 'alien_hoverbike', 'kamikaze', 'fake_goodie'],
  },
  {
    eraNumber: 3,
    name: 'Alien Scouts',
    description: 'Advanced recon vessels darting erratically and returning plasma fire.',
    palette: {
      bgTop: '#071318',
      bgBottom: '#0f2934',
      starsColor: '#99f6e4',
      ambientGlow: '#0d9488',
    },
    allowedThreats: ['scout', 'alien_hoverbike', 'sniper_ship', 'ice_comet', 'plasma_torpedo', 'fake_goodie'],
  },
  {
    eraNumber: 4,
    name: 'Alien Armada',
    description: 'Heavy vanguard battlecruisers with kinetic shielding and mothership armaments.',
    palette: {
      bgTop: '#110c1c',
      bgBottom: '#24143d',
      starsColor: '#e9d5ff',
      ambientGlow: '#9333ea',
    },
    allowedThreats: ['shielded_trooper', 'alien_hoverbike', 'scout', 'healer_ship', 'emp_asteroid', 'cluster_bomb', 'hypersonic_missile', 'siege_carrier'],
  },
  {
    eraNumber: 5,
    name: 'Orbital Debris Field',
    description: 'Derelict satellites and military junk tumbling with chaotic physics.',
    palette: {
      bgTop: '#0e1117',
      bgBottom: '#1f242e',
      starsColor: '#cbd5e1',
      ambientGlow: '#64748b',
    },
    allowedThreats: ['debris_junk', 'magnet_drone', 'alien_hoverbike', 'asteroid_large', 'kamikaze', 'railgun_slug', 'cluster_bomb', 'hypersonic_missile'],
  },
  {
    eraNumber: 6,
    name: 'Rogue AI / Drone Swarm',
    description: 'Self-replicating combat drone swarms in synchronized geometric attack vectors.',
    palette: {
      bgTop: '#091512',
      bgBottom: '#122f28',
      starsColor: '#a7f3d0',
      ambientGlow: '#10b981',
    },
    allowedThreats: ['swarm_pod', 'mini_drone', 'alien_hoverbike', 'magnet_drone', 'shielded_trooper', 'cluster_bomb', 'siege_carrier'],
  },
  {
    eraNumber: 7,
    name: 'Dimensional Rift',
    description: 'Quantum anomalies causing enemies to phase out of reality and teleport.',
    palette: {
      bgTop: '#150a1d',
      bgBottom: '#2f1540',
      starsColor: '#f5d0fe',
      ambientGlow: '#c026d3',
    },
    allowedThreats: ['phase_ghost', 'alien_hoverbike', 'stealth_threat', 'void_orb', 'scout', 'mirror_shade', 'cluster_bomb'],
  },
  {
    eraNumber: 8,
    name: 'Comet Apocalypse',
    description: 'Glacial leviathan comets fracturing into high-velocity freezing shrapnel.',
    palette: {
      bgTop: '#06131c',
      bgBottom: '#0e2b3d',
      starsColor: '#bae6fd',
      ambientGlow: '#0284c7',
    },
    allowedThreats: ['ice_comet', 'fire_meteor', 'debris_junk', 'kamikaze', 'cluster_bomb'],
  },
  {
    eraNumber: 9,
    name: 'Alien Hive Mind',
    description: 'Bio-mechanical organic brood clusters spawning living parasitic bio-drones.',
    palette: {
      bgTop: '#160914',
      bgBottom: '#32112d',
      starsColor: '#fbcfe8',
      ambientGlow: '#db2777',
    },
    allowedThreats: ['swarm_pod', 'alien_hoverbike', 'healer_ship', 'phase_ghost', 'void_orb', 'mirror_shade'],
  },
  {
    eraNumber: 10,
    name: 'Black Hole Anomaly',
    description: 'Singularity distortion warping space-time, pulling munitions and bending shots.',
    palette: {
      bgTop: '#050508',
      bgBottom: '#131124',
      starsColor: '#ddd6fe',
      ambientGlow: '#6366f1',
    },
    allowedThreats: ['gravity_well', 'alien_hoverbike', 'void_orb', 'stealth_threat', 'shielded_trooper', 'hunter_killer', 'mirv_warhead'],
  },
  {
    eraNumber: 11,
    name: 'Solar Corona Inferno',
    description: 'Inside the sun\u2019s atmosphere — plasma raiders surf coronal mass ejections at burn speed.',
    palette: {
      bgTop: '#1a0a02',
      bgBottom: '#451a03',
      starsColor: '#fde68a',
      ambientGlow: '#f59e0b',
    },
    allowedThreats: ['plasma_raider', 'fire_meteor', 'kamikaze', 'alien_hoverbike', 'mini_drone', 'cluster_bomb', 'hypersonic_missile'],
  },
  {
    eraNumber: 12,
    name: 'Nebula Leviathan Reef',
    description: 'A cosmic reef of gas giants — bio-metallic leviathans drift between glowing nebula coral.',
    palette: {
      bgTop: '#04121a',
      bgBottom: '#0b3550',
      starsColor: '#a5f3fc',
      ambientGlow: '#0891b2',
    },
    allowedThreats: ['ice_comet', 'healer_ship', 'swarm_pod', 'plasma_raider', 'debris_junk', 'plasma_torpedo', 'cluster_bomb', 'mirv_warhead'],
  },
  {
    eraNumber: 13,
    name: 'Chrono Storm Paradox',
    description: 'A temporal tempest where wraiths blink through stalled moments of frozen time.',
    palette: {
      bgTop: '#171103',
      bgBottom: '#422a06',
      starsColor: '#fef9c3',
      ambientGlow: '#eab308',
    },
    allowedThreats: ['chrono_wraith', 'phase_ghost', 'stealth_threat', 'sniper_ship', 'void_orb', 'tesla_node', 'hunter_killer', 'cluster_bomb', 'hypersonic_missile'],
  },
  {
    eraNumber: 14,
    name: 'Void Legion Dominion',
    description: 'The final crusade — armored void cruisers bombard from beyond the light of stars.',
    palette: {
      bgTop: '#120208',
      bgBottom: '#3d0a1a',
      starsColor: '#fecdd3',
      ambientGlow: '#e11d48',
    },
    allowedThreats: ['void_cruiser', 'shielded_trooper', 'chrono_wraith', 'kamikaze', 'magnet_drone', 'mirv_warhead', 'cluster_bomb', 'hypersonic_missile', 'railgun_slug', 'tesla_node'],
  },
  {
    eraNumber: 15,
    name: 'Omega Convergence Point',
    description: 'All timelines collide. Every hostile archetype converges on the last beacon of Earth.',
    palette: {
      bgTop: '#0a0a0f',
      bgBottom: '#312e51',
      starsColor: '#e0e7ff',
      ambientGlow: '#818cf8',
    },
    allowedThreats: [
      'plasma_raider',
      'chrono_wraith',
      'void_cruiser',
      'gravity_well',
      'shielded_trooper',
      'fake_goodie',
      'cluster_bomb',
      'mirv_warhead',
      'hypersonic_missile',
      'railgun_slug',
      'plasma_torpedo',
      'siege_carrier',
      'tesla_node',
      'hunter_killer',
      'mirror_shade',
    ],
  },
];

export interface SectorProgress {
  eraIndex: number;
  waveInEra: number;
  totalWavesInEra: number;
  isBossWave: boolean;
  isMiniBossWave: boolean;
  sectorName: string;
}

export function getSectorProgress(wave: number): SectorProgress {
  const WAVES_PER_ERA = 5;
  const eraIndex = Math.ceil(wave / WAVES_PER_ERA);
  const waveInEra = ((wave - 1) % WAVES_PER_ERA) + 1;
  const isBossWave = waveInEra === WAVES_PER_ERA;
  const isMiniBossWave = waveInEra === 3;
  const eraInfo = getEraInfo(wave);

  return {
    eraIndex,
    waveInEra,
    totalWavesInEra: WAVES_PER_ERA,
    isBossWave,
    isMiniBossWave,
    sectorName: eraInfo.name,
  };
}

export function getEraInfo(wave: number): EraInfo {
  // 5 substantial waves per Era to give each sector deep gameplay and build up to the sector boss!
  const WAVES_PER_ERA = 5;
  const eraIndex = Math.ceil(wave / WAVES_PER_ERA);
  if (eraIndex <= 15) {
    return ERAS_DATA[eraIndex - 1];
  }

  // Era 16+ : Convergence (Endless Remix) — cycles all 15 sector themes forever
  const cycleIndex = ((eraIndex - 1) % 15);
  const basePalette = ERAS_DATA[cycleIndex].palette;

  return {
    eraNumber: eraIndex,
    name: `Convergence – Sector ${eraIndex}`,
    description: 'All cosmic anomalies converging into infinite escalating storm events!',
    palette: {
      bgTop: '#030712',
      bgBottom: basePalette.bgBottom,
      starsColor: '#fef08a',
      ambientGlow: '#f59e0b',
    },
    allowedThreats: [
      'gravity_well',
      'phase_ghost',
      'shielded_trooper',
      'swarm_pod',
      'sniper_ship',
      'ice_comet',
      'fire_meteor',
      'void_orb',
      'plasma_raider',
      'chrono_wraith',
      'void_cruiser',
      'cluster_bomb',
      'mirv_warhead',
      'hypersonic_missile',
      'railgun_slug',
      'hunter_killer',
      'mirror_shade',
    ],
  };
}
