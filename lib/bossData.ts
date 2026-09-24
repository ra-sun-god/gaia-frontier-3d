import { AlienPilotInfo } from './types';

export interface EraBossConfig {
  eraNumber: number;
  bossName: string;
  pilot: AlienPilotInfo;
  radius: number;
  maxHpBase: number;
  shieldHpBase: number;
  color: string;
  canopyColor: string;
  hullTheme:
    | 'asteroid_drill'
    | 'solar_wing'
    | 'chrome_saucer'
    | 'armada_cruiser'
    | 'scrap_titan'
    | 'ai_matrix'
    | 'quantum_rift'
    | 'cryo_leviathan'
    | 'bio_organism'
    | 'singularity_core'
    | 'solar_titan'
    | 'nebula_leviathan'
    | 'chrono_flagship'
    | 'void_legion'
    | 'omega_core';
  specialAbility: string;
}

export const ERA_BOSS_REGISTRY: Record<number, EraBossConfig> = {
  1: {
    eraNumber: 1,
    bossName: "WARLORD KRAG'TOR",
    pilot: {
      name: "Warlord Krag'Tor",
      title: 'Rock-Claw Marauder',
      species: 'Krag-Reptilian',
      avatarIcon: '🦎',
      skinColor: '#10b981', // Scaly emerald green
      eyeColor: '#ef4444', // Fiery red slit eyes
      shipTheme: 'Drill Marauder',
      dialogueEncounter: 'Pathetic Terrans! My drills will grind your orbital defense to dust!',
      dialogueDefeated: 'Impossible! The Krag Armada... will avenge me!',
    },
    radius: 44,
    maxHpBase: 800,
    shieldHpBase: 250,
    color: '#059669',
    canopyColor: 'rgba(254, 240, 138, 0.45)', // Amber glass dome
    hullTheme: 'asteroid_drill',
    specialAbility: 'Seismic Rock Shatter',
  },
  2: {
    eraNumber: 2,
    bossName: 'PYROMANCER IGNIS',
    pilot: {
      name: 'Pyromancer Ignis',
      title: 'Solar Core Archon',
      species: 'Plasma Elemental',
      avatarIcon: '🔥',
      skinColor: '#f97316', // Glowing magma orange
      eyeColor: '#ffffff', // White-hot radiant eyes
      shipTheme: 'Solar Flare Cruiser',
      dialogueEncounter: 'Bathe in the stellar fire of a thousand dying suns!',
      dialogueDefeated: 'My flames... extinguished... by human weapons?!',
    },
    radius: 46,
    maxHpBase: 950,
    shieldHpBase: 320,
    color: '#ea580c',
    canopyColor: 'rgba(254, 215, 170, 0.5)',
    hullTheme: 'solar_wing',
    specialAbility: 'Solar Flare Meteor Shower',
  },
  3: {
    eraNumber: 3,
    bossName: 'FLEET ADMIRAL XYLAR',
    pilot: {
      name: 'Fleet Admiral Xylar',
      title: 'Zeta Recon Supreme',
      species: 'Zeta Reticulan',
      avatarIcon: '👽',
      skinColor: '#5eead4', // Classic teal/grey alien
      eyeColor: '#a855f7', // Huge glowing purple almond eyes
      shipTheme: 'Chrome Saucer Mothership',
      dialogueEncounter: 'Your primitive planet has been cataloged for total subjugation.',
      dialogueDefeated: 'Data anomaly detected... tactical retreat initiated!',
    },
    radius: 45,
    maxHpBase: 1100,
    shieldHpBase: 420,
    color: '#0d9488',
    canopyColor: 'rgba(153, 246, 228, 0.55)',
    hullTheme: 'chrome_saucer',
    specialAbility: 'Quantum Teleport Blaster',
  },
  4: {
    eraNumber: 4,
    bossName: 'HIGH INQUISITOR VEX',
    pilot: {
      name: 'High Inquisitor Vex',
      title: 'Armada Warmaster',
      species: 'Cyborg Arch-Vanguard',
      avatarIcon: '🤖',
      skinColor: '#8b5cf6', // Cybernetic violet
      eyeColor: '#38bdf8', // 4 glowing cyber-optic sensors
      shipTheme: 'Imperial Armada Flagship',
      dialogueEncounter: 'Submit to the Armada Empire! Kinetic shields to maximum!',
      dialogueDefeated: 'Hull breach in quadrant 4... my flagship is lost!',
    },
    radius: 48,
    maxHpBase: 1300,
    shieldHpBase: 550,
    color: '#9333ea',
    canopyColor: 'rgba(233, 213, 255, 0.5)',
    hullTheme: 'armada_cruiser',
    specialAbility: 'Multi-Barrier Aegis Shield',
  },
  5: {
    eraNumber: 5,
    bossName: 'RUSTJAW THE SCRAPPER',
    pilot: {
      name: 'Rustjaw',
      title: 'Debris Warlord',
      species: 'Cyclopean Scrap-Beast',
      avatarIcon: '⚙️',
      skinColor: '#d97706', // Weathered copper orange
      eyeColor: '#facc15', // Giant central glowing cyclops eye
      shipTheme: 'Junk-Titan Battle Rig',
      dialogueEncounter: 'More scrap for my collection! Time to strip Earth down for parts!',
      dialogueDefeated: 'Aaargh! My glorious junk fortress has been scrapped!',
    },
    radius: 47,
    maxHpBase: 1450,
    shieldHpBase: 480,
    color: '#64748b',
    canopyColor: 'rgba(226, 232, 240, 0.45)',
    hullTheme: 'scrap_titan',
    specialAbility: 'Magnetic Scrap Vortex',
  },
  6: {
    eraNumber: 6,
    bossName: 'SYNTH-PRIME 09',
    pilot: {
      name: 'Synth-Prime 09',
      title: 'Drone Swarm Hivemind',
      species: 'Living Digital Synthezoid',
      avatarIcon: '💠',
      skinColor: '#34d399', // Translucent neon green synth
      eyeColor: '#a7f3d0', // Digital pixel grid eyes
      shipTheme: 'Hex Carrier Mothership',
      dialogueEncounter: 'Calculating mortality probability: 99.98% Terran extinction.',
      dialogueDefeated: 'Critical logic error... system shutdown imminent...',
    },
    radius: 46,
    maxHpBase: 1600,
    shieldHpBase: 600,
    color: '#10b981',
    canopyColor: 'rgba(167, 243, 208, 0.5)',
    hullTheme: 'ai_matrix',
    specialAbility: 'Drone Swarm Replicator',
  },
  7: {
    eraNumber: 7,
    bossName: 'VOID WEAVER NYX',
    pilot: {
      name: 'Void Weaver Nyx',
      title: 'Quantum Rift Empress',
      species: 'Void Specter',
      avatarIcon: '🔮',
      skinColor: '#a21caf', // Deep celestial violet
      eyeColor: '#f0abfc', // Glowing constellation slit eyes
      shipTheme: 'Quantum Warp-Skiff',
      dialogueEncounter: 'You cannot target what does not exist in your dimension!',
      dialogueDefeated: 'The dimensional rift collapses... I fade into eternity!',
    },
    radius: 45,
    maxHpBase: 1800,
    shieldHpBase: 680,
    color: '#c026d3',
    canopyColor: 'rgba(245, 208, 254, 0.5)',
    hullTheme: 'quantum_rift',
    specialAbility: 'Dimensional Phase Shift',
  },
  8: {
    eraNumber: 8,
    bossName: 'LORD GLACIUS',
    pilot: {
      name: 'Lord Glacius',
      title: 'Cryo-Leviathan King',
      species: 'Frost Titan',
      avatarIcon: '❄️',
      skinColor: '#38bdf8', // Glacial azure crystalline
      eyeColor: '#ffffff', // Piercing white frost eyes
      shipTheme: 'Diamond Ice Dreadnought',
      dialogueEncounter: 'A planetary ice age begins now. Freeze in the absolute zero of space!',
      dialogueDefeated: 'The frost thaws... impossible warmth...',
    },
    radius: 48,
    maxHpBase: 2000,
    shieldHpBase: 750,
    color: '#0284c7',
    canopyColor: 'rgba(186, 230, 253, 0.55)',
    hullTheme: 'cryo_leviathan',
    specialAbility: 'Sub-Zero Freeze Cannon',
  },
  9: {
    eraNumber: 9,
    bossName: "QUEEN XOL'ZARA",
    pilot: {
      name: "Queen Xol'Zara",
      title: 'Bio-Hive Broodmother',
      species: 'Chitinous Insectoid Queen',
      avatarIcon: '🪲',
      skinColor: '#be185d', // Royal magenta carapace
      eyeColor: '#f472b6', // Multi-faceted compound eyes
      shipTheme: 'Living Organic Bio-Cruiser',
      dialogueEncounter: 'My children will feast upon your orbital crust! Screeech!',
      dialogueDefeated: 'The brood... must flee to the outer nebula...',
    },
    radius: 49,
    maxHpBase: 2250,
    shieldHpBase: 820,
    color: '#db2777',
    canopyColor: 'rgba(251, 207, 232, 0.5)',
    hullTheme: 'bio_organism',
    specialAbility: 'Parasitic Brood Infestation',
  },
  10: {
    eraNumber: 10,
    bossName: 'SINGULARITY SOVEREIGN',
    pilot: {
      name: 'Sovereign Chronos',
      title: 'Event Horizon Celestial',
      species: 'Dark Matter Overlord',
      avatarIcon: '🪐',
      skinColor: '#1e1b4b', // Cosmic obsidian nebula
      eyeColor: '#fde047', // Golden coronal star rings
      shipTheme: 'Black Hole Singularity Cruiser',
      dialogueEncounter: 'Behold the infinite gravitational collapse. All matter returns to the void.',
      dialogueDefeated: 'The singularity inverts! Reality bends around me...!',
    },
    radius: 52,
    maxHpBase: 2600,
    shieldHpBase: 950,
    color: '#6366f1',
    canopyColor: 'rgba(221, 214, 254, 0.6)',
    hullTheme: 'singularity_core',
    specialAbility: 'Gravitational Singularity Collapse',
  },
  11: {
    eraNumber: 11,
    bossName: 'HELIOS PRIME',
    pilot: {
      name: 'Helios Prime',
      title: 'Coronal Arch-Titan',
      species: 'Living Star-Flame',
      avatarIcon: '☀️',
      skinColor: '#fb923c', // Molten solar gold
      eyeColor: '#fef08a', // Blinding white-yellow starfire eyes
      shipTheme: 'Coronal Prominence Throne',
      dialogueEncounter: 'I am the furnace that forged your little world. Come, burn in my dawn!',
      dialogueDefeated: 'A star... extinguished... by dust... and defiance...',
    },
    radius: 50,
    maxHpBase: 2900,
    shieldHpBase: 1050,
    color: '#f59e0b',
    canopyColor: 'rgba(254, 240, 138, 0.55)',
    hullTheme: 'solar_titan',
    specialAbility: 'Coronal Mass Ejection',
  },
  12: {
    eraNumber: 12,
    bossName: 'ABYSSUS MAW',
    pilot: {
      name: 'Abyssus Maw',
      title: 'Nebula Leviathan',
      species: 'Cosmic Reef Colossus',
      avatarIcon: '🐋',
      skinColor: '#0e7490', // Deep nebula teal
      eyeColor: '#67e8f9', // Bioluminescent lure-light eyes
      shipTheme: 'Living Reef Dreadnought',
      dialogueEncounter: 'The reef feeds on sunken fleets. Your defense fleet will sink next.',
      dialogueDefeated: 'The tide... recedes... my reef... darkens...',
    },
    radius: 54,
    maxHpBase: 3200,
    shieldHpBase: 1150,
    color: '#0891b2',
    canopyColor: 'rgba(165, 243, 252, 0.5)',
    hullTheme: 'nebula_leviathan',
    specialAbility: 'Bioluminescent Spawn Reef',
  },
  13: {
    eraNumber: 13,
    bossName: 'CHRONARCH ZETA',
    pilot: {
      name: 'Chronarch Zeta',
      title: 'Temporal Warlord',
      species: 'Paradox Entity',
      avatarIcon: '⏳',
      skinColor: '#ca8a04', // Aged temporal gold
      eyeColor: '#fef9c3', // Hourglass-flash amber eyes
      shipTheme: 'Epoch Flagship of Stalled Time',
      dialogueEncounter: 'I have already won this battle in a future you will never reach.',
      dialogueDefeated: 'The timeline... rewrites... without me...?',
    },
    radius: 49,
    maxHpBase: 3500,
    shieldHpBase: 1250,
    color: '#eab308',
    canopyColor: 'rgba(254, 249, 195, 0.55)',
    hullTheme: 'chrono_flagship',
    specialAbility: 'Temporal Blink Barrage',
  },
  14: {
    eraNumber: 14,
    bossName: 'DREAD EMPEROR NOX',
    pilot: {
      name: 'Dread Emperor Nox',
      title: 'Sovereign of the Void Legion',
      species: 'Umbral Archon',
      avatarIcon: '👑',
      skinColor: '#881337', // Crimson-black imperial skin
      eyeColor: '#fb7185', // Burning rose-red gaze
      shipTheme: 'Legion Obsidian Cathedral',
      dialogueEncounter: 'Kneel. The light of your sun has been... withdrawn from service.',
      dialogueDefeated: 'An empire of darkness... ends... in your muzzle flash...',
    },
    radius: 53,
    maxHpBase: 3900,
    shieldHpBase: 1400,
    color: '#e11d48',
    canopyColor: 'rgba(254, 205, 211, 0.5)',
    hullTheme: 'void_legion',
    specialAbility: 'Void Legion Orbital Siege',
  },
  15: {
    eraNumber: 15,
    bossName: 'OMEGA PRIME',
    pilot: {
      name: 'Omega Prime',
      title: 'Convergence Incarnate',
      species: 'Fused Multiversal Host',
      avatarIcon: '✨',
      skinColor: '#4c1d95', // Prism-violet fusion
      eyeColor: '#e0e7ff', // Twin starlight glints
      shipTheme: 'Convergence Nexus Spire',
      dialogueEncounter: 'I am every ending you have ever feared, assembled into one.',
      dialogueDefeated: 'Then... every beginning... belongs... to you...',
    },
    radius: 56,
    maxHpBase: 4400,
    shieldHpBase: 1600,
    color: '#818cf8',
    canopyColor: 'rgba(224, 231, 255, 0.6)',
    hullTheme: 'omega_core',
    specialAbility: 'Multiversal Cascade Overload',
  },
};

export function getEraBossConfig(eraNumber: number): EraBossConfig {
  const norm = ((eraNumber - 1) % 15) + 1;
  const config = ERA_BOSS_REGISTRY[norm] || ERA_BOSS_REGISTRY[15];

  // For high eras (Convergence Era 16+), scale up HP
  if (eraNumber > 15) {
    const scale = 1 + (eraNumber - 15) * 0.25;
    return {
      ...config,
      eraNumber,
      bossName: `OMEGA ${config.bossName}`,
      maxHpBase: Math.round(config.maxHpBase * scale),
      shieldHpBase: Math.round(config.shieldHpBase * scale),
    };
  }

  return config;
}
