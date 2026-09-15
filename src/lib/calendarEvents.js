// Canonical calendar-marker derivation — a PURE, derived-only UI layer over the
// EXISTING dated financial events (scheduled_payments plus read-only card-statement
// extras). No persistence, no new table, no second query, no parallel records.
// Its only job: turn a flat list of dated events into a
// { 'YYYY-MM-DD': [event, ...] } map so every calendar marks a date whenever
// MoFlow already knows about an event on it.
//
// Why this exists: the calendar previously grouped markers by the RAW
// `payment_date` string, while Flow's projection (parseISO) and the Bills/Flow
// summaries (parseCalendarDate) both tolerate a time component. That divergence
// meant a stored value carrying any time/zone suffix would place an event in
// Flow's projection yet silently drop its calendar dot — exactly the "appears in
// Flow but not in the calendar" gap. Keying through parseCalendarDate removes the
// divergence: one date semantics for markers, projection, and summaries.
//
// The event shape is the existing scheduled_payments row (+ card extras):
//   { id, entity, amount, payment_date, status, is_recurring, readOnly? }
// Markers derive from the event date itself, so they are independent of the month
// currently displayed, of any "upcoming" summary limit, and of any Flow
// projection horizon. An event marks its own date, full stop.

import { parseCalendarDate } from './futureCommitments';

// 'YYYY-MM-DD' local-calendar key for any event date value, or null if
// unparseable. Reuses parseCalendarDate (local-midnight parse) so a stored
// timestamp never shifts the day through UTC: '2026-10-08' — and
// '2026-10-08T00:00:00+00:00' — both key to '2026-10-08', never '2026-10-07'.
export function calendarDateKey(value) {
  const d = parseCalendarDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// Group dated events into { 'YYYY-MM-DD': [event, ...] } for calendar markers.
// - Derived only: returns the SAME event objects (nothing is copied or persisted).
// - Input order within a day is preserved, so existing dot rendering and any
//   marker cap behave exactly as before.
// - Events without a parseable payment_date are skipped (no phantom markers).
export function groupEventsByCalendarDate(events) {
  const grouped = {};
  (events || []).forEach((event) => {
    if (!event) return;
    const key = calendarDateKey(event.payment_date);
    if (!key) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(event);
  });
  return grouped;
}
