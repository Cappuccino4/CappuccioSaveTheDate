/*
 * Austin & Kelsey Grace · Save the Date — app shell.
 *
 * Three screens in index.html, one visible at a time, chosen by the URL hash:
 *     #/  (or nothing)  → home        page 1, the photo-booth
 *     #/invitation      → invitation  page 2, the envelope + countdown
 *     #/details         → details     page 3, the "Share Details" form (assets/js/form.js)
 *     anything else     → home
 * Links simply set the hash, so the phone's back button / swipe works everywhere.
 *
 * On every screen change the new screen is shown from the top, focus moves to its heading, its intro plays (CSS
 * animations scoped to `.screen.play`, started once the fonts it uses have loaded and its pictures have decoded —
 * at most 2.5 s for the first screen, 1.2 s for fonts and 1.5 s for pictures later on — so script lettering never
 * reflows mid-animation and the envelope never opens with a layer missing) and then this is dispatched:
 *
 *     document.dispatchEvent(new CustomEvent('std:screen', { detail: { screen, previous } }))
 *     // screen: 'home' | 'invitation' | 'details';  previous: the same, or null on first load
 *
 * Pacing: a screen's first visit plays its full intro. Coming back through the site's own buttons, the old screen
 * fades out frozen mid-frame and the intro replays at 2.5x speed. Coming back with the browser's back/forward
 * (or the iPhone's swipe, which already shows a snapshot of the page) there is no fade-out and no replay: the
 * screen fades straight in as it was left.
 *
 * Page 2 and 3's pictures are fetched only once page 1 has everything it needs (see imagesFor), and a screen brought
 * in by a tap ignores taps for half a second, so a double tap can't land on its controls (see lockInput).
 *
 * Syntax is kept to ES2018 so older iPhones can parse the module.
 */

import { createCountdown } from './countdown.js';

const ROUTES = {
  '': 'home',
  '#': 'home',
  '#/home': 'home',
  '#/invitation': 'invitation',
  '#/details': 'details',
};

const LEAVE_MS = 180;               // fade-out of the old screen (matches .is-leaving in styles.css)
const LEAVE_MS_REDUCED = 120;
const FONT_TIMEOUT_MS = 1200;
const IMAGE_TIMEOUT_MS = 1500;      // pages 2 and 3: the longest an intro waits for its pictures
const FIRST_TIMEOUT_MS = 2500;      // first screen on a slow link: wait for its fonts (and pictures) rather than swap them in mid-intro
const REPLAY_RATE = 2.5;            // a repeat visit replays the intro in 40% of the time
const TAP_WINDOW_MS = 500;          // a hashchange this soon after a tap on one of our links came from that tap
const INPUT_LOCK_MS = 500;          // a screen brought in by a tap ignores taps this long (see lockInput)

const reduceMotion = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

const screens = {};
Array.prototype.forEach.call(document.querySelectorAll('[data-screen]'), (el) => {
  screens[el.getAttribute('data-screen')] = el;
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------------------------------ fonts */

// "New Icon Script" is listed first so the real Font 1 is waited for too once it is added to fonts.css
// (until then that load resolves immediately with nothing to load).
const FONT_FACES = {
  script: ['400 16px "New Icon Script"', '400 16px "Imperial Script"'],
  sans400: ['400 16px Poppins'],
  sans500: ['500 16px Poppins'],
  sans600: ['600 16px Poppins'],
  hand: ['400 16px "Beth Ellen"'],
};

const SCREEN_FONTS = {
  home: ['script', 'sans600'],
  invitation: ['hand', 'sans400', 'sans500', 'sans600'],
  details: ['script', 'sans400', 'sans500', 'sans600'],
};

const fontLoads = {};

function loadFont(key) {
  if (!fontLoads[key]) {
    const set = document.fonts;
    fontLoads[key] = set && typeof set.load === 'function'
      ? Promise.all(FONT_FACES[key].map((f) => set.load(f).catch(() => null)))
      : Promise.resolve();
  }
  return fontLoads[key];
}

function fontsFor(name, timeout) {
  return Promise.race([Promise.all(SCREEN_FONTS[name].map(loadFont)), delay(timeout)]);
}

/* ------------------------------------------------------------------------- pictures of pages 2 and 3 */

// Page 2 and 3's pictures start out in data-src, so on a slow link they don't take bandwidth from page 1: they are
// requested once page 1 has everything (the window's 'load'), or at once for a screen that is shown before that.
// Its intro then waits (at most IMAGE_TIMEOUT_MS) until they are decoded, so nothing pops in mid-intro.
const deferred = {};
Object.keys(screens).forEach((name) => {
  deferred[name] = Array.prototype.slice.call(screens[name].querySelectorAll('img[data-src]'));
});
const decoded = {}; // screens whose pictures have all been decoded (or have failed) once

function loadImages(name) {
  deferred[name].forEach((img) => {
    const src = img.getAttribute('data-src');
    if (src === null) return;
    img.removeAttribute('data-src');
    img.src = src;
  });
}

function loadAllImages() {
  if (!window.__stdUnsupported) Object.keys(deferred).forEach(loadImages);
}

function imagesFor(name, timeout) {
  loadImages(name);
  if (decoded[name] || !deferred[name].length) return Promise.resolve();
  const all = Promise.all(deferred[name].map((img) => (img.decode ? img.decode().catch(() => null) : null)));
  return Promise.race([all.then(() => { decoded[name] = true; }), delay(timeout)]);
}

/* ------------------------------------------------------------------- history: where "back" leads */

// Each history entry is numbered (in history.state) and we remember which screen each number showed, so
// "Go back" can use history.back() when the previous entry really is that screen, and otherwise just link
// there. (The numbers survive a reload; the map does not — then the links simply navigate.)
let entryIndex = 0;
let started = false;
const entryScreen = {};
let tappedAt = -Infinity; // last tap on one of our own links (see the hashchange handler)
let backSentAt = -Infinity; // a history.back() of ours that hasn't arrived as a hashchange yet

function stampEntry(name) {
  // The app scrolls each screen to the top itself; the browser restoring the old offset would jolt the screen
  // that is fading out. Safari keeps this per history entry (new ones start at 'auto'), so set it on every entry.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const state = history.state;
  if (state && typeof state.stdEntry === 'number') {
    entryIndex = state.stdEntry;
  } else {
    entryIndex = started ? entryIndex + 1 : 0;
    try {
      history.replaceState({ stdEntry: entryIndex }, '');
    } catch (err) {
      /* replaceState can throw in odd sandboxes; going back still works, it just links instead */
    }
  }
  entryScreen[entryIndex] = name;
}

function onClick(event) {
  const link = event.target && event.target.closest ? event.target.closest('a[href^="#/"], [data-back]') : null;
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  tappedAt = Date.now();
  const back = link.getAttribute('data-back');
  if (!back) return;
  if (tappedAt - backSentAt < TAP_WINDOW_MS) {
    event.preventDefault(); // a double tap: the first tap's history.back() is still on its way
  } else if (entryScreen[entryIndex - 1] === back) {
    event.preventDefault();
    backSentAt = tappedAt;
    history.back();
  }
  // otherwise the link's own href (#/ or #/invitation) takes the guest there
}

/* ------------------------------------------------------------------------------------- screens */

const countdown = createCountdown(
  document.querySelector('[data-countdown]'),
  (window.SAVE_THE_DATE_CONFIG || {}).weddingDateISO
);

let current = null;
let token = 0;
const seen = {}; // screens whose intro has played during this visit

function screenFromHash() {
  const hash = (location.hash || '').replace(/\/+$/, '').toLowerCase();
  return ROUTES[hash] || 'home';
}

function focusHeading(el) {
  const heading = el.querySelector('[data-screen-heading]');
  if (!heading) return;
  try {
    heading.focus({ preventScroll: true });
  } catch (err) {
    heading.focus();
  }
}

// A repeat visit: replay the intro at REPLAY_RATE ('short'), or jump it to its end ('none'). This includes the
// form's own entrance, which form.js starts from its std:screen listener. The screen's fade-in and the button's
// endless shimmer are left alone.
function pace(el, intro) {
  if (intro === 'full' || typeof el.getAnimations !== 'function') return;
  el.getAnimations({ subtree: true }).forEach((anim) => {
    const effect = anim.effect;
    if (!effect || effect.target === el || !isFinite(effect.getComputedTiming().endTime)) return;
    try {
      if (intro === 'short') anim.playbackRate = REPLAY_RATE;
      else anim.finish();
    } catch (err) {
      /* leave that one playing as it is */
    }
  });
}

// Double-tap guard: for a moment after a tap brings in a new screen, taps on it do nothing (CSS .is-entering takes
// it out of hit-testing, and guardInput catches anything that still gets through). Otherwise the second tap of an
// impatient double tap lands on the new screen's still-invisible controls: page 2's "Go back" (straight back to
// page 1) or "Share your details" (skipping page 2), or a form field (popping up the keyboard). Keyboard presses
// arrive as clicks with detail 0 and are never blocked, and back/forward never locks.
let inputLockedUntil = 0;
let unlockTimer = 0;

function lockInput(el) {
  inputLockedUntil = Date.now() + INPUT_LOCK_MS;
  el.classList.add('is-entering');
  clearTimeout(unlockTimer);
  unlockTimer = setTimeout(() => el.classList.remove('is-entering'), INPUT_LOCK_MS);
}

function guardInput(event) {
  if (Date.now() >= inputLockedUntil) return;
  if (event.type === 'mousedown') {
    event.preventDefault(); // focus stays on the new heading: no field takes it, no keyboard pops up
  } else if (event.detail > 0) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function enter(name, previous, how, myToken) {
  const el = screens[name];
  const intro = how === 'history' ? 'none' : seen[name] ? 'short' : 'full';
  el.classList.remove('is-leaving', 'play', 'is-quick', 'is-entering');
  if (intro === 'none') el.classList.add('is-quick');
  el.classList.add('is-active');
  if (how === 'tap') lockInput(el);
  window.scrollTo(0, 0);
  if (how !== 'load') focusHeading(el);
  if (countdown) {
    if (name === 'invitation') countdown.start();
    else countdown.stop();
  }
  const first = how === 'load';
  const fonts = fontsFor(name, first ? FIRST_TIMEOUT_MS : FONT_TIMEOUT_MS);
  const images = imagesFor(name, first ? FIRST_TIMEOUT_MS : IMAGE_TIMEOUT_MS);
  Promise.all([fonts, images, domReady]).then(() => {
    if (myToken !== token) return;
    void el.offsetWidth; // flush styles so the intro restarts from its first frame (and the fade-in runs)
    el.classList.add('play');
    seen[name] = true;
    document.dispatchEvent(new CustomEvent('std:screen', { detail: { screen: name, previous: previous } }));
    pace(el, intro);
    if (how === 'load') Object.keys(FONT_FACES).forEach(loadFont); // now the other screens' fonts
  });
}

// The first intro (and its std:screen event) waits for DOMContentLoaded, which fires only after every deferred
// module has run — so form.js is already listening even when the fonts come straight from the cache.
const domReady = new Promise((resolve) => {
  if (document.readyState === 'complete') resolve();
  document.addEventListener('DOMContentLoaded', resolve, { once: true });
});

// how: 'load' (first screen), 'tap' (one of the site's links or buttons) or 'history' (back/forward, swipe)
function go(name, how) {
  if (name === current && how !== 'load') return;
  const myToken = ++token;
  const previous = current;
  current = name;
  if (how !== 'tap') inputLockedUntil = 0; // back/forward: the screen it shows takes taps at once

  // The old screen fades out frozen where it is: its intro keeps .play (paused by .is-leaving in styles.css)
  // until it is hidden, so nothing jumps to its end state on the way out. Back/forward skips the fade-out — the
  // browser (on an iPhone, the swipe's own snapshot) has already moved away from it.
  const leaving = Object.keys(screens).filter((n) => n !== name && screens[n].classList.contains('is-active'));
  leaving.forEach((n) => screens[n].classList.add('is-leaving'));

  const wait = leaving.length && how === 'tap' ? (reduceMotion.matches ? LEAVE_MS_REDUCED : LEAVE_MS) : 0;
  const finish = () => {
    if (myToken !== token) return;
    leaving.forEach((n) => screens[n].classList.remove('is-active', 'is-leaving', 'play', 'is-quick', 'is-entering'));
    enter(name, previous, how, myToken);
  };
  if (wait) setTimeout(finish, wait);
  else finish();
}

function onHashChange() {
  backSentAt = -Infinity;
  const name = screenFromHash();
  stampEntry(name);
  go(name, Date.now() - tappedAt < TAP_WINDOW_MS ? 'tap' : 'history');
}

function removeFallback() {
  const fallback = document.getElementById('std-fallback');
  if (fallback) fallback.parentNode.removeChild(fallback);
}

/* ------------------------------------------------------------------------------------------ start */

// index.html keeps a browser that is too old for the site on its friendly card instead (see its <head> script).
if (!window.__stdUnsupported) {
  document.addEventListener('click', onClick);
  window.addEventListener('click', guardInput, true);
  window.addEventListener('mousedown', guardInput, true);
  document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS Safari show :active presses
  window.addEventListener('hashchange', onHashChange);

  const first = screenFromHash();
  stampEntry(first);
  started = true;
  go(first, 'load');

  // page 1 has everything it needs: now the other screens' pictures
  if (document.readyState === 'complete') loadAllImages();
  else window.addEventListener('load', loadAllImages);

  // Tell the safety net in index.html that the app is running (and undo it if it already fired).
  window.__stdReady = true;
  removeFallback();
}
