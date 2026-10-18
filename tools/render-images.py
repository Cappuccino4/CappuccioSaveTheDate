#!/usr/bin/env python3
"""
tools/render-images.py -- re-draws the pictures that need a browser (for the web fonts):

    public/images/share-card.jpg                <- tools/share-card.html  (1200 x 630, drawn at 2x)
    public/images/icons/apple-touch-icon.png,
                        favicon-192.png,
                        favicon-32.png          <- tools/icon.html  (drawn at 3x / 8x; the two favicons have clear corners)
    public/images/cutouts/seal.webp             <- tools/seal.html  (transparent, drawn at 3x)

    python tools/render-images.py                # writes into public/images/
    python tools/render-images.py --out DIR      # writes into DIR instead (to compare first)

Run it after changing one of those pages, or the fonts, styles or cut-outs they use. Needs Python 3.9+
with Pillow (python -m pip install pillow) and Google Chrome or Microsoft Edge. No npm: it starts its
own small web server on this computer only (127.0.0.1), takes the screenshots with the browser's
built-in headless mode, and shrinks them with Pillow for crisp edges.
"""

import argparse
import functools
import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit('This script needs Pillow. Install it once with:  python -m pip install pillow')

ROOT = Path(__file__).resolve().parent.parent

BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]


def find_browser(explicit=None):
    for c in ([explicit] if explicit else []) + BROWSERS:
        if c and Path(c).is_file():
            return c
    for name in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'):
        if shutil.which(name):
            return shutil.which(name)
    sys.exit('Could not find Google Chrome or Microsoft Edge. Pass its path, e.g.\n'
             '  python tools/render-images.py --browser "C:\\path\\to\\chrome.exe"')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(root):
    handler = functools.partial(QuietHandler, directory=str(root))
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)   # this computer only: no firewall prompt
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}/'


def shoot(browser, profile, url, out_png, w, h, scale, transparent=False):
    """Screenshot of a w x h CSS px window at `scale` device pixels per CSS px, as a w*scale x h*scale image."""
    args = [browser, '--headless=new', f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
            '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=5000',
            f'--window-size={w},{h}', f'--force-device-scale-factor={scale}', f'--screenshot={out_png}']
    if transparent:
        args.append('--default-background-color=00000000')
    subprocess.run(args + [url], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    if not Path(out_png).is_file():
        sys.exit(f'The browser did not write a screenshot of {url}.')
    im = Image.open(out_png)
    if im.width < w * scale or im.height < h * scale:
        sys.exit(f'The screenshot of {url} came out {im.width} x {im.height}, smaller than the expected '
                 f'{w * scale} x {h * scale}. Try the other browser with --browser.')
    return im.crop((0, 0, w * scale, h * scale))


def main():
    ap = argparse.ArgumentParser(description='Re-draw the share card, the icons and the wax seal.')
    ap.add_argument('--out', type=Path, default=ROOT / 'public' / 'images', help='output folder (default: public/images)')
    ap.add_argument('--browser', help='path to chrome.exe or msedge.exe, if it is not found automatically')
    a = ap.parse_args()
    browser = find_browser(a.browser)
    (a.out / 'icons').mkdir(parents=True, exist_ok=True)
    (a.out / 'cutouts').mkdir(parents=True, exist_ok=True)
    httpd, base = serve(ROOT)
    print('Using', browser)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            profile = t / 'profile'          # a throwaway browser profile: never touches your own
            card = shoot(browser, profile, base + 'tools/share-card.html', t / 'card.png', 1200, 630, 2)
            card.convert('RGB').resize((1200, 630), Image.LANCZOS).save(
                a.out / 'share-card.jpg', quality=88, optimize=True, progressive=True)
            # The two favicons are rounded squares on a clear background, shrunk premultiplied like the seal below. The
            # home-screen icon stays a full square: iOS would fill clear pixels with black.
            for name, size, scale, query in (('apple-touch-icon.png', 180, 3, 'size=180'),
                                             ('favicon-192.png', 192, 3, 'size=192&tab=1'),
                                             ('favicon-32.png', 32, 8, 'size=32&tab=1&small=1')):
                tab = 'tab=1' in query
                im = shoot(browser, profile, base + 'tools/icon.html?' + query, t / name, size, size, scale, tab)
                if tab:
                    im = im.convert('RGBA').convert('RGBa').resize((size, size), Image.LANCZOS).convert('RGBA')
                else:
                    im = im.convert('RGB').resize((size, size), Image.LANCZOS)
                im.save(a.out / 'icons' / name, optimize=True)
            seal = shoot(browser, profile, base + 'tools/seal.html', t / 'seal.png', 240, 240, 3, transparent=True)
            # shrunk premultiplied, so the transparent surroundings can't darken the wax's soft edge
            seal.convert('RGBA').convert('RGBa').resize((132, 132), Image.LANCZOS).convert('RGBA').save(
                a.out / 'cutouts' / 'seal.webp', format='WEBP', quality=90, alpha_quality=100, method=6)
    finally:
        httpd.shutdown()
    for p in ('share-card.jpg', 'icons/apple-touch-icon.png', 'icons/favicon-192.png', 'icons/favicon-32.png',
              'cutouts/seal.webp'):
        f = a.out / p
        print(f'  {p:28s} {Image.open(f).size} {f.stat().st_size / 1024:6.1f} KB')


if __name__ == '__main__':
    main()
