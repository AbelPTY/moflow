// Pure i18n core — no React, so it is unit-testable directly. The React
// provider/hook lives in ./index.js and re-exports these.
//
// Design:
//   * Canonical locales: en-US, es-PA. en-US is the guaranteed fallback.
//   * Future locales (e.g. es-US) can be added to DICTIONARIES + resolveLocale
//     without touching call sites.
//   * translate() never returns undefined: missing key -> en-US -> the key path.
//   * Business/canonical values (account_type, budget_bucket, categories) are
//     NEVER translated at the data layer; only their DISPLAY is translated via
//     the accountTypes/buckets/categories maps.

import enUS from './en-US.js';
import esPA from './es-PA.js';

export const DEFAULT_LOCALE = 'en-US';
export const LOCALES = ['en-US', 'es-PA'];
export const DICTIONARIES = { 'en-US': enUS, 'es-PA': esPA };

export const isSupportedLocale = (loc) => LOCALES.includes(loc);

// Read a dotted path ('nav.cards') from a nested dictionary. Returns undefined
// if any segment is missing (so callers can fall back).
const getByPath = (dict, key) => {
  if (!dict || !key) return undefined;
  let node = dict;
  for (const part of String(key).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
};

// Replace {name} placeholders from vars. Missing vars are left as the raw token
// (never rendered as "undefined").
const interpolate = (template, vars) => {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
  );
};

// Translate a semantic key for a locale, with safe fallback:
//   active locale -> en-US -> the key itself. Never undefined.
export function translate(locale, key, vars) {
  const active = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  let raw = getByPath(DICTIONARIES[active], key);
  if (raw === undefined && active !== DEFAULT_LOCALE) {
    raw = getByPath(DICTIONARIES[DEFAULT_LOCALE], key);
    if (raw !== undefined && typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development') {
      // Dev-only hint; silent in production builds.
      console.warn(`[i18n] missing "${key}" for ${active}; used ${DEFAULT_LOCALE}.`);
    }
  }
  if (raw === undefined) return key; // last resort — never render undefined
  return interpolate(raw, vars);
}

// Translate a transaction/budget CATEGORY name for DISPLAY only. Known canonical
// category names (English, as stored) map to a localized label; unknown or
// user-custom names are returned unchanged (never a raw key). Stored values are
// never affected. Only es-PA carries a catDisplay map; en-US returns the name.
export function translateCategory(locale, name) {
  const key = String(name ?? '');
  if (!key) return key;
  const active = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const map = DICTIONARIES[active]?.catDisplay;
  if (map && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return key;
}

// Localized, pluralized duration from a whole number of months. Language-neutral
// month count in -> localized phrase out ("2 years 3 months" / "2 años 3 meses").
// The loanMath engine stays language-neutral; this is the presentation adapter.
const DURATION_UNITS = {
  'en-US': { year: ['year', 'years'], month: ['month', 'months'], zero: '0 months' },
  'es-PA': { year: ['año', 'años'], month: ['mes', 'meses'], zero: '0 meses' },
};
export function formatDuration(totalMonths, locale = DEFAULT_LOCALE) {
  const loc = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const u = DURATION_UNITS[loc] || DURATION_UNITS[DEFAULT_LOCALE];
  const m = Math.max(0, Math.round(Number(totalMonths) || 0));
  if (m === 0) return u.zero;
  const years = Math.floor(m / 12);
  const months = m % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? u.year[0] : u.year[1]}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? u.month[0] : u.month[1]}`);
  return parts.join(' ');
}

// Map a raw browser/device language tag to one of our canonical locales.
// Spanish-like -> es-PA; everything else -> en-US. (es-US would slot in here.)
export function normalizeToLocale(tag) {
  const t = String(tag || '').toLowerCase();
  if (!t) return null;
  if (t.startsWith('es')) return 'es-PA';
  if (t.startsWith('en')) return 'en-US';
  return null;
}

// Inspect a navigator-like object ({ language, languages }) and return the first
// resolvable canonical locale, or the default.
export function detectLocale(navLike) {
  const tags = [];
  if (navLike?.languages && Array.isArray(navLike.languages)) tags.push(...navLike.languages);
  if (navLike?.language) tags.push(navLike.language);
  for (const tag of tags) {
    const loc = normalizeToLocale(tag);
    if (loc) return loc;
  }
  return DEFAULT_LOCALE;
}

// Resolve the effective locale: a valid SAVED preference always wins; otherwise
// detect from the device; otherwise default.
export function resolveLocale(saved, navLike) {
  if (isSupportedLocale(saved)) return saved;
  return detectLocale(navLike);
}

// ---- Locale-aware formatting (Intl). Stored values are never mutated. ----
// Panama uses USD, so Spanish does NOT imply EUR — currency is explicit (USD).

export function formatCurrency(amount, locale = DEFAULT_LOCALE, currency = 'USD') {
  const n = Number(amount);
  const loc = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatNumber(value, locale = DEFAULT_LOCALE, options) {
  const n = Number(value);
  const loc = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(loc, options).format(n);
  } catch {
    return String(n);
  }
}

export function formatDate(date, locale = DEFAULT_LOCALE, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const loc = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(loc, options).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
