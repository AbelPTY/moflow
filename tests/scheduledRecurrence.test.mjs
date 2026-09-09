// Workflow Quality Pass V1 — frequency-aware scheduled-payment recurrence.
// Pure, deterministic date logic. FICTIONAL data only.
//
// Run (where Node exists) from repo root:  node tests/scheduledRecurrence.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const {
    SCHEDULED_FREQUENCIES, nextScheduledPaymentDate, nextScheduledPaymentDateStr,
    normalizeFrequency, recurrenceForMonthlyFlag, toDateStr,
  } = await vite.ssrLoadModule('/src/lib/scheduledRecurrence.js');
  const nx = nextScheduledPaymentDateStr;

  ok('canonical frequency set', JSON.stringify(SCHEDULED_FREQUENCIES) === JSON.stringify(['monthly', 'semi_monthly', 'biweekly', 'weekly']));

  // A. weekly advances exactly 7 days.
  ok('A: weekly +7', nx('2026-09-03', 'weekly') === '2026-09-10');
  // B. biweekly advances exactly 14 days.
  ok('B: biweekly +14', nx('2026-09-03', 'biweekly') === '2026-09-17');
  // C. monthly advances one calendar month.
  ok('C: monthly +1 month', nx('2026-09-03', 'monthly') === '2026-10-03');
  // D. Jan 31 monthly clamps to Feb 28 (non-leap 2026).
  ok('D: Jan 31 monthly clamps', nx('2026-01-31', 'monthly') === '2026-02-28');
  ok('D: Jan 31 monthly clamps (leap 2024 -> Feb 29)', nx('2024-01-31', 'monthly') === '2024-02-29');

  // E. semi-monthly before the 15th -> the 15th.
  ok('E: semi before 15th -> 15th', nx('2026-09-03', 'semi_monthly') === '2026-09-15');
  ok('E: semi on 1st -> 15th', nx('2026-09-01', 'semi_monthly') === '2026-09-15');
  // F. semi-monthly on the 15th -> the last day of the month.
  ok('F: semi on 15th -> last day', nx('2026-09-15', 'semi_monthly') === '2026-09-30');
  ok('F: semi on 20th -> last day', nx('2026-09-20', 'semi_monthly') === '2026-09-30');
  // G. semi-monthly on month-end -> the 15th of next month.
  ok('G: semi month-end -> next 15th', nx('2026-09-30', 'semi_monthly') === '2026-10-15');
  ok('G: semi Dec 31 -> next-year Jan 15', nx('2026-12-31', 'semi_monthly') === '2027-01-15');

  // H. February leap/non-leap handled correctly.
  ok('H: non-leap Feb 15 -> Feb 28', nx('2026-02-15', 'semi_monthly') === '2026-02-28');
  ok('H: non-leap Feb 28 -> Mar 15', nx('2026-02-28', 'semi_monthly') === '2026-03-15');
  ok('H: leap Feb 15 -> Feb 29', nx('2024-02-15', 'semi_monthly') === '2024-02-29');
  ok('H: leap Feb 29 -> Mar 15', nx('2024-02-29', 'semi_monthly') === '2024-03-15');

  // I. legacy recurring payment with NULL frequency behaves as monthly.
  ok('I: null -> monthly', nx('2026-09-03', null) === '2026-10-03');
  ok('I: undefined -> monthly', nx('2026-09-03', undefined) === '2026-10-03');
  ok('I: unknown code -> monthly', nx('2026-09-03', 'yearly') === '2026-10-03');
  ok('I: null Jan 31 -> Feb 28 (legacy clamp)', nx('2026-01-31', null) === '2026-02-28');

  // J. helpers for the recurring flag / one-time semantics (rollover itself is
  //    gated by is_recurring in the client; a one-time payment stores null).
  ok('J: monthly flag -> monthly', recurrenceForMonthlyFlag(true) === 'monthly');
  ok('J: not-recurring flag -> null', recurrenceForMonthlyFlag(false) === null);
  ok('J: normalizeFrequency canonical', normalizeFrequency('weekly') === 'weekly');
  ok('J: normalizeFrequency empty -> null', normalizeFrequency('') === null);
  ok('J: normalizeFrequency unknown -> null', normalizeFrequency('daily') === null);

  // Multi-cycle stability — the series never drifts off its cadence.
  const cycle = (start, freq, n) => {
    const out = [start];
    let cur = start;
    for (let i = 0; i < n; i += 1) { cur = nx(cur, freq); out.push(cur); }
    return out;
  };
  const gapDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  // O. weekly stays weekly after multiple cycles.
  const wk = cycle('2026-09-03', 'weekly', 5);
  ok('O: weekly cycles all +7', wk.slice(1).every((d, i) => gapDays(wk[i], d) === 7));
  ok('O: weekly 5th cycle', wk[5] === '2026-10-08');

  // P. biweekly stays biweekly after multiple cycles.
  const bw = cycle('2026-09-03', 'biweekly', 5);
  ok('P: biweekly cycles all +14', bw.slice(1).every((d, i) => gapDays(bw[i], d) === 14));
  ok('P: biweekly 5th cycle', bw[5] === '2026-11-12');

  // Q. semi-monthly stays semi-monthly after multiple cycles (alternating
  //    15th / last-day, always in {15, month-end}).
  const sm = cycle('2026-09-03', 'semi_monthly', 6);
  ok('Q: semi cycle sequence', JSON.stringify(sm) === JSON.stringify([
    '2026-09-03', '2026-09-15', '2026-09-30', '2026-10-15', '2026-10-31', '2026-11-15', '2026-11-30',
  ]));
  ok('Q: semi lands only on 15th or month-end', sm.slice(1).every((d) => {
    const day = Number(d.slice(8, 10));
    const lastDay = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();
    return day === 15 || day === lastDay;
  }));

  // toDateStr / parse robustness.
  ok('toDateStr null-safe', toDateStr('not a date') === null);
  ok('nextScheduledPaymentDate returns a Date', nextScheduledPaymentDate('2026-09-03', 'weekly') instanceof Date);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
