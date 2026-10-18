/** @OnlyCurrentDoc */

/*
 * Austin & Kelsey Grace · Save the Date — guest response collector
 * =================================================================
 *
 * A tiny Google Apps Script web app. Every "Share your details" reply from the
 * website becomes one row in the "Responses" tab of this Google Sheet.
 * Guests don't need a Google account, and nothing is stored anywhere else.
 *
 * ONE-TIME SETUP (README.md walks through every click):
 *   1. In the Google Sheet: Extensions → Apps Script. Replace everything in
 *      Code.gs with this file, then click Save.
 *   2. Choose "setup" in the function menu at the top of the editor → Run →
 *      approve access. (If Google says it "hasn't verified this app", that's because
 *      this is your own private script: Advanced → Go to … (unsafe) → tick the boxes → Continue.)
 *      setup also saves this Sheet's ID as the SPREADSHEET_ID script property — leave it there.
 *   3. Deploy → New deployment → Select type: Web app →
 *      Execute as: Me · Who has access: Anyone → Deploy.
 *   4. Copy the Web app URL (it ends in /exec) into assets/js/config.js
 *      as formEndpoint, then commit & push.
 *
 * OPTIONAL — see replies on responses.html:
 *   Project Settings (gear icon) → Script properties → Add script property →
 *   Property: ADMIN_PASSPHRASE · Value: four random words you make up yourselves (at least
 *   16 characters). A shorter one, or an example copied from the README, keeps the page turned off.
 *
 * CHANGED THIS CODE LATER?
 *   Deploy → Manage deployments → pencil (Edit) → Version: New version → Deploy.
 *   The web app URL stays the same, so the website needs no changes.
 *
 * API (JSON in, JSON out; Apps Script always answers HTTP 200, so check "ok"):
 *   GET                         → { ok: true, service: "save-the-date", version: 1 }
 *                                 (or { ok: false, … } if the script can't open this Sheet)
 *   POST { action: "submit" … } → { ok: true, submissionId, duplicate }
 *   POST { action: "list", passphrase }
 *                               → { ok: true, columns, rows, generatedAt, sheetUrl, truncated, totalRows }
 *   Errors                      → { ok: false, code, error }
 *     code: VALIDATION | BAD_REQUEST | SERVER | DISABLED | UNAUTHORIZED | RATE_LIMITED
 */

const SERVICE_NAME = 'save-the-date';
const SERVICE_VERSION = 1;

const SETTINGS = Object.freeze({
  sheetName: 'Responses',
  filteredSheetName: 'Filtered',           // replies caught by the hidden anti-spam field (see filtered_)
  timeZone: 'America/New_York',
  timestampPattern: 'yyyy-MM-dd HH:mm:ss', // sorts correctly as text
  maxRequestChars: 20000,                  // a real reply is well under 2,000
  maxTextChars: 200,                       // per answer (the form stops at 200 for the name, 120 for the rest)
  maxPostalChars: 40,
  maxPassphraseChars: 500,
  lockWaitMs: 15000,
  spreadsheetIdProperty: 'SPREADSHEET_ID', // saved by setup(), see activeSpreadsheet_
  passphraseProperty: 'ADMIN_PASSPHRASE',
  minPassphraseChars: 16,                  // anything shorter is too easy to guess: the page stays off
  maxWrongPassphrases: 5,                  // after 5 wrong tries…
  pauseMinutes: 15,                        // …viewing pauses for 15 minutes
  wrongPassphraseDelayMs: 800,
  failureCacheKey: 'std:wrong-passphrases',
  // Safety brakes against scripted junk (the web app URL is public). A real wedding never gets close.
  maxRepliesPerWindow: 120,                // new replies accepted per 10 minutes…
  replyWindowMinutes: 10,
  replyCountCacheKey: 'std:new-replies:',
  maxReplyRows: 3000,                      // …and in total
  maxFilteredRows: 500,
  maxListRows: 2000,                       // responses.html gets at most the newest 2,000 rows
  headerTextColor: '#31505e',
  headerFillColor: '#d6dee3',
  tabColor: '#839aad',
  filteredTabColor: '#b4c3ce',
});

// Sheet columns, in order. "key" is internal; "header" is what you see in row 1.
const COLUMNS = Object.freeze([
  { key: 'submittedAt', header: 'Submitted At (Eastern time)', width: 170 },
  { key: 'fullName', header: 'Full Name', width: 190 },
  { key: 'cantMakeIt', header: "Can't Make It", width: 115 },
  { key: 'mailingAddress', header: 'Mailing Address', width: 380 },
  { key: 'line1', header: 'Street Address', width: 200 },
  { key: 'line2', header: 'Apt / Suite', width: 110 },
  { key: 'city', header: 'City', width: 130 },
  { key: 'state', header: 'State / Province', width: 130 },
  { key: 'postalCode', header: 'ZIP / Postal Code', width: 130 },
  { key: 'country', header: 'Country', width: 130 },
  { key: 'married', header: 'Married', width: 85 },
  { key: 'firstDanceSong', header: 'First Dance Song', width: 190 },
  { key: 'firstDanceArtist', header: 'First Dance Artist', width: 170 },
  { key: 'submissionId', header: 'Submission ID', width: 300 },
]);

// The "Filtered" tab: the same columns in the same order (so a real guest's row can be copied straight into
// Responses), plus whatever was typed into the hidden anti-spam field at the end.
const FILTERED_COLUMNS = Object.freeze(COLUMNS.concat([{ key: 'company', header: 'Hidden Field Value', width: 160 }]));

// Example passphrases that were ever printed in the README. The README is public, so these never count.
const PUBLIC_EXAMPLE_PASSPHRASES = Object.freeze(['maple-lantern-violin-harbor']);

const WEAK_PASSPHRASE = 'ADMIN_PASSPHRASE is too short (or is an example from the README) — make up four ' +
  'random words, at least ' + SETTINGS.minPassphraseChars + ' characters, and save them as ADMIN_PASSPHRASE ' +
  'in Project Settings → Script properties.';

const MESSAGES = Object.freeze({
  badRequest: "Sorry, we couldn't read that reply. Please try again.",
  busy: "We're receiving a lot of replies right now. Please try again in a moment.",
  server: 'Sorry, something went wrong on our side. Please try again in a moment.',
  noSheet: "The script is running but can't open its Google Sheet. See Troubleshooting in the README.",
  disabled: 'Viewing responses here is turned off. To turn it on, add an ADMIN_PASSPHRASE ' +
    'script property in Apps Script (see the README).',
  weakPassphrase: 'Viewing responses here is turned off: ' + WEAK_PASSPHRASE,
  unauthorized: "That passphrase doesn't match.",
  rateLimited: 'Too many incorrect passphrases. For safety, viewing is paused for about ' +
    SETTINGS.pauseMinutes + ' minutes. Please try again later.',
});

/* ────────────────────────────── Entry points ────────────────────────────── */

/**
 * Health check: open the /exec URL in a browser to confirm the deployment works.
 * It also makes sure the script can open its Sheet (read-only), so a permissions
 * problem shows up here instead of when guests reply.
 */
function doGet() {
  try {
    activeSpreadsheet_().getName();
    return json_({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION });
  } catch (err) {
    console.error('Save the Date: health check could not open the spreadsheet. ' +
      (err && err.stack ? err.stack : String(err)));
    return json_(failure_('SERVER', MESSAGES.noSheet));
  }
}

/** All website traffic: { action: "submit" } from the form, { action: "list" } from responses.html. */
function doPost(e) {
  try {
    const request = parseRequest_(e);
    if (request.action === 'submit') return json_(submit_(request));
    if (request.action === 'list') return json_(list_(request));
    return json_(failure_('BAD_REQUEST', MESSAGES.badRequest));
  } catch (err) {
    if (err && err.isClientError) return json_(failure_(err.code, err.message));
    // Details go to the Executions log (for you), never to the browser.
    console.error('Save the Date: unexpected error. ' + (err && err.stack ? err.stack : String(err)));
    return json_(failure_('SERVER', MESSAGES.server));
  }
}

/**
 * Run this once from the Apps Script editor (function menu → setup → Run).
 * It creates the "Responses" tab with its header row, saves this Sheet's ID (SPREADSHEET_ID)
 * and triggers the permission prompt. Safe to run again at any time — it never touches existing replies.
 */
function setup() {
  const spreadsheet = activeSpreadsheet_();
  ensureHeader_(responsesSheet_(spreadsheet));
  // Lets the web app find this Sheet even if Google ever stops handing it over (see activeSpreadsheet_).
  PropertiesService.getScriptProperties().setProperty(SETTINGS.spreadsheetIdProperty, spreadsheet.getId());
  console.log('All set: the "' + SETTINGS.sheetName + '" tab in "' + spreadsheet.getName() +
    '" is ready for replies.');
  const passphrase = adminPassphrase_(); // only its status is ever logged, never the value
  if (!passphrase) console.log('Optional: add an ADMIN_PASSPHRASE script property to use responses.html.');
  else if (isWeakPassphrase_(passphrase)) console.warn('responses.html stays turned off: ' + WEAK_PASSPHRASE);
  else console.log('ADMIN_PASSPHRASE is set, so responses.html can show replies.');
  console.log('Next: Deploy → New deployment → Web app (Execute as: Me · Who has access: Anyone), ' +
    'then paste the /exec URL into assets/js/config.js.');
}

/* ─────────────────────────────── Submit ─────────────────────────────── */

function submit_(data) {
  // Honeypot: the form has a hidden "company" field that people never see. Bots fill it in.
  if (isFilled_(data.company)) return filtered_(data);

  const record = validateSubmission_(data);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SETTINGS.lockWaitMs)) throw clientError_('SERVER', MESSAGES.busy);
  try {
    const sheet = responsesSheet_(activeSpreadsheet_());
    const layout = ensureHeader_(sheet);
    const existing = scanRows_(sheet, layout);
    // Already saved? Then this is a retry (e.g. the guest's connection dropped) — still a success.
    const duplicate = existing.ids.indexOf(record.submissionId) !== -1;
    if (!duplicate) {
      claimReplyBudget_(existing.lastRow - 1); // refuses ("busy") during a flood of scripted replies
      writeRow_(sheet, layout, existing.lastRow + 1, rowValues_(record, new Date()));
    }
    SpreadsheetApp.flush(); // commit before releasing the lock so the next writer sees this row
    return { ok: true, submissionId: record.submissionId, duplicate: duplicate };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Honeypot hit: the hidden "company" field was filled in, so this is almost certainly a bot. It never
 * reaches Responses, but a tidy copy goes to the "Filtered" tab (at most maxFilteredRows), so a real
 * guest caught by mistake (say, by an autofill extension) can still be found and copied over by hand.
 * The sender gets the normal "thank you" either way.
 */
function filtered_(data) {
  const record = validateSubmission_(data, true); // tidied and shortened, never refused
  const result = { ok: true, submissionId: record.submissionId, duplicate: false };
  const isFull = function (rows) {
    if (rows < SETTINGS.maxFilteredRows) return false;
    console.info('A reply with the hidden anti-spam field filled in was dropped: the "' +
      SETTINGS.filteredSheetName + '" tab already holds ' + rows + ' rows.');
    return true;
  };
  const spreadsheet = activeSpreadsheet_();
  const known = spreadsheet.getSheetByName(SETTINGS.filteredSheetName);
  if (known && isFull(known.getLastRow() - 1)) return result; // quick check, without the lock

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SETTINGS.lockWaitMs)) throw clientError_('SERVER', MESSAGES.busy);
  try {
    const sheet = filteredSheet_(spreadsheet);
    const layout = ensureHeader_(sheet, FILTERED_COLUMNS);
    const existing = scanRows_(sheet, layout);
    result.duplicate = existing.ids.indexOf(record.submissionId) !== -1;
    if (!result.duplicate && !isFull(existing.lastRow - 1)) {
      const values = rowValues_(record, new Date());
      values.company = cleanText_(String(data.company)).slice(0, SETTINGS.maxTextChars);
      writeRow_(sheet, layout, existing.lastRow + 1, values);
      console.info('A reply with the hidden anti-spam field filled in went to the "' +
        SETTINGS.filteredSheetName + '" tab instead of Responses.');
    }
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Checks and tidies a reply. With `lenient` (honeypot copies only) nothing is ever refused:
 * overlong answers are shortened and missing ones stay blank.
 */
function validateSubmission_(data, lenient) {
  const max = SETTINGS.maxTextChars;
  const text = function (value, label, limit) {
    return lenient ? cleanText_(value).slice(0, limit) : textField_(value, label, limit);
  };
  const refuse = function (message) {
    if (!lenient) throw clientError_('VALIDATION', message);
  };
  const record = {
    submissionId: cleanId_(data.submissionId) || Utilities.getUuid(),
    fullName: text(data.fullName, 'name', max),
    cantMakeIt: toBoolean_(data.cantMakeIt) === true,
    line1: '', line2: '', city: '', state: '', postalCode: '', country: '',
    married: null, firstDanceSong: '', firstDanceArtist: '',
  };
  if (!record.fullName) refuse('Please enter your full name.');

  // "I already know I can't make it" is the whole answer — nothing else is stored.
  if (record.cantMakeIt) return record;

  const address = data.address;
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    refuse('Please add your mailing address so we can send your invitation.');
    return record;
  }
  record.line1 = text(address.line1, 'street address', max);
  record.line2 = text(address.line2, 'apartment or suite', max);
  record.city = text(address.city, 'city', max);
  record.state = text(address.state, 'state or province', max);
  record.postalCode = text(address.postalCode, 'ZIP or postal code', SETTINGS.maxPostalChars);
  record.country = text(address.country, 'country', max) || 'United States';
  // Judged on the country exactly as sent (blank = United States), i.e. the same text the form judged.
  const unitedStates = isUnitedStates_(isFilled_(address.country) ? address.country : record.country);

  if (!record.line1) refuse('Please enter your street address.');
  if (!record.city) refuse('Please enter your city.');
  // Only US addresses need a state: many countries (the UK, Ireland, France…) don't have one.
  if (unitedStates && !record.state) refuse('Please enter your state.');
  if (!record.postalCode) refuse('Please enter your ZIP or postal code.');
  if (unitedStates && record.postalCode) {
    const zip = /^(\d{5})(?:[-\s]?(\d{4}))?$/.exec(record.postalCode);
    if (zip) record.postalCode = zip[2] ? zip[1] + '-' + zip[2] : zip[1];
    else refuse('Please enter a valid 5-digit ZIP code.');
  }

  record.married = toBoolean_(data.married); // true, false, or null (unanswered)
  if (record.married === true) {
    record.firstDanceSong = text(data.firstDanceSong, 'first dance song', max);
    record.firstDanceArtist = text(data.firstDanceArtist, 'first dance artist', max);
  }
  return record;
}

/**
 * Safety brake against scripted junk (the web app URL is public): at most maxRepliesPerWindow new
 * replies per replyWindowMinutes, and maxReplyRows in total — far more than any wedding needs.
 * Over the limit the guest sees the friendly "busy" message (their answers stay in the form) and the
 * reason goes to Executions. Call it while holding the lock.
 * The per-window count lives in CacheService. If Google's cache ever fails, the reply goes through uncounted
 * (with a warning in Executions): the brake must never turn a real guest away by itself. The total needs no cache.
 */
function claimReplyBudget_(replyRows) {
  if (replyRows >= SETTINGS.maxReplyRows) {
    console.error('Save the Date: refused a new reply because the "' + SETTINGS.sheetName + '" tab already has ' +
      replyRows + ' rows (the limit is ' + SETTINGS.maxReplyRows + '). Delete junk rows to accept replies again.');
    throw clientError_('SERVER', MESSAGES.busy);
  }
  const uncounted = function (err) {
    console.warn('Save the Date: accepted a new reply without counting it toward the ' + SETTINGS.replyWindowMinutes +
      "-minute limit, because Google's CacheService failed (" + (err && err.message ? err.message : String(err)) +
      '). Harmless: that limit only exists to stop floods of junk.');
  };
  const windowSeconds = SETTINGS.replyWindowMinutes * 60;
  const key = SETTINGS.replyCountCacheKey + Math.floor(Date.now() / (windowSeconds * 1000));
  let cache;
  let count;
  try {
    cache = CacheService.getScriptCache();
    count = Number(cache.get(key)) || 0;
  } catch (err) {
    uncounted(err);
    return; // the count is unknown, so don't overwrite it either
  }
  if (count >= SETTINGS.maxRepliesPerWindow) {
    console.error('Save the Date: refused a new reply: ' + count + ' new replies arrived within ' +
      SETTINGS.replyWindowMinutes + ' minutes, far more than a wedding gets. If they are junk, delete them in ' +
      'the Sheet (README → Privacy & safety). Replies are accepted again within ' + SETTINGS.replyWindowMinutes +
      ' minutes.');
    throw clientError_('SERVER', MESSAGES.busy);
  }
  try {
    cache.put(key, String(count + 1), windowSeconds + 300); // outlives its window a little
  } catch (err) {
    uncounted(err);
  }
}

function rowValues_(record, now) {
  return {
    submittedAt: Utilities.formatDate(now, SETTINGS.timeZone, SETTINGS.timestampPattern),
    fullName: record.fullName,
    cantMakeIt: record.cantMakeIt ? 'Yes' : 'No',
    mailingAddress: record.cantMakeIt ? '' : formatAddress_(record),
    line1: record.line1,
    line2: record.line2,
    city: record.city,
    state: record.state,
    postalCode: record.postalCode,
    country: record.country,
    married: record.married === true ? 'Yes' : record.married === false ? 'No' : '',
    firstDanceSong: record.firstDanceSong,
    firstDanceArtist: record.firstDanceArtist,
    submissionId: record.submissionId,
  };
}

/** "123 Main St, Apt 4B, Boston, MA 02134, United States" */
function formatAddress_(record) {
  const stateZip = [record.state, record.postalCode].filter(Boolean).join(' ');
  return [record.line1, record.line2, record.city, stateZip, record.country].filter(Boolean).join(', ');
}

/* ──────────────────────────── Sheet helpers ──────────────────────────── */

/**
 * This script's own Sheet. Normally Google hands it over directly (getActiveSpreadsheet, which needs only
 * the narrow "this spreadsheet only" permission). Google's docs say web apps may not get it, so if it ever
 * comes back empty, fall back to the ID that setup() saved. openById needs the broader "spreadsheets"
 * permission: README → Troubleshooting explains the switch.
 */
function activeSpreadsheet_() {
  let problem = 'getActiveSpreadsheet() returned nothing';
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (err) {
    problem = 'getActiveSpreadsheet() failed (' + (err && err.message ? err.message : String(err)) + ')';
  }
  const id = PropertiesService.getScriptProperties().getProperty(SETTINGS.spreadsheetIdProperty);
  if (!id) {
    throw new Error("Couldn't open this script's Google Sheet: " + problem + ', and no ' +
      SETTINGS.spreadsheetIdProperty + ' script property has been saved yet. Run setup once in the Apps Script ' +
      'editor (open it from your Sheet: Extensions → Apps Script), then see Troubleshooting in the README.');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error("Couldn't open this script's Google Sheet: " + problem + ', and opening it by its saved ' +
      SETTINGS.spreadsheetIdProperty + ' failed too (' + (err && err.message ? err.message : String(err)) +
      '). See Troubleshooting in the README.');
  }
}

/** The "Responses" tab — created on first use (a brand-new, empty "Sheet1" is simply renamed). */
function responsesSheet_(spreadsheet) {
  const existing = spreadsheet.getSheetByName(SETTINGS.sheetName);
  if (existing) return existing;
  const sheets = spreadsheet.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0 && sheets[0].getLastColumn() === 0) {
    return sheets[0].setName(SETTINGS.sheetName);
  }
  return spreadsheet.insertSheet(SETTINGS.sheetName, 0);
}

/** The "Filtered" tab (after all the others) — created the first time the honeypot catches something. */
function filteredSheet_(spreadsheet) {
  const existing = spreadsheet.getSheetByName(SETTINGS.filteredSheetName);
  if (existing) return existing;
  const sheet = spreadsheet.insertSheet(SETTINGS.filteredSheetName, spreadsheet.getSheets().length);
  writeHeader_(sheet, FILTERED_COLUMNS);
  sheet.setTabColor(SETTINGS.filteredTabColor);
  return sheet;
}

/**
 * Makes sure row 1 holds our headers and returns where each column lives.
 * Columns are matched by header text, so you can reorder columns or add your own
 * (e.g. an "Invitation mailed" checkbox) — new replies still land in the right place.
 * `columns` defaults to the Responses columns (FILTERED_COLUMNS for the Filtered tab).
 */
function ensureHeader_(sheet, columns) {
  const fields = columns || COLUMNS;
  let headers = readHeader_(sheet);
  if (headers.every(function (h) { return h === ''; })) {
    writeHeader_(sheet, fields);
    headers = fields.map(function (c) { return c.header; });
  }

  const present = headers.map(headerKey_);
  const missing = fields.filter(function (c) { return present.indexOf(headerKey_(c.header)) === -1; });
  if (missing.length) {
    // A column was renamed or deleted: add it back at the end so no answer is ever lost.
    let start = headers.length;
    while (start > 0 && headers[start - 1] === '') start--;
    start += 1;
    ensureColumnCount_(sheet, start + missing.length - 1);
    sheet.getRange(1, start, 1, missing.length)
      .setNumberFormat('@')
      .setValues([missing.map(function (c) { return c.header; })])
      .setFontWeight('bold')
      .setFontColor(SETTINGS.headerTextColor)
      .setBackground(SETTINGS.headerFillColor)
      .setVerticalAlignment('middle');
    missing.forEach(function (c, i) { headers[start - 1 + i] = c.header; });
    for (let i = 0; i < headers.length; i++) if (headers[i] === undefined) headers[i] = '';
  }
  return layoutFor_(headers, fields);
}

function readHeader_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function (h) {
    return String(h).trim();
  });
}

function writeHeader_(sheet, columns) {
  const fields = columns || COLUMNS;
  const width = fields.length;
  ensureColumnCount_(sheet, width);
  sheet.getRange(1, 1, 1, width)
    .setNumberFormat('@')
    .setValues([fields.map(function (c) { return c.header; })])
    .setFontWeight('bold')
    .setFontColor(SETTINGS.headerTextColor)
    .setBackground(SETTINGS.headerFillColor)
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);
  fields.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c.width); });
  // Plain text (@) for every answer cell: ZIP codes keep their leading zeros and
  // nothing a guest types is ever turned into a number, date or formula.
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, width).setNumberFormat('@');
  sheet.setTabColor(SETTINGS.tabColor);
}

/** Maps each column key → its 1-based sheet column, plus runs of adjacent columns for writing. */
function layoutFor_(headers, columns) {
  const fields = columns || COLUMNS;
  const keys = headers.map(headerKey_);
  const index = {};
  fields.forEach(function (c) { index[c.key] = keys.indexOf(headerKey_(c.header)) + 1; });
  const ordered = fields.filter(function (c) { return index[c.key] > 0; })
    .sort(function (a, b) { return index[a.key] - index[b.key]; });
  const runs = [];
  ordered.forEach(function (c) {
    const run = runs[runs.length - 1];
    if (run && run.start + run.keys.length === index[c.key]) run.keys.push(c.key);
    else runs.push({ start: index[c.key], keys: [c.key] });
  });
  return {
    index: index,
    columns: fields.map(function (c) { return index[c.key]; }).filter(function (n) { return n > 0; }),
    runs: runs,
    fields: fields,
  };
}

function headerKey_(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Finds the last row that holds a reply (looking only at our columns, so a checkbox
 * column you add yourself doesn't push new replies far down) and every saved Submission ID.
 */
function scanRows_(sheet, layout) {
  const result = { lastRow: 1, ids: [] };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;
  const first = Math.min.apply(null, layout.columns);
  const last = Math.max.apply(null, layout.columns);
  const block = sheet.getRange(2, first, lastRow - 1, last - first + 1).getDisplayValues();
  const idOffset = layout.index.submissionId - first;
  for (let r = 0; r < block.length; r++) {
    const row = block[r];
    for (let i = 0; i < layout.columns.length; i++) {
      if (String(row[layout.columns[i] - first]).trim() !== '') {
        result.lastRow = r + 2;
        break;
      }
    }
    const id = String(row[idOffset]).trim();
    if (id) result.ids.push(id);
  }
  return result;
}

function writeRow_(sheet, layout, rowNumber, values) {
  ensureRowCount_(sheet, rowNumber);
  layout.runs.forEach(function (run) {
    const range = sheet.getRange(rowNumber, run.start, 1, run.keys.length);
    range.setNumberFormat('@'); // plain text BEFORE writing, so values are stored exactly as typed
    range.setValues([run.keys.map(function (key) { return values[key]; })]);
  });
  keepFormulasAsText_(sheet, layout, rowNumber, values);
}

/**
 * Belt and braces: plain-text formatting already stops "=…" from becoming a formula.
 * If a formula-looking answer was somehow stored as a formula anyway, rewrite it as text.
 */
function keepFormulasAsText_(sheet, layout, rowNumber, values) {
  layout.fields.forEach(function (c) {
    if (!/^[=+\-@]/.test(values[c.key])) return;
    const cell = sheet.getRange(rowNumber, layout.index[c.key]);
    if (cell.getFormula()) {
      cell.setValue("'" + values[c.key]);
      console.warn('Stored a formula-like answer as plain text in "' + c.header + '".');
    }
  });
}

function ensureRowCount_(sheet, rowNumber) {
  const maxRows = sheet.getMaxRows();
  if (rowNumber <= maxRows) return;
  const added = Math.max(rowNumber - maxRows, 100);
  sheet.insertRowsAfter(maxRows, added);
  if (maxRows === 1) {
    // New rows copy the look of the row above; don't let replies inherit the header style.
    sheet.getRange(2, 1, added, sheet.getMaxColumns())
      .setFontWeight('normal')
      .setFontColor('#000000')
      .setBackground(null);
  }
}

function ensureColumnCount_(sheet, columnCount) {
  const maxColumns = sheet.getMaxColumns();
  if (columnCount > maxColumns) sheet.insertColumnsAfter(maxColumns, columnCount - maxColumns);
}

/* ──────────────────────── List (responses.html) ──────────────────────── */

function list_(data) {
  // Paused after too many wrong passphrases? Say so before taking the lock or reading Script
  // properties, so someone hammering the public URL costs next to nothing.
  if (wrongPassphraseCount_() >= SETTINGS.maxWrongPassphrases) {
    console.info('responses.html request refused: viewing is paused after too many wrong passphrases.');
    return failure_('RATE_LIMITED', MESSAGES.rateLimited);
  }
  const expected = adminPassphrase_();
  if (!expected) return failure_('DISABLED', MESSAGES.disabled);
  if (isWeakPassphrase_(expected)) return failure_('DISABLED', MESSAGES.weakPassphrase);

  const given = typeof data.passphrase === 'string'
    ? data.passphrase.trim().slice(0, SETTINGS.maxPassphraseChars)
    : '';
  const check = checkPassphrase_(given, expected);
  if (check.status === 'limited') return failure_('RATE_LIMITED', MESSAGES.rateLimited);
  if (check.status !== 'ok') {
    Utilities.sleep(SETTINGS.wrongPassphraseDelayMs); // slows down guessing
    let message = MESSAGES.unauthorized;
    if (check.triesLeft === 0) {
      message += ' For safety, viewing is now paused for about ' + SETTINGS.pauseMinutes + ' minutes.';
    } else if (check.triesLeft <= 2) {
      message += ' ' + check.triesLeft + (check.triesLeft === 1 ? ' try' : ' tries') +
        ' left before a ' + SETTINGS.pauseMinutes + '-minute pause.';
    }
    return failure_('UNAUTHORIZED', message);
  }

  const spreadsheet = activeSpreadsheet_();
  const table = readTable_(spreadsheet.getSheetByName(SETTINGS.sheetName));
  return {
    ok: true,
    columns: table.columns,
    rows: table.rows,
    generatedAt: new Date().toISOString(),
    sheetUrl: spreadsheet.getUrl(),
    truncated: table.rows.length < table.totalRows, // only the newest maxListRows were sent
    totalRows: table.totalRows,
  };
}

/** Wrong passphrases are counted in CacheService; after too many, everyone waits out the pause. */
function checkPassphrase_(given, expected) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SETTINGS.lockWaitMs)) throw clientError_('SERVER', MESSAGES.busy);
  try {
    const failures = Number(cache.get(SETTINGS.failureCacheKey)) || 0;
    if (failures >= SETTINGS.maxWrongPassphrases) return { status: 'limited', triesLeft: 0 };
    if (given && sameText_(given, expected)) {
      if (failures) cache.remove(SETTINGS.failureCacheKey);
      return { status: 'ok', triesLeft: SETTINGS.maxWrongPassphrases };
    }
    cache.put(SETTINGS.failureCacheKey, String(failures + 1), SETTINGS.pauseMinutes * 60);
    // Shows up in Executions, so you can tell if someone is guessing (the count only, never what was typed).
    console.warn('Save the Date: wrong passphrase on responses.html (' + (failures + 1) + ' of ' +
      SETTINGS.maxWrongPassphrases + ' before a ' + SETTINGS.pauseMinutes + '-minute pause).');
    return { status: 'wrong', triesLeft: SETTINGS.maxWrongPassphrases - failures - 1 };
  } finally {
    lock.releaseLock();
  }
}

function wrongPassphraseCount_() {
  return Number(CacheService.getScriptCache().get(SETTINGS.failureCacheKey)) || 0;
}

/**
 * Header + reply rows, as the text shown in the Sheet. Read-only. A flood of junk could make the list
 * too big for a phone, so only the last (newest) maxListRows rows are sent; totalRows counts them all.
 */
function readTable_(sheet) {
  const empty = { columns: COLUMNS.map(function (c) { return c.header; }), rows: [], totalRows: 0 };
  if (!sheet) return empty;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return empty;
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const columns = values[0].map(function (h) { return String(h).trim(); });
  if (columns.every(function (h) { return h === ''; })) return empty;
  const ours = layoutFor_(columns).columns;
  const rows = values.slice(1).filter(function (row) {
    const cells = ours.length ? ours.map(function (c) { return row[c - 1]; }) : row;
    return cells.some(function (v) { return String(v).trim() !== ''; });
  });
  return {
    columns: columns,
    rows: rows.slice(Math.max(0, rows.length - SETTINGS.maxListRows)),
    totalRows: rows.length,
  };
}

function adminPassphrase_() {
  return String(PropertiesService.getScriptProperties().getProperty(SETTINGS.passphraseProperty) || '').trim();
}

/**
 * Too short to resist guessing, or an example printed in the (public) README: either way it can't
 * protect your guests' home addresses, so responses.html stays turned off.
 */
function isWeakPassphrase_(passphrase) {
  if (passphrase.length < SETTINGS.minPassphraseChars) return true;
  const key = headerKey_(passphrase); // same loose comparison as the headers: case, spaces, punctuation ignored
  return PUBLIC_EXAMPLE_PASSPHRASES.some(function (example) { return headerKey_(example) === key; });
}

/** Compares without stopping at the first different character. */
function sameText_(a, b) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* ─────────────────────────── Small utilities ─────────────────────────── */

function parseRequest_(e) {
  const body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!body.trim()) throw clientError_('BAD_REQUEST', MESSAGES.badRequest);
  if (body.length > SETTINGS.maxRequestChars) throw clientError_('BAD_REQUEST', 'That reply is too large to save.');
  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    throw clientError_('BAD_REQUEST', MESSAGES.badRequest);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw clientError_('BAD_REQUEST', MESSAGES.badRequest);
  }
  return data;
}

/** Trimmed, tidy text: no control characters or invisible direction overrides; spaces collapsed. */
function cleanText_(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value);
  if (typeof text.normalize === 'function') text = text.normalize('NFC');
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ')
    .replace(/[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textField_(value, label, max) {
  const text = cleanText_(value);
  if (text.length > max) {
    throw clientError_('VALIDATION', 'Your ' + label + ' is a little too long. Please shorten it to ' +
      max + ' characters or fewer.');
  }
  return text;
}

function cleanId_(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,99}$/.test(id) ? id : '';
}

function toBoolean_(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 'yes') return true;
    if (v === 'false' || v === 'no') return false;
  }
  return null;
}

/**
 * The same rule as the website's form (isUS in assets/js/form.js), so the server is never stricter:
 * only the letters count, in any case — "US", "U.S.", "U.S.A.", "United States of America", "America"…
 */
function isUnitedStates_(country) {
  const letters = String(country).toLowerCase().replace(/[^a-z]/g, '');
  return /^(us|usa|unitedstates|unitedstatesofamerica|america)$/.test(letters);
}

function isFilled_(value) {
  return value !== null && value !== undefined && value !== false && String(value).trim() !== '';
}

function clientError_(code, message) {
  const err = new Error(message);
  err.code = code;
  err.isClientError = true;
  return err;
}

function failure_(code, message) {
  return { ok: false, code: code, error: message };
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
