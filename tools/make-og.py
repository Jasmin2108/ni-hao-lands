# Builds the social share cards (public/og.png 1200x630, public/og-1200x675.png) from the brand banner
# and an in-game still. Usage: python3 tools/make-og.py BANNER.jpg STILL.png
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
BANNER, STILL = sys.argv[1], sys.argv[2]
F = "/usr/share/fonts/truetype/sand-box/google/Nunito/Nunito-VariableFont_wght.ttf"
def font(size, wght):
    f = ImageFont.truetype(F, size)
    try: f.set_variation_by_axes([wght])
    except Exception: pass
    return f
def card(W, H, out):
    art = Image.open(BANNER).convert("RGB")
    sc = W / art.width
    art = art.resize((W, round(art.height * sc)), Image.LANCZOS)
    img = art.crop((0, 0, W, H)) if art.height >= H else art.resize((W, H))
    # bottom band for text
    band_h = 150
    grad = Image.new("L", (1, band_h + 70))
    for y in range(band_h + 70): grad.putpixel((0, y), min(235, int(235 * (y / 70)) if y < 70 else 235))
    shade = Image.new("RGB", (W, band_h + 70), (26, 14, 8))
    img.paste(shade, (0, H - band_h - 70), grad.resize((W, band_h + 70)))
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - 6, W, H), fill=(212, 160, 23))
    # in-game still: gold frame, slight tilt, bottom right
    st = Image.open(STILL).convert("RGB")
    cw, ch = st.width, st.height
    x0, x1 = int(cw * 0.25), int(cw * 0.75); y0 = int(ch * 0.05)
    crop = st.crop((x0, y0, x1, y0 + int((x1 - x0) * 9 / 16)))
    tw = 360; th = round(tw * 9 / 16)
    crop = crop.resize((tw, th), Image.LANCZOS)
    fr = Image.new("RGBA", (tw + 16, th + 16), (212, 160, 23, 255))
    ImageDraw.Draw(fr).rectangle((3, 3, tw + 12, th + 12), fill=(90, 26, 16, 255))
    fr.paste(crop, (8, 8))
    tag = font(17, 900); td = ImageDraw.Draw(fr)
    label = "IN-GAME"; lw = td.textlength(label, font=tag)
    td.rectangle((8, 8, 8 + lw + 16, 8 + 26), fill=(184, 50, 42, 255)); td.text((16, 10), label, font=tag, fill=(255, 243, 200))
    fr = fr.rotate(2.5, resample=Image.BICUBIC, expand=True)
    shadow = Image.new("RGBA", fr.size, (0, 0, 0, 0)); shadow.paste((0, 0, 0, 150), (0, 0), fr.split()[3]); shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    x, y = W - fr.width - 26, H - fr.height - 30
    img.paste(shadow, (x + 6, y + 10), shadow); img.paste(fr, (x, y), fr)
    # text
    tx, by = 44, H - band_h + 6
    def outlined(xy, text, f, fill, stroke=(40, 14, 8), sw=3):
        d.text(xy, text, font=f, fill=fill, stroke_width=sw, stroke_fill=stroke)
    outlined((tx, by), "Free, unofficial $mihao fan MMO", font(40, 900), (255, 243, 200))
    outlined((tx, by + 52), "Fish · Mine · Cook · Lantern Festival story", font(27, 800), (255, 211, 106))
    outlined((tx, by + 92), "Play in your browser  ·  ni-hao-lands.onrender.com  ·  Not financial advice", font(19, 700), (232, 214, 170), sw=2)
    img = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB") if "--q" in sys.argv else img
    img.save(out, optimize=True)
    print(out, img.size)
card(1200, 630, "public/og.png")
card(1200, 675, "public/og-1200x675.png")
