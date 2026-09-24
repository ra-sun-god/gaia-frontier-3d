#!/usr/bin/env python3
"""
Earth-Defender icon builder.

Takes the AI-generated hero art (cannon in front of Earth, 1024x1024) and
produces the full icon family:

  app/icon.png              48x48    Next.js metadata favicon PNG
  app/favicon.ico           16/32/48 multi-size browser favicon
  app/apple-icon.png        180x180  iOS home-screen / apple-touch-icon
  public/icon-192.png       192x192  PWA manifest icon (any)
  public/icon-512.png       512x512  PWA manifest icon (any)
  public/icon-512-maskable.png  512x512  PWA maskable: blurred backdrop
                                       + art at 76% inside the safe zone
  app/opengraph-image.png   1200x630 social share banner (composed)
  app/twitter-image.png     1200x630 social share banner (copy of OG)

Idempotent; re-run after replacing SOURCE.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path
import random

SOURCE = Path("/home/z/my-project/assets/icon-candidate-1.png")
REPO = Path("/home/z/my-project/Earth-Defender")

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Brand palette (lib/site.ts THEME)
BG_DARK = (11, 13, 26)        # #0B0D1A
BG_MID = (24, 27, 46)         # #181B2E
ACCENT = (0, 210, 255)        # #00D2FF cyan
TEXT_DIM = (107, 115, 150)    # #6B7396
TEXT_SOFT = (154, 163, 199)   # #9AA3C7


def load_art() -> Image.Image:
    art = Image.open(SOURCE).convert("RGB")
    assert art.size == (1024, 1024), f"expected 1024x1024 source, got {art.size}"
    return art


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(REPO.parent)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024} KB")


def make_maskable(art: Image.Image) -> Image.Image:
    """Maskable icon: same art blurred+darkened as full-bleed backdrop, the
    crisp art scaled to 76% centered — important content stays inside the
    80%-diameter safe circle for every mask shape (circle/squircle/rounded)."""
    backdrop = art.resize((640, 640), Image.LANCZOS)
    backdrop = backdrop.crop((64, 64, 64 + 512, 64 + 512))  # center 512
    backdrop = backdrop.filter(ImageFilter.GaussianBlur(22))
    backdrop = Image.eval(backdrop, lambda v: int(v * 0.72))  # darken
    fg = art.resize((390, 390), Image.LANCZOS)  # 76% of 512
    canvas = backdrop.copy()
    canvas.paste(fg, ((512 - 390) // 2, (512 - 390) // 2))
    return canvas


def draw_tracked(draw: ImageDraw.ImageDraw, xy, text, font, fill, tracking=0):
    """Draw text with per-character letter-spacing; returns end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


def tracked_width(draw: ImageDraw.ImageDraw, text, font, tracking=0) -> float:
    w = sum(draw.textlength(ch, font=font) for ch in text)
    return w + tracking * max(0, len(text) - 1)


def make_banner(art: Image.Image) -> Image.Image:
    """1200x630 social banner: space gradient + starfield + rounded icon art
    on the left, brand typography on the right."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # --- background: radial glow around the icon + subtle vertical grade ---
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-260, 315 - 430, 620 - 100 + 260, 315 + 430), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    mid = Image.new("RGB", (W, H), BG_MID)
    img = Image.composite(mid, img, glow)
    draw = ImageDraw.Draw(img)

    # --- starfield (deterministic) ---
    rng = random.Random(42)
    for _ in range(190):
        x, y = rng.randrange(0, W), rng.randrange(0, H)
        r = rng.choice((1, 1, 1, 1, 2, 2, 3))
        a = rng.randrange(38, 235)
        tint = rng.random()
        c = ACCENT if tint > 0.86 else (255, 255, 255)
        col = tuple(int(v * a / 255) for v in c)
        if r == 1:
            draw.point((x, y), fill=col)
        else:
            draw.ellipse((x - r // 2, y - r // 2, x + r // 2, y + r // 2), fill=col)
    # a few 4-point sparkles
    for (sx, sy, s) in [(985, 120, 7), (705, 520, 5), (1130, 470, 6), (620, 80, 4)]:
        col = tuple(int(v * 0.75) for v in ACCENT)
        draw.line((sx - s, sy, sx + s, sy), fill=col, width=1)
        draw.line((sx, sy - s, sx, sy + s), fill=col, width=1)

    # --- icon art: cyan glow + rounded-rect mask ---
    art_size = 560
    icon = art.resize((art_size, art_size), Image.LANCZOS)
    ax, ay = 35, (H - art_size) // 2  # 35, 35
    # glow halo
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.rounded_rectangle(
        (ax - 26, ay - 26, ax + art_size + 26, ay + art_size + 26),
        radius=108, fill=ACCENT + (70,),
    )
    halo = halo.filter(ImageFilter.GaussianBlur(34))
    img.paste(Image.alpha_composite(img.convert("RGBA"), halo).convert("RGB"), (0, 0))
    # rounded art
    mask = Image.new("L", (art_size, art_size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, art_size, art_size), radius=84, fill=255)
    img.paste(icon, (ax, ay), mask)
    # thin cyan edge
    draw.rounded_rectangle(
        (ax, ay, ax + art_size, ay + art_size), radius=84,
        outline=tuple(int(v * 0.8) for v in ACCENT), width=2,
    )

    # --- typography block ---
    x0 = 660
    f_gaia = ImageFont.truetype(FONT_BOLD, 148)
    f_front = ImageFont.truetype(FONT_BOLD, 72)
    f_sub = ImageFont.truetype(FONT_BOLD, 36)
    f_tag = ImageFont.truetype(FONT_BOLD, 27)
    f_feat = ImageFont.truetype(FONT_BOLD, 23)
    f_cta = ImageFont.truetype(FONT_BOLD, 22)

    draw_tracked(draw, (x0, 96), "GAIA", f_gaia, (255, 255, 255), tracking=10)
    draw_tracked(draw, (x0, 276), "FRONTIER", f_front, ACCENT, tracking=8)

    # divider
    draw.rounded_rectangle((x0 + 2, 396, x0 + 470, 399), radius=2, fill=ACCENT)

    draw_tracked(draw, (x0 + 2, 424), "AFTER CONTACT", f_sub, TEXT_SOFT, tracking=9)
    draw_tracked(draw, (x0 + 2, 480), "Arcade Planetary Defense", f_tag, TEXT_DIM, tracking=1)
    draw_tracked(draw, (x0 + 2, 518), "15 bosses · 16 eras · endless gauntlet", f_feat, TEXT_DIM, tracking=0)

    # CTA pill
    cta_text = "PLAY FREE IN YOUR BROWSER"
    cta_w = tracked_width(draw, cta_text, f_cta, tracking=2)
    px, py = x0 + 2, 560
    pad_x, pill_h = 22, 46
    draw.rounded_rectangle(
        (px - pad_x, py, px + cta_w + pad_x, py + pill_h), radius=25,
        fill=ACCENT,
    )
    draw_tracked(draw, (px, py + (pill_h - 30) // 2 + 1), cta_text, f_cta, (7, 28, 44), tracking=2)

    return img


def main() -> None:
    art = load_art()
    print("Building Earth-Defender icon family from", SOURCE.name)

    # favicon PNG (Next.js app/icon.png)
    save_png(art.resize((48, 48), Image.LANCZOS), REPO / "app" / "icon.png")

    # multi-size favicon.ico
    ico_src = art.resize((256, 256), Image.LANCZOS)
    (REPO / "app").mkdir(exist_ok=True)
    ico_path = REPO / "app" / "favicon.ico"
    ico_src.save(ico_path, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  Earth-Defender/app/favicon.ico  16+32+48  {ico_path.stat().st_size // 1024} KB")

    # apple touch icon
    save_png(art.resize((180, 180), Image.LANCZOS), REPO / "app" / "apple-icon.png")

    # PWA manifest icons
    save_png(art.resize((192, 192), Image.LANCZOS), REPO / "public" / "icon-192.png")
    save_png(art.resize((512, 512), Image.LANCZOS), REPO / "public" / "icon-512.png")
    save_png(make_maskable(art), REPO / "public" / "icon-512-maskable.png")

    # social banners
    banner = make_banner(art)
    save_png(banner, REPO / "app" / "opengraph-image.png")
    save_png(banner, REPO / "app" / "twitter-image.png")

    print("Done.")


if __name__ == "__main__":
    main()
