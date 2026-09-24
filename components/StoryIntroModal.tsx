'use client';

import React, { useState } from 'react';
import { sound } from '@/lib/audio';
import { haptics } from '@/lib/haptics';
import { ChevronLeft, ChevronRight, FastForward, Play } from 'lucide-react';

interface StoryIntroModalProps {
  /** Fired when the player finishes the story (last NEXT or SKIP ALL).
   *  Reports funnel depth for analytics: how many pages were viewed and
   *  whether the player skipped the rest. */
  onFinish: (info: { pagesViewed: number; skipped: boolean }) => void;
}

/* ---------------------------------------------------------------------------
 * GAIA FRONTIER: AFTER CONTACT — the opening cinematic (the first-contact story).
 *
 * Product spec: first-time players get the storyline when they press PLAY,
 * broken into multiple small illustrated scenes with [PREV] [NEXT] [SKIP ALL]
 * navigation. Every illustration is pure inline SVG — zero external assets,
 * crisp at any DPI, and tiny over the wire.
 * ------------------------------------------------------------------------- */

/** Shared starfield scatter used by the cosmic scenes. */
const StarField: React.FC<{ count?: number }> = ({ count = 26 }) => (
  <g>
    {Array.from({ length: count }).map((_, i) => {
      const x = (i * 53 + 17) % 320;
      const y = (i * 31 + 11) % 120;
      const r = i % 7 === 0 ? 1.4 : 0.7;
      return (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          fill="#e0f2fe"
          opacity={0.85}
          className="animate-pulse"
          style={{ animationDelay: `${(i % 5) * 0.4}s` }}
        />
      );
    })}
  </g>
);

/* ---------------------------------- SCENES --------------------------------- */

/** PAGE 1 — 2035: a voice from the stars; the saucers descend in peace. */
const SceneFirstContact = () => (
  <svg viewBox="0 0 320 170" className="w-full h-full" role="img" aria-label="A friendly saucer descends over a city at night">
    <defs>
      <linearGradient id="s1-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#020617" />
        <stop offset="70%" stopColor="#0c1d44" />
        <stop offset="100%" stopColor="#123a6b" />
      </linearGradient>
      <radialGradient id="s1-beam" cx="50%" cy="0%" r="90%">
        <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.75" />
        <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="s1-earth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#0c4a6e" />
      </linearGradient>
    </defs>
    <rect width="320" height="170" fill="url(#s1-sky)" />
    <StarField />
    {/* Gaia's curved horizon */}
    <circle cx="160" cy="300" r="185" fill="url(#s1-earth)" />
    <circle cx="160" cy="300" r="185" fill="none" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.8" />
    {/* City skyline on the horizon */}
    <g fill="#020617">
      <rect x="38" y="126" width="14" height="20" />
      <rect x="58" y="118" width="10" height="28" />
      <rect x="74" y="130" width="18" height="16" />
      <rect x="120" y="114" width="9" height="32" />
      <rect x="136" y="124" width="16" height="22" />
      <rect x="186" y="120" width="12" height="26" />
      <rect x="206" y="128" width="18" height="18" />
      <rect x="232" y="116" width="9" height="30" />
      <rect x="248" y="126" width="14" height="20" />
    </g>
    <g fill="#fbbf24" opacity="0.9">
      {[[41, 130], [45, 136], [61, 124], [77, 134], [123, 120], [140, 130], [189, 126], [210, 132], [235, 122], [252, 132]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="2" height="2" />
      ))}
    </g>
    {/* The visitor — friendly saucer with cyan welcome beam */}
    <g className="animate-pulse" style={{ animationDuration: '3s' }}>
      <polygon points="160,52 108,140 212,140" fill="url(#s1-beam)" />
      <ellipse cx="160" cy="48" rx="34" ry="9" fill="#94a3b8" />
      <ellipse cx="160" cy="44" rx="34" ry="9" fill="#cbd5e1" />
      <path d="M138 44a22 14 0 0 1 44 0z" fill="#7dd3fc" opacity="0.9" />
      <circle cx="160" cy="38" r="4" fill="#f0f9ff" />
      <circle cx="146" cy="50" r="2" fill="#67e8f9" />
      <circle cx="174" cy="50" r="2" fill="#67e8f9" />
      <ellipse cx="160" cy="45" rx="46" ry="16" fill="none" stroke="#7dd3fc" strokeWidth="0.8" opacity="0.55" />
    </g>
    {/* Year tag */}
    <g>
      <rect x="12" y="12" width="52" height="16" rx="8" fill="#020617" stroke="#38bdf8" strokeWidth="1" opacity="0.9" />
      <text x="38" y="23" textAnchor="middle" fontSize="9" fontWeight="900" fill="#7dd3fc" fontFamily="monospace">
        2035
      </text>
    </g>
  </svg>
);

/** PAGE 2 — The gift years: wonders shared, guards lowered. */
const SceneGiftYears = () => (
  <svg viewBox="0 0 320 170" className="w-full h-full" role="img" aria-label="Human and alien hands exchange a glowing crystal">
    <defs>
      <linearGradient id="s2-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#041c26" />
        <stop offset="100%" stopColor="#0e7490" stopOpacity="0.6" />
      </linearGradient>
      <radialGradient id="s2-crystal" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#fef9c3" />
        <stop offset="60%" stopColor="#4ade80" />
        <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="320" height="170" fill="url(#s2-sky)" />
    <StarField count={18} />
    {/* Prosperous skyline with green spires */}
    <g>
      <rect x="10" y="120" width="300" height="50" fill="#06283a" />
      <g fill="#0b3b4d" stroke="#2dd4bf" strokeWidth="0.6">
        <path d="M22 120l8-26 8 26z" />
        <path d="M56 120l6-34 6 34z" />
        <rect x="96" y="86" width="16" height="34" rx="2" />
        <path d="M150 120l10-44 10 44z" />
        <rect x="200" y="80" width="14" height="40" rx="2" />
        <path d="M244 120l8-28 8 28z" />
        <rect x="282" y="96" width="12" height="24" rx="2" />
      </g>
      <g fill="#5eead4" opacity="0.8">
        {[[100, 92], [104, 100], [152, 84], [204, 86], [208, 96], [60, 96]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="2.5" height="2.5" />
        ))}
      </g>
    </g>
    {/* Hands exchanging the gift crystal */}
    <ellipse cx="160" cy="88" rx="60" ry="46" fill="url(#s2-crystal)" className="animate-pulse" />
    {/* Human arm (left) */}
    <path d="M64 96q34-10 62-2l6 10q-36 12-68 4z" fill="#d6a778" stroke="#92613c" strokeWidth="1" />
    {/* Alien arm (right) — teal, slender */}
    <path d="M256 96q-34-10-62-2l-6 10q36 12 68 4z" fill="#5eead4" stroke="#0f766e" strokeWidth="1" />
    {/* Crystal */}
    <g className="animate-pulse">
      <polygon points="160,66 172,86 160,108 148,86" fill="#bbf7d0" />
      <polygon points="160,66 172,86 160,108 148,86" fill="none" stroke="#facc15" strokeWidth="1.2" />
      <line x1="160" y1="66" x2="160" y2="108" stroke="#fef9c3" strokeWidth="0.8" />
    </g>
    {/* Sparkles */}
    <g fill="#fde047">
      <circle cx="120" cy="70" r="1.6" className="animate-ping" />
      <circle cx="204" cy="64" r="1.6" className="animate-ping" style={{ animationDelay: '0.5s' }} />
      <circle cx="188" cy="112" r="1.4" className="animate-ping" style={{ animationDelay: '1s' }} />
      <circle cx="132" cy="112" r="1.4" className="animate-ping" style={{ animationDelay: '1.5s' }} />
    </g>
  </svg>
);

/** PAGE 3 — The masks fall: colonization and the harvest begin. */
const SceneMasksFall = () => (
  <svg viewBox="0 0 320 170" className="w-full h-full" role="img" aria-label="Crimson saucers drill extraction beams into a cracked Earth">
    <defs>
      <linearGradient id="s3-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0a0a0f" />
        <stop offset="100%" stopColor="#450a0a" />
      </linearGradient>
      <linearGradient id="s3-beam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f87171" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#dc2626" stopOpacity="0.15" />
      </linearGradient>
    </defs>
    <rect width="320" height="170" fill="url(#s3-sky)" />
    <StarField count={14} />
    {/* Menacing eyes in the dark */}
    <g className="animate-pulse">
      <path d="M42 34q10-8 20 0q-10 6-20 0z" fill="#ef4444" />
      <path d="M88 34q10-8 20 0q-10 6-20 0z" fill="#ef4444" />
      <path d="M212 30q12-9 24 0q-12 7-24 0z" fill="#ef4444" />
      <path d="M266 30q12-9 24 0q-12 7-24 0z" fill="#ef4444" />
    </g>
    {/* Crimson saucer */}
    <g>
      <ellipse cx="160" cy="46" rx="38" ry="10" fill="#7f1d1d" />
      <ellipse cx="160" cy="42" rx="38" ry="10" fill="#b91c1c" />
      <path d="M136 42a24 15 0 0 1 48 0z" fill="#450a0a" />
      <circle cx="152" cy="49" r="2" fill="#f87171" />
      <circle cx="160" cy="50" r="2" fill="#f87171" />
      <circle cx="168" cy="49" r="2" fill="#f87171" />
    </g>
    {/* Extraction drill beams into the crust */}
    <g className="animate-pulse" style={{ animationDuration: '1.6s' }}>
      <polygon points="160,52 118,150 202,150" fill="url(#s3-beam)" />
    </g>
    {/* Wounded Earth */}
    <circle cx="160" cy="306" r="196" fill="#1c1917" stroke="#7f1d1d" strokeWidth="2" />
    {/* Glowing extraction veins */}
    <g stroke="#f97316" strokeWidth="1.4" fill="none" opacity="0.9">
      <path d="M96 142l18-12 10 10 14-8" />
      <path d="M180 146l14-10 12 8 16-6" />
      <path d="M130 156l16-8 8 6" />
    </g>
    <g fill="#f97316">
      <circle cx="96" cy="142" r="2" className="animate-ping" />
      <circle cx="222" cy="130" r="2" className="animate-ping" style={{ animationDelay: '0.6s' }} />
      <circle cx="130" cy="156" r="1.6" className="animate-ping" style={{ animationDelay: '1.2s' }} />
    </g>
    {/* Warning tag */}
    <g>
      <rect x="236" y="88" width="72" height="16" rx="8" fill="#450a0a" stroke="#f87171" strokeWidth="1" />
      <text x="272" y="99" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fecaca" fontFamily="monospace">
        HARVESTING…
      </text>
    </g>
  </svg>
);

/** PAGE 4 — Gaia under siege: the skies burn. */
const SceneUnderSiege = () => (
  <svg viewBox="0 0 320 170" className="w-full h-full" role="img" aria-label="Fire meteors rain down on burning cities">
    <defs>
      <linearGradient id="s4-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1c0a0a" />
        <stop offset="60%" stopColor="#7c2d12" />
        <stop offset="100%" stopColor="#ea580c" stopOpacity="0.8" />
      </linearGradient>
      <linearGradient id="s4-trail" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fdba74" stopOpacity="0" />
        <stop offset="100%" stopColor="#fdba74" stopOpacity="0.9" />
      </linearGradient>
    </defs>
    <rect width="320" height="170" fill="url(#s4-sky)" />
    <StarField count={10} />
    {/* Raining fire meteors */}
    <g>
      {[
        { x: 60, y: 20, s: 1.0, d: '0s' },
        { x: 130, y: 8, s: 0.8, d: '0.3s' },
        { x: 205, y: 26, s: 1.1, d: '0.6s' },
        { x: 262, y: 10, s: 0.7, d: '0.15s' },
        { x: 30, y: 54, s: 0.6, d: '0.45s' },
        { x: 168, y: 48, s: 0.55, d: '0.75s' },
      ].map((m, i) => (
        <g key={i} className="animate-pulse" style={{ animationDelay: m.d, animationDuration: '1.1s' }}>
          <rect x={m.x - 1.5 * m.s} y={m.y} width={3 * m.s} height={34 * m.s} fill="url(#s4-trail)" />
          <circle cx={m.x} cy={m.y} r={4 * m.s} fill="#fb923c" />
          <circle cx={m.x} cy={m.y} r={2 * m.s} fill="#fef3c7" />
        </g>
      ))}
    </g>
    {/* Burning city */}
    <g>
      <rect x="0" y="132" width="320" height="38" fill="#1c0a0a" />
      <g fill="#292524">
        <rect x="34" y="104" width="16" height="34" />
        <rect x="56" y="116" width="12" height="22" />
        <rect x="84" y="96" width="20" height="42" />
        <rect x="112" y="112" width="14" height="26" />
        <rect x="150" y="90" width="22" height="48" />
        <rect x="182" y="110" width="16" height="28" />
        <rect x="214" y="100" width="18" height="38" />
        <rect x="246" y="118" width="14" height="20" />
        <rect x="272" y="106" width="16" height="32" />
      </g>
      {/* Explosion bursts */}
      <g className="animate-ping" style={{ animationDuration: '1.4s' }}>
        <polygon points="94,96 100,82 106,96 120,88 106,102 112,116 94,108 86,118 90,102 76,96" fill="#fbbf24" opacity="0.95" />
      </g>
      <g className="animate-ping" style={{ animationDuration: '1.4s', animationDelay: '0.7s' }}>
        <polygon points="160,88 166,72 172,88 188,80 172,94 178,110 160,100 150,112 156,94 142,88" fill="#f87171" opacity="0.9" />
      </g>
      {/* Smoke plumes */}
      <g fill="#57534e" opacity="0.7">
        <circle cx="94" cy="76" r="7" className="animate-pulse" />
        <circle cx="104" cy="66" r="5" className="animate-pulse" style={{ animationDelay: '0.4s' }} />
        <circle cx="162" cy="62" r="8" className="animate-pulse" style={{ animationDelay: '0.2s' }} />
        <circle cx="174" cy="52" r="5.5" className="animate-pulse" style={{ animationDelay: '0.6s' }} />
      </g>
      {/* Ember windows */}
      <g fill="#fb923c" opacity="0.9">
        {[[38, 112], [88, 104], [156, 98], [220, 108], [276, 114]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="2.5" height="2.5" />
        ))}
      </g>
    </g>
    {/* Distress tag */}
    <g>
      <rect x="12" y="12" width="86" height="16" rx="8" fill="#450a0a" stroke="#f87171" strokeWidth="1" />
      <text x="55" y="23" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fecaca" fontFamily="monospace">
        GLOBAL ALERT
      </text>
    </g>
  </svg>
);

/** PAGE 5 — The Gaia Frontier: every nation, one banner. */
const SceneGaiaFrontier = () => (
  <svg viewBox="0 0 320 170" className="w-full h-full" role="img" aria-label="United nations form a shield ring around Earth">
    <defs>
      <radialGradient id="s5-earth" cx="38%" cy="32%" r="80%">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="55%" stopColor="#1d4ed8" />
        <stop offset="100%" stopColor="#172554" />
      </radialGradient>
      <radialGradient id="s5-halo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#facc15" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="320" height="170" fill="#020617" />
    <StarField count={30} />
    <ellipse cx="160" cy="85" rx="120" ry="80" fill="url(#s5-halo)" className="animate-pulse" />
    {/* Hope rays */}
    <g stroke="#facc15" strokeWidth="0.8" opacity="0.5">
      <line x1="160" y1="85" x2="46" y2="26" className="animate-pulse" />
      <line x1="160" y1="85" x2="274" y2="26" className="animate-pulse" style={{ animationDelay: '0.4s' }} />
      <line x1="160" y1="85" x2="30" y2="96" className="animate-pulse" style={{ animationDelay: '0.8s' }} />
      <line x1="160" y1="85" x2="290" y2="96" className="animate-pulse" style={{ animationDelay: '1.2s' }} />
      <line x1="160" y1="85" x2="98" y2="152" className="animate-pulse" style={{ animationDelay: '1.6s' }} />
      <line x1="160" y1="85" x2="222" y2="152" className="animate-pulse" style={{ animationDelay: '2s' }} />
    </g>
    {/* Earth */}
    <circle cx="160" cy="85" r="34" fill="url(#s5-earth)" stroke="#93c5fd" strokeWidth="1" />
    <path d="M146 70q8-6 16-2q4 6-2 10q-10 2-14-8z" fill="#34d399" opacity="0.9" />
    <path d="M170 92q10-4 14 4q-2 8-12 6q-6-4-2-10z" fill="#34d399" opacity="0.9" />
    <path d="M148 104q6 0 8 6q-8 4-12-2z" fill="#34d399" opacity="0.8" />
    {/* United orbit ring of nations */}
    <g className="animate-[spin_14s_linear_infinite]" style={{ transformOrigin: '160px 85px' }}>
      <ellipse cx="160" cy="85" rx="56" ry="56" fill="none" stroke="#facc15" strokeWidth="1" strokeDasharray="4 6" opacity="0.85" />
      {[
        { a: -90, c: '#f87171' }, { a: -30, c: '#60a5fa' }, { a: 30, c: '#fbbf24' },
        { a: 90, c: '#34d399' }, { a: 150, c: '#c084fc' }, { a: 210, c: '#fb923c' },
      ].map(({ a, c }, i) => {
        const rad = (a * Math.PI) / 180;
        const x = 160 + 56 * Math.cos(rad);
        const y = 85 + 56 * Math.sin(rad);
        return <circle key={i} cx={x} cy={y} r="3.4" fill={c} stroke="#fef9c3" strokeWidth="0.8" />;
      })}
    </g>
    {/* Frontier shield emblem */}
    <g className="animate-pulse">
      <path d="M160 118l-16-8v-12q0-8 16-14q16 6 16 14v12z" fill="#0e7490" stroke="#facc15" strokeWidth="1.6" />
      <path d="M160 114l-11-6v-8q0-6 11-10q11 4 11 10v8z" fill="none" stroke="#7dd3fc" strokeWidth="0.8" />
      <polygon points="160,94 162,101 169,101 163,105 165,112 160,108 155,112 157,105 151,101 158,101" fill="#fde047" />
    </g>
    {/* Banner tag */}
    <g>
      <rect x="84" y="12" width="152" height="16" rx="8" fill="#172554" stroke="#facc15" strokeWidth="1" />
      <text x="160" y="23" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fde047" fontFamily="monospace" letterSpacing="1">
        ALL NATIONS · ONE BANNER
      </text>
    </g>
  </svg>
);

/** PAGE 6 — The cannon is yours: the gameplay hand-off. */
const SceneTakeTheCannon = () => (
  <svg viewBox="0 0 320 170" className="w-full h-full" role="img" aria-label="The orbital defense cannon opens fire on the incoming fleet">
    <defs>
      <linearGradient id="s6-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0b1026" />
        <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.7" />
      </linearGradient>
      <linearGradient id="s6-ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#14532d" />
        <stop offset="100%" stopColor="#052e16" />
      </linearGradient>
    </defs>
    <rect width="320" height="170" fill="url(#s6-sky)" />
    <StarField count={20} />
    {/* Incoming enemy wedges */}
    <g>
      {[
        { x: 74, y: 26 }, { x: 118, y: 14 }, { x: 210, y: 20 }, { x: 252, y: 34 },
      ].map(({ x, y }, i) => (
        <g key={i} className="animate-pulse" style={{ animationDelay: `${i * 0.35}s` }}>
          <polygon points={`${x},${y + 8} ${x - 10},${y - 5} ${x + 10},${y - 5}`} fill="#9f1239" stroke="#fb7185" strokeWidth="0.8" />
          <circle cx={x} cy={y} r="1.8" fill="#fecdd3" />
        </g>
      ))}
    </g>
    {/* Rising interceptor rounds */}
    <g fill="#fde047">
      {[[150, 62], [168, 54], [186, 66], [142, 84], [178, 84], [160, 76]].map(([x, y], i) => (
        <g key={i} className="animate-pulse" style={{ animationDelay: `${i * 0.18}s`, animationDuration: '0.7s' }}>
          <rect x={x - 1.4} y={y} width="2.8" height="10" rx="1.4" />
          <circle cx={x} cy={y} r="1.6" fill="#fff7ed" />
        </g>
      ))}
    </g>
    {/* Ground */}
    <path d="M0 170q80-40 160-38t160 38z" fill="url(#s6-ground)" />
    {/* The turret */}
    <g>
      <path d="M138 152l10-24h24l10 24z" fill="#0f2b5c" stroke="#38bdf8" strokeWidth="1" />
      <rect x="148" y="136" width="24" height="10" rx="2" fill="#1e3a8a" stroke="#7dd3fc" strokeWidth="0.8" />
      <g transform="rotate(-38 160 132)">
        <rect x="156" y="108" width="9" height="28" rx="3" fill="#334155" stroke="#38bdf8" strokeWidth="1" />
        <rect x="156" y="112" width="9" height="6" fill="#38bdf8" opacity="0.8" />
      </g>
      {/* Muzzle flash */}
      <g className="animate-ping" style={{ animationDuration: '0.9s' }}>
        <polygon points="146,102 152,88 158,102 170,96 162,110 168,124 150,116 140,126 146,110 132,104" fill="#fbbf24" />
      </g>
    </g>
    {/* HUD corners */}
    <g stroke="#38bdf8" strokeWidth="1.4" fill="none" opacity="0.9">
      <path d="M10 24V10h14" />
      <path d="M296 10h14v14" />
      <path d="M10 146v14h14" />
      <path d="M310 146v14h-14" />
    </g>
    <g>
      <rect x="106" y="148" width="108" height="14" rx="7" fill="#020617" stroke="#38bdf8" strokeWidth="1" />
      <text x="160" y="158" textAnchor="middle" fontSize="7.5" fontWeight="900" fill="#7dd3fc" fontFamily="monospace">
        DEFENSE GRID: ONLINE
      </text>
    </g>
  </svg>
);

/* --------------------------------- SCRIPT ---------------------------------- */

interface StoryScene {
  chapter: string;
  title: string;
  paragraphs: string[];
  Illustration: React.FC;
}

const STORY_SCENES: StoryScene[] = [
  {
    chapter: 'PAGE 1 · THE ARRIVAL',
    title: 'First Contact',
    paragraphs: [
      'In the year 2035, the people of Gaia — the Earth — heard a voice from the stars. Lights appeared over every capital at once, descending slow and silent as snow.',
      'They said they had traveled a thousand years to meet us. They said they came in peace.',
    ],
    Illustration: SceneFirstContact,
  },
  {
    chapter: 'PAGE 2 · THE GIFTS',
    title: 'Years of Wonder',
    paragraphs: [
      'The visitors shared wonders freely: engines that breathed starlight, cures for a hundred diseases, maps of the galaxy drawn by older civilizations.',
      'For three years humanity called them friends. For three years, humanity lowered its guard.',
    ],
    Illustration: SceneGiftYears,
  },
  {
    chapter: 'PAGE 3 · THE MASKS FALL',
    title: 'The True Intent',
    paragraphs: [
      'Then the masks fell. Their true intention was never friendship — it was colonization. Gaia had been surveyed long ago: a jewel of water, minerals and life.',
      'The harvest of Earth\u2019s resources began without a single warning shot.',
    ],
    Illustration: SceneMasksFall,
  },
  {
    chapter: 'PAGE 4 · THE FALL',
    title: 'Gaia Under Siege',
    paragraphs: [
      'Skies burned. Oceans dimmed. City after city fell to the Overlords\u2019 armada, their orbital fortresses hanging above the smoke like false moons.',
      'It was Earth\u2019s darkest hour — and it did not look like it would end.',
    ],
    Illustration: SceneUnderSiege,
  },
  {
    chapter: 'PAGE 5 · THE ANSWER',
    title: 'The Gaia Frontier',
    paragraphs: [
      'But Gaia did not kneel. Every nation on Earth joined hands — old rivals, far continents, strangers — and raised one last united banner: the GAIA FRONTIER.',
      'One fleet. One defense grid. One promise: the Earth belongs to the Earth.',
    ],
    Illustration: SceneGaiaFrontier,
  },
  {
    chapter: 'PAGE 6 · THE CANNON',
    title: 'Commander, Take the Cannon',
    paragraphs: [
      'The Frontier\u2019s last orbital cannon is yours, Commander. Hold the line wave after wave — and trust nothing that glows, for some gifts falling from the sky are traps.',
      'Make First Contact their last mistake. Good hunting.',
    ],
    Illustration: SceneTakeTheCannon,
  },
];

/* --------------------------------- MODAL ----------------------------------- */

export const StoryIntroModal: React.FC<StoryIntroModalProps> = ({ onFinish }) => {
  const [page, setPage] = useState(0);
  /** Furthest scene reached — first-contact funnel data (GA). */
  const [deepestPage, setDeepestPage] = useState(0);
  const scene = STORY_SCENES[page];
  const isLast = page === STORY_SCENES.length - 1;
  const Illustration = scene.Illustration;

  const turn = (next: number) => {
    setPage(next);
    setDeepestPage((d) => Math.max(d, next));
  };

  const goNext = () => {
    sound.playUiClick();
    haptics.light();
    if (isLast) {
      onFinish({ pagesViewed: deepestPage + 1, skipped: false });
    } else {
      turn(Math.min(STORY_SCENES.length - 1, page + 1));
    }
  };

  const goPrev = () => {
    if (page === 0) return;
    sound.playUiClick();
    haptics.light();
    turn(Math.max(0, page - 1));
  };

  return (
    // .story-ctn-size (container-type: size) — the overlay measures BOTH
    // axes, so cqh units can cap the illustration by a HEIGHT budget and a
    // wide-landscape container query can switch the body into a two-page
    // spread. Previously the full-width 320:170 art alone was taller than
    // most desktop viewports: the narrative collapsed to 0px and the nav
    // buttons landed below the fold. Now art, prose and buttons always fit —
    // see the .story-* rules in globals.css.
    <div
      id="story-intro-overlay"
      className="story-ctn-size absolute inset-0 z-50 flex flex-col select-none bg-gradient-to-b from-[#01040e] via-[#04102b] to-[#020a17] backdrop-blur-sm"
    >
      {/* Cinematic letterbox header */}
      <div className="shrink-0 pt-[clamp(10px,2.5cqw,20px)] px-[clamp(16px,4cqw,32px)] flex items-center justify-between">
        <span className="text-[clamp(9px,2.2cqw,14px)] font-black uppercase tracking-[0.25em] text-cyan-300/80">
          GAIA FRONTIER · AFTER CONTACT
        </span>
        <span className="text-[clamp(9px,2.2cqw,14px)] font-mono font-bold text-slate-400">
          {scene.chapter}
        </span>
      </div>

      {/* Story body: illustration + narrative. Stacked on portrait chassis;
          two-page spread (art left, prose right) on wide landscape — the
          container query in globals.css flips it. */}
      <div className="story-body flex-1 min-h-0 mt-[clamp(8px,2cqw,18px)] mb-[clamp(6px,1.5cqw,14px)] px-[clamp(20px,5cqw,44px)] flex flex-col items-center gap-[clamp(10px,2.5cqw,22px)]">
        {/* Illustration frame — width capped by BOTH the body width and a
            chassis-height budget (stacked mode); sized by height in spread
            mode, so it can never starve the prose below the fold. */}
        <div
          key={page}
          className="story-art-frame animate-in fade-in slide-in-from-right-4 duration-300 relative shrink-0 rounded-2xl overflow-hidden border-2 border-cyan-400/40 shadow-[0_0_30px_rgba(56,189,248,0.35)]"
          style={{ aspectRatio: '320 / 170' }}
        >
          <Illustration />
          {/* Vignette for cinematic depth */}
          <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_28px_rgba(0,0,0,0.8)]" />
        </div>

        {/* Narrative — fills the remaining space; the text cluster is vertically
          centered (my-auto) between the illustration and the dots, and every
          size is a cqw clamp so desktop chassis gets big, readable prose
          instead of phone-sized crumbs. */}
      <div
        key={`text-${page}`}
        className="story-text animate-in fade-in duration-500 self-stretch flex-1 min-h-0 px-[clamp(4px,1cqw,12px)] flex flex-col items-center text-center overflow-y-auto"
      >
        <div className="my-auto flex w-full flex-col items-center">
          <h2 className="text-[clamp(18px,5.2cqw,38px)] font-black uppercase tracking-wider text-white drop-shadow-[0_2px_6px_rgba(56,189,248,0.6)]">
            {scene.title}
          </h2>
          <div className="mt-[clamp(4px,1.2cqw,12px)] h-px w-[clamp(64px,16cqw,130px)] bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
          <div className="mt-[clamp(8px,2cqw,18px)] mx-auto flex w-full max-w-[34rem] flex-col gap-[clamp(8px,2cqw,18px)]">
            {scene.paragraphs.map((p, i) => (
              <p key={i} className="text-[clamp(11px,3.2cqw,22px)] leading-relaxed text-slate-200/90 font-medium">
                {p}
              </p>
            ))}
          </div>
        </div>
        {/* Page dots */}
        <div className="shrink-0 pt-[clamp(8px,2cqw,16px)] pb-[clamp(4px,1cqw,10px)] flex items-center gap-[clamp(6px,1.5cqw,12px)]">
          {STORY_SCENES.map((_, i) => (
            <span
              key={i}
              className={`h-[clamp(6px,1.5cqw,10px)] rounded-full transition-all ${
                i === page
                  ? 'w-[clamp(16px,4cqw,26px)] bg-cyan-300'
                  : i < page
                    ? 'w-[clamp(6px,1.5cqw,10px)] bg-cyan-700'
                    : 'w-[clamp(6px,1.5cqw,10px)] bg-slate-700'
              }`}
            />
          ))}
        </div>
        </div>
      </div>

      {/* Navigation footer: [PREV] [NEXT] [SKIP ALL] */}
      <div className="shrink-0 px-[clamp(16px,4cqw,36px)] pb-[clamp(14px,3.5cqw,28px)] pt-[clamp(8px,2cqw,16px)] flex items-center justify-between gap-[clamp(8px,2cqw,16px)] border-t border-cyan-400/15 bg-[#01040e]/60">
        <button
          id="btn-story-prev"
          onClick={goPrev}
          disabled={page === 0}
          className={`flex items-center gap-[clamp(4px,1cqw,8px)] px-[clamp(12px,3cqw,24px)] py-[clamp(8px,2cqw,14px)] rounded-full text-[clamp(10px,2.6cqw,15px)] font-black uppercase tracking-wider border transition select-none ${
            page === 0
              ? 'border-slate-700 text-slate-600 cursor-not-allowed'
              : 'border-cyan-400/50 text-cyan-200 bg-[#071938]/80 active:scale-95 cursor-pointer'
          }`}
        >
          <ChevronLeft className="w-[clamp(14px,3.4cqw,20px)] h-[clamp(14px,3.4cqw,20px)]" aria-hidden />
          PREV
        </button>

        <span className="text-[clamp(9px,2.2cqw,14px)] font-mono font-bold text-slate-500 tracking-wider">
          {page + 1} / {STORY_SCENES.length}
        </span>

        <div className="flex items-center gap-[clamp(6px,1.5cqw,14px)]">
          <button
            id="btn-story-skip"
            onClick={() => {
              sound.playUiClick();
              haptics.light();
              onFinish({ pagesViewed: deepestPage + 1, skipped: true });
            }}
            className="flex items-center gap-[clamp(4px,1cqw,8px)] px-[clamp(10px,2.5cqw,20px)] py-[clamp(8px,2cqw,14px)] rounded-full text-[clamp(10px,2.6cqw,15px)] font-black uppercase tracking-wider text-slate-400 hover:text-slate-200 transition active:scale-95 cursor-pointer"
            title="Skip the whole story"
          >
            <FastForward className="w-[clamp(14px,3.4cqw,20px)] h-[clamp(14px,3.4cqw,20px)]" aria-hidden />
            SKIP ALL
          </button>
          <button
            id="btn-story-next"
            onClick={goNext}
            className={`flex items-center gap-[clamp(6px,1.5cqw,12px)] px-[clamp(20px,5cqw,40px)] py-[clamp(8px,2cqw,14px)] rounded-full text-[clamp(11px,2.9cqw,17px)] font-black uppercase tracking-widest transition active:scale-95 cursor-pointer select-none ${
              isLast
                ? 'btn-game-gold text-white'
                : 'border-2 border-cyan-300 text-cyan-100 bg-gradient-to-b from-[#0d2f5e] to-[#081b3b]'
            }`}
          >
            {isLast ? (
              <>
                <Play className="w-[clamp(14px,3.4cqw,20px)] h-[clamp(14px,3.4cqw,20px)] fill-white" aria-hidden />
                BEGIN DEFENSE
              </>
            ) : (
              <>
                NEXT
                <ChevronRight className="w-[clamp(14px,3.4cqw,20px)] h-[clamp(14px,3.4cqw,20px)]" aria-hidden />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
