#!/usr/bin/env python3
"""
Warlord Krag'Tor — YouTube thumbnail compositor (1280x720).

Takes the three AI background arts (1344x768), center-crops to 16:9, adds
crisp programmatic arcade typography and saves YouTube-ready thumbnails.

v3 TYPOGRAPHY (user-directed readability overhaul): the heavy serif title
was retired — boss names now render in a clean grotesque bold (Liberation
Sans Bold) with a THIN 6px stroke, +10px tracking and a near-white core,
the YouTube-standard look verified legible down to 168px feed previews.

NOTE: the source backgrounds live at /home/z/my-project/scripts/thumb-bg-{1,2,3}.png
(sandbox-local AI art, not committed). v3 typography can also be re-applied
to already-composited finals via scripts/patch_kragtor_thumbs_v3.py.
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

SRC_DIR = "/home/z/my-project/scripts"
OUT_DIR = "/home/z/my-project/download"
W, H = 1280, 720

FONT_TITLE = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_BADGE = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_BADGE_IT = "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf"
FONT_CAP = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

EMERALD_LIGHT = (209, 250, 229)
EMERALD = (52, 211, 153)
EMERALD_DEEP = (5, 150, 105)
EMERALD_GLOW = (16, 185, 129)
STROKE_DARK = (2, 44, 34)
CRIMSON_HI = (248, 113, 113)
CRIMSON = (220, 38, 38)
CRIMSON_DEEP = (127, 29, 29)
AMBER = (250, 204, 21)

TRACKING = 10          # generous glyph spacing — the readability workhorse
STROKE_W = 6           # thin stroke: glyph counters stay OPEN at feed sizes
TITLE_TARGET_W = 680   # sans is narrower than the old serif — fits larger


def tracked_width(font, text, tracking):
    w = 0
    for ch in text:
        bb = font.getbbox(ch)
        w += (bb[2] - bb[0]) + tracking
    return w - tracking if text else 0


def draw_tracked(draw_obj, x, y, text, font, tracking, **kw):
    cx = x
    for ch in text:
        draw_obj.text((cx, y), ch, font=font, **kw)
        bb = font.getbbox(ch)
        cx += (bb[2] - bb[0]) + tracking


def fit_font(path, text, target_w, start_size):
    """Largest font size whose rendered width (incl. tracking) fits target_w."""
    size = start_size
    while size > 20:
        f = ImageFont.truetype(path, size)
        if tracked_width(f, text, TRACKING) <= target_w:
            return f, tracked_width(f, text, TRACKING)
        size -= 4
    return ImageFont.truetype(path, 20), 0


def gradient_text(layer_size, text, font, colors, stroke_w, stroke_fill):
    """Render tracked text with a vertical gradient fill + heavy stroke. Returns RGBA."""
    pad = stroke_w + 8
    tmp = Image.new("L", layer_size, 0)
    d = ImageDraw.Draw(tmp)
    draw_tracked(d, pad, pad, text, font, TRACKING, fill=255, stroke_width=stroke_w)
    bbox = tmp.getbbox()
    if not bbox:
        return Image.new("RGBA", layer_size, (0, 0, 0, 0)), (0, 0, 0, 0)
    # Gradient fill through the text mask
    grad = Image.new("RGB", layer_size)
    gd = ImageDraw.Draw(grad)
    y0, y1 = bbox[1], bbox[3]
    for y in range(layer_size[1]):
        t = 0 if y1 == y0 else min(1, max(0, (y - y0) / (y1 - y0)))
        # 3-stop vertical gradient
        if t < 0.5:
            k = t / 0.5
            c = tuple(int(colors[0][i] + (colors[1][i] - colors[0][i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            c = tuple(int(colors[1][i] + (colors[2][i] - colors[1][i]) * k) for i in range(3))
        gd.line([(0, y), (layer_size[0], y)], fill=c)
    out = Image.new("RGBA", layer_size, (0, 0, 0, 0))
    # Stroke pass (full text incl. stroke area)
    stroke_layer = Image.new("RGBA", layer_size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(stroke_layer)
    draw_tracked(sd, pad, pad, text, font, TRACKING,
                 fill=stroke_fill + (255,), stroke_width=stroke_w,
                 stroke_fill=stroke_fill + (255,))
    out.alpha_composite(stroke_layer)
    # Gradient fill pass
    fill_layer = Image.new("RGBA", layer_size, (0, 0, 0, 0))
    fill_layer.paste(grad, (0, 0), tmp)
    out.alpha_composite(fill_layer)
    return out, bbox


def add_glow(base, layer, color, radius, offset, passes=2, alpha=1.0):
    """Screen-blend a colored glow of `layer` (placed at `offset`) onto `base`."""
    for _ in range(passes):
        glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        mask = layer.split()[3].point(lambda a: int(a * alpha))
        solid = Image.new("RGBA", layer.size, color + (255,))
        glow.paste(solid, offset, mask)
        glow = glow.filter(ImageFilter.GaussianBlur(radius))
        base.alpha_composite(glow)


def render_badge():
    """Skewed crimson BOSS FIGHT badge with lightning slash. Returns RGBA."""
    f = ImageFont.truetype(FONT_BADGE, 60)
    txt = "BOSS FIGHT"
    tw = f.getbbox(txt)[2] - f.getbbox(txt)[0]
    notch = 26  # angled leading edge
    text_x = notch + 150
    bw = text_x + tw + 44  # plate sized to the ACTUAL text width + padding
    bh = 116
    badge = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    # Crimson gradient plate with angled edges
    plate = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pts = [(notch, 0), (bw, 0), (bw, bh), (0, bh)]
    pd.polygon(pts, fill=CRIMSON + (255,))
    grad = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    gdd = ImageDraw.Draw(grad)
    for y in range(bh):
        t = y / bh
        c = tuple(int(CRIMSON_HI[i] + (CRIMSON_DEEP[i] - CRIMSON_HI[i]) * t) for i in range(3))
        gdd.line([(notch, y), (bw, y)], fill=c + (255,))
    grad.putalpha(plate.split()[3])
    plate = grad
    badge.alpha_composite(plate)
    # White border
    d.line([*pts[0], *pts[1], *pts[2], *pts[3], *pts[0]], fill=(255, 255, 255, 235), width=5)
    # Lightning slash through the plate
    slash = [(notch + 112, 6), (notch + 80, 60), (notch + 110, 60), (notch + 62, 110),
             (notch + 84, 64), (notch + 54, 64)]
    d.polygon(slash, fill=(255, 255, 240, 240))
    # Text — offset right of the slash, sized to fit with padding
    d.text((text_x, bh // 2 + 2), txt, font=f, fill=(255, 255, 255, 255),
           anchor="lm", stroke_width=3, stroke_fill=(90, 10, 10, 255))
    # Skew the whole badge (generous canvas so nothing clips)
    skew = -0.16
    xform = (1, skew, -skew * 30, 0, 1, 0)
    return badge.transform((bw + 110, bh + 60), Image.AFFINE, xform, resample=Image.BICUBIC)


def compose(bg_path, out_path):
    bg = Image.open(bg_path).convert("RGBA")
    # Center-crop 1344x768 -> 1280x720
    bg = bg.crop(((1344 - W) // 2, 0, (1344 - W) // 2 + W, H))
    # YouTube pop: punch contrast + saturation
    bg = ImageEnhance.Contrast(bg).enhance(1.14)
    bg = ImageEnhance.Color(bg).enhance(1.22)

    # Bottom scrim for title legibility
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    for y in range(330, H):
        a = int(200 * ((y - 330) / (H - 330)) ** 1.6)
        sd.line([(0, y), (W, y)], fill=(1, 8, 6, a))
    bg.alpha_composite(scrim)
    # Soft top scrim for badge legibility
    scrim2 = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd2 = ImageDraw.Draw(scrim2)
    for y in range(200):
        a = int(110 * (1 - y / 200) ** 1.5)
        sd2.line([(0, y), (W, y)], fill=(1, 8, 6, a))
    bg.alpha_composite(scrim2)

    # ---- Title: WARLORD / KRAG'TOR --------------------------------------
    margin = 52
    f1, w1 = fit_font(FONT_TITLE, "WARLORD", TITLE_TARGET_W, 200)
    f2, w2 = fit_font(FONT_TITLE, "KRAG'TOR", TITLE_TARGET_W, 200)
    # v3: near-white core through the vertical mid keeps glyph interiors
    # bright; emerald only anchors the bottom — high small-size contrast.
    title_colors = ((255, 255, 252), (178, 242, 214), EMERALD)
    line1, bb1 = gradient_text((W, 340), "WARLORD", f1, title_colors, STROKE_W, (2, 20, 16))
    line2, bb2 = gradient_text((W, 340), "KRAG'TOR", f2, title_colors, STROKE_W, (2, 20, 16))
    y1, y2 = 396, 524
    # Crop each text layer to its content and place
    l1 = line1.crop(bb1)
    l2 = line2.crop(bb2)
    # Local contrast pad behind the title block (radial dark patch)
    pad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd_ = ImageDraw.Draw(pad)
    pd_.ellipse([margin - 70, y1 - 60, margin + 660, y2 + 190], fill=(0, 6, 5, 170))
    pad = pad.filter(ImageFilter.GaussianBlur(46))
    bg.alpha_composite(pad)
    add_glow(bg, l1, EMERALD_GLOW, 11, (margin, y1), 2, 0.85)
    add_glow(bg, l2, EMERALD_GLOW, 11, (margin, y2), 2, 0.85)
    # Hard drop shadow for depth
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh.paste(l1, (margin + 7, y1 + 9), l1)
    sh.paste(l2, (margin + 7, y2 + 9), l2)
    sh = sh.filter(ImageFilter.GaussianBlur(6))
    bg.alpha_composite(sh)
    bg.alpha_composite(l1, (margin, y1))
    bg.alpha_composite(l2, (margin, y2))

    # Amber underline slash beneath the title
    ud = ImageDraw.Draw(bg)
    ud.line([(margin + 4, y2 + l2.height + 14), (margin + min(w2, 480), y2 + l2.height + 6)],
            fill=AMBER + (235,), width=6)

    # ---- BOSS FIGHT badge (top-right) -----------------------------------
    badge = render_badge()
    add_glow(bg, badge, CRIMSON, 14, (W - badge.width - 34, 40), 2, 0.8)
    bg.alpha_composite(badge, (W - badge.width - 34, 40))

    # ---- Corner caption --------------------------------------------------
    cap_f = ImageFont.truetype(FONT_CAP, 30)
    cap_it_f = ImageFont.truetype(FONT_BADGE_IT, 26)
    cd = ImageDraw.Draw(bg)
    cap = "GAIA FRONTIER"
    cw = cd.textbbox((0, 0), cap, font=cap_f)[2]
    cd.text((W - cw - 40, H - 60), cap, font=cap_f, fill=EMERALD_LIGHT + (255,),
            stroke_width=2, stroke_fill=STROKE_DARK + (255,))
    cd.line([(W - cw - 40, H - 24), (W - 40, H - 24)], fill=AMBER + (200,), width=3)
    sub = "ERA 1 APEX THREAT"
    sw = cd.textbbox((0, 0), sub, font=cap_it_f)[2]
    cd.text((W - sw - 40, H - 118), sub, font=cap_it_f, fill=(254, 240, 138, 255),
            stroke_width=2, stroke_fill=STROKE_DARK + (255,))

    # ---- Edge vignette ----------------------------------------------------
    vig = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vig)
    vd.rectangle([0, 0, W, H], fill=90)
    vd.rectangle([60, 40, W - 60, H - 40], fill=0)
    vig = vig.filter(ImageFilter.GaussianBlur(50))
    black = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    bg = Image.composite(black, bg, vig.point(lambda a: int(a * 0.55)))

    bg.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"saved {out_path}")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for i in (1, 2, 3):
        compose(f"{SRC_DIR}/thumb-bg-{i}.png", f"{OUT_DIR}/kragtor-boss-fight-thumb-{i}.png")
    print("done")
