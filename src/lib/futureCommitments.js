// Future Commitment Visibility — pure helpers over the EXISTING scheduled_payments
// data source. No second query, no Activity/Yappy inference, no transaction
// intelligence: this is strictly about explicit known scheduled obligations.
//
// Two surfaces consume these:
//   * Bills — an "Upcoming payments" summary above the calendar, independent of
//     the month currently displayed.
//   * Flow — an informational notice for known payments that fall AFTER the
//     current projection window but within an extended (30-day) look-ahead. The
//     notice never changes the projection itself.
//
// payment_date is calendar-date data ('YYYY-MM-DD'). All comparison/sorting is
// timezone-safe: dates are parsed to LOCAL midnight (never `new Date(str)`,
// which would parse as UTC and shift the day), and sorting uses the string form
// (lexicographic order of 'YYYY-MM-DD' equals chronological order).
// scheduled_payments.amount is stored as a positive obligation; callers display
// it as-is.

// Parse a 'YYYY-MM-DD' string to a LOCAL-midnight Date, or null. Ignores any
// time component so a stored timestamp never shifts the calendar day.
export function parseCalendarDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDaysLocal(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// A real, still-owed obligation: present, not paid, with a valid calendar date.
function isPending(payment) {
  if (!payment || payment.readOnly) return false; // never read-only card extras
  if (payment.status === 'paid') return false;
  return !!parseCalendarDate(payment.payment_date);
}

// Ascending by payment_date ('YYYY-MM-DD' compares chronologically as strings).
function byDateAsc(a, b) {
  const da = String(a.payment_date);
  const db = String(b.payment_date);
  return da < db ? -1 : da > db ? 1 : 0;
}

// The next few pending future commitments — independent of any calendar month.
// Includes recurring and one-time; rail/payment method is irrelevant. "Future"
// means due today or later (past-due lives in the overdue banner). Returns up to
// `limit` payments sorted ascending by due date.
export function getUpcomingScheduledPayments(payments, today, limit = 5) {
  const start = parseCalendarDate(today);
  if (!start) return [];
  return (payments || [])
    .filter(isPending)
    .filter((p) => parseCalendarDate(p.payment_date) >= start)
    .sort(byDateAsc)
    .slice(0, Math.max(0, limit));
}

// Known commitments AFTER the current Flow window but within the extended
// look-ahead: pending, valid date strictly after windowEnd and on/before
// extendedEnd. Mirrors Flow's own `d > windowEnd` exclusion exactly, so these
// are precisely the payments NOT in the current projection yet worth surfacing.
//   opts: { today: 'YYYY-MM-DD', windowDays, extendedDays = 30 }
export function getOutsideHorizonCommitments(payments, opts = {}) {
  const { today, windowDays, extendedDays = 30 } = opts;
  const start = parseCalendarDate(today);
  if (!start || !Number.isFinite(Number(windowDays))) return [];
  const windowEnd = addDaysLocal(start, Number(windowDays));
  const extendedEnd = addDaysLocal(start, Number(extendedDays));
  if (extendedEnd <= windowEnd) return []; // horizon already at/beyond extended
  return (payments || [])
    .filter(isPending)
    .filter((p) => {
      const d = parseCalendarDate(p.payment_date);
      return d > windowEnd && d <= extendedEnd;
    })
    .sort(byDateAsc);
}

// Summarize an outside-horizon list for the notice copy.
//   { count, total (sum of positive obligation amounts), first (earliest) }
export function summarizeOutsideHorizonCommitments(list) {
  const items = list || [];
  return {
    count: items.length,
    total: items.reduce((sum, p) => sum + Math.abs(Number(p.amount) || 0), 0),
    first: items[0] || null,
  };
}
