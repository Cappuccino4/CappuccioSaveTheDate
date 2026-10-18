/*
 * Live countdown to the wedding (page 2): days · hours · minutes · seconds.
 *
 * Ticks right after each whole second (re-aligned every tick, so it never drifts) and only while the
 * invitation screen is showing. The tiles are aria-hidden; screen readers get one summary sentence that
 * changes at most once a minute and is deliberately not a live region. Once the moment has passed it reads
 * "It's wedding day!" (on the Eastern-time wedding date) and then "Just married!".
 *
 * Syntax is kept to ES2018 so older iPhones can parse the module.
 */

const ZONE = 'America/New_York';

// the little tick on a digit that just changed
const TICK = [{ opacity: 0.2, transform: 'translateY(-0.22em)' }, { opacity: 1, transform: 'none' }];
const TICK_TIMING = { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

// Calendar date (YYYY-MM-DD) of a moment in Eastern time. Browsers without time-zone support use the offset
// written in the wedding date itself (zoneOffset, ms behind UTC), which is Eastern time on that day.
function easternDate(ms, zoneOffset) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  } catch (err) {
    return new Date(ms - zoneOffset).toISOString().slice(0, 10);
  }
}

// "Sunday, April 18, 2027 at 4 PM Eastern" ('' without time-zone support; the summary then leaves it out)
function longDate(ms) {
  try {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(new Date(ms));
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, hour: 'numeric', minute: '2-digit',
    }).format(new Date(ms)).replace(':00', '');
    return day + ' at ' + time + ' Eastern';
  } catch (err) {
    return '';
  }
}

export function createCountdown(root, targetISO) {
  if (!root) return null;
  const target = Date.parse(targetISO);
  if (!isFinite(target)) {
    root.hidden = true;
    return { start() {}, stop() {} };
  }
  // e.g. '2027-04-18T16:00:00-04:00' → 4 h: its wall-clock time read as UTC, minus the moment itself
  const zoneOffset = target - Date.parse(String(targetISO).slice(0, 19) + 'Z') || 0;

  const nums = {};
  const labels = {};
  Array.prototype.forEach.call(root.querySelectorAll('[data-unit]'), (el) => {
    nums[el.getAttribute('data-unit')] = el;
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-label]'), (el) => {
    labels[el.getAttribute('data-label')] = el;
  });
  const caption = root.querySelector('.countdown-caption');
  const doneEl = root.querySelector('.countdown-done');
  const summary = root.querySelector('[data-countdown-summary]');
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const when = longDate(target);
  const shown = {};
  let timer = 0;
  let running = false;
  let summaryKey = null;

  function setNumber(unit, text, animate) {
    const el = nums[unit];
    if (!el || shown[unit] === text) return;
    const first = shown[unit] === undefined;
    shown[unit] = text;
    el.textContent = text;
    if (animate && !first && !reduce.matches && typeof el.animate === 'function') el.animate(TICK, TICK_TIMING);
  }

  function setLabel(unit, n, singular, pluralWord) {
    const el = labels[unit];
    const word = n === 1 ? singular : pluralWord;
    if (el && el.textContent !== word) el.textContent = word;
  }

  function showDone(now) {
    const text = easternDate(now, zoneOffset) === easternDate(target, zoneOffset) ? 'It’s wedding day!' : 'Just married!';
    root.classList.add('is-done');
    if (caption) caption.hidden = true;
    if (doneEl) {
      doneEl.hidden = false;
      doneEl.textContent = text;
    }
    if (summary) summary.textContent = text;
  }

  // Returns false once the countdown is over.
  function render(animate) {
    const now = Date.now();
    const left = target - now;
    if (left <= 0) {
      showDone(now);
      return false;
    }
    const total = Math.ceil(left / 1000); // whole seconds still to go
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    setNumber('days', String(d), animate);
    setNumber('hours', pad2(h), animate);
    setNumber('minutes', pad2(m), animate);
    setNumber('seconds', pad2(s), animate);
    setLabel('days', d, 'Day', 'Days');
    setLabel('hours', h, 'Hour', 'Hours');
    setLabel('minutes', m, 'Minute', 'Minutes');
    setLabel('seconds', s, 'Second', 'Seconds');

    const key = Math.floor(total / 60); // changes exactly when the shown minute does — once a minute
    if (summary && key !== summaryKey) {
      summaryKey = key;
      const bits = [];
      if (d) bits.push(plural(d, 'day'));
      if (d || h) bits.push(plural(h, 'hour'));
      bits.push(plural(m, 'minute'));
      const list = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0];
      summary.textContent = list + ' until our wedding' + (when ? ' on ' + when : '') + '.';
    }
    return true;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  function nextSecond() {
    return 1000 - (Date.now() % 1000) + 10;
  }

  function tick() {
    timer = 0;
    if (!running) return;
    if (render(true)) schedule(nextSecond());
    else schedule(60000); // keep "wedding day" → "just married" honest at midnight
  }

  function start() {
    if (running) return;
    running = true;
    if (render(false)) schedule(nextSecond());
    else schedule(60000);
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    timer = 0;
  }

  document.addEventListener('visibilitychange', () => {
    if (!running) return;
    if (document.hidden) {
      clearTimeout(timer);
      timer = 0;
    } else {
      if (render(false)) schedule(nextSecond());
      else schedule(60000);
    }
  });

  render(false); // fill the tiles right away, before the screen is ever shown
  return { start, stop };
}
