"""Renders the Bello info clip (portrait, loopable) frame by frame and pipes it to ffmpeg.
Usage: python make_info_video.py <out.mp4> <poster.jpg> [preview_dir]
"""
import subprocess, sys, os
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 720, 1280, 30
RED, CREAM, INK, YELLOW, DEEP = (224, 38, 28), (255, 246, 232), (21, 20, 17), (255, 216, 74), (150, 20, 14)
F = 'C:/Windows/Fonts/'
font = lambda name, size: ImageFont.truetype(F + name, size)
ROUND, SANS, SERIF, SERIF_I = 'ARLRDBD.TTF', 'arialbd.ttf', 'georgiab.ttf', 'georgiaz.ttf'

clamp = lambda v, a=0.0, b=1.0: max(a, min(b, v))
def ease(t):
    t = clamp(t); return 1 - (1 - t) ** 3
def span(a, b, t): return clamp((t - a) / (b - a))

def stripes(d, y0, y1, w=60, x_shift=0, first=RED, second=CREAM):
    x, i = -w + int(x_shift) % (2 * w) - w, 0
    while x < W:
        d.rectangle([x, y0, x + w - 1, y1], fill=first if i % 2 == 0 else second)
        x += w; i += 1

def tracked_width(d, text, f, track):
    return sum(d.textlength(c, font=f) for c in text) + track * (len(text) - 1)

def tracked(d, x, y, text, f, fill, track):
    for c in text:
        d.text((x, y), c, font=f, fill=fill); x += d.textlength(c, font=f) + track

def put(img, t, delay, draw_fn, rise=46):
    """Draws a block on its own layer, then fades and slides it in."""
    k = ease(span(delay, delay + .16, t))
    if k <= 0: return
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    if k < 1:
        layer.putalpha(layer.getchannel('A').point(lambda a: int(a * k)))
    img.alpha_composite(layer, (0, 0)) if k >= 1 else img.alpha_composite(shift(layer, int((1 - k) * rise)))

def shift(layer, dy):
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0)); out.paste(layer, (0, dy)); return out

def centered(d, y, text, f, fill):
    d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)

def pill(d, y, text, bg, fg, size=27, track=4, pad=44):
    f = font(SANS, size); w = tracked_width(d, text, f, track)
    d.rounded_rectangle([(W - w) / 2 - pad, y, (W + w) / 2 + pad, y + 72], radius=36, fill=bg)
    tracked(d, (W - w) / 2, y + 36 - size * .58, text, f, fg, track)

def kicker(d, y, text, fill):
    f = font(SANS, 25); w = tracked_width(d, text, f, 7)
    tracked(d, (W - w) / 2, y, text, f, fill, 7)

def frame_base(bg, awning_shift):
    img = Image.new('RGBA', (W, H), bg + (255,))
    d = ImageDraw.Draw(img)
    stripes(d, 0, 150, x_shift=awning_shift)
    d.rectangle([0, 150, W, 158], fill=(120, 14, 9) if bg == RED else (226, 214, 196))
    stripes(d, H - 96, H, x_shift=-awning_shift)
    return img

# ---- scenes: each gets local time t in 0..1 and the global clock g (seconds) ----
def scene_logo(t, g):
    img = Image.new('RGBA', (W, H), CREAM + (255,))
    stripes(ImageDraw.Draw(img), 0, H, w=90, x_shift=g * 14)
    def logo(d):
        f = font(ROUND, 190); w = d.textlength('BELLO', font=f)
        d.text(((W - w) / 2, 470), 'BELLO', font=f, fill=INK)
    put(img, t, .06, logo)
    put(img, t, .2, lambda d: pill(d, 700, 'APERITIVO BAR · GÖTTINGEN', INK, CREAM))
    return img

def scene_what(t, g):
    img = frame_base(RED, g * 10)
    put(img, t, .08, lambda d: kicker(d, 300, 'WAS DICH ERWARTET', YELLOW))
    lines = [('Aperitivo.', SERIF, CREAM), ('Cocktails.', SERIF, CREAM), ('Antipasti.', SERIF_I, YELLOW)]
    for i, (text, fn, col) in enumerate(lines):
        put(img, t, .16 + i * .1, lambda d, text=text, fn=fn, col=col, i=i: centered(d, 420 + i * 150, text, font(fn, 118), col))
    put(img, t, .52, lambda d: centered(d, 920, 'Italien im Glas. Mitten in Göttingen.', font(SANS, 30), CREAM))
    return img

def scene_where(t, g):
    img = frame_base(CREAM, g * 10)
    put(img, t, .08, lambda d: kicker(d, 320, 'HIER FINDEST DU UNS', RED))
    put(img, t, .18, lambda d: centered(d, 440, 'Kurze Str. 6A', font(SERIF, 96), INK))
    put(img, t, .28, lambda d: centered(d, 570, 'Göttingen', font(SERIF_I, 96), RED))
    put(img, t, .42, lambda d: pill(d, 770, 'INNENSTADT · 37073', RED, CREAM))
    return img

def scene_when(t, g):
    img = frame_base(RED, g * 10)
    put(img, t, .08, lambda d: kicker(d, 290, 'WANN WIR OFFEN HABEN', YELLOW))
    rows = [('Di – Sa', '14:30 – 00:00'), ('So', '14:00 – 22:00'), ('Mo', 'Ruhetag')]
    for i, (day, hours) in enumerate(rows):
        def row(d, day=day, hours=hours, i=i):
            y = 420 + i * 170
            d.text((70, y), day, font=font(SERIF_I, 50), fill=YELLOW if i < 2 else (255, 190, 170))
            f = font(SERIF, 50); d.text((W - 70 - d.textlength(hours, font=f), y), hours, font=f, fill=CREAM)
            d.rectangle([70, y + 96, W - 70, y + 98], fill=(255, 150, 130))
        put(img, t, .16 + i * .1, row)
    return img

def scene_cheers(t, g):
    img = frame_base(RED, g * 10)
    def toast(d):
        fa, fb = font(SERIF, 124), font(SERIF_I, 124)
        wa = d.textlength('Auf ', font=fa); wb = d.textlength('Bello!', font=fb); x = (W - wa - wb) / 2
        d.text((x, 520), 'Auf ', font=fa, fill=CREAM); d.text((x + wa, 520), 'Bello!', font=fb, fill=YELLOW)
    put(img, t, .08, toast)
    put(img, t, .24, lambda d: pill(d, 730, '@bello.aperitivobar', CREAM, RED, size=29, track=1))
    return img

SCENES = [(scene_logo, 2.4), (scene_what, 3.2), (scene_where, 3.0), (scene_when, 3.6), (scene_cheers, 2.6)]
TOTAL = sum(d for _, d in SCENES)
WIPE = .55  # seconds; the next scene arrives through falling stripes

def wipe_mask(q):
    m = Image.new('L', (W, H), 0); d = ImageDraw.Draw(m); n, w = 12, 60
    for i in range(n):
        h = ease(q * 1.55 - i * .05) * H
        if h > 0: d.rectangle([i * w, 0, i * w + w - 1, int(h)], fill=255)
    return m

def render(g):
    g %= TOTAL; start = 0
    for i, (fn, dur) in enumerate(SCENES):
        if g < start + dur:
            img = fn((g - start) / dur, g)
            left = start + dur - g
            if left < WIPE:  # last scene wipes back into the first, so the loop is seamless
                nxt = SCENES[(i + 1) % len(SCENES)]
                # negative local time: only the background of the next scene shows during the wipe
                nimg = nxt[0](0, g)
                img.paste(nimg, (0, 0), wipe_mask(1 - left / WIPE))
            return img.convert('RGB')
        start += dur

if __name__ == '__main__':
    out, poster = sys.argv[1], sys.argv[2]
    if len(sys.argv) > 3:
        os.makedirs(sys.argv[3], exist_ok=True)
        for g in (1.5, 2.2, 4.6, 7.6, 11.2, 13.8):
            render(g).save(os.path.join(sys.argv[3], f'preview_{g:05.1f}.png'))
        sys.exit(0)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = round(TOTAL * FPS)
    for i in range(n):
        p.stdin.write(render(i / FPS).tobytes())
    p.stdin.close(); p.wait()
    render(1.9).save(poster, quality=86)
    print('frames', n, 'seconds', TOTAL, 'exit', p.returncode)
