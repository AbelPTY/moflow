// Flow V2.7 — recurring-income recurrence engine (pure, deterministic).
//
// Panama commonly pays SEMI-MONTHLY / QUINCENAL: twice per CALENDAR month
// (24×/year), which is NOT "every 14 days" (biweekly, ~26×/year). This module
// is the single source of truth for turning a recurring-income config into a
// concrete list of dated inflows inside a projection window, for every
// frequency MoFlow distinguishes. It is pure (no DB, no React, no i18n) so the
// Flow projection and unit tests share the exact same math.
//
// CANONICAL VALUES ONLY. Frequencies are stored as the lowercase codes below;
// month-end is the stable token `last_day`. Display translation (Quincenal,
// "Último día del mes", …) is handled entirely by the i18n layer. Nothing here
// emits or accepts translated text.

// Canonical frequency codes. 'monthly' is the pre-existing implicit default and
// keeps producing exactly one inflow per calendar month.
export const INCOME_FREQUENCIES = ['monthly', 'semi_monthly', 'biweekly', 'weekly'];

// Stable canonical token for "last calendar day of the month" (never encode it
// as 30/31 — February and 30-day months must resolve correctly).
export const LAST_DAY = 'last_day';

// Reasonable initial semi-monthly schedule (the user can change both). These are
// GLOBAL sensible defaults, not Panama-only — do not infer market from language.
export const DEFAULT_SEMI_MONTHLY = { first_day: 15, second_day: LAST_DAY };

// ---------------------------------------------------------------------------
// Small date helpers (all local-midnight, DST-safe via calendar arithmetic).
// ---------------------------------------------------------------------------
const atMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDaysLocal = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Parse a yyyy-MM-dd string (or Date) to a local-midnight Date, or null.
export function parseAnchor(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : atMidnight(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Coerce a raw day spec to a canonical one: LAST_DAY, or an integer 1..31, or
// the supplied fallback when the input is missing/invalid.
export function normalizeDaySpec(value, fallback) {
  if (value === LAST_DAY) return LAST_DAY;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (n > 31) return 31;
  return n;
}

// Resolve a day spec within a specific month to a local-midnight Date.
//   LAST_DAY -> the month's last calendar day (Feb 28/29, Apr 30, …).
//   numeric  -> CLAMPED to the last valid day (day 31 in Feb -> Feb 28/29).
// Returns null for an unusable spec.
export function resolveDayInMonth(year, monthIndex, daySpec) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  if (daySpec === LAST_DAY) return new Date(year, monthIndex, lastDay);
  const day = typeof daySpec === 'number' ? daySpec : parseInt(daySpec, 10);
  if (!Number.isFinite(day) || day < 1) return null;
  return new Date(year, monthIndex, Math.min(day, lastDay));
}

// True when two day specs resolve to the SAME calendar date in the given month
// (e.g. `31` and `last_day` in any 31-day month; `30` and `last_day` in April).
export function daySpecsCollide(year, monthIndex, a, b) {
  const da = resolveDayInMonth(year, monthIndex, a);
  const db = resolveDayInMonth(year, monthIndex, b);
  return !!da && !!db && da.getTime() === db.getTime();
}

// ---------------------------------------------------------------------------
// Semi-monthly config normalization + validation.
// ---------------------------------------------------------------------------

// Normalize a raw semi-monthly config to canonical shape. When same_amount is
// on (the default), the second installment mirrors the first.
export function normalizeSemiMonthly(raw = {}) {
  const first_day = normalizeDaySpec(raw.first_day, DEFAULT_SEMI_MONTHLY.first_day);
  const second_day = normalizeDaySpec(raw.second_day, DEFAULT_SEMI_MONTHLY.second_day);
  const same_amount = raw.same_amount === undefined ? true : !!raw.same_amount;
  const first_amount = num(raw.first_amount);
  const second_amount = same_amount ? first_amount : num(raw.second_amount);
  return { first_day, second_day, first_amount, second_amount, same_amount };
}

// Validate a semi-monthly schedule. Returns { valid, error } where `error` is an
// i18n KEY suffix (never user-facing text): 'invalidDay' | 'orderReversed' |
// 'duplicateDate' | null. Ordering is judged in a full 31-day month; a duplicate
// resolved date in ANY month of the year (incl. leap February) is rejected so
// ambiguous configs like `31 + last_day` or `30 + last_day` cannot be saved.
export function validateSemiMonthly(raw = {}) {
  const c = normalizeSemiMonthly(raw);
  const first = resolveDayInMonth(2025, 0, c.first_day);   // January = 31 days
  const second = resolveDayInMonth(2025, 0, c.second_day);
  if (!first || !second) return { valid: false, error: 'invalidDay' };
  if (first.getTime() > second.getTime()) return { valid: false, error: 'orderReversed' };
  const months = [];
  for (let m = 0; m < 12; m += 1) months.push([2025, m]);
  months.push([2024, 1]); // leap-year February
  if (months.some(([y, m]) => daySpecsCollide(y, m, c.first_day, c.second_day))) {
    return { valid: false, error: 'duplicateDate' };
  }
  return { valid: true, error: null };
}

// ---------------------------------------------------------------------------
// Occurrence generation — the heart of the engine.
// ---------------------------------------------------------------------------

// Produce the sorted inflows for `frequency` within the window, one entry per
// actual payment date. Each entry: { date, dateStr, amount, installment } where
// installment is 1 or 2 (semi-monthly) and 1 otherwise.
//
// Window semantics match the Flow engine: by default occurrences are STRICTLY
// after `start` (so income that may already have posted today is not double
// counted) and up to and including `end`. Pass { strictlyAfterStart: false } to
// include an occurrence landing exactly on `start`.
//
// config by frequency:
//   'monthly'      -> { day, amount }            (day: 1..31 | LAST_DAY)
//   'semi_monthly' -> { first_day, second_day, first_amount, second_amount }
//   'biweekly' / 'weekly' -> { anchor, amount }  (anchor: Date | 'yyyy-MM-dd')
export function incomeOccurrences(frequency, config = {}, start, end, opts = {}) {
  const s = atMidnight(start);
  const e = atMidnight(end);
  const out = [];
  if (e < s) return out;
  const strictly = opts.strictlyAfterStart !== false;
  const inWindow = (d) => (strictly ? d > s : d >= s) && d <= e;
  const endMonthKey = e.getFullYear() * 12 + e.getMonth();

  if (frequency === 'semi_monthly') {
    const c = normalizeSemiMonthly(config);
    let y = s.getFullYear();
    let m = s.getMonth();
    while (y * 12 + m <= endMonthKey) {
      const d1 = resolveDayInMonth(y, m, c.first_day);
      const d2 = resolveDayInMonth(y, m, c.second_day);
      if (d1 && inWindow(d1)) out.push({ date: d1, dateStr: isoOf(d1), amount: c.first_amount, installment: 1 });
      if (d2 && inWindow(d2)) out.push({ date: d2, dateStr: isoOf(d2), amount: c.second_amount, installment: 2 });
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
  } else if (frequency === 'weekly' || frequency === 'biweekly') {
    const step = frequency === 'weekly' ? 7 : 14;
    const amount = num(config.amount);
    const anchor = parseAnchor(config.anchor);
    if (!anchor) return out;
    let d = new Date(anchor);
    // Align to the series near the window without drifting off the cadence.
    let guard = 0;
    while (d > s && guard < 2000) { d = addDaysLocal(d, -step); guard += 1; }
    guard = 0;
    while (!inWindow(d) && d <= e && guard < 2000) { d = addDaysLocal(d, step); guard += 1; }
    guard = 0;
    while (d <= e && guard < 2000) {
      if (inWindow(d)) out.push({ date: d, dateStr: isoOf(d), amount, installment: 1 });
      d = addDaysLocal(d, step);
      guard += 1;
    }
  } else {
    // monthly (and any unknown code) -> one inflow per month.
    const day = config.day != null ? config.day : config.first_day;
    const amount = num(config.amount != null ? config.amount : config.first_amount);
    let y = s.getFullYear();
    let m = s.getMonth();
    while (y * 12 + m <= endMonthKey) {
      const d = resolveDayInMonth(y, m, day);
      if (d && inWindow(d)) out.push({ date: d, dateStr: isoOf(d), amount, installment: 1 });
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
  }

  out.sort((a, b) => a.date - b.date || a.installment - b.installment);
  return out;
}

export default incomeOccurrences;
