/*
 * Share Details: the multi-step form on page 3 of the save-the-date. It renders into #details-form.
 *
 *   Step 1  Full name
 *   Step 2  "Already know you can't make it?"   (checking the box and pressing Submit ends the flow here)
 *   Step 3  Mailing address
 *   Step 4  Married? (+ optional first dance song)
 *   Done    Thank-you card. A successful reply is remembered on this device.
 *
 * Replies are POSTed as JSON to the Google Apps Script web app in window.SAVE_THE_DATE_CONFIG.formEndpoint
 * (see README.md and apps-script/Code.gs). The body is sent as text/plain so the browser makes a "simple"
 * CORS request with no preflight. While formEndpoint is empty the form runs in preview mode on your own computer
 * (localhost / a file) and saves nothing; on the live site it says replies aren't being collected yet instead.
 *
 * Answers in progress are kept in this tab's sessionStorage, so a reload doesn't wipe them. Every word the guest
 * reads is in COPY / ERRORS below.
 *
 * Safety: anything a guest types is only ever written with .textContent / .value, never parsed as HTML.
 * Syntax is kept to ES2018 so older iPhones can still parse the module.
 */

const STORAGE_KEY = 'std:lastSubmission';
const DRAFT_KEY = 'std:draft';
const REQUEST_TIMEOUT_MS = 20000;
const PREVIEW_DELAY_MS = 700;
const MAX_LEN = 120;
const NAME_MAX = 200;              // households list everyone; the server allows 200 too
const DEFAULT_COUNTRY = 'United States';
const ENTRANCE_DELAY_MS = 180;
const INPUT_LOCK_MS = 600;         // taps ignored right after a step change (see lockInput)
const HEIGHT_MS = 400;             // the card's height change on a step change
const GLIDE_MS = 450;              // ...when the page has to scroll along with it
const REVEAL_MS = 460;
const SCROLL_MARGIN = 12;

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

const PATH_FULL = ['name', 'cant', 'address', 'married'];
const PATH_DECLINE = ['name', 'cant'];

/* ------------------------------------------------------------------ wording (everything the guest reads) */

const COPY = {
  formLabel: 'Share your details',
  progress: (n, total) => `Step ${n} of ${total}`,
  optional: '(optional)',
  back: 'Back',
  continue: 'Continue',
  submit: 'Submit',
  tryAgain: 'Try again',
  sending: 'Sending…',
  sendingStatus: 'Sending your details…',

  nameTitle: 'Who’s replying?',
  nameLabel: 'Full name',
  nameHelp: 'First and last, please. Replying for your household? List everyone.',

  cantTitle: 'Already know you can’t make it?',
  cantHelp: 'If so, just check the box — no explanation needed. Otherwise, tap Continue.',
  cantBox: 'I already know I can’t make it',
  honesty: 'We totally understand and appreciate the honesty.',
  honestyNext: 'Tap Submit to send your reply.',

  addressTitle: 'Where should we mail your invitation?',
  country: 'Country',
  line1: 'Street address',
  line2: 'Apt, suite, unit',
  city: 'City',
  state: 'State',
  stateIntl: 'State / Province',
  zip: 'ZIP code',
  postal: 'Postal code',

  marriedTitle: 'Are you married?',
  yes: 'Yes',
  no: 'No',
  songTitle: 'What was your first dance song?',
  songHelp: 'We’d love to know!',
  song: 'Song',
  songExample: 'e.g. At Last',
  artist: 'Artist',
  artistExample: 'e.g. Etta James',

  // {First} is the name to greet: "Jane", "Uncle Joe", "John & Jane", "the Smiths" (see firstNameOf)
  thanks: (first) => `Thank you, ${first}!`,
  missYou: (first) => `We’ll miss\u00A0you, ${first}!`,
  allSet: (first) => `You’re all\u00A0set, ${first}!`,
  attending: 'We’ve got your details. Keep\u00A0an\u00A0eye on your mailbox — a\u00A0formal invitation will follow.',
  declined: 'We totally understand and appreciate the honesty. Thank you for letting us know.',
  revisit: 'We already have your details from this device. Thank you!',
  preview: 'Preview mode — this response wasn’t saved. (Connect Google Sheets to start collecting responses.)',
  website: 'Find all the details on our wedding website.',
  websiteButton: 'Visit our Zola page',
  newTab: '(opens in a new tab)',
  toInvitation: 'Back to the invitation',
  another: 'Submit another response',
  friend: 'friend',                 // greeting when there's no usable name
  andFamily: '& family',            // "Christopher & family", for a long household list

  honeypot: 'Leave this field empty',   // never seen by guests (a trap for bots)
};

const ERRORS = {
  name: 'Please enter your first and last name.',
  line1: 'Please enter your street address.',
  city: 'Please enter your city.',
  state: 'Please enter your state.',
  zip: 'Please enter your ZIP code.',
  zipInvalid: 'Please enter a 5\u2011digit ZIP code. Not in the US? Change the country above.',
  postal: 'Please enter your postal code.',
  country: 'Please enter your country.',
  married: 'Please choose one.',
  network: 'We couldn’t reach our server. Please check your connection and try again.',
  timeout: 'This is taking longer than it should. Please check your connection and try again.',
  server: 'Something went wrong on our end. Please try again in a moment.',
  validation: 'Please check your details and try again.',
  config: 'Replies aren’t being collected just yet — please let Austin or Kelsey know.',
  persist: 'If it keeps happening, please reach out to Austin or Kelsey directly.',
};

const HEART_PATH = 'M12 20.4s-7.3-4.5-9.2-9C1.5 8.3 3.6 4.9 7 4.9c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.5 3.4 4.2 6.5-1.9 4.5-9.2 9-9.2 9z';

const ICON = {
  back: '<svg class="df-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M13 8H3.6M7.6 3.8 3.4 8l4.2 4.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 12.6l4.1 4.1 8.9-9.4"/></svg>',
  alert: '<svg class="df-error-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.6"/><path d="M8 4.7v4.1"/><circle class="df-dot" cx="8" cy="11.3" r=".55"/></svg>',
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${HEART_PATH}"/></svg>`,
  external: '<svg class="df-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5 7 9"/></svg>',
};

/** The couple's wedding website from config.js (weddingWebsiteURL), linked on the thank-you card; https only. */
function websiteURL() {
  const cfg = window.SAVE_THE_DATE_CONFIG;
  const url = cfg && typeof cfg.weddingWebsiteURL === 'string' ? cfg.weddingWebsiteURL.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

/* ------------------------------------------------------------------ markup (static, never guest data) */

/** The wording above goes into the template as text, so it may safely contain & < > or quotes. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TEXT_ATTRS = 'autocapitalize="words" autocorrect="off" spellcheck="false"';

/**
 * One labelled text field. optional: true shows "(optional)"; false renders it hidden, for a field that is
 * optional only sometimes (State, outside the US); left out, the field is simply required.
 */
function field(opts) {
  const id = opts.id;
  const helpId = opts.help ? `df-${id}-help` : '';
  const optional = opts.optional === undefined ? '' : `<span class="df-optional"${opts.optional ? '' : ' hidden'}> ${esc(COPY.optional)}</span>`;
  return `
          <div class="df-field">
            <label class="df-label" id="df-${id}-label" for="df-${id}"><span class="df-label-text">${esc(opts.label)}</span>${optional}</label>
            <input class="df-input" type="text" id="df-${id}" name="${opts.name}" autocomplete="${opts.autocomplete || 'off'}" maxlength="${opts.max || MAX_LEN}"${opts.optional ? '' : ' required'}${helpId ? ` aria-describedby="${helpId}"` : ''} ${opts.attrs || ''}>
            <p class="df-error" id="df-${id}-error" hidden>${ICON.alert}<span class="df-error-text"></span></p>${opts.help ? `
            <p class="df-help" id="${helpId}">${esc(opts.help)}</p>` : ''}
          </div>`;
}

function finale(view, titleId, text) {
  const site = websiteURL();
  return `
    <div class="df-view df-done" data-view="${view}" hidden>
      <div class="df-flourish" aria-hidden="true"><span></span>${ICON.heart}<span></span></div>
      <h2 class="df-done-title" id="${titleId}" tabindex="-1"></h2>
      <p class="df-done-text">${esc(text)}</p>${view === 'done' ? `
      <p class="df-note" hidden>${esc(COPY.preview)}</p>` : ''}${site ? `
      <div class="df-website">
        <p class="df-website-text">${esc(COPY.website)}</p>
        <a class="btn df-website-link" href="${esc(site)}" target="_blank" rel="noopener">${esc(COPY.websiteButton)}${ICON.external}<span class="sr-only"> ${esc(COPY.newTab)}</span></a>
        <p class="df-website-address">${esc(site.replace(/^https:\/\/(?:www\.)?/i, '').replace(/\/$/, '')).replace(/\//g, '/<wbr>')}</p>
      </div>` : ''}
      <div class="df-done-actions">
        <a class="btn-link" href="#/invitation" data-back="invitation">${esc(COPY.toInvitation)}</a>
        <button type="button" class="btn-link" data-action="another">${esc(COPY.another)}</button>
      </div>
    </div>`;
}

// enterkeyhint: "next" moves on to the next field, "go" on a step's last field means Continue, "send" = Submit.
// Country comes first in the address step, so the labels and the ZIP keyboard already fit before anything is typed.
const TEMPLATE = `
<div class="df-card">
  <div class="df-views">
    <form class="df-view df-form" data-view="form" novalidate autocomplete="on" aria-label="${esc(COPY.formLabel)}">
      <div class="df-progress" aria-hidden="true">
        <p class="df-progress-label">${esc(COPY.progress(1, 4))}</p>
        <ol class="df-dots"><li></li><li></li><li></li><li></li></ol>
      </div>

      <div class="df-steps">
        <div class="df-step" data-step="name" role="group" aria-labelledby="df-name-title">
          <h2 class="df-title" id="df-name-title" tabindex="-1"><span class="sr-only df-sr-step"></span>${esc(COPY.nameTitle)}</h2>${field({
            id: 'fullname', name: 'fullName', label: COPY.nameLabel, autocomplete: 'name', max: NAME_MAX, help: COPY.nameHelp,
            attrs: `${TEXT_ATTRS} enterkeyhint="go"`,
          })}
        </div>

        <div class="df-step" data-step="cant" role="group" aria-labelledby="df-cant-title" hidden>
          <h2 class="df-title" id="df-cant-title" tabindex="-1"><span class="sr-only df-sr-step"></span>${esc(COPY.cantTitle)}</h2>
          <p class="df-lede" id="df-cant-help">${esc(COPY.cantHelp)}</p>
          <label class="df-check">
            <input class="df-check-input" type="checkbox" id="df-cant" name="cantMakeIt" aria-describedby="df-cant-help">
            <span class="df-check-frame" aria-hidden="true"></span>
            <span class="df-check-box" aria-hidden="true">${ICON.check}</span>
            <span class="df-check-text">${esc(COPY.cantBox)}</span>
          </label>
          <div class="df-reveal" data-reveal="honesty" hidden>
            <p class="df-honesty">${esc(COPY.honesty)}</p>
            <p class="df-honesty-next">${esc(COPY.honestyNext)}</p>
          </div>
        </div>

        <div class="df-step" data-step="address" role="group" aria-labelledby="df-address-title" hidden>
          <h2 class="df-title" id="df-address-title" tabindex="-1"><span class="sr-only df-sr-step"></span>${esc(COPY.addressTitle)}</h2>${field({
            id: 'country', name: 'country', label: COPY.country, autocomplete: 'country-name',
            attrs: `value="${esc(DEFAULT_COUNTRY)}" ${TEXT_ATTRS} enterkeyhint="next"`,
          })}${field({
            id: 'line1', name: 'line1', label: COPY.line1, autocomplete: 'address-line1', attrs: `${TEXT_ATTRS} enterkeyhint="next"`,
          })}${field({
            id: 'line2', name: 'line2', label: COPY.line2, optional: true, autocomplete: 'address-line2', attrs: `${TEXT_ATTRS} enterkeyhint="next"`,
          })}${field({
            id: 'city', name: 'city', label: COPY.city, autocomplete: 'address-level2', attrs: `${TEXT_ATTRS} enterkeyhint="next"`,
          })}
          <div class="df-pair">${field({
            id: 'state', name: 'state', label: COPY.state, optional: false, autocomplete: 'address-level1', attrs: `${TEXT_ATTRS} enterkeyhint="next"`,
          })}${field({
            id: 'postal', name: 'postalCode', label: COPY.zip, autocomplete: 'postal-code', max: 20,
            attrs: 'inputmode="numeric" autocorrect="off" spellcheck="false" enterkeyhint="go"',
          })}
          </div>
        </div>

        <div class="df-step" data-step="married" role="group" aria-labelledby="df-married-title" hidden>
          <h2 class="df-title" id="df-married-title" tabindex="-1"><span class="sr-only df-sr-step"></span>${esc(COPY.marriedTitle)}</h2>
          <div class="df-seg" id="df-married" role="radiogroup" aria-labelledby="df-married-title" aria-required="true">
            <label class="df-seg-opt"><input type="radio" name="married" value="yes" id="df-married-yes"><span class="df-seg-face">${esc(COPY.yes)}</span></label>
            <label class="df-seg-opt"><input type="radio" name="married" value="no" id="df-married-no"><span class="df-seg-face">${esc(COPY.no)}</span></label>
          </div>
          <p class="df-error" id="df-married-error" hidden>${ICON.alert}<span class="df-error-text"></span></p>
          <div class="df-reveal" data-reveal="song" hidden>
            <div class="df-song" role="group" aria-labelledby="df-song-title">
              <h3 class="df-subtitle" id="df-song-title">${esc(COPY.songTitle)}</h3>
              <p class="df-lede">${esc(COPY.songHelp)}</p>${field({
                id: 'song', name: 'firstDanceSong', label: COPY.song, optional: true,
                attrs: `placeholder="${esc(COPY.songExample)}" autocapitalize="words" enterkeyhint="next"`,
              })}${field({
                id: 'artist', name: 'firstDanceArtist', label: COPY.artist, optional: true,
                attrs: `placeholder="${esc(COPY.artistExample)}" autocapitalize="words" enterkeyhint="send"`,
              })}
            </div>
          </div>
        </div>
      </div>

      <div class="df-alert" role="alert" hidden>${ICON.alert}<p class="df-alert-text"></p></div>

      <div class="df-actions">
        <button type="button" class="btn-link df-back" hidden>${ICON.back}<span>${esc(COPY.back)}</span></button>
        <button type="submit" class="btn df-next"><span class="df-spinner" aria-hidden="true"></span><span class="df-next-label">${esc(COPY.continue)}</span></button>
      </div>
    </form>
${finale('done', 'df-done-title', '')}
${finale('revisit', 'df-revisit-title', COPY.revisit)}
  </div>
  <p class="sr-only df-status" role="status" aria-live="polite"></p>
</div>
<form class="df-hp sr-only" aria-hidden="true" autocomplete="off">
  <label for="df-company">${esc(COPY.honeypot)}</label>
  <input type="text" id="df-company" name="company" tabindex="-1" autocomplete="off">
</form>`;

/* ------------------------------------------------------------------ helpers */

const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });
const now = () => (window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now());

/** cubic-bezier() as a function of progress, so a scroll can move on exactly the same curve as an animation. */
function bezier(x1, y1, x2, y2) {
  const at = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i += 1) {
      const mid = (lo + hi) / 2;
      if (at(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2, y1, y2);
  };
}

const easeOut = bezier(0.22, 1, 0.36, 1); // = EASE_OUT
const easeInOut = bezier(0.4, 0, 0.2, 1); // = EASE_IN_OUT

/** Trim, collapse runs of whitespace, cap the length. */
function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || MAX_LEN);
}

function makeRe(source, flags, fallback) {
  try {
    return new RegExp(source, flags);
  } catch (err) {
    return fallback;
  }
}

const LETTER_RE = makeRe('\\p{L}', 'u', /[A-Za-zÀ-ɏ]/);
const CJK_RE = makeRe('[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]', 'u', /[぀-ヿ㐀-鿿가-힯]/);
const INITIALS_RE = makeRe('^(?:\\p{L}\\.)+\\p{L}?$', 'u', /^(?:[A-Za-zÀ-ɏ]\.)+[A-Za-zÀ-ɏ]?$/); // "J.", "J.R.", "A.J"
const INITIAL_RE = makeRe('^\\p{L}\\.?$', 'u', /^[A-Za-zÀ-ɏ]\.?$/); // one initial: "J." or "J"

/** First + last name: at least two words that contain a letter (one CJK name of 2+ characters is fine too). */
function isFullName(value) {
  const words = clean(value, NAME_MAX).split(' ').filter((w) => LETTER_RE.test(w));
  if (words.length >= 2) return true;
  return words.length === 1 && CJK_RE.test(words[0]) && Array.from(words[0]).length >= 2;
}

const US_NAMES = ['us', 'usa', 'unitedstates', 'unitedstatesofamerica', 'america'];
function isUS(country) {
  return US_NAMES.indexOf(String(country || '').toLowerCase().replace(/[^a-z]/g, '')) !== -1;
}

/** "02134", "02134-1234", "02134 1234" or "021341234" -> canonical form; anything else -> "". */
function normalizeZip(value) {
  const m = /^(\d{5})(?:[\s-]?(\d{4}))?$/.exec(String(value).trim());
  if (!m) return '';
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/* --------------------------------------- the name to greet ("Thank you, {First}!") */

const HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame', 'lady', 'lord', 'capt', 'col', 'sgt', 'lt', 'hon'];
// family and clergy titles are how the guest is known, so they stay with the next word: "Uncle Joe", "Father Michael"
const KIN_TITLES = ['aunt', 'auntie', 'aunty', 'uncle', 'grandma', 'grandpa', 'granny', 'gran', 'grandmother', 'grandfather',
  'nana', 'nanna', 'nonna', 'nonno', 'papa', 'pop', 'pops', 'mama', 'cousin', 'father', 'fr', 'mother', 'sister', 'sr',
  'brother', 'br', 'pastor', 'rabbi', 'reverend', 'rev', 'deacon', 'bishop'];
// words in a household list that aren't anyone's name: "with Ben", "baby Rose", "and the kids"
const FILLER = ['with', 'baby', 'little', 'our', 'my', 'the', 'plus', 'kids', 'children', 'family', 'guest', 'guests'];
const SUFFIX_RE = /^(?:jr|sr|ii|iii|iv|md|phd|esq|dds)\.?$/i;

const bare = (word) => word.toLowerCase().replace(/\.$/, '');

/** Strip punctuation around a word, but never the period of an initial ("J.R.") or a title ("Fr."). */
function trimWord(word) {
  let w = word.replace(/[,;:!?)\]}]+$/, '');
  const quoted = /^(["'“‘(])(.+)(["'”’)])$/.exec(w);
  if (quoted) w = quoted[2];
  return w;
}

/** "MARGARET" / "margaret" -> "Margaret", "D'ANGELO" -> "D'Angelo", "MARY-KATE" -> "Mary-Kate"; mixed case is kept. */
function fixCase(word) {
  const upper = word === word.toUpperCase();
  const lower = word === word.toLowerCase();
  if ((!upper && !lower) || upper === lower || INITIALS_RE.test(word)) return word;
  return word.toLowerCase().replace(/(^[-'’‘\u02BB]*|[-'’‘\u02BB]+)(.)/g, (m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * The name to greet in one part of the reply: the first name, a family title with it ("Uncle Joe"), an initial
 * with the next name ("J. Robert"), or for one person, title + surname ("Dr. Smith"). null = only honorifics ("Mr.").
 */
function greetOne(part, alone) {
  const words = part.split(' ').map(trimWord).filter((w) => LETTER_RE.test(w));
  let i = 0;
  while (i < words.length && HONORIFICS.indexOf(bare(words[i])) !== -1) i += 1;
  if (!words.length) return '';
  if (i === words.length) return null;
  if (alone && i > 0 && i === words.length - 1) return words.map(fixCase).join(' ');
  while (i < words.length && FILLER.indexOf(words[i].toLowerCase()) !== -1) i += 1;
  if (i === words.length) return '';
  const name = [fixCase(words[i])];
  const nextWord = words[i + 1];
  const keepNext = KIN_TITLES.indexOf(bare(words[i])) !== -1 || INITIAL_RE.test(words[i]);
  if (keepNext && nextWord && !SUFFIX_RE.test(nextWord)) name.push(fixCase(nextWord));
  return name.join(' ');
}

/**
 * A family name greeted mid-sentence starts with a lowercase "the": "We'll miss you, the Cappuccio Family!" (setTitle
 * keeps it on the line of the name). A name typed all in capitals keeps its "THE".
 */
function midSentence(name) {
  return name === name.toUpperCase() ? name : name.replace(/^the(?=\s)/i, 'the');
}

/**
 * Who to thank: "Jane", "Uncle Joe", "J.R.", "John & Jane" for a couple, "Rose, Joe & Vinny" for three, and the
 * whole reply for formal or family names ("Mr. and Mrs. Smith", "the Smiths", "Smith Family").
 */
function firstNameOf(fullName) {
  const name = clean(fullName, NAME_MAX);
  const words = name.split(' ').filter(Boolean);
  if (!words.length) return COPY.friend;
  if (/^the$/i.test(words[0]) || /^famil(?:y|ies)$/i.test(words[words.length - 1])) return midSentence(name);
  let parts;
  if (/\s(?:&|and|\+)\s/i.test(name)) {
    parts = name.split(/\s*,\s*|\s+(?:&|and|\+)\s+/i);               // "Rose, Joe and Vinny Cappuccio"
  } else {
    const comma = name.indexOf(',');
    const after = comma > 0 ? name.slice(comma + 1).trim() : '';
    parts = [after && !SUFFIX_RE.test(after.split(' ')[0]) ? after : name]; // "Smith, John" but "John Smith, Jr."
  }
  const names = [];
  for (let i = 0; i < parts.length; i += 1) {
    const one = greetOne(parts[i], parts.length === 1);
    if (one === null) return name; // "Mr. and Mrs. John Smith": formal, keep it whole
    if (one) names.push(one);
  }
  if (!names.length) return fixCase(trimWord(words[0])) || COPY.friend;
  if (names.length === 1) return names[0];
  if (names.length > 3) return `${names[0]} ${COPY.andFamily}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function uuid() {
  const c = window.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch (err) {
      /* insecure context: fall through */
    }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* --------------------------------------- storage (every access may throw: private modes, in-app browsers) */

function readLastSubmission() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.firstName === 'string' && clean(data.firstName)) return data;
  } catch (err) {
    /* storage blocked or unreadable: just start fresh */
  }
  return null;
}

function writeLastSubmission(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    /* storage blocked: nothing to remember, the reply itself was still saved */
  }
}

// the fields kept in a draft (never the honeypot)
const DRAFT_FIELDS = ['fullName', 'country', 'line1', 'line2', 'city', 'state', 'postal', 'song', 'artist'];

function readDraft() {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.v === 1 && data.values && typeof data.values === 'object') return data;
  } catch (err) {
    /* storage blocked or unreadable: no draft */
  }
  return null;
}

function writeDraft(data) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch (err) {
    /* storage blocked: the answers just won't survive a reload */
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    /* storage blocked: there's no draft to clear */
  }
}

function configuredEndpoint() {
  const cfg = window.SAVE_THE_DATE_CONFIG;
  return cfg && typeof cfg.formEndpoint === 'string' ? cfg.formEndpoint.trim() : '';
}

/** Preview mode (no formEndpoint yet) is only for trying the site on your own computer, never the live site. */
function isLocalPreview() {
  try {
    const loc = window.location;
    return loc.protocol === 'file:' || ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(loc.hostname) !== -1;
  } catch (err) {
    return false;
  }
}

class SubmitError extends Error {
  constructor(kind, detail) {
    super(kind);
    this.kind = kind;
    this.detail = detail || '';
  }
}

/** POST the reply. Resolves with the parsed JSON on { ok: true }; rejects with a SubmitError otherwise. */
async function postReply(url, payload) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  let timer = 0;
  const timeout = new Promise((resolve, reject) => {
    timer = window.setTimeout(() => {
      timedOut = true;
      if (controller) controller.abort();
      reject(new SubmitError('timeout', `no answer after ${REQUEST_TIMEOUT_MS / 1000}s`));
    }, REQUEST_TIMEOUT_MS);
  });
  const request = (async () => {
    let res;
    let text = '';
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined,
      });
      text = await res.text();
    } catch (err) {
      throw new SubmitError(timedOut ? 'timeout' : 'network', err && err.message);
    }
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new SubmitError('server', `expected JSON, got HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
    if (!data || data.ok !== true) {
      const code = data && data.code;
      throw new SubmitError(code === 'VALIDATION' ? 'validation' : 'server', (data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

/** One piece of the celebration. Colours are CSS values (palette custom properties), so they come from tokens.css. */
function particle(type, color) {
  if (type === 'heart') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const size = (11 + Math.random() * 8).toFixed(1);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', HEART_PATH);
    path.style.fill = color;
    svg.appendChild(path);
    return svg;
  }
  const el = document.createElement('span');
  const petal = type === 'petal';
  const w = petal ? 9 + Math.random() * 4 : 5 + Math.random() * 3;
  const h = petal ? w * (0.8 + Math.random() * 0.3) : 9 + Math.random() * 5;
  el.style.width = `${w.toFixed(1)}px`;
  el.style.height = `${h.toFixed(1)}px`;
  el.style.background = color;
  el.style.borderRadius = petal ? '0 80% 0 80%' : '1px';
  if (color === 'var(--c-white)' || color === 'var(--df-cream)') el.style.boxShadow = '0 0 0 0.5px rgb(var(--c-ink-rgb) / 0.18)';
  return el;
}

/* ------------------------------------------------------------------ the form */

class DetailsForm {
  constructor(root) {
    this.root = root;
    this.screen = root.closest ? root.closest('.screen') : null; // page 3's section (its own back link)
    this.step = 'name';
    this.busy = false;
    this.attempt = null;     // { id, signature }: retries of the same answers reuse the same submissionId
    this.failures = 0;
    this.alertOn = false;
    this.postalUS = null;
    this.entrance = [];
    this.statusToken = 0;
    this.lockedUntil = 0;
    this.lockTimer = 0;
    this.transitionId = 0;
    this.holding = false;
    this.scrollAnim = null;
    this.preconnected = false;

    root.innerHTML = TEMPLATE;
    const $ = (sel) => root.querySelector(sel);
    this.card = $('.df-card');
    this.views = $('.df-views');
    this.form = $('.df-form');
    this.doneView = $('[data-view="done"]');
    this.revisitView = $('[data-view="revisit"]');
    this.doneTitle = $('#df-done-title');
    this.doneText = this.doneView.querySelector('.df-done-text');
    this.doneNote = this.doneView.querySelector('.df-note');
    this.revisitTitle = $('#df-revisit-title');
    this.progress = $('.df-progress');
    this.progressLabel = $('.df-progress-label');
    this.dots = Array.from(root.querySelectorAll('.df-dots li'));
    this.stepsBox = $('.df-steps');
    this.steps = {};
    Array.from(root.querySelectorAll('.df-step')).forEach((el) => { this.steps[el.dataset.step] = el; });
    this.alert = $('.df-alert');
    this.alertText = $('.df-alert-text');
    this.actions = $('.df-actions');
    this.backBtn = $('.df-back');
    this.nextBtn = $('.df-next');
    this.nextLabel = $('.df-next-label');
    this.status = $('.df-status');
    this.honestyReveal = $('[data-reveal="honesty"]');
    this.honestyNext = $('.df-honesty-next');
    this.songReveal = $('[data-reveal="song"]');
    this.radios = Array.from(root.querySelectorAll('input[name="married"]'));
    this.f = {
      fullName: $('#df-fullname'),
      cant: $('#df-cant'),
      country: $('#df-country'),
      line1: $('#df-line1'),
      line2: $('#df-line2'),
      city: $('#df-city'),
      state: $('#df-state'),
      postal: $('#df-postal'),
      married: $('#df-married'),
      song: $('#df-song'),
      artist: $('#df-artist'),
      company: $('#df-company'),
    };

    this.bind();
    this.updatePostalMode();
    const last = readLastSubmission();
    const draft = readDraft();
    // a draft started after the last reply (e.g. "Submit another response", then a reload) wins over "all set"
    if (draft && (!last || Date.parse(draft.at) > Date.parse(last.at))) this.restoreDraft(draft);
    else if (last) this.showRevisit(last);
    this.sync();
  }

  bind() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.primary();
    });
    this.form.addEventListener('keydown', (e) => this.onKeydown(e));
    this.form.addEventListener('input', (e) => this.onInput(e));
    this.form.addEventListener('change', (e) => this.onChange(e));
    this.backBtn.addEventListener('click', () => this.back());
    this.root.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-action="another"]')) this.startOver();
    });
    // the input lock (see lockInput): a tap or click on the card while locked does nothing, and doesn't even move
    // focus off the new step's heading. Keyboard presses arrive as clicks with detail 0 and are never blocked.
    this.card.addEventListener('click', (e) => {
      if (e.detail > 0 && this.isLocked()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    this.card.addEventListener('mousedown', (e) => {
      if (this.isLocked()) e.preventDefault();
    }, true);
    // scrolling by hand always wins over an automatic scroll (a tap's tiny finger jitter doesn't count)
    let touchY = null;
    window.addEventListener('touchstart', (e) => { touchY = e.touches.length ? e.touches[0].clientY : null; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (touchY !== null && e.touches.length && Math.abs(e.touches[0].clientY - touchY) > 10) this.stopScroll();
    }, { passive: true });
    window.addEventListener('wheel', () => this.stopScroll(), { passive: true });
    // leaving page 3 (a link, Back, a swipe): app.js owns the scroll position from here
    window.addEventListener('hashchange', () => this.stopScroll());
    document.addEventListener('std:screen', (e) => {
      if (e.detail && e.detail.screen === 'details') {
        this.preconnect();
        this.playEntrance();
      }
    });
  }

  /* ---------------------------------------------------------------- navigation */

  primary() {
    if (this.busy) return;
    if (this.step === 'name') {
      if (this.validateStep('name')) this.goTo('cant', 1);
    } else if (this.step === 'cant') {
      if (this.f.cant.checked) this.submit(true);
      else this.goTo('address', 1);
    } else if (this.step === 'address') {
      if (this.validateStep('address')) this.goTo('married', 1);
    } else if (this.step === 'married') {
      if (this.validateStep('married')) this.submit(false);
    }
  }

  back() {
    if (this.busy) return;
    const i = PATH_FULL.indexOf(this.step);
    if (i > 0) this.goTo(PATH_FULL[i - 1], -1);
  }

  goTo(step, dir) {
    this.beginTransition();
    const from = this.steps[this.step];
    const to = this.steps[step];
    this.step = step;
    this.hideAlert();
    this.sync();
    this.swap(this.stepsBox, from, to, dir, this.form);
    this.focusHeading(to);
    this.saveDraft();
  }

  currentView() {
    const views = [this.form, this.doneView, this.revisitView];
    for (let i = 0; i < views.length; i += 1) {
      if (!views[i].hidden && !views[i].classList.contains('df-leaving')) return views[i];
    }
    return this.form;
  }

  showView(view, dir) {
    this.beginTransition();
    const from = this.currentView();
    this.markDone(view !== this.form);
    this.swap(this.views, from, view, dir, view);
    this.focusHeading(view);
  }

  showRevisit(last) {
    const first = clean(last.firstName).slice(0, 60);
    this.setTitle(this.revisitTitle, COPY.allSet(first), first);
    this.form.hidden = true;
    this.doneView.hidden = true;
    this.revisitView.hidden = false;
    this.markDone(true);
  }

  /** While the thank-you / "all set" card shows, page 3's own back link would just repeat the card's. */
  markDone(on) {
    if (this.screen) this.screen.classList.toggle('df-finished', on);
  }

  /** "Submit another response": a blank form, a fresh submissionId. */
  startOver() {
    if (this.busy) return;
    this.form.reset();
    this.f.company.value = '';
    [this.f.fullName, this.f.country, this.f.line1, this.f.line2, this.f.city, this.f.state, this.f.postal, this.f.married, this.f.song, this.f.artist]
      .forEach((el) => this.setError(el, ''));
    this.reveal(this.honestyReveal, false, false);
    this.reveal(this.songReveal, false, false);
    this.hideAlert();
    this.attempt = null;
    this.failures = 0;
    Object.keys(this.steps).forEach((key) => { this.steps[key].hidden = key !== 'name'; });
    this.step = 'name';
    this.updatePostalMode();
    this.sync();
    clearDraft();
    this.showView(this.form, -1);
  }

  /** Move focus to a heading without popping the keyboard (only ever after the guest acted). */
  focusHeading(scope) {
    const panel = scope === this.form ? this.steps[this.step] : scope;
    const heading = panel.querySelector('h2');
    if (!heading) return;
    try {
      heading.focus({ preventScroll: true });
    } catch (err) {
      heading.focus();
    }
  }

  /* ---------------------------------------------------------------- step changes: input lock, height, scroll */

  /** Start a step / view change: finish any running one, hold the page's height and lock input. */
  beginTransition() {
    this.transitionId += 1;
    this.settle(this.views);
    this.settle(this.stepsBox);
    this.stopScroll();
    this.holdPage();
    this.lockInput();
  }

  /**
   * Double-tap guard: for a moment after the form changes under the guest's finger, taps on it do nothing (CSS
   * .df-locked, plus the click guard in bind). Otherwise an impatient second tap lands on the next step: it ticks
   * "can't make it", skips a step, or pops up the keyboard. The keyboard needs no guard: focus moves to the new
   * heading, so a repeated Enter has nothing to press.
   */
  lockInput() {
    this.lockedUntil = now() + INPUT_LOCK_MS;
    this.card.classList.add('df-locked');
    window.clearTimeout(this.lockTimer);
    this.lockTimer = window.setTimeout(() => this.card.classList.remove('df-locked'), INPUT_LOCK_MS);
  }

  isLocked() {
    return now() < this.lockedUntil;
  }

  /**
   * Keep the page from getting shorter mid-change: as soon as one layout saw the shorter page, the browser would
   * clamp the scroll position on the spot, a lurch of up to a few hundred px for a guest scrolled down to the button.
   */
  holdPage() {
    if (this.holding) return;
    const doc = document.documentElement;
    doc.style.minHeight = `${doc.scrollHeight}px`;
    this.holding = true;
  }

  /** Let go of the page's height once the change in progress (`id`), and its scroll, has finished. */
  maybeRelease(id) {
    if (!this.holding || id !== this.transitionId) return;
    if (this.views.dfSwap || this.stepsBox.dfSwap || this.scrollAnim) return;
    document.documentElement.style.minHeight = '';
    this.holding = false;
  }

  /**
   * Where the window should be after a change: the top of the panel (progress, heading) and its button(s) both on
   * screen when they fit, moving as little as possible; the top of the panel when they don't; never past the bottom
   * of the page as it will end up. downOnly: only ever scroll down (to keep a button in view as a block opens).
   * anchor: the element to keep on screen instead of the top of the panel (the box just ticked), so a step taller
   * than the screen (big page zoom, landscape) still scrolls its button into view.
   */
  scrollTargetFor(view, downOnly, anchor) {
    const y = window.pageYOffset;
    const vh = window.innerHeight;
    const topEl = anchor || (view === this.form ? this.progress : view);
    const bottomEl = view === this.form ? this.actions : view.querySelector('.df-done-actions');
    const top = topEl.getBoundingClientRect().top + y - SCROLL_MARGIN;
    const bottom = bottomEl.getBoundingClientRect().bottom + y + SCROLL_MARGIN;
    const maxTop = document.body.offsetHeight - vh; // the page's height once it's let go (see holdPage)
    let target = Math.min(Math.max(y, bottom - vh), top);
    if (downOnly) target = Math.max(y, target);
    return Math.max(0, Math.min(Math.round(target), Math.floor(maxTop))); // whole pixels
  }

  /**
   * Scroll the window to `top` together with `driver`, the height animation it goes with: the scroll follows that
   * animation's own (eased) progress, so the two stay in step even when frames are dropped. Without a driver it runs
   * `duration` ms on `ease` (the same curve); instantly when duration is 0 (reduced motion).
   */
  scrollTo(top, duration, ease, driver) {
    this.stopScroll();
    const from = window.pageYOffset;
    if (Math.abs(top - from) < 1) return;
    if (!duration || typeof window.requestAnimationFrame !== 'function') {
      window.scrollTo(0, top);
      return;
    }
    const anim = { id: this.transitionId, to: top, raf: 0, start: null };
    const frame = (time) => {
      if (this.scrollAnim !== anim) return;
      if (anim.start === null) anim.start = time;
      let p = ease(Math.min(1, (time - anim.start) / duration));
      if (driver && driver.effect && typeof driver.effect.getComputedTiming === 'function') {
        const progress = driver.effect.getComputedTiming().progress;
        if (driver.playState === 'finished' || driver.playState === 'idle') p = 1;
        else if (typeof progress === 'number') p = progress;
      }
      window.scrollTo(0, from + (top - from) * p);
      if (p < 1) anim.raf = window.requestAnimationFrame(frame);
      else this.stopScroll();
    };
    this.scrollAnim = anim;
    anim.raf = window.requestAnimationFrame(frame);
  }

  stopScroll() {
    const anim = this.scrollAnim;
    if (!anim) return;
    this.scrollAnim = null;
    window.cancelAnimationFrame(anim.raf);
    this.maybeRelease(anim.id);
  }

  /**
   * Swap two panels inside `box` (call beginTransition() first): slide + fade, the box height easing between them
   * while the window scrolls along so the new heading and its button end up on screen.
   */
  swap(box, from, to, dir, view) {
    const id = this.transitionId;
    if (from === to) {
      to.hidden = false;
      this.maybeRelease(id);
      return;
    }
    // exact (fractional) heights, so nothing shifts by a sub-pixel when the animation hands over to the layout
    const startHeight = box.getBoundingClientRect().height;
    from.hidden = true;
    to.hidden = false;
    const endHeight = box.getBoundingClientRect().height; // a safe layout read: the page is held
    const motion = canAnimate() && !reducedMotion();
    const target = this.scrollTargetFor(view);
    // When the page scrolls along, height and scroll share a gentle ease-in-out (a move of a few hundred px shouldn't
    // start at full speed) and the card's bottom edge stays put; on its own, the height just eases out.
    const glide = Math.abs(target - window.pageYOffset) >= 1;
    const heightMs = glide ? GLIDE_MS : HEIGHT_MS;
    if (!motion) this.scrollTo(target, 0);
    if (!canAnimate()) {
      this.maybeRelease(id);
      return;
    }
    const anims = [];
    if (!motion) {
      anims.push(to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }));
    } else {
      const dx = 26 * (dir || 1);
      from.hidden = false;
      from.classList.add('df-leaving');
      from.setAttribute('aria-hidden', 'true');
      from.inert = true;
      box.classList.add('df-clip');
      // the old step clears out quickly so the two never visibly overlap; the new one glides in
      anims.push(from.animate(
        [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dx * 0.6}px)` }],
        { duration: 160, easing: 'ease', fill: 'forwards' },
      ));
      anims.push(to.animate(
        [{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 380, delay: 100, easing: EASE_OUT, fill: 'backwards' },
      ));
      let heightAnim = null;
      if (Math.abs(endHeight - startHeight) > 1) {
        heightAnim = box.animate([{ height: `${startHeight}px` }, { height: `${endHeight}px` }], { duration: heightMs, easing: glide ? EASE_IN_OUT : EASE_OUT });
        anims.push(heightAnim);
      }
      this.scrollTo(target, heightMs, easeInOut, heightAnim);
    }
    const record = {};
    record.cleanup = () => {
      if (box.dfSwap !== record) return;
      box.dfSwap = null;
      window.clearTimeout(record.timer);
      from.classList.remove('df-leaving');
      from.removeAttribute('aria-hidden');
      from.inert = false;
      from.hidden = true;
      box.classList.remove('df-clip');
      anims.forEach((a) => a.cancel());
      this.maybeRelease(id);
    };
    box.dfSwap = record;
    Promise.all(anims.map((a) => a.finished)).then(record.cleanup, record.cleanup);
    // safety net: never leave a half-swapped panel behind if a finished promise doesn't settle
    record.timer = window.setTimeout(record.cleanup, 1500);
  }

  settle(box) {
    if (box.dfSwap) box.dfSwap.cleanup();
  }

  /**
   * Expand / collapse a .df-reveal block (it only clips while animating, so focus rings stay visible). follow:
   * scroll along as it opens, so the button below stays on screen; an element (the box just ticked) also stays in view.
   */
  reveal(el, show, animate, follow) {
    if (el.dfAnim) {
      el.dfAnim.cancel();
      el.dfAnim = null;
    }
    el.classList.remove('is-animating');
    if (show === !el.hidden) return;
    const anchor = follow && follow.nodeType === 1 ? follow : null;
    if (animate === false || !canAnimate()) {
      el.hidden = !show;
      if (show && follow) this.scrollTo(this.scrollTargetFor(this.form, true, anchor), 0, easeOut);
      return;
    }
    const reduce = reducedMotion();
    let anim;
    if (show) {
      el.hidden = false;
      const h = el.getBoundingClientRect().height;
      const target = follow ? this.scrollTargetFor(this.form, true, anchor) : 0; // on the final layout, before the animation starts
      anim = el.animate(
        reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }],
        { duration: reduce ? 220 : REVEAL_MS, easing: EASE_OUT },
      );
      if (follow) this.scrollTo(target, reduce ? 0 : REVEAL_MS, easeOut, anim);
    } else {
      const h = el.getBoundingClientRect().height;
      anim = el.animate(
        reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: reduce ? 160 : 280, easing: EASE_IN_OUT, fill: 'forwards' },
      );
    }
    el.dfAnim = anim;
    el.classList.add('is-animating');
    anim.onfinish = () => {
      if (el.dfAnim !== anim) return;
      el.dfAnim = null;
      el.classList.remove('is-animating');
      if (!show) {
        el.hidden = true;
        anim.cancel();
      }
    };
  }

  /** Replay the current panel's entrance when page 3 is shown (never moves focus). */
  playEntrance() {
    if (!canAnimate()) return;
    this.settle(this.views);
    this.settle(this.stepsBox);
    this.entrance.forEach((a) => a.cancel());
    const view = this.currentView();
    const items = (view === this.form
      ? [this.progress].concat(Array.from(this.steps[this.step].children), [this.alert, this.actions])
      : Array.from(view.children)
    ).filter((el) => !el.hidden);
    const reduce = reducedMotion();
    const base = this.entranceDelay();
    this.entrance = items.map((el, i) => el.animate(
      reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: reduce ? 450 : 650, delay: base + i * 60, easing: EASE_OUT, fill: 'backwards' },
    ));
  }

  /** When the page animates the #details-form container in, cascade the contents just after it starts. */
  entranceDelay() {
    try {
      const cs = window.getComputedStyle(this.root);
      if (cs.animationName && cs.animationName !== 'none') {
        const first = String(cs.animationDelay || '0s').split(',')[0].trim();
        const ms = parseFloat(first) * (/ms$/.test(first) ? 1 : 1000);
        if (ms > 0 && ms < 3000) return ms + 120;
      }
    } catch (err) {
      /* fall back to the default */
    }
    return ENTRANCE_DELAY_MS;
  }

  /** Warm up the connections a reply will need (the web app answers through a redirect to googleusercontent.com). */
  preconnect() {
    if (this.preconnected) return;
    const endpoint = configuredEndpoint();
    if (!endpoint) return;
    this.preconnected = true;
    try {
      const origin = new URL(endpoint, window.location.href).origin;
      const origins = origin === 'https://script.google.com' ? [origin, 'https://script.googleusercontent.com'] : [origin];
      origins.forEach((href) => {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      });
    } catch (err) {
      /* not a valid URL: the reply itself will report the problem */
    }
  }

  /* ---------------------------------------------------------------- answers kept across a reload */

  /** Keep the answers in this tab, so a reload (or the phone dropping the tab while the guest looks up a ZIP code)
   *  doesn't wipe them. Includes the submission in flight, so a retry after a reload is still de-duplicated. */
  saveDraft() {
    const values = {};
    DRAFT_FIELDS.forEach((key) => { values[key] = this.f[key].value; });
    writeDraft({
      v: 1, at: new Date().toISOString(), step: this.step, cant: this.f.cant.checked, married: this.marriedValue(), values, attempt: this.attempt,
    });
  }

  /** Put a saved draft back, straight onto its step (no animation). */
  restoreDraft(draft) {
    const f = this.f;
    DRAFT_FIELDS.forEach((key) => {
      const value = draft.values[key];
      if (typeof value === 'string') f[key].value = value.slice(0, key === 'fullName' ? NAME_MAX : MAX_LEN);
    });
    f.cant.checked = draft.cant === true;
    this.radios.forEach((radio) => { radio.checked = radio.value === draft.married; });
    this.updatePostalMode();
    this.reveal(this.honestyReveal, f.cant.checked, false);
    this.reveal(this.songReveal, this.marriedValue() === 'yes', false);
    this.step = PATH_FULL.indexOf(draft.step) !== -1 ? draft.step : 'name';
    Object.keys(this.steps).forEach((key) => { this.steps[key].hidden = key !== this.step; });
    const a = draft.attempt;
    if (a && typeof a.id === 'string' && /^[0-9a-f-]{36}$/i.test(a.id) && typeof a.signature === 'string') {
      this.attempt = { id: a.id, signature: a.signature };
    }
  }

  /* ---------------------------------------------------------------- state -> UI */

  sync() {
    const path = this.f.cant.checked ? PATH_DECLINE : PATH_FULL;
    const index = Math.max(0, path.indexOf(this.step));
    const total = path.length;
    this.progressLabel.textContent = COPY.progress(index + 1, total);
    this.dots.forEach((dot, i) => {
      dot.classList.toggle('is-done', i < index);
      dot.classList.toggle('is-current', i === index);
      dot.classList.toggle('is-skipped', i >= total);
    });
    Object.keys(this.steps).forEach((key) => {
      const sr = this.steps[key].querySelector('.df-sr-step');
      const i = path.indexOf(key);
      sr.textContent = i >= 0 ? `${COPY.progress(i + 1, total)}: ` : '';
    });
    this.backBtn.hidden = this.step === 'name';
    this.backBtn.disabled = this.busy;
    this.nextLabel.textContent = this.primaryLabel();
    // "Tap Submit to send your reply." would contradict a button that now says "Try again"
    this.honestyNext.hidden = this.alertOn;
    this.nextBtn.classList.toggle('is-busy', this.busy);
    // aria-disabled (not disabled) keeps keyboard focus on the button while sending
    if (this.busy) this.nextBtn.setAttribute('aria-disabled', 'true');
    else this.nextBtn.removeAttribute('aria-disabled');
  }

  primaryLabel() {
    if (this.busy) return COPY.sending;
    if (this.alertOn) return COPY.tryAgain;
    if (this.step === 'married' || (this.step === 'cant' && this.f.cant.checked)) return COPY.submit;
    return COPY.continue;
  }

  announce(message) {
    this.statusToken += 1;
    const token = this.statusToken;
    this.status.textContent = '';
    if (!message) return;
    window.setTimeout(() => {
      if (token === this.statusToken) this.status.textContent = message;
    }, 60);
  }

  showAlert(message) {
    this.alertOn = true;
    this.alertText.textContent = message;
    this.alert.hidden = false;
  }

  hideAlert() {
    this.alertOn = false;
    this.alert.hidden = true;
    this.alertText.textContent = '';
  }

  /**
   * Show a thank-you title. A family name ("the Cappuccio Family!") goes in a .df-family inline-block: it moves to a
   * line of its own rather than leave "the" at the end of a line, and still wraps when it's wider than the card (a
   * no-break space would cut a long name mid-word at a big page zoom instead).
   */
  setTitle(el, text, first) {
    const at = /^the\s/i.test(first) ? text.lastIndexOf(first) : -1;
    el.textContent = at > 0 ? text.slice(0, at) : text;
    if (at > 0) {
      const family = document.createElement('span');
      family.className = 'df-family';
      family.textContent = text.slice(at);
      el.appendChild(family);
    }
  }

  /* ---------------------------------------------------------------- input handling */

  onKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'text') return;
    // In multi-field steps Enter walks down the fields; on the last one (or once everything is filled) it means Next.
    const fields = Array.from(this.steps[this.step].querySelectorAll('input.df-input')).filter((el) => !el.closest('[hidden]'));
    const i = fields.indexOf(t);
    if (i < 0 || i === fields.length - 1) return;
    const missingRequired = fields.some((el) => el.required && !el.value.trim());
    if (!missingRequired && fields[i + 1].value.trim()) return;
    e.preventDefault();
    fields[i + 1].focus();
  }

  onInput(e) {
    const t = e.target;
    if (t === this.f.country) {
      this.updatePostalMode();
      [this.f.state, this.f.postal].forEach((el) => {
        if (el.getAttribute('aria-invalid') === 'true') this.setError(el, this.check(el));
      });
    }
    // once a field has shown an error, re-check it as the guest types so the message clears right away
    // (text fields only: the Yes / No radios carry the group's error and are re-checked in onChange)
    if (t.classList && t.classList.contains('df-input') && t.getAttribute('aria-invalid') === 'true') this.setError(t, this.check(t));
    this.saveDraft();
  }

  onChange(e) {
    const t = e.target;
    if (t === this.f.cant) {
      const on = t.checked;
      this.hideAlert();
      this.sync();
      // as the message opens, bring Submit into view (without scrolling the box just ticked off the top)
      this.reveal(this.honestyReveal, on, true, on ? t.closest('.df-check') : false);
      this.announce(on ? `${COPY.honesty} ${COPY.honestyNext}` : '');
    } else if (t.name === 'married') {
      this.reveal(this.songReveal, this.marriedValue() === 'yes');
      if (this.f.married.getAttribute('aria-invalid') === 'true') this.setError(this.f.married, '');
      this.sync();
    } else if (t === this.f.country) {
      this.updatePostalMode();
    }
    this.saveDraft();
  }

  marriedValue() {
    for (let i = 0; i < this.radios.length; i += 1) if (this.radios[i].checked) return this.radios[i].value;
    return '';
  }

  /** ZIP vs. international postal code: keyboard, length, labels and whether State is required follow the country. */
  updatePostalMode() {
    const us = isUS(this.f.country.value);
    if (us === this.postalUS) return;
    this.postalUS = us;
    const postal = this.f.postal;
    postal.setAttribute('inputmode', us ? 'numeric' : 'text');
    postal.setAttribute('autocapitalize', us ? 'off' : 'characters');
    postal.maxLength = us ? 10 : 20;
    this.f.state.required = us; // many countries have no state or province line
    this.root.querySelector('#df-postal-label .df-label-text').textContent = us ? COPY.zip : COPY.postal;
    this.root.querySelector('#df-state-label .df-label-text').textContent = us ? COPY.state : COPY.stateIntl;
    this.root.querySelector('#df-state-label .df-optional').hidden = us;
    // the longer "State / Province (optional)" gets a row of its own (Country comes first, so this settles early)
    this.root.querySelector('.df-pair').classList.toggle('df-stack', !us);
  }

  /* ---------------------------------------------------------------- validation */

  fieldsFor(step) {
    const f = this.f;
    if (step === 'name') return [f.fullName];
    if (step === 'address') return [f.country, f.line1, f.line2, f.city, f.state, f.postal];
    if (step === 'married') return [f.married];
    return [];
  }

  /** Returns the error message for one field, or '' when it's fine. */
  check(el) {
    const f = this.f;
    if (el === f.married) return this.marriedValue() ? '' : ERRORS.married;
    const value = clean(el.value);
    const us = isUS(f.country.value);
    switch (el) {
      case f.fullName: return isFullName(el.value) ? '' : ERRORS.name;
      case f.line1: return value ? '' : ERRORS.line1;
      case f.city: return value ? '' : ERRORS.city;
      case f.state: return value || !us ? '' : ERRORS.state;
      case f.postal:
        if (!value) return us ? ERRORS.zip : ERRORS.postal;
        return !us || normalizeZip(value) ? '' : ERRORS.zipInvalid;
      case f.country: return value ? '' : ERRORS.country;
      default: return '';
    }
  }

  validateStep(step) {
    let firstInvalid = null;
    this.fieldsFor(step).forEach((el) => {
      const message = this.check(el);
      this.setError(el, message, true);
      if (message && !firstInvalid) firstInvalid = el;
    });
    if (!firstInvalid) return true;
    const target = firstInvalid === this.f.married ? this.radios[0] : firstInvalid;
    target.focus();
    return false;
  }

  setError(el, message, replay) {
    const error = this.root.querySelector(`#${el.id}-error`);
    const help = this.root.querySelector(`#${el.id}-help`);
    const wasInvalid = el.getAttribute('aria-invalid') === 'true';
    if (message) {
      error.querySelector('.df-error-text').textContent = message;
      error.hidden = false;
      if (replay || !wasInvalid) {
        error.classList.remove('is-new');
        void error.offsetWidth; // restart the CSS animation
        error.classList.add('is-new');
      }
      el.setAttribute('aria-invalid', 'true');
    } else {
      error.hidden = true;
      error.querySelector('.df-error-text').textContent = '';
      error.classList.remove('is-new');
      el.removeAttribute('aria-invalid');
    }
    const describedBy = [message ? error.id : '', help ? help.id : ''].filter(Boolean).join(' ');
    if (describedBy) el.setAttribute('aria-describedby', describedBy);
    else el.removeAttribute('aria-describedby');
    if (el === this.f.married) {
      // focus goes to a radio, so the radios carry the error too (screen readers read it there)
      this.radios.forEach((radio) => {
        if (message) {
          radio.setAttribute('aria-invalid', 'true');
          radio.setAttribute('aria-describedby', error.id);
        } else {
          radio.removeAttribute('aria-invalid');
          radio.removeAttribute('aria-describedby');
        }
      });
    }
  }

  /* ---------------------------------------------------------------- submitting */

  collect(cantMakeIt) {
    const f = this.f;
    const married = cantMakeIt ? null : this.marriedValue() === 'yes';
    const postal = clean(f.postal.value);
    return {
      action: 'submit',
      submissionId: '',
      fullName: clean(f.fullName.value, NAME_MAX),
      cantMakeIt,
      address: cantMakeIt ? null : {
        line1: clean(f.line1.value),
        line2: clean(f.line2.value),
        city: clean(f.city.value),
        state: clean(f.state.value),
        postalCode: (isUS(f.country.value) && normalizeZip(postal)) || postal,
        country: clean(f.country.value),
      },
      married,
      firstDanceSong: married ? clean(f.song.value) : '',
      firstDanceArtist: married ? clean(f.artist.value) : '',
      company: clean(f.company.value),
      clientTime: new Date().toISOString(),
    };
  }

  async submit(cantMakeIt) {
    if (this.busy) return;
    const payload = this.collect(cantMakeIt);
    // Same answers as a failed attempt -> same submissionId, so the sheet de-duplicates if it did arrive.
    // Edited answers count as a new reply.
    const signature = JSON.stringify(Object.assign({}, payload, { submissionId: '', clientTime: '' }));
    if (!this.attempt || this.attempt.signature !== signature) this.attempt = { id: uuid(), signature };
    payload.submissionId = this.attempt.id;
    this.saveDraft(); // with the attempt: a retry after a reload reuses the same submissionId

    this.busy = true;
    this.hideAlert();
    this.sync();
    this.announce(COPY.sendingStatus);

    const endpoint = configuredEndpoint();
    try {
      if (endpoint) {
        await postReply(endpoint, payload);
      } else if (isLocalPreview()) {
        console.info('[Share Details] Preview mode: formEndpoint in assets/js/config.js is empty, so this reply was not saved.', payload);
        await wait(PREVIEW_DELAY_MS);
      } else {
        // the live site without a formEndpoint: never pretend a reply was saved
        console.error('[Share Details] formEndpoint in assets/js/config.js is empty, so replies can’t be saved. Paste the Apps Script web app URL there (README.md, Google Sheets setup).');
        throw new SubmitError('config');
      }
    } catch (err) {
      this.busy = false;
      this.fail(err);
      return;
    }
    // outside the try: a problem showing the thank-you card must never be reported as a failed send
    this.busy = false;
    this.finish(payload, !endpoint);
  }

  finish(payload, preview) {
    const first = firstNameOf(payload.fullName);
    this.attempt = null;
    this.failures = 0;
    clearDraft();
    if (!preview) writeLastSubmission({ firstName: first, cantMakeIt: payload.cantMakeIt, at: new Date().toISOString() });
    this.setTitle(this.doneTitle, payload.cantMakeIt ? COPY.missYou(first) : COPY.thanks(first), first);
    this.doneText.textContent = payload.cantMakeIt ? COPY.declined : COPY.attending;
    this.doneNote.hidden = !preview;
    this.announce('');
    this.sync();
    this.showView(this.doneView, 1);
    this.burst(payload.cantMakeIt ? 'soft' : 'full');
  }

  fail(err) {
    this.failures += 1;
    const kind = err && err.kind ? err.kind : 'network';
    console.warn('[Share Details] The reply was not saved:', kind, err && (err.detail || err.message));
    let message = ERRORS[kind] || ERRORS.server;
    if (kind === 'validation') message = clean(err.detail).slice(0, 300) || ERRORS.validation;
    else if (this.failures >= 2 && kind !== 'config') message = `${message} ${ERRORS.persist}`;
    this.announce('');
    this.showAlert(message);
    this.sync();
    this.lockInput(); // "Submit" just became "Try again" under the guest's finger
    // the message pushes the button down: keep message + "Try again" on screen
    try {
      this.actions.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      /* very old browsers: skip */
    }
  }

  /* ---------------------------------------------------------------- celebration */

  burst(kind) {
    if (reducedMotion() || !canAnimate()) return;
    const view = this.currentView();
    const anchor = view.querySelector('.df-flourish') || view;
    const r = anchor.getBoundingClientRect();
    if (!r.width && !r.height) return; // page 3 isn't on screen
    // the page may still be scrolling to the card: start where the heart is about to be
    const shift = this.scrollAnim ? this.scrollAnim.to - window.pageYOffset : 0;
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2 - shift;
    const soft = kind === 'soft';
    const colors = soft
      ? ['var(--c-accent)', 'var(--c-mist)', 'var(--c-ink)', 'var(--df-cream)']
      : ['var(--c-accent)', 'var(--c-ink)', 'var(--c-mist)', 'var(--c-accent)', 'var(--c-accent-dark)', 'var(--df-cream)', 'var(--c-white)'];
    const count = soft ? 14 : 44;
    const layer = document.createElement('div');
    layer.className = 'df-burst';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < count; i += 1) {
      let type = 'confetti';
      if (soft || i % 6 === 0) type = 'heart';
      else if (i % 3 === 0) type = 'petal';
      const p = particle(type, colors[i % colors.length]);
      p.style.left = `${ox.toFixed(1)}px`;
      p.style.top = `${oy.toFixed(1)}px`;
      layer.appendChild(p);
      const start = 'translate(-50%, -50%) translate(0px, 0px) rotate(0deg) scale(0.3)';
      let frames;
      let duration;
      let delay = Math.random() * 90;
      if (soft) {
        // a gentle stream of hearts drifting up and fading, like a sigh
        const dx = (i / (count - 1) - 0.5) * 230 + (Math.random() * 2 - 1) * 24;
        const sway = (Math.random() * 2 - 1) * 22;
        const rise = 70 + Math.random() * 110;
        const tilt = (Math.random() * 2 - 1) * 26;
        frames = [
          { transform: start, opacity: 0 },
          { transform: `translate(-50%, -50%) translate(${(dx * 0.4 + sway).toFixed(1)}px, ${(-rise * 0.35).toFixed(1)}px) rotate(${(tilt * 0.4).toFixed(1)}deg) scale(1)`, opacity: 0.9, offset: 0.3 },
          { transform: `translate(-50%, -50%) translate(${dx.toFixed(1)}px, ${(-rise).toFixed(1)}px) rotate(${tilt.toFixed(1)}deg) scale(0.8)`, opacity: 0 },
        ];
        duration = 1500 + Math.random() * 500;
        delay = Math.random() * 420;
      } else {
        // a little fountain: up and out, a soft apex, then falling and spinning away
        const angle = ((-90 + (Math.random() * 2 - 1) * 72) * Math.PI) / 180;
        const speed = 120 + Math.random() * 170;
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed;
        const drop = 170 + Math.random() * 170;
        const spin = (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 380);
        frames = [
          { transform: start, opacity: 0, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
          { transform: `translate(-50%, -50%) translate(${(dx * 0.62).toFixed(1)}px, ${(dy * 0.62).toFixed(1)}px) rotate(${(spin * 0.25).toFixed(1)}deg) scale(1)`, opacity: 1, offset: 0.16 },
          { transform: `translate(-50%, -50%) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${(spin * 0.5).toFixed(1)}deg) scale(1)`, opacity: 1, offset: 0.42, easing: 'cubic-bezier(0.45, 0, 0.85, 0.6)' },
          { transform: `translate(-50%, -50%) translate(${(dx * 1.2).toFixed(1)}px, ${(dy + drop).toFixed(1)}px) rotate(${spin.toFixed(1)}deg) scale(0.85)`, opacity: 0 },
        ];
        duration = 1250 + Math.random() * 450;
      }
      p.animate(frames, { duration, delay, fill: 'both' });
    }
    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 2600);
  }
}

/* ------------------------------------------------------------------ boot */

function init() {
  const root = document.getElementById('details-form');
  if (!root || root.getAttribute('data-df-ready') === 'true') return;
  root.setAttribute('data-df-ready', 'true');
  try {
    new DetailsForm(root); // eslint-disable-line no-new
  } catch (err) {
    console.error('[Share Details] The form could not start.', err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
