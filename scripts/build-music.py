#!/usr/bin/env python3
"""
Earth-Defender soundtrack builder.

Takes the user's uploaded AAA reference tracks (.m4a) and produces tiny,
seamlessly-looping game assets:

  1. decode -> 48kHz stereo float
  2. analyze (RMS envelope, BPM via onset autocorrelation, beat phase)
  3. pick the best loop window (battle = hottest steady groove,
     menu = calmest breakdown)
  4. build a PERFECT seamless loop: the last bar crossfades into the
     pre-roll material that naturally precedes the loop start, so the
     wrap point is sample-continuous (equal-power crossfade)
  5. loudness-normalize (battle -15.5 dBFS RMS, menu -19 dBFS, peak cap
     -1 dBFS) so all eras feel level-matched
  6. encode: Opus 40 kbps VBR stereo (~5 KB/s!) + AAC 80 kbps fallback
     for Safari, into Earth-Defender/public/music/

Output is idempotent; edit CONFIG and re-run.
"""
import json
import subprocess
import sys
import numpy as np
from pathlib import Path

UPLOAD = Path("/home/z/my-project/upload")
OUT = Path("/home/z/my-project/Earth-Defender/public/music")
SR = 48000
CROSSFADE_MIN, CROSSFADE_MAX = 1.2, 2.6   # seconds (snapped to a bar)
TARGET_BATTLE_S, TARGET_MENU_S = 60.0, 76.0
RMS_BATTLE_DB, RMS_MENU_DB = -15.5, -19.0
PEAK_CAP_DB = -1.0
OPUS_KBPS, AAC_KBPS = 40, 80

# id -> (source file, mode, display name, era range comment)
CONFIG = {
    "menu":      ("Deep-Defense Protocol.m4a",       "menu",   "Deep Defense",      "menu / game over"),
    "battle1":   ("Event Horizon Siege.m4a",          "battle", "Event Horizon",     "eras 1-2"),
    "battle2":   ("Neuro Defense.m4a",                "battle", "Neuro Defense",     "eras 3-5"),
    "battle3":   ("Voidfront Siege.m4a",              "battle", "Voidfront Siege",   "eras 6-8"),
    "battle4":   ("Final War Scale.m4a",              "battle", "Final War Scale",   "eras 9-11"),
    "battle5":   ("Neurofunk Tower Defense.m4a",      "battle", "Neurofunk Rampart", "eras 12-14"),
    "battle6":   ("Final Stand.m4a",                  "battle", "Final Stand",       "era 15 / Convergence"),
}


def decode(path: Path) -> np.ndarray:
    """Decode any audio file to (N, 2) float32 @ 48kHz via ffmpeg."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR),
         "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float32)
    return x.reshape(-1, 2)


def dbfs(x):  # mono RMS in dB
    m = x.mean(axis=1) if x.ndim == 2 else x
    r = np.sqrt(np.mean(m * m)) + 1e-12
    return 20 * np.log10(r)


def detect_bpm(x: np.ndarray):
    """Onset-envelope autocorrelation -> (bpm, beat_samples, phase_samples, conf)."""
    mono = x.mean(axis=1)
    hop = SR // 100                      # 10 ms frame
    n = len(mono) // hop
    # frame RMS
    frames = mono[: n * hop].reshape(n, hop)
    rms = np.sqrt((frames ** 2).mean(axis=1)) + 1e-9
    logr = np.log(rms)
    onset = np.maximum(0, np.diff(logr))            # energy rise
    onset = onset - onset.mean()
    sd = onset.std() + 1e-9
    onset = onset / sd
    # autocorrelation over beat lags (63..171 bpm -> 0.35..0.95 s)
    lo, hi = 35, 96
    ac = np.array([np.dot(onset[:-l], onset[l:]) / (len(onset) - l) for l in range(lo, hi + 1)])
    best, best_score = None, -1e9
    for i, l in enumerate(range(lo, hi + 1)):
        l2 = l * 2
        s = ac[i]
        if l2 < len(onset) // 2 and l2 <= hi * 2:
            j2 = l2 - lo
            if 0 <= j2 < len(ac):
                s = 2 * ac[i] + ac[j2]            # reward true period over subdivision
        if s > best_score:
            best_score, best = s, l
    # parabolic refine
    if lo < best < hi:
        y0, y1, y2 = ac[best - lo - 1], ac[best - lo], ac[best - lo + 1]
        denom = (y0 - 2 * y1 + y2)
        if abs(denom) > 1e-12:
            best = best + float(np.clip(0.5 * (y0 - y2) / denom, -0.5, 0.5))
    beat_frames = float(best)
    bpm = 60.0 / (beat_frames / 100.0)
    # beat phase: comb-sum of onset strength
    L = int(round(beat_frames))
    phase = int(np.argmax([onset[p::L].sum() for p in range(L)])) if L > 0 else 0
    conf = float(best_score)
    return bpm, int(L * hop), int(phase * hop), conf


def trim_bounds(x: np.ndarray):
    """Skip leading/trailing near-silence (5 ms windows, -40 dBFS)."""
    mono = x.mean(axis=1)
    w = int(0.005 * SR)
    n = len(mono) // w
    r = np.sqrt((mono[: n * w].reshape(n, w) ** 2).mean(axis=1))
    loud = np.where(r > 10 ** (-40 / 20))[0]
    s = int(loud[0] * w) if len(loud) else 0
    e = int((loud[-1] + 1) * w) if len(loud) else len(mono)
    return s, min(e, len(mono))


def pick_window(x: np.ndarray, core_s, core_e, bar, win, mode):
    """Slide bar-stepped windows of the TARGET loop length; battle = loudest,
    menu = calmest. Returns the best start sample."""
    best, best_score = None, None
    center_bias = (core_s + core_e) / 2
    s = core_s
    while s + win <= core_e:
        seg = x[s: s + win]
        score = dbfs(seg)
        if mode == "menu":
            score = -score                       # prefer calm
        # mild center bias to avoid weird edges of the track
        score -= abs((s + win / 2) - center_bias) / SR * 0.05
        if best_score is None or score > best_score:
            best_score, best = score, s
        s += bar
    return best


def build_loop(x: np.ndarray, s: int, D: int, bar: int):
    """Seamless loop: last F seconds crossfade into the pre-roll."""
    F = int(np.clip(round(bar / SR) * SR, CROSSFADE_MIN * SR, CROSSFADE_MAX * SR))
    F = min(F, bar, D // 8)
    pre = x[s - F: s]                            # material that FLOWS INTO loop start
    body = x[s: s + D]
    out = np.empty((D, 2), dtype=np.float32)
    out[: D - F] = body[: D - F]
    t = np.linspace(0, np.pi / 2, F)             # equal-power curves
    fade_out, fade_in = np.cos(t).astype(np.float32), np.sin(t).astype(np.float32)
    blend = body[D - F:] * fade_out[:, None] + pre * fade_in[:, None]
    out[D - F:] = blend
    return out, F


def normalize(loop: np.ndarray, target_db: float):
    rms = dbfs(loop)
    gain = 10 ** ((target_db - rms) / 20)
    y = loop * gain
    peak = np.abs(y).max()
    cap = 10 ** (PEAK_CAP_DB / 20)
    if peak > cap:
        y *= cap / peak
    return y


def encode(y: np.ndarray, stem: str):
    def run(args, out_name):
        p = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2",
             "-i", "-"] + args + [str(OUT / out_name)],
            input=y.astype(np.float32).tobytes(), capture_output=True)
        if p.returncode != 0:
            print("  ! ffmpeg:", p.stderr.decode()[:300]); return None
        return (OUT / out_name).stat().st_size
    opus = run(["-c:a", "libopus", "-b:a", f"{OPUS_KBPS}k", "-vbr", "on",
                "-application", "audio", "-map_metadata", "-1"], f"{stem}.opus")
    m4a = run(["-c:a", "aac", "-b:a", f"{AAC_KBPS}k", "-movflags", "+faststart",
               "-map_metadata", "-1"], f"{stem}.m4a")
    return opus, m4a


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    total_opus = total_m4a = 0
    print(f"{'track':10} {'src dur':>8} {'bpm':>6} {'win@s':>7} {'loop':>6} {'xfade':>6} "
          f"{'rms dB':>7} {'opus KB':>8} {'m4a KB':>7}  name")
    for stem, (fname, mode, disp, note) in CONFIG.items():
        src = UPLOAD / fname
        x = decode(src)
        bpm, beat, phase, conf = detect_bpm(x)
        bar = beat * 4                                   # assume 4/4
        s0, e0 = trim_bounds(x)
        # usable core: inside trimmed bounds, keep >= crossfade pre-roll headroom
        core_s = s0 + int(CROSSFADE_MAX * SR) + beat
        core_e = e0 - int(3.0 * SR)
        target = TARGET_BATTLE_S if mode == "battle" else TARGET_MENU_S
        max_bars = 40 if mode == "battle" else 44
        bars = max(8, min(max_bars, round(target * SR / bar)))
        want = bars * bar
        # shrink (4 bars at a time) until the loop fits the core
        while want > (core_e - core_s) and bars > 8:
            bars -= 4; want = bars * bar
        s = pick_window(x, core_s, core_e, bar, want, mode)
        # snap s to the beat grid
        grid = (s - phase) / beat
        s = phase + int(round(grid)) * beat
        s = max(s, core_s)                               # pre-roll guaranteed
        D = min(want, core_e - s)
        D = (D // bar) * bar
        loop, F = build_loop(x, s, D, bar)
        y = normalize(loop, RMS_BATTLE_DB if mode == "battle" else RMS_MENU_DB)
        del loop
        src_dur, out_rms = len(x) / SR, dbfs(y)
        opus_sz, m4a_sz = encode(y, stem)
        del y, x
        total_opus += opus_sz or 0; total_m4a += m4a_sz or 0
        print(f"{stem:10} {src_dur:7.1f}s {bpm:6.1f} {s/SR:6.1f}s {D/SR:5.1f}s "
              f"{F/SR:5.2f}s {out_rms:7.1f} {opus_sz/1024:7.0f}KB {m4a_sz/1024:6.0f}KB  {disp} ({note})")
        manifest[stem] = {"file": stem, "name": disp, "bpm": int(round(bpm)),
                          "loop_s": round(D / SR, 1), "mode": mode, "eras": note}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nTOTAL: opus {total_opus/1024:.0f} KB  +  aac fallback {total_m4a/1024:.0f} KB "
          f"(fetched only by Safari)")
    print("manifest.json written")


if __name__ == "__main__":
    sys.exit(main())
