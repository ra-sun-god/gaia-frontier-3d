#!/usr/bin/env python3
"""Verify the intro loop: opus decode round-trip + seam continuity check."""
import subprocess
import numpy as np

SR = 48000
N = round(16 * 60.0 / 73.0 * SR)

for ext in (".opus", ".m4a"):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", f"/home/z/my-project/Earth-Defender/public/music/intro{ext}",
         "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64).reshape(-1, 2)
    dur = len(x) / SR
    # seam: compare end-of-loop (last 100ms) vs start (first 100ms) energy + spectrum
    tail = x[-4800:]
    head = x[:4800]
    rms_tail = np.sqrt((tail ** 2).mean())
    rms_head = np.sqrt((head ** 2).mean())
    # mid-loop reference (should look like head/tail after wrap)
    mid = x[N // 2 - 2400:N // 2 + 2400]
    rms_mid = np.sqrt((mid ** 2).mean())
    # first-order seam click detector: max |diff| across the wrap boundary
    d = np.abs(x[-1] - x[0]).max()
    print(f"{ext}: decoded {dur:.3f}s ({len(x)} smp, target {N/SR:.3f}s / {N})")
    print(f"   RMS head {20*np.log10(rms_head+1e-12):6.1f} dB | tail {20*np.log10(rms_tail+1e-12):6.1f} dB | mid {20*np.log10(rms_mid+1e-12):6.1f} dB | wrap jump {d:.4f}")
    # correlation of tail vs head (should be high for a well-wrapped loop)
    c = np.corrcoef(tail[:, 0], head[:, 0])[0, 1]
    print(f"   tail/head correlation (L): {c:.3f}")
