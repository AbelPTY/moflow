// Scheduled-payment recurrence — the ONE canonical, deterministic stepper for
// advancing a recurring scheduled_payments obligation to its next occurrence.
//
// This is the client-side mirror of the DB CHECK values added in
// 20260909000000_scheduled_payments_recurrence_frequency.sql. There is no
// server-side rollover function (reset_recurring_bills does not exist); the
// recurring rollover has always run in the client (mark-paid → re-insert the
// next dated occurrence), so the frequency-aware logic lives here and every
// creation/rollover path calls this single helper.
//
// Semi-monthly reuses the recurring-income convention verbatim (15th + last
// calendar day of the month) via recurringIncome's resolveDayInMonth/LAST_DAY,
// so Payments and Income never diverge. Month arithmetic uses date-fns
// addMonths (the SAME calendar-clamping — Jan 31 → Feb 28/29 — the legacy
// +1-month rollover relied on).

import { addMonths, addDays } from 'date-fns';
import { parseAnchor, resolveDayInMonth, LAST_DAY } from './recurringIncome';

// Canonical stored frequency codes. NULL (absent) is treated as 'monthly' for
// backward compatibility with recurring rows created before this column existed.
export const SCHEDULED_FREQUENCIES = ['monthly', 'semi_monthly', 'biweekly', 'weekly'];

const pad2 = (n) => String(n).padStart(2, '0');

// Format a Date as a local 'YYYY-MM-DD' string (no timezone slippage).
export function toDateStr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Advance ONE recurrence step from `current` for `frequency`. Accepts a Date or
// a 'YYYY-MM-DD' string; returns a local-midnight Date (or null if unparseable).
//
//   weekly       -> +7 days
//   biweekly     -> +14 days
//   monthly      -> +1 calendar month (clamped: Jan 31 -> Feb 28/29)
//   semi_monthly -> next of {15th, last day}: before the 15th -> the 15th;
//                   on/after the 15th but before month-end -> the last day;
//                   on the last day -> the 15th of next month
//   null/unknown -> monthly (legacy compatibility)
export function nextScheduledPaymentDate(current, frequency) {
  const d = parseAnchor(current);
  if (!d) return null;

  switch (frequency) {
    case 'weekly':
      return addDays(d, 7);
    case 'biweekly':
      return addDays(d, 14);
    case 'semi_monthly': {
      const y = d.getFullYear();
      const m = d.getMonth();
      const day = d.getDate();
      const lastDay = new Date(y, m + 1, 0).getDate();
      if (day < 15) return resolveDayInMonth(y, m, 15);
      if (day < lastDay) return resolveDayInMonth(y, m, LAST_DAY);
      // On the month's last day -> the 15th of the following month (m+1 rolls
      // the year over correctly inside resolveDayInMonth/Date).
      return resolveDayInMonth(y, m + 1, 15);
    }
    case 'monthly':
    default:
      return addMonths(d, 1);
  }
}

// String-returning convenience for callers that persist 'YYYY-MM-DD'.
export function nextScheduledPaymentDateStr(current, frequency) {
  return toDateStr(nextScheduledPaymentDate(current, frequency));
}

// Normalize a raw value to a stored recurrence_frequency, or null. Non-canonical
// input (including '' and unknown strings) becomes null (→ monthly at rollover).
export function normalizeFrequency(value) {
  return SCHEDULED_FREQUENCIES.includes(value) ? value : null;
}

// The recurrence_frequency to persist for a legacy-style recurring toggle: the
// existing Bills "Recurring monthly" checkbox creates monthly obligations, so an
// on-toggle stores 'monthly' and off stores null. Keeps the DB explicit while
// remaining behavior-compatible with the null-means-monthly fallback.
export function recurrenceForMonthlyFlag(isRecurring) {
  return isRecurring ? 'monthly' : null;
}
