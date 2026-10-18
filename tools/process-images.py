#!/usr/bin/env python3
"""
tools/process-images.py -- builds every derived image of the save-the-date site.

    python tools/process-images.py                  # (re)writes public/images/cutouts/*
    python tools/process-images.py --preview DIR    # also writes 3x review composites on #d6dee3

Needs Python 3.9+, Pillow (with WebP support) and numpy. Deterministic: the same originals always
give the same files (the only noise used is seeded). The originals in public/images/*.jpg are only
ever read, never modified.

Tuned to these five originals: every measurement below expects their size and framing. If a picture
doesn't match (an edge isn't where it should be, isn't straight, or the holder's tray moved), the
script stops with a message saying what it couldn't find and leaves public/images/cutouts/ exactly
as it was -- the new files only replace the old ones once every picture has been processed.

What it produces (public/images/cutouts/)
-----------------------------------------
Transparent cut-outs, WebP with alpha (quality 90), *same pixel size as the originals*:

    holder.webp    <- PhotoStripHolder.jpg  alpha = quad fitted to the frame's four straight edges
    strip.webp     <- PhotoStrip.jpg        alpha = rectangle fitted to the strip's black border
    photo.webp     <- EnvelopePicture.jpg   alpha = rotated rectangle fitted to the cream border
    envelope.webp  <- OpenEnvelope.jpg      colour matte, with the V-shaped opening forced clear
    animals.webp   <- Animals.jpg           colour matte (line art)

Only the *exterior* white goes: the background is the region flood-filled from the image border
through near-white pixels, so enclosed whites (the dog's body, the photo's cream border, the white
photo-booth backdrops inside the strip) are never touched. Edge pixels get a soft alpha and their
colour is un-mixed from white ("decontaminated"), so nothing has a white halo on the blue page.
For the three straight-edged objects the alpha comes from the fitted geometry instead of colour,
which gives perfectly straight anti-aliased edges and keeps the holder's bright metal rim.

The envelope is the back of an *open* envelope with no top flap, photographed at ~8 deg. The site
builds a closed envelope that opens, so this script also draws, in the envelope's *level* frame
(rotation removed, 1 px = 1 source px, origin at the level top-left corner):

    envelope-inside.webp       inner face of the envelope, seen through the V opening
    envelope-flap-front.webp   constructed top flap, outside face (hangs down while closed)
    envelope-flap-back.webp    the same flap, inside face with a soft liner (points up when open)
    envelope-flap-shadow.webp  soft contact shadow the closed flap casts on the envelope

The paper colour and grain are measured from the real envelope so the new pieces match it.

Soft drop shadows, as separate images that sit behind their cut-out (the page used to draw them with
CSS drop-shadow() filters, which phones re-render on every frame of the intros):

    holder-shadow.webp     behind holder.webp
    photo-shadow.webp      behind photo.webp
    envelope-shadow.webp   behind envelope.webp, in the envelope's level frame

Each is the two-layer shadow those filters drew (a tight contact shadow plus a soft one, see
SHADOWS), at the size the element has on a typical phone; it scales with the element.

Not made here: seal.webp (the wax seal on the flap) is drawn as SVG in tools/seal.html, and the icons
and share card come from tools/icon.html and tools/share-card.html -- those need a browser to render
the web fonts: run python tools/render-images.py.

geometry.json records every measurement the CSS relies on (rotation, level rectangle, opening
polygon, flap shape, photo tilt, holder tray + slot line, strip frames, where each shadow image
goes). styles.css copies the numbers it needs; re-run this script and update styles.css if an
original image ever changes.

Coordinates: "image space" -- pixel (i, j) covers [j, j+1) x [i, i+1), the convention of CSS and
of PIL's ImageDraw. Measurements are made on pixel centres and converted (+0.5) before storing.
"""

import argparse
import json
import math
import shutil
import tempfile
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'images'
OUT = SRC / 'cutouts'
PAGE_BG = (0xD6, 0xDE, 0xE3)
WEBP = dict(format='WEBP', quality=90, alpha_quality=100, method=6)


def stop(picture, problem):
    """End the run with a plain-English message (main() then leaves the existing cut-outs untouched)."""
    raise SystemExit(f'\nStopped: {picture}: {problem}\n'
                     'This script is tuned to the five original pictures, so a replacement needs the same size and '
                     'framing (see "A photo or illustration" in README.md).\n'
                     'Nothing in public/images/cutouts/ was changed.')


# --------------------------------------------------------------------------------------------- basics

def load_rgb(name):
    return np.asarray(Image.open(SRC / name).convert('RGB')).astype(np.float64)


def dist_from_white(rgb):
    """How far the darkest channel is from white: ~0 on the backdrop, >0 on anything printed."""
    return 255.0 - rgb.min(axis=2)


def flood_from_border(passable):
    """Pixels reachable from the image border through `passable` pixels (4-connected)."""
    h, w = passable.shape
    seen = np.zeros_like(passable, dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if passable[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if passable[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and passable[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def shifted(a, dy, dx, fill):
    out = np.full_like(a, fill)
    h, w = a.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


NEIGH8 = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0)]


def dilate(mask, r=1):
    m = mask.copy()
    for _ in range(r):
        acc = m.copy()
        for dy, dx in NEIGH8:
            acc |= shifted(m, dy, dx, False)
        m = acc
    return m


def erode(mask, r=1):
    """Binary erosion; everything beyond the image border counts as background."""
    m = np.pad(mask, r, constant_values=False)
    return (~dilate(~m, r))[r:-r, r:-r]


def close_then_erode(mask, close_r, erode_r):
    """Morphological closing (fills hairline notches) followed by an erosion, computed on a padded
    canvas so shapes touching the image border are treated like any other edge."""
    pad = close_r + erode_r + 1
    m = np.pad(mask, pad, constant_values=False)
    m = ~dilate(~dilate(m, close_r), close_r)          # closing
    m = ~dilate(~m, erode_r)                           # erosion (padding = background)
    return m[pad:-pad, pad:-pad]


def max3(a):
    """3x3 maximum filter (float)."""
    acc = a.copy()
    for dy, dx in NEIGH8:
        acc = np.maximum(acc, shifted(a, dy, dx, -np.inf))
    return acc


def blur(a, sigma):
    """Separable Gaussian blur with reflected edges (2-D float array)."""
    r = max(1, int(math.ceil(sigma * 3)))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()
    p = np.pad(a, ((r, r), (0, 0)), mode='reflect')
    a = sum(k[i] * p[i:i + a.shape[0]] for i in range(2 * r + 1))
    p = np.pad(a, ((0, 0), (r, r)), mode='reflect')
    return sum(k[i] * p[:, i:i + a.shape[1]] for i in range(2 * r + 1))


def local_colour(rgb, weight, sigmas=(1.5, 4.0, 12.0)):
    """Normalised convolution: weighted average colour near every pixel (weights = trusted pixels).
    Falls back to wider kernels where no trusted pixel is close."""
    out = np.full(rgb.shape, np.nan)
    for s in sigmas:
        den = blur(weight, s)
        num = np.stack([blur(rgb[..., c] * weight, s) for c in range(3)], axis=-1)
        est = num / np.maximum(den, 1e-12)[..., None]
        ok = (den > 1e-3)[..., None] & np.isnan(out)
        out = np.where(ok, est, out)
    return np.where(np.isnan(out), rgb, out)


def coverage(shape, polys, ss=8):
    """Anti-aliased coverage (0..1) of polygons given in image space, by 8x supersampling."""
    h, w = shape
    im = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(im)
    for poly in polys:
        d.polygon([(x * ss, y * ss) for x, y in poly], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX)).astype(np.float64) / 255.0


def save_rgba(rgb, alpha, path):
    a8 = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)
    c8 = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    c8[a8 == 0] = 0
    Image.fromarray(np.dstack([c8, a8]), 'RGBA').save(path, **WEBP)


# ------------------------------------------------------------------------------------ line fitting

def rising_cross(vals, thr, start=0):
    """Sub-pixel index (pixel-centre coords) where vals first rises to >= thr at or after start."""
    for i in range(max(start, 1), len(vals)):
        if vals[i] >= thr > vals[i - 1]:
            return (i - 1) + (thr - vals[i - 1]) / (vals[i] - vals[i - 1])
    return None


def falling_cross(vals, thr, start=0):
    for i in range(max(start, 1), len(vals)):
        if vals[i] < thr <= vals[i - 1]:
            return (i - 1) + (vals[i - 1] - thr) / (vals[i - 1] - vals[i])
    return None


class Line:
    """Total-least-squares line through points, refit after dropping outliers."""

    def __init__(self, pts, tol=1.2, name=''):
        p = np.asarray(pts, dtype=np.float64)
        for _ in range(2):
            c = p.mean(axis=0)
            _, _, vt = np.linalg.svd(p - c)
            d = vt[0]
            n = np.array([-d[1], d[0]])
            r = (p - c) @ n
            keep = np.abs(r) < tol
            if keep.sum() < 10:
                break
            p = p[keep]
        self.c, self.d = c, d
        self.n_used, self.n_all = len(p), len(pts)
        self.rms = float(np.sqrt((((p - c) @ np.array([-d[1], d[0]])) ** 2).mean()))
        self.name = name

    def angle_deg(self):
        """Direction angle in degrees, folded to (-90, 90]."""
        a = math.degrees(math.atan2(self.d[1], self.d[0]))
        while a <= -90:
            a += 180
        while a > 90:
            a -= 180
        return a

    def intersect(self, other):
        A = np.array([self.d, -other.d]).T
        t = np.linalg.solve(A, other.c - self.c)
        return self.c + t[0] * self.d

    def x_at(self, y):
        return self.c[0] + (y - self.c[1]) * self.d[0] / self.d[1]

    def report(self):
        return f'{self.name:>14s}: angle {self.angle_deg():8.3f} deg, rms {self.rms:.3f} px, {self.n_used}/{self.n_all} samples'


def fit_edge(pts, name, picture, what, scanned):
    """Line through the edge samples of one straight edge, or a stop when the picture has no clean
    straight edge there: found on at least half the scan lines, fit error <= 1 px, >= 80% of the
    samples on the line. (The originals fit to within a third of a pixel, with every sample on it.)"""
    if len(pts) < max(10, scanned // 2):
        stop(picture, f"couldn't find {what} (only {len(pts)} of {scanned} scan lines crossed it).")
    ln = Line(pts, name=name)
    if ln.rms > 1.0 or ln.n_used < 0.8 * ln.n_all:
        stop(picture, f"{what} isn't a clean straight line (fit error {ln.rms:.1f} px, "
                      f"{100 * ln.n_used / ln.n_all:.0f}% of the samples on it).")
    return ln


def check_corners(picture, what, edges, tol=3.0):
    """The fitted edges of a rectangular object, in order around it, must meet at right angles; if not,
    some of them were found on something else."""
    worst = 90.0
    for a, b in zip(edges, edges[1:] + edges[:1]):
        t = abs(a.angle_deg() - b.angle_deg()) % 180
        worst = min(worst, min(t, 180 - t))
    if worst < 90 - tol:
        stop(picture, f"the edges found for {what} don't meet at right angles (one corner is {worst:.0f} deg).")


def edge_by_coverage(rgb, side, lo, hi, noise=12.0):
    """Edge samples for an axis-aligned edge with a ~1 px transition: walk in from the image border,
    take the first non-white pixel and estimate how much of it is covered from the next pixel in."""
    d = dist_from_white(rgb)
    h, w = d.shape
    pts = []
    for s in range(lo, hi):
        if side in ('top', 'bottom'):
            line = d[:, s] if side == 'top' else d[::-1, s]
        else:
            line = d[s, :] if side == 'left' else d[s, ::-1]
        idx = np.nonzero(line > noise)[0]
        if len(idx) == 0 or idx[0] + 4 >= len(line):
            continue
        k = idx[0]
        ref = line[k:k + 4].max()            # the darkest of the first object pixels = fully covered
        if ref <= noise:
            continue
        # the transition may straddle two pixels: add up what each partial pixel leaves uncovered
        pos = float(k)                       # image-space distance of the edge from the image border
        for j in range(k, k + 3):
            c = min(1.0, line[j] / ref)
            if c >= 0.9:
                break
            pos += 1.0 - c
        if side == 'top':
            pts.append((s + 0.5, pos))
        elif side == 'bottom':
            pts.append((s + 0.5, h - pos))
        elif side == 'left':
            pts.append((pos, s + 0.5))
        else:
            pts.append((w - pos, s + 0.5))
    return pts


def geometric_cutout(rgb, poly):
    """Alpha from a polygon (image space); colours un-mixed from white along the boundary."""
    alpha = coverage(rgb.shape[:2], [poly])
    inside = alpha >= 0.999
    trusted = local_colour(rgb, erode(inside, 1).astype(np.float64))
    a = np.maximum(alpha, 1e-6)[..., None]
    unmixed = np.clip((rgb - (1.0 - alpha)[..., None] * 255.0) / a, 0, 255)
    w = np.clip((alpha - 0.3) / 0.45, 0, 1)[..., None]
    colour = np.where(inside[..., None], rgb, w * unmixed + (1 - w) * trusted)
    return colour, alpha


def colour_matte(rgb, flood_thr, rings=2, dark_weight=False, extra_exterior=None):
    """Matte for objects on a white backdrop.
    exterior = flood fill from the border through near-white pixels; the first `rings` pixel rings of
    the object get alpha from the white-mixing model  p = a*F + (1-a)*255  with F the local object colour
    (estimated from pixels deeper inside), their colour un-mixed toward F. Deeper pixels are opaque.
    A ring pixel that is *lighter* than the ring outside it lies past an outline (e.g. white fur just
    inside the dog's ink line) and stays opaque with its own colour."""
    d = dist_from_white(rgb)
    ext = flood_from_border(d <= flood_thr)
    if extra_exterior is not None:
        ext |= extra_exterior
    obj = ~ext
    ring_masks, reached = [], ext.copy()
    for _ in range(rings):
        r = obj & dilate(reached) & ~reached
        ring_masks.append(r)
        reached |= r
    core = obj & ~reached
    w = core.astype(np.float64)
    if dark_weight:  # line art: estimate F from the ink, not from white fur next to it
        w = w * (0.05 + (d / 255.0) ** 2)
    F = local_colour(rgb, w)
    Fk = 255.0 - F
    a_col = ((255.0 - rgb) * Fk).sum(-1) / np.maximum((Fk ** 2).sum(-1), 1.0)
    a_col = np.clip(a_col, 0, 1)
    alpha = core.astype(np.float64)
    is_edge = np.zeros_like(core)
    prev_alpha = np.zeros_like(alpha)
    prev_d = np.zeros_like(alpha)
    for i, r in enumerate(ring_masks):
        a = a_col.copy()
        if i > 0:
            outer_a = max3(np.where(ring_masks[i - 1], prev_alpha, -np.inf))
            outer_d = max3(np.where(ring_masks[i - 1], prev_d, -np.inf))
            past_outline = d < outer_d - 18.0
            a = np.where(past_outline, 1.0, np.maximum(a, np.where(np.isfinite(outer_a), outer_a, 0)))
            edge_here = r & ~past_outline
        else:
            edge_here = r.copy()
        alpha = np.where(r, a, alpha)
        is_edge |= edge_here & (a < 0.999)
        prev_alpha = np.where(r, a, 0)
        prev_d = np.where(r, d, 0)
    am = np.maximum(alpha, 1e-6)[..., None]
    unmixed = np.clip((rgb - (1.0 - alpha)[..., None] * 255.0) / am, 0, 255)
    wmix = np.clip((alpha - 0.3) / 0.45, 0, 1)[..., None]
    colour = np.where(is_edge[..., None], wmix * unmixed + (1 - wmix) * F, rgb)
    return colour, alpha, ext


def composite_preview(rgba_path, out_path, scale=3, bg=PAGE_BG):
    im = Image.open(rgba_path).convert('RGBA')
    base = Image.new('RGBA', im.size, bg + (255,))
    base.alpha_composite(im)
    base = base.convert('RGB')
    base.resize((im.width * scale, im.height * scale), Image.NEAREST).save(out_path)


# ------------------------------------------------------------------------------------ soft shadows

SHADOW_RGB = (31, 52, 64)    # --c-shadow-rgb in assets/css/tokens.css

# The drop-shadow() filters styles.css used to put on each element: (offset y, blur, opacity) in CSS px, the blur
# being the Gaussian's standard deviation (as drop-shadow() defines it). They are drawn at the size the element has
# on the reference phone (iPhone 15, 393 x 659 CSS px) -- `css_px` = CSS px per source px there, from styles.css:
#   holder    .booth height  659 - 148 - 2.04 x 15vw - 1.1 x 10.6vw = 344.92 px  for 626 src px
#   photo     100.798% of the envelope's 0.72 x (393 - 24) = 265.68 px = 267.80 px  for 515 src px
#   envelope  108.655% of those 265.68 px = 288.67 px  for 551 src px
SHADOWS = {
    'holder': dict(css_px=344.92 / 626, layers=[(2, 2, 0.16), (12, 16, 0.20)]),
    'photo': dict(css_px=267.80 / 515, layers=[(1, 1.5, 0.22), (6, 9, 0.20)]),
    'envelope': dict(css_px=288.67 / 551, layers=[(1, 1, 0.16), (5, 9, 0.16)]),
}


def blur_down(a, sigma, dy):
    """Gaussian blur (standard deviation sigma) that also moves the image dy px down (fractions allowed);
    zero outside the array."""
    r = int(math.ceil(abs(dy) + 4 * sigma))
    x = np.arange(-r, r + 1, dtype=np.float64)
    ky = np.exp(-0.5 * ((x + dy) / sigma) ** 2)       # out[y] = sum_t ky[t] a[y + t]: centred on t = -dy
    kx = np.exp(-0.5 * (x / sigma) ** 2)
    ky /= ky.sum()
    kx /= kx.sum()
    p = np.pad(a, ((r, r), (0, 0)))
    a = sum(ky[i] * p[i:i + a.shape[0]] for i in range(2 * r + 1))
    p = np.pad(a, ((0, 0), (r, r)))
    return sum(kx[i] * p[:, i:i + a.shape[1]] for i in range(2 * r + 1))


def drop_shadow(alpha, kind):
    """The shadow (alpha only; its colour is SHADOW_RGB) that chained drop-shadow() filters draw around an image
    with this alpha. Like chained filters, each layer is cast by the image *and* the layers before it and goes
    under them. Returns it on a canvas padded by `pad` px on every side, and `pad`."""
    css_px, layers = SHADOWS[kind]['css_px'], SHADOWS[kind]['layers']
    pad = int(math.ceil(max(dy + 5 * std for dy, std, _ in layers) / css_px))
    total = np.pad(alpha, pad)
    shadow = np.zeros_like(total)
    for dy, std, opacity in layers:
        s = opacity * blur_down(total, std / css_px, dy / css_px)
        shadow = shadow + s * (1 - shadow)
        total = total + s * (1 - total)
    return shadow, pad


def save_shadow(shadow, name, box):
    """Write the part of a shadow canvas inside box = (x0, y0, x1, y1) as WebP (constant colour + alpha)."""
    x0, y0, x1, y1 = box
    a8 = np.clip(np.round(shadow[y0:y1, x0:x1] * 255), 0, 255).astype(np.uint8)
    rgb = np.zeros(a8.shape + (3,), dtype=np.uint8) + np.array(SHADOW_RGB, dtype=np.uint8)
    Image.fromarray(np.dstack([rgb, a8]), 'RGBA').save(OUT / name, **WEBP)


def shadow_box(shadow):
    """Bounding box (x0, y0, x1, y1) of the pixels that come out visible (>= 1/255) in 8 bits."""
    ys, xs = np.nonzero(np.round(shadow * 255) >= 1)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def shadow_note(kind):
    return {'css_px_per_src_px': round(SHADOWS[kind]['css_px'], 5),
            'drop_shadows_css_px': [list(layer) for layer in SHADOWS[kind]['layers']],
            'colour': list(SHADOW_RGB)}


# ------------------------------------------------------------------------------------------ holder

def build_holder(geo, preview):
    pic = 'PhotoStripHolder.jpg'
    rgb = load_rgb(pic)
    h, w = rgb.shape[:2]
    top = fit_edge(edge_by_coverage(rgb, 'top', 8, w - 8), 'holder top', pic, 'the top edge of the holder', w - 16)
    bottom = fit_edge(edge_by_coverage(rgb, 'bottom', 8, w - 8), 'holder bottom', pic, 'the bottom edge of the holder', w - 16)
    left = fit_edge(edge_by_coverage(rgb, 'left', 8, h - 8), 'holder left', pic, 'the left edge of the holder', h - 16)
    right = fit_edge(edge_by_coverage(rgb, 'right', 8, h - 8), 'holder right', pic, 'the right edge of the holder', h - 16)
    for ln in (top, bottom, left, right):
        print('  ' + ln.report())
    check_corners(pic, 'the holder', [top, right, bottom, left])
    quad = [top.intersect(left), top.intersect(right), bottom.intersect(right), bottom.intersect(left)]

    # Tray = the recessed opening the strip prints into. Read off luminance profiles averaged across the
    # tray (rows over x 70..180, columns over y 150..450):
    #   rows 33-43  bright bevel lines; first dark row below them = the slot line (44)
    #   rows 44-62  deep shadow under the top lip; 541-545 bright crease where the back wall meets the floor
    #   rows 580-585 the tray's front lip; columns 31-42 / 217-221 the side bevels
    #   columns 43..197 back wall, 197..217 right side wall (seen in perspective)
    # styles.css positions the printing strip from these numbers, so they must come out exactly as measured.
    lum = rgb.mean(axis=2)
    rows = lum[:, 70:180].mean(axis=1)
    cols = lum[150:450, :].mean(axis=0)
    bevel = [y for y in range(30, 50) if rows[y] > 90]
    slot = next((y for y in range(bevel[-1] + 1, 60) if rows[y] < 30), None) if bevel else None
    floor_y = next((y for y in range(500, 560) if rows[y] > 180), None)
    back_corner = int(np.argmax(cols[185:205])) + 185
    left_in, right_in, lip_y = 43, 217, 580
    if (slot, floor_y, back_corner) != (44, 541, 198):
        found = lambda v: 'not found' if v is None else v
        stop(pic, f"the tray inside the holder isn't where assets/css/styles.css expects it: slot line at y = "
                  f"{found(slot)}, tray floor at y = {found(floor_y)}, back corner at x = {back_corner} (expected 44, "
                  f"541 and 198). A different holder needs its .booth-tray / .booth-print numbers in styles.css "
                  f"re-measured, and then the expected values here updated.")

    colour, alpha = geometric_cutout(rgb, [tuple(p) for p in quad])
    save_rgba(colour, alpha, OUT / 'holder.webp')
    shadow, pad = drop_shadow(alpha, 'holder')
    x0, y0, x1, y1 = shadow_box(shadow)
    save_shadow(shadow, 'holder-shadow.webp', (x0, y0, x1, y1))
    ox, oy, sw, sh = pad - x0, pad - y0, x1 - x0, y1 - y0
    geo['holder'] = {
        'size': [w, h],
        'outline_quad': [[round(float(x), 2), round(float(y), 2)] for x, y in quad],
        'tray_opening': {'x0': left_in, 'x1': right_in, 'y0': slot, 'y1': lip_y},
        'slot_line_y': slot,
        'floor_line_y': floor_y,
        'back_wall_x': [left_in, back_corner],
        'note': 'image-space px. Strip prints from slot_line_y down; keep its bottom near floor_line_y.',
    }
    geo['holder']['shadow'] = {
        'image': 'holder-shadow.webp', 'size': [sw, sh], 'holder_at': [ox, oy],
        'css_pct_of_holder': {'left': round(-100 * ox / w, 3), 'top': round(-100 * oy / h, 3),
                              'width': round(100 * sw / w, 3), 'height': round(100 * sh / h, 3)},
        **shadow_note('holder'),
    }
    print(f'  tray opening x {left_in}..{right_in}, slot line y={slot}, floor y={floor_y}, lip y={lip_y}, back-wall corner x={back_corner}')
    print(f'  shadow {sw} x {sh}, holder at ({ox}, {oy})')
    if preview:
        composite_preview(OUT / 'holder.webp', preview / 'holder_3x.png')


# ------------------------------------------------------------------------------------------- strip

def build_strip(geo, preview):
    pic = 'PhotoStrip.jpg'
    rgb = load_rgb(pic)
    h, w = rgb.shape[:2]
    # noise=60: the strip sits in a faint grey shadow (d ~12-19); its edge is where the black border starts
    top = fit_edge(edge_by_coverage(rgb, 'top', 15, w - 15, noise=60), 'strip top', pic, 'the top edge of the strip', w - 30)
    left = fit_edge(edge_by_coverage(rgb, 'left', 15, h - 15, noise=60), 'strip left', pic, 'the left edge of the strip', h - 30)
    right = fit_edge(edge_by_coverage(rgb, 'right', 15, h - 15, noise=60), 'strip right', pic, 'the right edge of the strip', h - 30)
    bottom = fit_edge(edge_by_coverage(rgb, 'bottom', 15, w - 15, noise=60), 'strip bottom', pic, 'the bottom edge of the strip', w - 30)
    for ln in (top, bottom, left, right):
        print('  ' + ln.report())
    check_corners(pic, 'the strip', [top, right, bottom, left])
    quad = [top.intersect(left), top.intersect(right), bottom.intersect(right), bottom.intersect(left)]
    colour, alpha = geometric_cutout(rgb, [tuple(p) for p in quad])
    save_rgba(colour, alpha, OUT / 'strip.webp')

    # Frame separators: dark bands running right across the strip (dark at every column).
    lum = rgb.mean(axis=2)
    x_a, x_b = int(quad[0][0]) + 6, int(quad[1][0]) - 6
    prof = np.percentile(lum[:, x_a:x_b], 90, axis=1)
    dark = prof < 75
    bands, y = [], 0
    while y < h:
        if dark[y]:
            y0 = y
            while y < h and dark[y]:
                y += 1
            if 2 <= y - y0 <= 10 and 40 < y0 < h - 20:
                bands.append([y0, y - 1])
        y += 1
    x0, y0 = quad[0]
    x1, y1 = quad[2]
    geo['strip'] = {
        'size': [w, h],
        'content_rect': {'x': round(float(x0), 2), 'y': round(float(y0), 2),
                         'w': round(float(x1 - x0), 2), 'h': round(float(y1 - y0), 2)},
        'separators_y': bands,
        'note': 'image-space px; content_rect = the strip itself (the rest of the image is transparent).',
    }
    print(f'  strip rect x {x0:.2f}..{x1:.2f}  y {y0:.2f}..{y1:.2f}; separators {bands}')
    if preview:
        composite_preview(OUT / 'strip.webp', preview / 'strip_3x.png')


# ------------------------------------------------------------------------------------------- photo

def photo_edges(d, thr, pic):
    """The print's four outer edges: where the darkness first rises to thr, walking in from each image
    border (pixel-centre coords)."""
    h, w = d.shape
    top, bot, lft, rgt = [], [], [], []
    for x in range(90, w - 90):
        y = rising_cross(d[:, x], thr)
        if y is not None:
            top.append((x, y))
        y = rising_cross(d[::-1, x], thr)
        if y is not None:
            bot.append((x, h - 1 - y))
    for y in range(90, h - 90):
        x = rising_cross(d[y, :], thr)
        if x is not None:
            lft.append((x, y))
        x = rising_cross(d[y, ::-1], thr)
        if x is not None:
            rgt.append((w - 1 - x, y))
    L = {k: fit_edge(v, f'photo {k}', pic, f'the {k} edge of the print', (w if k in ('top', 'bottom') else h) - 180)
         for k, v in (('top', top), ('bottom', bot), ('left', lft), ('right', rgt))}
    check_corners(pic, 'the print', [L['top'], L['right'], L['bottom'], L['left']])
    return L


def build_photo(geo, preview):
    pic = 'EnvelopePicture.jpg'
    rgb = load_rgb(pic)
    h, w = rgb.shape[:2]
    d = dist_from_white(rgb)
    # The cream border's darkness sets the edge threshold (half of it: where an edge pixel is half covered). It is
    # measured on the border itself -- a 30 x 3 px patch in the middle of the top edge, 7 px in from it -- which a
    # first fit, at a threshold just above the JPEG noise on the white backdrop, locates.
    rough = photo_edges(d, 6.0, pic)
    tl, tr = rough['top'].intersect(rough['left']), rough['top'].intersect(rough['right'])
    along = (tr - tl) / np.linalg.norm(tr - tl)
    inward = np.array([-along[1], along[0]])             # the top edge runs left to right: this points into the print
    mid = (tl + tr) / 2 + 7.0 * inward
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    rel_a = (xx - mid[0]) * along[0] + (yy - mid[1]) * along[1]
    rel_n = (xx - mid[0]) * inward[0] + (yy - mid[1]) * inward[1]
    border_d = float(np.median(d[(np.abs(rel_a) <= 15) & (np.abs(rel_n) <= 1.5)]))
    if border_d < 10:
        stop(pic, f"couldn't find the light border around the print (the darkness measured just inside its top edge "
                  f"is {border_d:.0f}; a cream border is about 15-25).")
    thr = border_d / 2.0
    L = photo_edges(d, thr, pic)
    for ln in L.values():
        print('  ' + ln.report())
    quad = [L['top'].intersect(L['left']), L['top'].intersect(L['right']),
            L['bottom'].intersect(L['right']), L['bottom'].intersect(L['left'])]
    quad = [(p[0] + 0.5, p[1] + 0.5) for p in quad]  # pixel centres -> image space
    colour, alpha = geometric_cutout(rgb, quad)
    save_rgba(colour, alpha, OUT / 'photo.webp')
    # The photo is placed by its centre (translate(-50%, -50%)), so its shadow image is cropped symmetrically
    # around the same centre.
    shadow, pad = drop_shadow(alpha, 'photo')
    x0, y0, x1, y1 = shadow_box(shadow)
    cw, ch = shadow.shape[1], shadow.shape[0]
    mx, my = min(x0, cw - x1), min(y0, ch - y1)
    save_shadow(shadow, 'photo-shadow.webp', (mx, my, cw - mx, ch - my))
    tilt = float(np.mean([L['top'].angle_deg(), L['bottom'].angle_deg(),
                          L['left'].angle_deg() - 90 if L['left'].angle_deg() > 0 else L['left'].angle_deg() + 90,
                          L['right'].angle_deg() - 90 if L['right'].angle_deg() > 0 else L['right'].angle_deg() + 90]))
    qa = np.array(quad)
    width = float(np.mean([np.linalg.norm(qa[1] - qa[0]), np.linalg.norm(qa[2] - qa[3])]))
    height = float(np.mean([np.linalg.norm(qa[3] - qa[0]), np.linalg.norm(qa[2] - qa[1])]))
    geo['photo'] = {
        'size': [w, h],
        'tilt_deg': round(tilt, 3),
        'outer_quad': [[round(x, 2), round(y, 2)] for x, y in quad],
        'outer_size': [round(width, 2), round(height, 2)],
        'centre': [round(float(qa[:, 0].mean()), 2), round(float(qa[:, 1].mean()), 2)],
        'note': 'clockwise tilt; the photo keeps this natural tilt on screen.',
    }
    sw, sh = cw - 2 * mx, ch - 2 * my
    geo['photo']['shadow'] = {
        'image': 'photo-shadow.webp', 'size': [sw, sh], 'photo_at': [pad - mx, pad - my],
        'width_pct_of_photo': round(100 * sw / w, 3),
        'note': 'same centre as photo.webp (crop is symmetric), so it takes the same left/top/transform.',
        **shadow_note('photo'),
    }
    print(f'  photo tilt {tilt:.3f} deg, outer {width:.1f} x {height:.1f} (border darkness {border_d:.0f})')
    print(f'  shadow {sw} x {sh}, photo at ({pad - mx}, {pad - my})')
    if preview:
        composite_preview(OUT / 'photo.webp', preview / 'photo_3x.png', scale=2)


# ---------------------------------------------------------------------------------------- envelope

def build_envelope(geo, preview):
    pic = 'OpenEnvelope.jpg'
    rgb = load_rgb(pic)
    h, w = rgb.shape[:2]
    d = dist_from_white(rgb)
    # The paper's darkness (~28: cream vs white) sets the edge threshold (half of it). Measured over the envelope
    # itself: everything darker than the white backdrop, less an 8 px margin, so no edge or shadow pixel counts.
    paper_px = erode(d > 9.0, 8)
    if paper_px.sum() < 0.1 * h * w:
        stop(pic, "couldn't find the envelope: the picture is almost entirely white.")
    paper = float(np.median(d[paper_px]))
    thr = paper / 2.0

    # Outer edges (left, right, bottom) of the tilted envelope.
    left, right, bottom = [], [], []
    for y in range(40, 320):
        x = rising_cross(d[y, :], thr)
        if x is not None:
            left.append((x, y))
    for y in range(110, 390):
        x = rising_cross(d[y, ::-1], thr)
        if x is not None:
            right.append((w - 1 - x, y))
    for x in range(30, 480):
        y = rising_cross(d[::-1, x], thr)
        if y is not None:
            bottom.append((x, h - 1 - y))
    Lleft = fit_edge(left, 'env left', pic, 'the left edge of the envelope', 280)
    Lright = fit_edge(right, 'env right', pic, 'the right edge of the envelope', 280)
    Lbot = fit_edge(bottom, 'env bottom', pic, 'the bottom edge of the envelope', 450)
    check_corners(pic, 'the envelope', [Lbot, Lleft])
    check_corners(pic, 'the envelope', [Lbot, Lright])

    # Inner edges of the two side flaps ("wings"): paper -> background, scanning into the opening.
    wingL, wingR = [], []
    for y in range(30, 172):
        x = falling_cross(d[y, :], thr, start=int(Lleft.x_at(y)) + 6)
        if x is not None and x < 260:
            wingL.append((x, y))
    for y in range(100, 186):
        xr = falling_cross(d[y, ::-1], thr, start=int(w - 1 - Lright.x_at(y)) + 6)
        if xr is not None and (w - 1 - xr) > 300:
            wingR.append((w - 1 - xr, y))
    LwingL = fit_edge(wingL, 'wing L inner', pic, "the left side flap's inner edge (the opening's left side)", 142)
    LwingR = fit_edge(wingR, 'wing R inner', pic, "the right side flap's inner edge (the opening's right side)", 86)

    # Top edge of the bottom flap ("pocket"). Above it sits a neutral-grey sliver (the JPG's shadow of
    # the pocket edge on white, d <= ~19); the cream paper starts where d reaches ~22.
    pocket = []
    xa = int(LwingL.x_at(185)) + 8
    xb = int(LwingR.x_at(195)) - 8
    for x in range(xa, xb):
        y = rising_cross(d[:, x], 22.0, start=150)
        if y is not None and y < 215:
            pocket.append((x, y))
    Lpocket = fit_edge(pocket, 'pocket top', pic, "the top edge of the envelope's front pocket", max(xb - xa, 20))
    for ln in (Lleft, Lright, Lbot, LwingL, LwingR, Lpocket):
        print('  ' + ln.report())

    theta = float(np.mean([Lbot.angle_deg(), Lpocket.angle_deg(),
                           Lleft.angle_deg() - 90 if Lleft.angle_deg() > 0 else Lleft.angle_deg() + 90,
                           Lright.angle_deg() - 90 if Lright.angle_deg() > 0 else Lright.angle_deg() + 90]))
    th = math.radians(theta)
    ux, uy = math.cos(th), math.sin(th)      # level x axis in image space
    vx, vy = -math.sin(th), math.cos(th)     # level y axis (down)

    # Opening polygon (image space): wing lines + pocket line, extended above the image.
    def img(p):
        return (float(p[0]) + 0.5, float(p[1]) + 0.5)
    P1 = img(LwingL.intersect(Lpocket))
    P2 = img(LwingR.intersect(Lpocket))
    P0 = (LwingL.x_at(-80) + 0.5, -80 + 0.5)
    P3 = (LwingR.x_at(-80) + 0.5, -80 + 0.5)
    opening_img = [P0, P1, P2, P3]
    open_cov = coverage((h, w), [opening_img])

    colour, alpha, ext = colour_matte(rgb, flood_thr=9.0, rings=2, extra_exterior=open_cov >= 0.5)
    alpha = alpha * (1.0 - open_cov)
    save_rgba(colour, alpha, OUT / 'envelope.webp')

    # Level frame: origin = top-left corner of the level bounding rectangle.
    BL = np.array(img(Lleft.intersect(Lbot)))
    BR = np.array(img(Lright.intersect(Lbot)))
    ys, xs = np.nonzero(alpha >= 0.5)
    px, py = xs + 0.5, ys + 0.5
    v_rel = (px - BL[0]) * vx + (py - BL[1]) * vy        # <= 0 above the bottom edge
    level_h = float(-v_rel.min()) + 0.5
    level_w = float(np.linalg.norm(BR - BL))
    TL = BL - level_h * np.array([vx, vy])

    def to_level(p):
        dx, dy = p[0] - TL[0], p[1] - TL[1]
        return (dx * ux + dy * uy, dx * vx + dy * vy)

    opening_lvl = [to_level(p) for p in opening_img]
    pocket_v = float(np.mean([to_level(P1)[1], to_level(P2)[1]]))
    print(f'  rotation {theta:.3f} deg, level {level_w:.2f} x {level_h:.2f}, TL {TL.round(2)}, pocket top v={pocket_v:.1f}')
    print(f'  opening (level): ' + ', '.join(f'({u:.1f},{v:.1f})' for u, v in opening_lvl))

    # Level-frame alpha (for the wing-tip shapes and the inside layer), 1 px = 1 source px.
    LW, LH = int(math.ceil(level_w)), int(math.ceil(level_h))
    inv = (ux, vx, TL[0], uy, vy, TL[1])  # level (u,v) -> image (x,y)
    a_img = Image.fromarray(np.clip(alpha * 255, 0, 255).astype(np.uint8))
    a_lvl = np.asarray(a_img.transform((LW, LH), Image.AFFINE, inv, resample=Image.BILINEAR)).astype(np.float64) / 255
    # how far the tips are from the corners: first opaque row per column near each corner
    def first_opaque(col):
        idx = np.nonzero(a_lvl[:, col] >= 0.5)[0]
        return int(idx[0]) if len(idx) else None
    tipL = [first_opaque(c) for c in range(0, 48, 4)]
    tipR = [first_opaque(LW - 1 - c) for c in range(0, 48, 4)]
    print(f'  left tip first-opaque rows (cols 0,4,..): {tipL}')
    print(f'  right tip first-opaque rows (cols W-1,-5,..): {tipR}')

    # Its shadow, drawn in image space (the envelope picture is shown unrotated, so "down" is down on the page too),
    # then resampled into the level frame, where it sits like the other envelope layers.
    shadow, pad = drop_shadow(alpha, 'envelope')
    m = pad                                              # level-frame canvas margin, then cropped
    s_lvl = np.asarray(Image.fromarray(shadow.astype(np.float32), 'F').transform(
        (LW + 2 * m, LH + 2 * m), Image.AFFINE,
        (ux, vx, TL[0] + pad - m * (ux + vx), uy, vy, TL[1] + pad - m * (uy + vy)),
        resample=Image.BILINEAR)).astype(np.float64)
    x0, y0, x1, y1 = shadow_box(s_lvl)
    save_shadow(s_lvl, 'envelope-shadow.webp', (x0, y0, x1, y1))
    ou, ov, sw, sh = m - x0, m - y0, x1 - x0, y1 - y0

    geo['envelope'] = {
        'size': [w, h],
        'rotation_deg': round(theta, 3),
        'level_size': [round(level_w, 2), round(level_h, 2)],
        'level_origin_in_image': [round(float(TL[0]), 2), round(float(TL[1]), 2)],
        'css_front_img': {
            'width_pct_of_level': round(100 * w / level_w, 3),
            'translate_pct': [round(-100 * TL[0] / w, 3), round(-100 * TL[1] / h, 3)],
            'rotate_deg': round(-theta, 3),
            'note': 'inside a level box rotated by +rotation: img {left:0; top:0; width:W%; '
                    'transform-origin:0 0; transform: rotate(R) translate(X%, Y%)}',
        },
        'opening_polygon_level': [[round(u, 1), round(v, 1)] for u, v in opening_lvl],
        'pocket_top_v': round(pocket_v, 1),
        'wing_tip_first_rows_left': tipL,
        'wing_tip_first_rows_right': tipR,
    }
    geo['envelope']['shadow'] = {
        'image': 'envelope-shadow.webp', 'size': [sw, sh], 'level_origin_at': [ou, ov],
        'css_pct_of_level': {'left': round(-100 * ou / level_w, 3), 'top': round(-100 * ov / level_h, 3),
                             'width': round(100 * sw / level_w, 3), 'height': round(100 * sh / level_h, 3)},
        'note': 'level frame, like envelope-inside.webp; goes just under envelope.webp (same z-index, earlier).',
        **shadow_note('envelope'),
    }
    print(f'  shadow {sw} x {sh}, level origin at ({ou}, {ov})')
    return dict(rgb=rgb, alpha=alpha, a_lvl=a_lvl, level_w=level_w, level_h=level_h, LW=LW, LH=LH,
                opening_lvl=opening_lvl, pocket_v=pocket_v, theta=theta)


# ------------------------------------------------------------------------------ envelope extras

PAPER = np.array([237.6, 233.7, 226.9])     # measured median colour of the envelope paper


def paper_texture(hgt, wid, seed, base, grain=1.0, mottle=0.85):
    """Cream paper like the envelope's: fine luminance grain (sigma ~1 level, as measured on the
    envelope) plus faint low-frequency mottling. Seeded, so the output is deterministic."""
    rng = np.random.default_rng(seed)
    g = blur(rng.normal(0, 1, (hgt, wid)), 0.45)
    g = g / g.std() * grain
    m = blur(rng.normal(0, 1, (hgt, wid)), 14.0)
    m = m / max(m.std(), 1e-9) * mottle
    return np.clip(base[None, None, :] + (g + m)[..., None], 0, 255)


def offset_convex(pts, insets):
    """Move edge i (pts[i] -> pts[i+1]) of a convex polygon inward by insets[i]; return the new vertices."""
    n = len(pts)
    P = [np.asarray(p, dtype=np.float64) for p in pts]
    cen = sum(P) / n
    lines = []
    for i in range(n):
        p, q = P[i], P[(i + 1) % n]
        d = (q - p) / np.linalg.norm(q - p)
        nrm = np.array([-d[1], d[0]])
        if (cen - p) @ nrm < 0:
            nrm = -nrm
        lines.append((p + nrm * insets[i], d))
    out = []
    for i in range(n):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        t = np.linalg.solve(np.array([d1, -d2]).T, p2 - p1)
        out.append(tuple(p1 + t[0] * d1))
    return out


def rounded_poly(points, radii, steps=16):
    """Polygon with vertex i rounded by radii[i] (0 = sharp corner)."""
    out = []
    n = len(points)
    for i in range(n):
        p0, p1, p2 = (np.asarray(points[j], dtype=np.float64) for j in (i - 1, i, (i + 1) % n))
        r = radii[i]
        if r <= 0:
            out.append(tuple(p1))
            continue
        a, b = p0 - p1, p2 - p1
        la, lb = np.linalg.norm(a), np.linalg.norm(b)
        a, b = a / la, b / lb
        ang = math.acos(max(-1.0, min(1.0, float(a @ b))))
        t = min(r / math.tan(ang / 2), 0.45 * la, 0.45 * lb)
        r_eff = t * math.tan(ang / 2)
        bis = (a + b) / np.linalg.norm(a + b)
        c = p1 + bis * (r_eff / math.sin(ang / 2))
        s, e = p1 + a * t, p1 + b * t
        a0 = math.atan2(s[1] - c[1], s[0] - c[0])
        da = math.atan2(e[1] - c[1], e[0] - c[0]) - a0
        da = (da + math.pi) % (2 * math.pi) - math.pi
        for k in range(steps + 1):
            aa = a0 + da * k / steps
            out.append((c[0] + r_eff * math.cos(aa), c[1] + r_eff * math.sin(aa)))
    return out


def poly_contains(poly, pt):
    x, y = pt
    inside = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x1 + (y - y1) * (x2 - x1) / (y2 - y1) > x:
            inside = not inside
    return inside


def dist_to_edges(poly, pt, skip_y=None):
    """Distance from pt to the polygon outline, ignoring segments lying on y == skip_y."""
    p = np.asarray(pt, dtype=np.float64)
    best = 1e9
    for i in range(len(poly)):
        a, b = np.asarray(poly[i]), np.asarray(poly[(i + 1) % len(poly)])
        if skip_y is not None and abs(a[1] - skip_y) < 0.5 and abs(b[1] - skip_y) < 0.5:
            continue
        ab = b - a
        t = max(0.0, min(1.0, float((p - a) @ ab / (ab @ ab))))
        best = min(best, float(np.linalg.norm(p - (a + t * ab))))
    return best


def build_envelope_extras(env, geo, preview):
    W, H = env['level_w'], env['level_h']
    LW, LH = env['LW'], env['LH']
    pv = env['pocket_v']
    (u0, v0), (u1, v1), (u2, v2), (u3, v3) = env['opening_lvl']      # far-up L, pocket L, pocket R, far-up R

    def wing_u(side, v):
        if side == 'L':
            return u0 + (u1 - u0) * (v - v0) / (v1 - v0)
        return u3 + (u2 - u3) * (v - v3) / (v2 - v3)

    opening_top = [(wing_u('L', 0.0), 0.0), (u1, v1), (u2, v2), (wing_u('R', 0.0), 0.0)]

    # ---- flap shape, level coords, hinge on v = 0: straight sides meeting at a softly rounded apex.
    depth = round(0.655 * H, 1)
    tri = [(0.0, 0.0), (W, 0.0), (W / 2, depth)]
    corner_r, apex_r = 7.0, 30.0
    flap_poly = rounded_poly(tri, [corner_r, corner_r, apex_r])
    # Every point of the opening must sit inside the closed flap with a margin, or a gap would show.
    test = []
    for v in np.linspace(0.5, pv + 1.5, 80):
        test += [(wing_u('L', v), v), (wing_u('R', v), v)]
    test += [(u, pv + 1.5) for u in np.linspace(u1, u2, 40)]
    margins = [(1 if poly_contains(flap_poly, p) else -1) * dist_to_edges(flap_poly, p, skip_y=0.0) for p in test]
    worst = min(margins)
    print(f'  flap depth {depth} px ({depth / H:.3f} H); worst margin of the opening inside the closed flap: {worst:.1f} px')
    if worst < 6.0:
        stop('OpenEnvelope.jpg', f"the top flap drawn for the envelope wouldn't fully cover its opening when closed "
                                 f"(margin {worst:.1f} px; it needs at least 6).")

    ext = 3                          # the flap images overlap 3 px past the hinge: no seam when open
    FH = int(math.ceil(depth)) + ext + 1
    yy, xx = np.mgrid[0:FH, 0:LW].astype(np.float64)

    # ---- front face (closed, hanging down). Rows 0..ext-1 are empty; the hinge is at row `ext`.
    def down(poly):
        return [(x, y + ext) for x, y in poly]
    fa = coverage((FH, LW), [down(flap_poly)])
    # inner outlines measured from the two cut edges only (the hinge edge is a fold, not a cut)
    rim_in = coverage((FH, LW), [down(rounded_poly(offset_convex(tri, [-4, 1.4, 1.4]), [0, 0, apex_r - 1.4]))], ss=4)
    band_in = coverage((FH, LW), [down(rounded_poly(offset_convex(tri, [-4, 7.0, 7.0]), [0, 0, max(apex_r - 7, 4)]))], ss=4)
    edge_band = np.clip(fa - blur(band_in, 2.5), 0, 1)
    rim = np.clip(fa - rim_in, 0, 1)
    t = np.clip((yy - ext) / depth, 0, 1)
    shade = 1.0 + 0.010 * (1 - t) - 0.016 * t * t - 0.020 * edge_band
    front = paper_texture(FH, LW, seed=11, base=PAPER + np.array([1.4, 1.4, 1.2])) * shade[..., None]
    front = np.clip(front + rim[..., None] * np.array([4.0, 4.0, 4.5]), 0, 255)   # paper edge catching light
    save_rgba(front, fa, OUT / 'envelope-flap-front.webp')

    # ---- back face (open, pointing up). y = 0 is the apex end, the hinge is the line y = FH - ext, and the
    # last `ext` rows overlap the inside layer. (The face is turned over twice in CSS -- rotateX(180deg) about
    # its own centre, then the flap's rotateX(180deg) about the hinge at y = ext -- which maps image y to
    # y - (FH - 2*ext): so the line y = FH - ext lands exactly on the hinge.)
    hinge_row = FH - ext

    def up(poly):
        return [(x, hinge_row - y) for x, y in poly]
    ba = np.maximum(coverage((FH, LW), [up(flap_poly)]),
                    coverage((FH, LW), [[(0.0, hinge_row - 0.5), (W, hinge_row - 0.5), (W, FH), (0.0, FH)]]))
    back = paper_texture(FH, LW, seed=23, base=PAPER - np.array([5.0, 4.0, 2.5]))     # inner side: a touch cooler
    # liner in a soft dusty blue between the palette accent #839aad and mist #b4c3ce; inset from the cut edges,
    # stops at the fold. (A paler liner would read as a hole onto the page colour.) It also stops 50 px short of
    # the apex: open, the flap's rounded tip peeks out above the risen photo (whose centre sits on the hinge; shown at
    # 0.90 x the envelope's width it covers the flap up to ~180 px above the hinge, of the tip's ~215), and that
    # peak stays cream paper, like the mockup's.
    A, B, C = offset_convex(tri, [-1, 10.0, 10.0])        # left hinge corner, right hinge corner, apex
    stop_v = depth - 50.0

    def at_v(p, q, v):
        return (p[0] + (q[0] - p[0]) * (v - p[1]) / (q[1] - p[1]), v)
    liner_poly = [A, B, at_v(B, C, stop_v), at_v(A, C, stop_v)]
    la = coverage((FH, LW), [up(rounded_poly(liner_poly, [0, 0, 10.0, 10.0]))])
    la *= np.clip((hinge_row - 5.0 - yy) / 2.0, 0, 1)
    liner = paper_texture(FH, LW, seed=37, base=np.array([0x93, 0xA8, 0xB8], dtype=np.float64), grain=0.9, mottle=0.7)
    back = back * (1 - 0.09 * np.clip(blur(la, 1.4) - la, 0, 1))[..., None]          # hairline shadow at liner edge
    back = back * (1 - la[..., None]) + liner * la[..., None]
    crease = np.exp(-0.5 * ((yy - hinge_row) / 0.9) ** 2)
    back = np.clip(back * (1 - 0.06 * crease)[..., None], 0, 255)                     # fold crease
    save_rgba(back, ba, OUT / 'envelope-flap-back.webp')

    # ---- soft contact shadow of the closed flap (same frame as the front face)
    sh = shifted(blur(fa, 2.0), 2, 0, 0.0)
    save_rgba(np.zeros((FH, LW, 3)) + np.array([88.0, 80.0, 70.0]), np.clip(sh * 0.34, 0, 1),
              OUT / 'envelope-flap-shadow.webp')

    # ---- inside: inner face of the envelope. Covers the whole envelope interior (the front image hides all
    # of it except the opening), kept 2 px inside the outer outline so the front image's anti-aliased edge
    # blends with the page, never with this layer. Its top edge is the hinge line v = 0 between the tips.
    a_lvl = env['a_lvl'][:LH, :LW]
    open_cov = coverage((LH, LW), [opening_top], ss=4)
    sil = (a_lvl >= 0.5) | (open_cov >= 0.5)
    top_band = (open_cov >= 0.5) & (np.mgrid[0:LH, 0:LW][0] < 8)
    inside_mask = close_then_erode(sil, 2, 2) | top_band   # 2 px inside the outer outline
    ia = np.where(inside_mask, 1.0, 0.0)
    ia[0, :] = np.where(inside_mask[0, :], open_cov[0, :].clip(0, 1), 0)              # crisp hinge row
    iy = np.mgrid[0:LH, 0:LW][0].astype(np.float64)
    depth_shade = 1.0 - 0.055 * np.clip(iy / max(pv, 1.0), 0, 1.4)                   # deeper = darker
    outside_open = 1.0 - open_cov
    wing_shadow = np.clip(blur(outside_open, 5.0) - outside_open, 0, 1)               # wings + top edge shade it
    inside = paper_texture(LH, LW, seed=5, base=PAPER - np.array([8.0, 7.5, 6.0]))
    inside = np.clip(inside * (depth_shade - 0.11 * wing_shadow)[..., None], 0, 255)
    save_rgba(inside, ia, OUT / 'envelope-inside.webp')

    geo['envelope']['flap'] = {
        'depth': depth,
        'depth_frac_of_level_h': round(depth / H, 4),
        'image_size': [LW, FH],
        'hinge_overlap_px': ext,
        'front_hinge_row': ext,
        'back_hinge_row': hinge_row,
        'apex_radius': apex_r,
        'corner_radius': corner_r,
        'min_cover_margin_px': round(worst, 1),
        'note': 'front/back/shadow images share one frame: LW x image_size[1]. Front: hinge at row '
                'front_hinge_row, apex below. Back: apex at row 0, hinge at back_hinge_row, overlap below.',
    }
    geo['envelope']['opening_polygon_level_clipped'] = [[round(u, 1), round(v, 1)] for u, v in opening_top]
    geo['envelope']['inside_image_size'] = [LW, LH]
    if preview:
        for n in ('envelope-flap-front', 'envelope-flap-back', 'envelope-inside', 'envelope-flap-shadow'):
            composite_preview(OUT / f'{n}.webp', preview / f'{n}_2x.png', scale=2)
        preview_closed_open(env, geo, preview)


def preview_closed_open(env, geo, preview):
    """Rough assembly in the level frame (the real one is CSS): closed, and open with the photo risen."""
    g = geo['envelope']
    LW, LH = env['LW'], env['LH']
    th = math.radians(env['theta'])
    TL = g['level_origin_in_image']
    FH = g['flap']['image_size'][1]
    ext = g['flap']['hinge_overlap_px']
    pad = FH + 30
    cw, ch = LW + 60, LH + pad + 30
    ox, oy = 30, pad
    ux, uy, vx, vy = math.cos(th), math.sin(th), -math.sin(th), math.cos(th)
    inv = (ux, vx, TL[0] - ox * ux - oy * vx, uy, vy, TL[1] - ox * uy - oy * vy)
    # resample premultiplied (like a browser) so transparent pixels' colour can't bleed into the edge
    front = Image.open(OUT / 'envelope.webp').convert('RGBa').transform((cw, ch), Image.AFFINE, inv,
                                                                       resample=Image.BILINEAR).convert('RGBA')
    inside = Image.open(OUT / 'envelope-inside.webp').convert('RGBA')
    ff = Image.open(OUT / 'envelope-flap-front.webp').convert('RGBA')
    fb = Image.open(OUT / 'envelope-flap-back.webp').convert('RGBA')
    fs = Image.open(OUT / 'envelope-flap-shadow.webp').convert('RGBA')
    photo = Image.open(OUT / 'photo.webp').convert('RGBA')
    ph = geo['photo']
    k = 0.84 * env['level_w'] / ph['outer_size'][0]
    p2 = photo.resize((round(photo.width * k), round(photo.height * k)), Image.LANCZOS)
    p2 = p2.convert('RGBa').rotate(env['theta'], resample=Image.BICUBIC).convert('RGBA')   # undo the level rotation
    clipmask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(clipmask).rectangle([ox + 3, 0, ox + LW - 4, oy + LH - 4], fill=255)
    for name, rise in (('closed', 0), ('open_in', 0), ('open_up', 163)):
        c = Image.new('RGBA', (cw, ch), PAGE_BG + (255,))
        c.alpha_composite(inside, (ox, oy))
        if name != 'closed':
            c.alpha_composite(fb, (ox, oy - (FH - ext)))     # back face: hinge on row FH - ext
        layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        top_y = oy + 6 - rise
        layer.alpha_composite(p2, (int(ox + LW / 2 - p2.width / 2), int(top_y - (p2.height - ph['outer_size'][1] * k) / 2 - 8)))
        a = np.minimum(np.asarray(layer.getchannel('A')), np.asarray(clipmask))
        layer.putalpha(Image.fromarray(a.astype(np.uint8)))
        c.alpha_composite(layer)
        c.alpha_composite(front)
        if name == 'closed':
            c.alpha_composite(fs, (ox, oy - ext))
            c.alpha_composite(ff, (ox, oy - ext))
        c.convert('RGB').resize((cw * 2, ch * 2), Image.LANCZOS).save(preview / f'assembled_{name}_2x.png')


# ----------------------------------------------------------------------------------------- animals

def build_animals(geo, preview):
    rgb = load_rgb('Animals.jpg')
    colour, alpha, _ = colour_matte(rgb, flood_thr=12.0, rings=2, dark_weight=True)
    save_rgba(colour, alpha, OUT / 'animals.webp')
    ys, xs = np.nonzero(alpha > 0.04)
    if len(xs) == 0:
        stop('Animals.jpg', "couldn't find the drawing: the picture is entirely white.")
    geo['animals'] = {'size': [rgb.shape[1], rgb.shape[0]],
                      'content_bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]}
    print(f"  animals content bbox {geo['animals']['content_bbox']}")
    if preview:
        composite_preview(OUT / 'animals.webp', preview / 'animals_3x.png')


# -------------------------------------------------------------------------------------------- main

def main():
    global OUT
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--preview', type=Path, help='folder for 3x review composites on the page colour')
    args = ap.parse_args()
    final = OUT
    final.mkdir(parents=True, exist_ok=True)
    if args.preview:
        args.preview.mkdir(parents=True, exist_ok=True)
    # Everything is written to a scratch folder first and copied over the old files only once every picture has
    # worked, so a stop half-way leaves public/images/cutouts/ as it was.
    OUT = Path(tempfile.mkdtemp(prefix='cutouts-'))
    try:
        geo = {'generated_by': 'tools/process-images.py', 'units': 'source pixels, image space'}
        print('holder');   build_holder(geo, args.preview)
        print('strip');    build_strip(geo, args.preview)
        print('photo');    build_photo(geo, args.preview)
        print('envelope'); env = build_envelope(geo, args.preview)
        print('envelope extras'); build_envelope_extras(env, geo, args.preview)
        print('animals');  build_animals(geo, args.preview)
        (OUT / 'geometry.json').write_text(json.dumps(geo, indent=2) + '\n', encoding='utf-8')
        for f in sorted(OUT.iterdir()):
            shutil.copyfile(f, final / f.name)
    finally:
        shutil.rmtree(OUT, ignore_errors=True)
        OUT = final
    for f in sorted(OUT.iterdir()):
        print(f'  {f.name:28s} {f.stat().st_size / 1024:7.1f} KB')


if __name__ == '__main__':
    main()
