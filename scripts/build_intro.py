#!/usr/bin/env python3
"""
Earth-Defender instant-start intro loop builder — "First Contact".

The main menu theme (menu.opus, ~350 KB) needs a network round-trip plus a
decode before it can make a sound, so the game used to sit in silence for
the first seconds. This script synthesizes a tiny, seamlessly-looping
ambient bridge that plays the moment audio unlocks, then crossfades away
when the real soundtrack is ready.

Design brief (musical kinship with the score):
  - D minor, half-time kinship with the menu theme "Deep Defense" (146 BPM):
    the grid is 73 BPM = 146/2, so the handover feels tempo-related.
  - Layers: breathing sub drone (D), warm detuned pad (Dm9 -> Bbmaj9),
    soft heartbeat thump on the 73 BPM grid, sparse D-minor-pentatonic
    plucks through a dotted-eighth echo, sonar beacons, solar wind,
    and a faint high shimmer.
  - PERFECT loop: sustained layers are rendered over exactly one period and
    tiled; grid events repeat with the same period; melodic one-shots and
    their echo tails are wrapped into the head with an equal-power
    crossfade (same technique as scripts/build-music.py).
  - Loudness-matched to the menu track: -19 dBFS RMS, -1 dBFS peak cap.
  - Encode: Opus 40 kbps VBR stereo (~65 KB) + AAC 56 kbps Safari fallback.

Output: public/music/intro.opus + intro.m4a (+ manifest.json entry).
Idempotent; tweak the constants and re-run.
"""
import json
import subprocess
import numpy as np
from pathlib import Path

OUT = Path("/home/z/my-project/Earth-Defender/public/music")
SR = 48000
BPM = 73.0                    # = 146 / 2 (menu theme kinship)
BARS = 4
BEATS = BARS * 4              # 16 beats
D = BEATS * 60.0 / BPM        # loop length in seconds (~13.15 s)
N = round(D * SR)             # loop period in samples (exact)
F = int(2.5 * SR)             # wrap-crossfade length (s)
M = N + F                     # total render length
RMS_DB = -19.0                # match menu.opus loudness
PEAK_DB = -1.0
OPUS_KBPS, AAC_KBPS = 40, 56

# D minor frequency table
NOTE = {
    "D1": 36.708, "D2": 73.416, "Bb2": 116.541, "D3": 146.832,
    "F3": 174.614, "A3": 220.0, "C4": 261.626, "E4": 329.628,
    "D5": 587.330, "F5": 698.456, "G5": 783.991, "A5": 880.0,
    "C6": 1046.502, "D6": 1174.664,
}
PENT = ["D5", "F5", "G5", "A5", "C6", "D6"]

rng = np.random.default_rng(20260923)


def equal_power_pan(p: float):
    """p in [-1, 1] -> (L, R) equal-power weights."""
    theta = (p + 1.0) * np.pi / 4.0
    return float(np.cos(theta)), float(np.sin(theta))


def band_saw(freq: float, n: int, harmonic_pow: float = 1.8, bright: float = 4200.0) -> np.ndarray:
    """Band-limited additive sawtooth-ish voice, warm harmonic rolloff."""
    t = np.arange(n, dtype=np.float64)
    K = max(1, min(48, int(bright / freq)))
    out = np.zeros(n, dtype=np.float64)
    for k in range(1, K + 1):
        out += np.sin(2.0 * np.pi * freq * k * t / SR) / (k ** harmonic_pow)
    out /= K ** 0.35
    return out


def pure_sine(freq: float, n: int, phase: float = 0.0) -> np.ndarray:
    t = np.arange(n, dtype=np.float64)
    return np.sin(2.0 * np.pi * freq * t / SR + phase)


def lfo(n: int, cycles: int, phase: float = 0.0) -> np.ndarray:
    """Integer-cycle sine LFO over exactly n samples — loop-periodic."""
    idx = np.arange(n, dtype=np.float64)
    return np.sin(2.0 * np.pi * cycles * idx / n + phase)


def place(buf: np.ndarray, x: np.ndarray, start: int) -> None:
    """Add x into buf at start (clipped to buffer length)."""
    end = min(start + len(x), len(buf))
    if start < len(buf) and end > start:
        buf[start:end] += x[: end - start]


def run_delay(x: np.ndarray, delay_s: float, fb: float) -> np.ndarray:
    """Feedback delay (dotted-eighth echo), chunk-accelerated."""
    y = x.astype(np.float64).copy()
    d = int(round(delay_s * SR))
    pos = d
    while pos < len(y):
        end = min(pos + d, len(y))
        y[pos:end] += fb * y[pos - d:end - d]
        pos = end
    return y


def build() -> np.ndarray:
    n_idx = np.arange(N, dtype=np.float64)
    beat_s = 60.0 / BPM
    beat_n = N / BEATS  # samples per beat (float, grid exact over the loop)

    # ---- sustained layers (rendered over exactly N, tiled to M) ----------
    # Sub drone: D2 + a touch of D1, breathing 2 cycles per loop.
    drone = (
        pure_sine(NOTE["D2"], N)
        + 0.38 * pure_sine(NOTE["D1"], N)
        + 0.12 * pure_sine(NOTE["D2"] * 2.0, N)
    )
    drone *= 0.72 + 0.28 * (0.5 + 0.5 * lfo(N, 2))
    drone = np.tanh(drone * 1.15) / 1.15

    # Pad: Dm9 (bars 1-2) -> Bbmaj9 (bars 3-4), 3 detuned voices per note,
    # chord crossfade centered at the half-loop point, 1-cycle breathing.
    cf_n = int(0.9 * SR)
    half = N // 2
    win = np.ones(N)
    fade = 0.5 - 0.5 * np.cos(np.pi * np.arange(cf_n) / cf_n)  # 0->1 raised cosine
    win[half - cf_n // 2 : half - cf_n // 2 + cf_n] = 1.0 - fade
    win[half - cf_n // 2 + cf_n :] = 0.0
    winB = 1.0 - win
    breathe = 0.82 + 0.18 * (0.5 + 0.5 * lfo(N, 1, phase=-np.pi / 2))

    padL = np.zeros(N)
    padR = np.zeros(N)
    chords = [
        (win, [("D3", -0.45), ("F3", -0.10), ("A3", 0.25), ("C4", 0.5), ("E4", 0.0)]),
        (winB, [("Bb2", -0.55), ("D3", -0.2), ("F3", 0.15), ("A3", 0.45), ("C4", 0.55)]),
    ]
    for chord_win, notes in chords:
        for name, pan in notes:
            base = NOTE[name]
            gl, gr = equal_power_pan(pan)
            for cents, amp in ((-6.0, 0.34), (4.0, 0.33), (9.0, 0.33)):
                f = base * 2.0 ** (cents / 1200.0)
                v = band_saw(f, N) * amp
                # split the detuned voices slightly across channels
                padL += chord_win * v * (gl * 0.82 + gr * 0.18)
                padR += chord_win * v * (gr * 0.82 + gl * 0.18)
    padL *= breathe
    padR *= breathe

    # Shimmer: high octave sines with slow beating, 3-cycle breathing.
    shimL = pure_sine(NOTE["A5"], N) + 0.7 * pure_sine(NOTE["A5"] * 1.0015, N)
    shimR = pure_sine(NOTE["D6"], N) + 0.7 * pure_sine(NOTE["D6"] * 0.9985, N)
    shim_env = 0.5 + 0.5 * lfo(N, 3)
    shimL *= shim_env
    shimR *= shim_env

    # Solar wind: shaped noise, 1-cycle breathing, decorrelated L/R.
    def shaped_noise() -> np.ndarray:
        x = rng.standard_normal(N)
        spec = np.fft.rfft(x)
        freqs = np.fft.rfftfreq(N, 1.0 / SR)
        mask = 1.0 / np.sqrt((freqs / 420.0) ** 2 + 1.0)          # gentle lowpass tilt
        mask *= np.exp(-0.5 * ((freqs - 750.0) / 1400.0) ** 2)    # soft band center
        y = np.fft.irfft(spec * mask, N)
        return y / (np.abs(y).max() + 1e-9)

    windL = shaped_noise() * (0.55 + 0.45 * (0.5 + 0.5 * lfo(N, 1)))
    windR = shaped_noise() * (0.55 + 0.45 * (0.5 + 0.5 * lfo(N, 1, phase=np.pi / 3)))

    # Heartbeat thump on the 73 BPM grid (periodic -> tiles perfectly).
    thump = np.zeros(N)
    thump_len = int(0.35 * SR)
    tt = np.arange(thump_len) / SR
    for b in range(BEATS):
        freq_env = 96.0 * np.exp(-tt / 0.09) + 46.0
        phase = 2.0 * np.pi * np.cumsum(freq_env) / SR
        stroke = np.sin(phase) * np.exp(-tt / 0.11)
        accent = 1.25 if b % 4 == 0 else 1.0
        place(thump, np.tanh(stroke * 1.6 * accent) / 1.6, int(round(b * beat_n)))

    # ---- event layers (over M; one-shots inside the loop only) ----------
    evL = np.zeros(M)
    evR = np.zeros(M)

    # Sparse pentatonic plucks, alternating pan.
    pluck_beats = [
        (0.75, "D6", -0.5), (3.5, "A5", 0.45), (4.75, "F5", -0.4),
        (7.5, "C6", 0.5), (8.75, "D6", -0.45), (11.5, "A5", 0.4),
        (12.75, "G5", -0.5), (14.0, "D5", 0.0),
    ]
    pluck_len = int(1.6 * SR)
    tp = np.arange(pluck_len) / SR
    for beat, name, pan in pluck_beats:
        f = NOTE[name]
        tone = (
            np.sin(2.0 * np.pi * f * tp)
            + 0.32 * np.sin(2.0 * np.pi * f * 2.0 * tp)
            + 0.12 * np.sin(2.0 * np.pi * f * 3.0 * tp)
        )
        env = np.minimum(tp / 0.008, 1.0) * np.exp(-tp / 0.38)
        gl, gr = equal_power_pan(pan)
        x = tone * env
        place(evL, x * gl, int(round(beat * beat_n)))
        place(evR, x * gr, int(round(beat * beat_n)))

    # Sonar beacons.
    ping_len = int(2.5 * SR)
    tq = np.arange(ping_len) / SR
    for beat, name in ((0.0, "D5"), (8.25, "A5")):
        f = NOTE[name]
        tone = np.sin(2.0 * np.pi * f * tq)
        env = np.minimum(tq / 0.03, 1.0) * np.exp(-tq / 0.85)
        x = tone * env
        place(evL, x * 0.72, int(round(beat * beat_n)))
        place(evR, x * 0.72, int(round(beat * beat_n)))

    # Dotted-eighth echo per channel (input = events only).
    wetL = run_delay(evL, 0.75 * beat_s, 0.45) - evL
    wetR = run_delay(evR, 0.75 * beat_s, 0.45) - evR

    # ---- assemble stereo mix ---------------------------------------------
    def tile(x: np.ndarray) -> np.ndarray:
        return np.concatenate([x, x[:F]])

    mixL = (
        0.50 * tile(drone)
        + 1.00 * tile(padL)
        + 0.13 * tile(shimL)
        + 0.16 * tile(windL)
        + 0.30 * tile(thump)
        + 0.50 * evL
        + 0.30 * wetL
    )
    mixR = (
        0.50 * tile(drone)
        + 1.00 * tile(padR)
        + 0.13 * tile(shimR)
        + 0.16 * tile(windR)
        + 0.30 * tile(thump)
        + 0.50 * evR
        + 0.30 * wetR
    )

    # ---- wrap the tail into the head (equal-power) -----------------------
    ramp = np.arange(F) / F
    w_head = np.sin(np.pi / 2.0 * ramp)
    w_tail = np.cos(np.pi / 2.0 * ramp)
    mixL[:F] = mixL[:F] * w_head + mixL[N:N + F] * w_tail
    mixR[:F] = mixR[:F] * w_head + mixR[N:N + F] * w_tail
    L = mixL[:N]
    R = mixR[:N]

    # ---- loudness normalize ------------------------------------------------
    stereo = np.stack([L, R], axis=1).astype(np.float32)
    rms = np.sqrt(np.mean(np.asarray(stereo, dtype=np.float64) ** 2)) + 1e-12
    gain = 10 ** (RMS_DB / 20.0) / rms
    stereo *= gain
    peak = np.abs(stereo).max()
    peak_cap = 10 ** (PEAK_DB / 20.0)
    if peak > peak_cap:
        stereo *= peak_cap / peak
        print(f"  peak-capped: {20 * np.log10(peak):.2f} dBFS -> {PEAK_DB} dBFS")
    return stereo


def encode(y: np.ndarray, stem: str):
    def run(args, out_name):
        out = OUT / out_name
        p = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2",
             "-i", "-", *args, str(out)],
            input=y.tobytes(), capture_output=True,
        )
        if p.returncode != 0 or not out.exists():
            print("  ! ffmpeg:", p.stderr.decode()[:300])
            return None
        return out.stat().st_size

    opus = run(["-c:a", "libopus", "-b:a", f"{OPUS_KBPS}k", "-vbr", "on",
                "-application", "audio", "-map_metadata", "-1"], f"{stem}.opus")
    m4a = run(["-c:a", "aac", "-b:a", f"{AAC_KBPS}k", "-movflags", "+faststart",
               "-map_metadata", "-1"], f"{stem}.m4a")
    return opus, m4a


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"'First Contact' intro loop: {BARS} bars @ {BPM} BPM = {N / SR:.3f} s, "
          f"wrap {F / SR:.1f} s, render {(N + F) / SR:.3f} s")
    stereo = build()
    print(f"  loop RMS {20 * np.log10(np.sqrt(np.mean(stereo.astype(np.float64) ** 2)) + 1e-12):.1f} dBFS, "
          f"peak {20 * np.log10(np.abs(stereo).max() + 1e-12):.1f} dBFS")
    opus_sz, m4a_sz = encode(stereo, "intro")
    print(f"  intro.opus {opus_sz // 1024} KB   intro.m4a {m4a_sz // 1024} KB")

    # keep the music manifest in sync
    man_path = OUT / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man["intro"] = {
        "file": "intro",
        "name": "First Contact",
        "bpm": int(round(BPM)),
        "loop_s": round(N / SR, 1),
        "mode": "intro bridge",
        "eras": "instant-start bridge until menu/battle theme decodes",
    }
    man_path.write_text(json.dumps(man, indent=2) + "\n")
    print("  manifest.json updated")


if __name__ == "__main__":
    main()
