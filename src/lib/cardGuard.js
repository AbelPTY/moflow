// Shared credit-card due-date logic used by the Cash Flow tab and the card panel.

// The next occurrence of a day-of-month due date on/after today. If this
// month's due day has already passed, roll to next month. Returns a Date at
// local midnight, or null if dueDay isn't a valid 1-31.
export function nextDueDate(dueDay, from = new Date()) {
  const day = Number(dueDay);
  if (!day || day < 1 || day > 31) return null;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let d = new Date(start.getFullYear(), start.getMonth(), day);
  if (d < start) d = new Date(start.getFullYear(), start.getMonth() + 1, day);
  return d;
}

// Whole days from today until the given date (0 = today, negative = past).
export function daysUntil(date) {
  if (!date) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - start.getTime()) / 86400000);
}
