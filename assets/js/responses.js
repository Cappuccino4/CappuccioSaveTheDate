/*
 * Guest responses — the couple's private page (responses.html, not linked from the site).
 *
 * Enter the ADMIN_PASSPHRASE you saved in Apps Script → every reply loads from the Google Sheet
 * (via the same web app the form posts to: { action: "list", passphrase }) → quick stats,
 * search + filters, a readable list, and a CSV download built right here in the browser.
 *
 * Privacy: the passphrase lives in memory and, so a refresh doesn't log you out, in this tab's
 * sessionStorage (gone when the tab closes). "Lock" forgets it immediately.
 * Safety: guest answers are only ever inserted with textContent — never parsed as HTML.
 * Open responses.html?demo to see the page with made-up sample replies.
 */

const SESSION_KEY = 'std:responsesPassphrase';
const TIMEOUT_MS = 20000;
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const COMBINING_MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Sheet header → field. Exact matches win, then prefixes, so renamed-but-similar headers still work.
const FIELDS = [
  ['submittedAt', ['submittedateasterntime', 'submittedat', 'timestamp']],
  ['fullName', ['fullname', 'name']],
  ['cantMakeIt', ['cantmakeit']],
  ['mailingAddress', ['mailingaddress']],
  ['line1', ['streetaddress', 'street', 'addressline1']],
  ['line2', ['aptsuite', 'apt', 'addressline2']],
  ['city', ['city']],
  ['state', ['stateprovince', 'state', 'province']],
  ['postalCode', ['zippostalcode', 'zipcode', 'zip', 'postalcode', 'postcode']],
  ['country', ['country']],
  ['married', ['married']],
  ['song', ['firstdancesong']],
  ['artist', ['firstdanceartist']],
  ['submissionId', ['submissionid']],
];

const FILTERS = {
  all: { test: () => true, file: 'responses' },
  mail: { test: (r) => r.hasAddress, file: 'mailing-list' },
  cant: { test: (r) => r.cant, file: 'cant-make-it' },
  married: { test: (r) => r.married === 'Yes', file: 'married' },
};

const MESSAGES = {
  EMPTY: 'Please enter your passphrase.',
  UNAUTHORIZED: 'That passphrase doesn’t match. Check for typos and try again.',
  RATE_LIMITED: 'Too many incorrect tries, so viewing is paused for about 15 minutes. ' +
    'Please try again later — your Google Sheet still has every reply.',
  DISABLED: 'Viewing responses here is turned off. To turn it on, open Apps Script → Project Settings → ' +
    'Script properties and add ADMIN_PASSPHRASE (see the README).',
  WEAK_PASSPHRASE: 'Viewing responses here is turned off: your ADMIN_PASSPHRASE is too short (or is an example ' +
    'from the README). Make up four random words — at least 16 characters — and save them as ADMIN_PASSPHRASE ' +
    'in Apps Script → Project Settings → Script properties. No need to redeploy.',
  NETWORK: 'Couldn’t reach your Google Apps Script. If your internet is working, open your /exec link in a ' +
    'private window — it should show {"ok":true,…}. A Google sign-in page there means “Who has access” ' +
    'isn’t set to “Anyone” (README → Troubleshooting).',
  TIMEOUT: 'Google is taking too long to answer. Please try again in a moment.',
  BAD_RESPONSE: 'Google sent back something unexpected. Make sure the web app is deployed with ' +
    '“Who has access: Anyone” and that config.js has the /exec URL (README → Troubleshooting).',
  OUTDATED: 'Your Apps Script didn’t recognize this request. Paste the latest Code.gs and deploy it as a ' +
    'New version (README → Updating the script).',
  SERVER: 'Something went wrong in your Apps Script. Check Executions in the Apps Script editor, then try again.',
};

const ICONS = {
  copy: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 3.5h-8a2 2 0 0 0-2 2v8"/></svg>',
  check: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.5 10.5l3.6 3.6 7.4-8"/></svg>',
};

class ListError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail || '';
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function headerKey(header) {
  return str(header).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fold(text) {
  return str(text).normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(/\s+/g, ' ');
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function readSession() {
  try { return window.sessionStorage.getItem(SESSION_KEY) || ''; } catch (err) { return ''; }
}
function writeSession(value) {
  try { window.sessionStorage.setItem(SESSION_KEY, value); } catch (err) { /* private mode: memory only */ }
}
function clearSession() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* nothing stored */ }
}

function endpoint() {
  const cfg = window.SAVE_THE_DATE_CONFIG;
  return cfg && typeof cfg.formEndpoint === 'string' ? cfg.formEndpoint.trim() : '';
}

/**
 * "2026-10-18 14:03:22" (Eastern, from the sheet) → "Oct 18 · 2:03 PM ET" (+ year if not this year).
 * No-break spaces keep "Oct 18" and "2:03 PM ET" in one piece; a narrow card wraps at the "·" instead.
 */
function formatSubmitted(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(str(text));
  if (!m) return str(text);
  const hour = Number(m[4]);
  const time = [`${hour % 12 || 12}:${m[5]}`, hour < 12 ? 'AM' : 'PM', 'ET'].join(NBSP);
  const year = Number(m[1]) === new Date().getFullYear() ? '' : `,${NBSP}${m[1]}`;
  return `${MONTHS[Number(m[2]) - 1]}${NBSP}${Number(m[3])}${year} · ${time}`;
}

function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isUnitedStates(country) {
  return ['us', 'usa', 'unitedstates', 'unitedstatesofamerica', 'america'].indexOf(str(country).toLowerCase().replace(/[^a-z]/g, '')) !== -1;
}

/* ───────────────────────────── data ───────────────────────────── */

function mapColumns(columns) {
  const keys = columns.map(headerKey);
  const taken = new Set();
  const map = {};
  const find = (test) => keys.findIndex((k, i) => !taken.has(i) && k !== '' && test(k));
  FIELDS.forEach(([field, names]) => {
    let index = -1;
    for (const name of names) { index = find((k) => k === name); if (index >= 0) break; }
    if (index < 0) for (const name of names) { index = find((k) => k.indexOf(name) === 0); if (index >= 0) break; }
    if (index >= 0) taken.add(index);
    map[field] = index;
  });
  return { map, taken };
}

function buildRecords(columns, rows) {
  const { map, taken } = mapColumns(columns);
  const records = rows.map((raw, index) => {
    // `raw` keeps every cell exactly as the sheet has it (for the CSV); `cells` is tidied for display.
    const exact = Array.isArray(raw) ? raw.map((v) => (v === undefined || v === null ? '' : String(v))) : [];
    const cells = exact.map(str);
    const get = (field) => (map[field] >= 0 ? cells[map[field]] || '' : '');
    const rec = {
      index,
      raw: exact,
      cells,
      submittedAt: get('submittedAt'),
      name: get('fullName'),
      cant: /^(yes|true|y)$/i.test(get('cantMakeIt')),
      mailingAddress: get('mailingAddress'),
      line1: get('line1'),
      line2: get('line2'),
      city: get('city'),
      state: get('state'),
      postalCode: get('postalCode'),
      country: get('country'),
      married: /^(yes|true|y)$/i.test(get('married')) ? 'Yes' : /^(no|false|n)$/i.test(get('married')) ? 'No' : '',
      song: get('song'),
      artist: get('artist'),
      extras: columns
        .map((label, i) => ({ label: str(label), value: str(cells[i]), i }))
        .filter((x) => !taken.has(x.i) && x.label !== '' && x.value !== ''),
    };
    rec.hasAddress = !rec.cant && Boolean(rec.line1 || rec.mailingAddress);
    rec.search = fold(cells.join(' '));
    rec.nameKey = fold(rec.name).replace(/[^a-z0-9 ]/g, '');
    return rec;
  });
  const counts = {};
  records.forEach((r) => { if (r.nameKey) counts[r.nameKey] = (counts[r.nameKey] || 0) + 1; });
  records.forEach((r) => { r.duplicate = Boolean(r.nameKey) && counts[r.nameKey] > 1; });
  return records;
}

function addressLines(rec) {
  if (!rec.line1) return rec.mailingAddress ? [rec.mailingAddress] : [];
  const lines = [rec.line2 ? `${rec.line1}, ${rec.line2}` : rec.line1];
  const cityLine = [rec.city, [rec.state, rec.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  if (rec.country) lines.push(rec.country);
  return lines;
}

/** A ready-to-paste mailing label (country left off for US addresses). */
function addressLabel(rec) {
  const lines = addressLines(rec);
  if (rec.line1 && rec.country && isUnitedStates(rec.country)) lines.pop();
  return [rec.name].concat(lines).filter(Boolean).join('\n');
}

/* ───────────────────────────── CSV ───────────────────────────── */

/** RFC 4180 field: quote when needed; a leading = + - @ tab or CR gets a ' so spreadsheets never run it as a formula. */
export function csvCell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** UTF-8 BOM (so Excel reads accents/emoji correctly) + CRLF line endings. */
export function toCsv(columns, rows) {
  return BOM + [columns].concat(rows).map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ───────────────────────────── network ───────────────────────────── */

async function fetchList(passphrase) {
  const url = endpoint();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  state.request = controller; // so Lock can cancel a request that's still loading
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; if (controller) controller.abort(); }, TIMEOUT_MS);
  try {
    let text = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // "simple" CORS request: no preflight
        body: JSON.stringify({ action: 'list', passphrase }),
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      text = await res.text();
    } catch (err) {
      throw new ListError(timedOut ? 'TIMEOUT' : 'NETWORK', err && err.message);
    }
    let data = null;
    try { data = JSON.parse(text); } catch (err) { throw new ListError('BAD_RESPONSE', text.slice(0, 200)); }
    if (!data || typeof data !== 'object') throw new ListError('BAD_RESPONSE');
    if (data.ok !== true) throw new ListError(str(data.code) || 'SERVER', str(data.error));
    if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) throw new ListError('BAD_RESPONSE');
    return data;
  } finally {
    window.clearTimeout(timer);
    if (state.request === controller) state.request = null;
  }
}

function messageFor(err) {
  const code = err && err.code;
  if (code === 'UNAUTHORIZED') {
    // The server adds "N tries left…" when it matters.
    return err.detail && /tries? left|paused/i.test(err.detail) ? err.detail : MESSAGES.UNAUTHORIZED;
  }
  // Set, but too short or copied from the README: the server keeps the page off and says why.
  if (code === 'DISABLED' && /too short|example/i.test(err.detail)) return MESSAGES.WEAK_PASSPHRASE;
  if (code === 'BAD_REQUEST' || code === 'VALIDATION') return MESSAGES.OUTDATED;
  return MESSAGES[code] || MESSAGES.SERVER;
}

/* ───────────────────────────── page ───────────────────────────── */

const els = {};
const state = {
  passphrase: '',
  columns: [],
  records: [],
  generatedAt: '',
  sheetUrl: '',
  totalRows: 0,      // rows in the Sheet; more than records.length when the server sent only the newest
  filter: 'all',
  sort: 'newest',
  query: '',
  busy: false,
  demo: false,
  session: 0,        // bumped by Lock, so a reply that arrives after locking is ignored
  request: null,     // AbortController of the list request in flight
};
let announceTimer = 0;
let enterTimer = 0;

function init() {
  Object.assign(els, {
    setup: $('#rs-setup'),
    login: $('#rs-login'),
    loginForm: $('#rs-login-form'),
    pass: $('#rs-pass'),
    reveal: $('#rs-reveal'),
    loginError: $('#rs-login-error'),
    loginErrorText: $('#rs-login-error .rs-error-text'),
    submit: $('#rs-submit'),
    dash: $('#rs-dash'),
    dashTitle: $('#rs-dash-title'),
    demoNote: $('#rs-demo'),
    updated: $('#rs-updated'),
    refresh: $('#rs-refresh'),
    lockBtn: $('#rs-lock'),
    banner: $('#rs-banner'),
    truncated: $('#rs-truncated'),
    statTotal: $('#rs-stat-total'),
    statMail: $('#rs-stat-mail'),
    statCant: $('#rs-stat-cant'),
    statMarried: $('#rs-stat-married'),
    search: $('#rs-search'),
    filters: Array.from(document.querySelectorAll('.rs-stat[data-filter]')),
    sort: $('#rs-sort'),
    sortFace: $('#rs-sort-face'),
    count: $('#rs-count'),
    download: $('#rs-download'),
    downloadNote: $('#rs-download-note'),
    list: $('#rs-list'),
    empty: $('#rs-empty'),
    emptyTitle: $('#rs-empty-title'),
    emptyText: $('#rs-empty-text'),
    clear: $('#rs-clear'),
    sheetLink: $('#rs-sheet-link'),
    live: $('#rs-live'),
  });
  if (!els.dash) return;

  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    login(els.pass.value.trim(), false);
  });
  els.reveal.addEventListener('click', () => {
    const show = els.pass.type === 'password';
    els.pass.type = show ? 'text' : 'password';
    setRevealLabel(show);
  });
  els.pass.addEventListener('input', () => hideLoginError());
  els.refresh.addEventListener('click', refresh);
  els.lockBtn.addEventListener('click', () => lock(''));
  els.search.addEventListener('input', () => { state.query = els.search.value; render(true); });
  els.search.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
  els.filters.forEach((button) => button.addEventListener('click', () => {
    // Tapping the active total again goes back to everything.
    state.filter = state.filter === button.dataset.filter ? 'all' : button.dataset.filter;
    render(true);
  }));
  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value;
    els.sortFace.textContent = els.sort.options[els.sort.selectedIndex].text;
    render(true);
  });
  els.download.addEventListener('click', downloadCsv);
  els.clear.addEventListener('click', () => {
    state.query = '';
    els.search.value = '';
    state.filter = 'all';
    render(true);
    els.search.focus();
  });
  els.list.addEventListener('click', onListClick);

  state.demo = new URLSearchParams(window.location.search).has('demo');
  if (state.demo) {
    showDashboard(demoData(), false);
    return;
  }
  if (!endpoint()) {
    showPanel('setup');
    return;
  }
  showPanel('login');
  const saved = readSession();
  if (saved) {
    els.pass.value = saved;
    login(saved, true);
  } else if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
    els.pass.focus();
  }
}

function showPanel(name) {
  els.setup.hidden = name !== 'setup';
  els.login.hidden = name !== 'login';
  els.dash.hidden = name !== 'dash';
  document.body.dataset.view = name;
}

/** The button names what a tap will do ("Show" / "Hide"), so it has no aria-pressed (that would read "Hide, pressed"). */
function setRevealLabel(shown) {
  els.reveal.textContent = shown ? 'Hide' : 'Show';
  els.reveal.setAttribute('aria-label', shown ? 'Hide passphrase' : 'Show passphrase');
}

function setBusy(busy, label) {
  state.busy = busy;
  els.submit.disabled = busy;
  els.submit.classList.toggle('is-busy', busy);
  els.submit.querySelector('.rs-submit-label').textContent = busy ? label : 'View responses';
  els.pass.readOnly = busy;
  els.loginForm.setAttribute('aria-busy', String(busy));
}

function showLoginError(message) {
  els.loginErrorText.textContent = message;
  els.loginError.hidden = false;
  els.pass.setAttribute('aria-invalid', 'true');
}

function hideLoginError() {
  els.loginError.hidden = true;
  els.pass.removeAttribute('aria-invalid');
}

async function login(passphrase, automatic) {
  if (state.busy) return;
  hideLoginError();
  if (!passphrase) {
    showLoginError(MESSAGES.EMPTY);
    els.pass.focus();
    return;
  }
  setBusy(true, automatic ? 'Loading…' : 'Opening…');
  const session = state.session;
  try {
    const data = await fetchList(passphrase);
    if (session !== state.session) return;
    state.passphrase = passphrase;
    writeSession(passphrase);
    showDashboard(data, true);
  } catch (err) {
    if (session !== state.session) return; // locked meanwhile: lock() has already reset the form
    clearSession();
    if (automatic) els.pass.value = '';
    showLoginError(messageFor(err));
    if (!automatic) {
      els.pass.focus();
      els.pass.select();
    }
  } finally {
    if (session === state.session) setBusy(false);
  }
}

async function refresh() {
  if (state.busy || state.demo || !state.passphrase) return;
  state.busy = true;
  els.refresh.disabled = true;
  els.refresh.classList.add('is-busy');
  els.updated.textContent = 'Refreshing…';
  const session = state.session;
  try {
    const data = await fetchList(state.passphrase);
    if (session !== state.session) return; // locked while loading: drop the data
    applyData(data);
    hideBanner();
    render(false);
    announce('Responses updated.');
  } catch (err) {
    if (session !== state.session) return;
    if (err.code === 'UNAUTHORIZED' || err.code === 'RATE_LIMITED' || err.code === 'DISABLED') {
      lock(messageFor(err));
    } else {
      showBanner(`Couldn’t refresh. ${messageFor(err)}`);
    }
  } finally {
    // After a Lock, lock() has already freed everything — and a newer sign-in may be busy by now.
    if (session === state.session) {
      state.busy = false;
      els.refresh.disabled = false;
      els.refresh.classList.remove('is-busy');
      updateStamp();
    }
  }
}

function lock(message) {
  state.session += 1;
  // Cancel a Refresh that's still loading instead of making the next sign-in wait for it.
  if (state.request) state.request.abort();
  state.request = null;
  setBusy(false);
  els.refresh.disabled = false;
  els.refresh.classList.remove('is-busy');
  state.passphrase = '';
  state.columns = [];
  state.records = [];
  state.totalRows = 0;
  clearSession();
  els.list.textContent = '';
  els.pass.value = '';
  els.pass.type = 'password';
  setRevealLabel(false);
  hideBanner();
  showPanel('login');
  if (message) showLoginError(message);
  else hideLoginError();
  els.pass.focus();
}

function applyData(data) {
  state.columns = data.columns.map(str);
  state.records = buildRecords(state.columns, data.rows);
  state.totalRows = Math.max(Number(data.totalRows) || 0, state.records.length);
  state.generatedAt = str(data.generatedAt);
  const sheetUrl = str(data.sheetUrl);
  state.sheetUrl = /^https:\/\/docs\.google\.com\//.test(sheetUrl) ? sheetUrl : '';
}

function showDashboard(data, focus) {
  applyData(data);
  showPanel('dash');
  els.demoNote.hidden = !state.demo;
  els.refresh.hidden = state.demo;
  els.lockBtn.hidden = state.demo;
  render(false);
  if (focus) els.dashTitle.focus({ preventScroll: false });
}

function updateStamp() {
  // keep "11:04 AM" on one line if the label has to wrap on a narrow phone
  const time = formatClock(state.generatedAt).replace(/\s+/g, NBSP);
  els.updated.textContent = state.demo ? 'Sample data' : time ? `Updated ${time}` : 'Updated just now';
}

function showBanner(message) {
  els.banner.querySelector('.rs-error-text').textContent = message;
  els.banner.hidden = false;
}
function hideBanner() {
  els.banner.hidden = true;
}

function announce(message, delay) {
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => { els.live.textContent = message; }, delay || 120);
}

/* ───────────────────────────── rendering ───────────────────────────── */

function visibleRecords() {
  const filter = FILTERS[state.filter] || FILTERS.all;
  const words = fold(state.query).split(' ').filter(Boolean);
  const list = state.records.filter((r) => filter.test(r) && words.every((w) => r.search.indexOf(w) !== -1));
  const byTime = (a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : a.index - b.index);
  if (state.sort === 'oldest') list.sort(byTime);
  else if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.index - b.index);
  else list.sort((a, b) => byTime(b, a));
  return list;
}

function render(fromControls) {
  const all = state.records;
  els.statTotal.textContent = String(all.length);
  els.statMail.textContent = String(all.filter((r) => r.hasAddress).length);
  els.statCant.textContent = String(all.filter((r) => r.cant).length);
  els.statMarried.textContent = String(all.filter((r) => r.married === 'Yes').length);
  updateStamp();
  els.sheetLink.hidden = !state.sheetUrl;
  if (state.sheetUrl) els.sheetLink.href = state.sheetUrl;
  // The server sends at most the last (newest) 2,000 rows of the Sheet (a safety limit against floods of junk).
  const truncated = state.totalRows > all.length;
  els.truncated.hidden = !truncated;
  els.truncated.textContent = truncated
    ? `This page shows only the last ${all.length.toLocaleString('en-US')} of the ${state.totalRows.toLocaleString('en-US')} ` +
      'rows in your Sheet (and so does Download CSV). Open the Google Sheet to see every reply.'
    : '';

  els.filters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));

  const shown = visibleRecords();
  const filtered = shown.length !== all.length;
  els.count.textContent = filtered
    ? `Showing ${shown.length} of ${plural(all.length, 'response', 'responses')}`
    : plural(all.length, 'response', 'responses');
  els.download.disabled = shown.length === 0;
  // Only worth saying when the CSV won't contain everything.
  els.downloadNote.hidden = !(filtered && shown.length);
  els.downloadNote.textContent = filtered && shown.length
    ? `The CSV will include just the ${plural(shown.length, 'response', 'responses')} shown.`
    : '';

  const fragment = document.createDocumentFragment();
  shown.forEach((rec, i) => fragment.appendChild(card(rec, i)));
  els.list.textContent = '';
  els.list.appendChild(fragment);
  // Entrance animation only when the list (re)loads, never while filtering or typing.
  window.clearTimeout(enterTimer);
  els.list.classList.toggle('is-entering', !fromControls);
  if (!fromControls) enterTimer = window.setTimeout(() => els.list.classList.remove('is-entering'), 1200);

  els.empty.hidden = shown.length > 0;
  if (!shown.length) {
    const searching = all.length > 0;
    els.emptyTitle.textContent = searching ? 'No matches' : 'No replies yet';
    els.emptyText.textContent = searching
      ? 'No responses match this search or filter.'
      : 'Once guests share their details, they’ll show up here (and in your Google Sheet) right away.';
    els.clear.hidden = !searching;
  }
  if (fromControls) announce(els.count.textContent, 700); // wait until typing pauses
}

function badge(text, kind, title) {
  const node = el('span', `rs-badge rs-badge--${kind}`, text);
  if (title) node.title = title;
  return node;
}

function detail(list, label, value) {
  if (!value) return;
  list.appendChild(el('dt', null, label));
  list.appendChild(el('dd', null, value));
}

function card(rec, position) {
  const item = el('li', 'rs-item');
  item.style.setProperty('--i', String(Math.min(position, 12)));
  const head = el('div', 'rs-item-head');
  head.appendChild(el('h3', 'rs-name', rec.name || 'No name given'));
  const badges = el('div', 'rs-badges');
  if (rec.cant) badges.appendChild(badge('Can’t make it', 'cant'));
  if (rec.duplicate) badges.appendChild(badge('Duplicate?', 'dup', 'Another reply has the same name'));
  if (badges.childNodes.length) head.appendChild(badges);
  item.appendChild(head);

  if (rec.cant) {
    item.appendChild(el('p', 'rs-note', 'Already knows they can’t make it — no address needed.'));
  } else {
    const lines = addressLines(rec);
    if (lines.length) {
      const address = el('p', 'rs-address');
      lines.forEach((line) => address.appendChild(el('span', null, line)));
      item.appendChild(address);
    }
  }

  const details = el('dl', 'rs-details');
  if (!rec.cant) {
    detail(details, 'Married', rec.married);
    if (rec.married === 'Yes' && (rec.song || rec.artist)) {
      detail(details, 'First dance', rec.song && rec.artist ? `“${rec.song}” — ${rec.artist}` : rec.song ? `“${rec.song}”` : rec.artist);
    }
  }
  rec.extras.forEach((x) => detail(details, x.label, x.value === 'TRUE' ? 'Yes' : x.value === 'FALSE' ? 'No' : x.value));
  if (details.childNodes.length) item.appendChild(details);

  const meta = el('div', 'rs-meta');
  meta.appendChild(el('span', 'rs-time', rec.submittedAt ? formatSubmitted(rec.submittedAt) : ''));
  if (rec.hasAddress) {
    const copy = el('button', 'rs-copy');
    copy.type = 'button';
    copy.dataset.index = String(rec.index);
    copy.innerHTML = `${ICONS.copy}<span>Copy address</span>`; // static markup only
    copy.setAttribute('aria-label', `Copy mailing address for ${rec.name || 'this guest'}`);
    meta.appendChild(copy);
  }
  item.appendChild(meta);
  return item;
}

async function onListClick(event) {
  const button = event.target.closest('.rs-copy');
  if (!button) return;
  const rec = state.records[Number(button.dataset.index)];
  if (!rec) return;
  const text = addressLabel(rec);
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }
  if (!copied) copied = legacyCopy(text);
  button.classList.toggle('is-done', copied);
  button.innerHTML = `${copied ? ICONS.check : ICONS.copy}<span></span>`; // static markup only
  button.querySelector('span').textContent = copied ? 'Copied' : 'Couldn’t copy';
  announce(copied ? `Copied the address for ${rec.name || 'this guest'}.` : 'Couldn’t copy automatically. Select the address and copy it instead.');
  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.classList.remove('is-done');
    button.innerHTML = `${ICONS.copy}<span>Copy address</span>`;
  }, 1800);
}

function legacyCopy(text) {
  const area = el('textarea', 'rs-offscreen');
  area.value = text;
  area.setAttribute('readonly', '');
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  area.remove();
  return ok;
}

function downloadCsv() {
  const shown = visibleRecords();
  if (!shown.length) return;
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const filter = FILTERS[state.filter] || FILTERS.all;
  const name = `austin-kelsey-${state.query.trim() ? 'search' : filter.file}-${stamp}.csv`;
  const width = state.columns.length;
  const rows = shown.map((r) => {
    const cells = r.raw.slice(0, width);
    while (cells.length < width) cells.push('');
    return cells;
  });
  downloadText(name, toCsv(state.columns, rows));
  announce(`Downloading ${plural(rows.length, 'response', 'responses')} as ${name}.`);
}

/* ───────────────────────────── demo ───────────────────────────── */

function demoData() {
  const columns = ['Submitted At (Eastern time)', 'Full Name', 'Can\'t Make It', 'Mailing Address', 'Street Address',
    'Apt / Suite', 'City', 'State / Province', 'ZIP / Postal Code', 'Country', 'Married', 'First Dance Song',
    'First Dance Artist', 'Submission ID'];
  const row = (at, name, cant, line1, line2, city, st, zip, country, married, song, artist) => {
    const mailing = cant ? '' : [line1, line2, city, [st, zip].filter(Boolean).join(' '), country].filter(Boolean).join(', ');
    return [at, name, cant ? 'Yes' : 'No', mailing, line1, line2, city, st, zip, country, married, song, artist, `demo-${name.length}${at.slice(-2)}`];
  };
  const y = new Date().getFullYear();
  return {
    ok: true,
    columns,
    rows: [
      row(`${y}-01-04 09:12:40`, 'Margaret & Tom Whitfield', false, '18 Orchard Lane', '', 'Concord', 'MA', '01742', 'United States', 'Yes', 'At Last', 'Etta James'),
      row(`${y}-01-04 11:30:02`, 'Priya Raman', false, '450 W 42nd St', 'Apt 31C', 'New York', 'NY', '10036', 'United States', 'No', '', ''),
      row(`${y}-01-05 18:47:15`, 'Uncle Joe Cappuccio', true, '', '', '', '', '', '', '', '', ''),
      row(`${y}-01-06 08:05:51`, 'Chloé & Marc Dubois', false, '12 Rue de la Paix', '', 'Paris', 'Île-de-France', '75002', 'France', 'Yes', 'La Vie en Rose', 'Édith Piaf'),
      row(`${y}-01-07 20:22:09`, 'Sam Patel', false, '77 Harbor View Rd', 'Unit 2', 'Portland', 'ME', '04101', 'United States', 'Yes', 'Perfect', 'Ed Sheeran'),
      row(`${y}-01-08 13:14:33`, 'Grandma Rose', false, '9 Willow Ct', '', 'Hartford', 'CT', '06105', 'United States', 'Yes', 'Can’t Help Falling in Love', 'Elvis Presley'),
    ],
    generatedAt: new Date().toISOString(),
    sheetUrl: '',
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
