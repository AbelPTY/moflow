// Activity → Add to Payments — pure logic for turning a historical expense
// transaction into a future recurring obligation.
//
// Product architecture:
//   Activity        = what happened (transactions)
//   Payments/Bills  = future obligations (scheduled_payments)
//   Flow            = consumes future obligations
//
// This module ONLY prepares data. Persistence reuses the existing
// scheduled_payments model + useScheduledPayments.addPayment (no new table, no
// parallel recurrence model). scheduled_payments stores: entity, amount,
// payment_date, status, is_recurring. There is no frequency/category/account/
// note/source column, so the confirmation form captures those for the user's
// decision and this module folds them into what the schema supports:
//   - frequency  -> drives the suggested next due date + sets is_recurring
//   - amount     -> stored as a positive obligation (expenses are negative in
//                   Activity; a bill amount is a positive number to pay)
// Non-monthly frequencies still set is_recurring so the obligation recurs; the
// existing engine's auto-rollover cadence (monthly) is unchanged.

import {
  SCHEDULED_FREQUENCIES,
  nextScheduledPaymentDate,
  normalizeFrequency,
} from './scheduledRecurrence';

// Canonical, internal recurrence keys. Sourced from the single scheduled-payment
// recurrence model (no parallel set): 'semi_monthly' matches the recurring-income
// convention verbatim.
export const FREQUENCIES = SCHEDULED_FREQUENCIES;

// Parse a 'YYYY-MM-DD' string to a local Date (noon-safe: no timezone slippage).
function parseDateStr(value) {
  const s = String(value || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toDateStr(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// Advance a date by one period of the given frequency. Thin alias over the ONE
// canonical stepper so the suggestion and the rollover can never diverge.
export const addPeriod = nextScheduledPaymentDate;

// Suggest the next due date from a transaction date + frequency, rolled forward
// until strictly after "today" so the suggestion is always a future obligation.
// Example: transaction Sep 3, monthly, today Sep 9 -> Oct 3.
// Returns a 'YYYY-MM-DD' string, or null if the transaction date is unparseable.
export function suggestNextDueDate(fromDateStr, frequency, todayStr) {
  const from = parseDateStr(fromDateStr);
  if (!from) return null;
  const today = parseDateStr(todayStr) || new Date();

  let next = nextScheduledPaymentDate(from, frequency);
  // Roll forward if the first computed occurrence is not in the future.
  let guard = 0;
  while (next && next <= today && guard < 400) {
    next = nextScheduledPaymentDate(next, frequency);
    guard += 1;
  }
  return next ? toDateStr(next) : null;
}

// Lightweight name normalizer for matching (lower-case, alphanumerics only).
export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A transaction is eligible for "Add to Payments" when it is a real historical
// expense (negative amount). Works for manually entered cash expenses too — no
// bank account, card, or import source is required.
export function isEligibleForPayment(tx) {
  if (!tx) return false;
  const amount = Number(tx.amount);
  return Number.isFinite(amount) && amount < 0;
}

// Build the scheduled_payments payload from a transaction + user confirmations.
// Only fields that exist on the model are returned. Throws when required data
// is missing so a malformed obligation can never be written.
export function buildPaymentFromTransaction(tx, opts = {}) {
  const entity = String(opts.name != null ? opts.name : tx?.merchant || '').trim();
  const rawAmount =
    opts.amount != null && opts.amount !== '' ? opts.amount : Math.abs(Number(tx?.amount) || 0);
  const amount = Math.abs(Number(rawAmount) || 0);
  const payment_date = String(opts.nextDueDate || '').slice(0, 10);

  if (!entity) throw new Error('MISSING_NAME');
  if (!(amount > 0)) throw new Error('MISSING_AMOUNT');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) throw new Error('MISSING_DUE_DATE');

  // A canonical frequency makes this a recurring obligation; anything else is a
  // one-time payment (is_recurring=false, recurrence_frequency=null).
  const freq = normalizeFrequency(opts.frequency);
  const is_recurring = opts.isRecurring != null ? !!opts.isRecurring : !!freq;
  // Persist the chosen cadence so the rollover stays frequency-aware. When not
  // recurring (or no canonical frequency), store null (→ monthly at rollover if
  // ever flagged recurring later, matching legacy behavior).
  const recurrence_frequency = is_recurring ? freq : null;

  return {
    entity,
    amount,
    payment_date,
    status: 'pending',
    is_recurring,
    recurrence_frequency,
  };
}

// Suggest a frequency from transaction history: same merchant + similar amount
// recurring at a recognizable cadence. RECOMMENDATION ONLY — the caller must
// confirm; returns null when evidence is insufficient (leave unselected).
export function suggestFrequency(tx, history = []) {
  if (!tx) return null;
  const key = normalizeName(tx.merchant);
  if (!key) return null;
  const amt = Math.abs(Number(tx.amount) || 0);
  const tol = Math.max(2, amt * 0.2);

  const related = (history || []).filter((h) => {
    if (!h || h.id === tx.id) return false;
    if (!(Number(h.amount) < 0)) return false;
    if (normalizeName(h.merchant) !== key) return false;
    return Math.abs(Math.abs(Number(h.amount)) - amt) <= tol;
  });

  if (related.length < 1) return null; // need at least one prior occurrence

  const dates = [tx, ...related]
    .map((x) => parseDateStr(x.dateString || x.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;

  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push(Math.round((dates[i] - dates[i - 1]) / 86400000));
  }
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;

  if (avg >= 25 && avg <= 35) return 'monthly';
  if (avg >= 12 && avg <= 18) return 'biweekly';
  if (avg >= 5 && avg <= 9) return 'weekly';
  return null;
}

// Find a likely existing payment (before creating) to avoid silent duplicates.
// Match on normalized name + similar amount + an active (unpaid or recurring)
// obligation. Read-only card-statement events are never candidates.
// Returns the matching payment or null.
export function findDuplicatePayment(candidate, existingPayments = []) {
  const key = normalizeName(candidate?.entity);
  if (!key) return null;
  const amt = Math.abs(Number(candidate?.amount) || 0);
  const tol = Math.max(2, amt * 0.15);

  return (
    (existingPayments || []).find((p) => {
      if (!p || p.readOnly) return false;
      if (normalizeName(p.entity) !== key) return false;
      const sameAmount = Math.abs(Math.abs(Number(p.amount) || 0) - amt) <= tol;
      if (!sameAmount) return false;
      const active = !!p.is_recurring || p.status !== 'paid';
      return active;
    }) || null
  );
}
