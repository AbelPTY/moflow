// Future Commitment Visibility UX Pass — pure helpers for the Bills "Upcoming
// payments" summary and the Flow outside-horizon notice. FICTIONAL data only.
// Uses the existing scheduled_payments shape; no Activity/Yappy inference.
//
// Run (where Node exists) from repo root:  node tests/futureCommitments.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const {
    parseCalendarDate, getUpcomingScheduledPayments,
    getOutsideHorizonCommitments, summarizeOutsideHorizonCommitments,
  } = await vite.ssrLoadModule('/src/lib/futureCommitments.js');
  const { translate, formatDate } = await vite.ssrLoadModule('/src/i18n/core.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);
  const differs = (k) => en(k) !== es(k) && en(k) !== k && es(k) !== k;

  const today = '2026-09-15';
  // A realistic mix (rails vary; none required for visibility).
  const achMonthly = { id: 'p-ach', entity: 'Colegio Las Esclavas', amount: 580, payment_date: '2026-10-03', status: 'pending', is_recurring: true, recurrence_frequency: 'monthly' };
  const cashOneTime = { id: 'p-cash', entity: 'Plumber', amount: 120, payment_date: '2026-10-10', status: 'pending', is_recurring: false, recurrence_frequency: null };
  const insideWindow = { id: 'p-in', entity: 'Gym', amount: 40, payment_date: '2026-09-20', status: 'pending', is_recurring: true, recurrence_frequency: 'monthly' };
  const beyond30 = { id: 'p-far', entity: 'Insurance', amount: 300, payment_date: '2026-11-20', status: 'pending', is_recurring: true, recurrence_frequency: 'monthly' };
  const paid = { id: 'p-paid', entity: 'Netflix', amount: 12.99, payment_date: '2026-10-05', status: 'paid', is_recurring: true, recurrence_frequency: 'monthly' };
  const invalid = { id: 'p-bad', entity: 'Broken', amount: 50, payment_date: 'not-a-date', status: 'pending' };
  const past = { id: 'p-past', entity: 'Old', amount: 25, payment_date: '2026-09-01', status: 'pending' };
  const all = [beyond30, achMonthly, insideWindow, cashOneTime, paid, invalid, past];

  // ============================ BILLS: Upcoming summary ============================
  const up = getUpcomingScheduledPayments(all, today, 5);
  // A. future pending payment appears.
  ok('Bills-A: ACH future payment appears', up.some((p) => p.id === 'p-ach'));
  // B. next-month payment appears even though "today" is mid-September.
  ok('Bills-B: next-month (Oct 3) present regardless of month', up.find((p) => p.id === 'p-ach').payment_date === '2026-10-03');
  // C. paid excluded.
  ok('Bills-C: paid excluded', !up.some((p) => p.id === 'p-paid'));
  // D. invalid date excluded.
  ok('Bills-D: invalid date excluded', !up.some((p) => p.id === 'p-bad'));
  // E. sorted ascending by payment_date.
  const dates = up.map((p) => p.payment_date);
  ok('Bills-E: sorted ascending', JSON.stringify(dates) === JSON.stringify([...dates].sort()));
  ok('Bills-E: earliest first (Sep 20)', up[0].payment_date === '2026-09-20');
  // F. limited to configured count.
  ok('Bills-F: limit respected', getUpcomingScheduledPayments(all, today, 2).length === 2);
  // G. recurring and one-time both included.
  ok('Bills-G: recurring + one-time both present', up.some((p) => p.id === 'p-ach') && up.some((p) => p.id === 'p-cash'));
  // H. ACH / manual source not required (no rail field exists; both appear).
  ok('Bills-H: rail-agnostic (ACH + cash both shown)', up.filter((p) => ['p-ach', 'p-cash'].includes(p.id)).length === 2);
  // I. past payments are not "upcoming".
  ok('Bills-I: past excluded from upcoming', !up.some((p) => p.id === 'p-past'));
  // J. empty state.
  ok('Bills-J: empty when none', getUpcomingScheduledPayments([], today, 5).length === 0);
  ok('Bills-J: empty when all paid/invalid', getUpcomingScheduledPayments([paid, invalid], today, 5).length === 0);

  // ============================ FLOW: outside-horizon notice ============================
  const outside14 = getOutsideHorizonCommitments(all, { today, windowDays: 14, extendedDays: 30 });
  // A. payment inside 14 days is NOT in the outside notice.
  ok('Flow-A: inside-14 excluded from notice', !outside14.some((p) => p.id === 'p-in'));
  // B. after 14-day window but within 30 days appears.
  ok('Flow-B: Oct 3 in notice (day 18)', outside14.some((p) => p.id === 'p-ach'));
  ok('Flow-B: Oct 10 in notice', outside14.some((p) => p.id === 'p-cash'));
  // C. beyond 30 days excluded.
  ok('Flow-C: beyond 30 excluded', !outside14.some((p) => p.id === 'p-far'));
  // D. paid excluded.
  ok('Flow-D: paid excluded', !outside14.some((p) => p.id === 'p-paid'));
  // E. invalid excluded.
  ok('Flow-E: invalid excluded', !outside14.some((p) => p.id === 'p-bad'));
  // F/G. multiple commitments summarized; total summed.
  const sum = summarizeOutsideHorizonCommitments(outside14);
  ok('Flow-F: count = 2', sum.count === 2);
  ok('Flow-G: total = 700 (580 + 120)', sum.total === 700);
  ok('Flow-G: first is earliest (Oct 3)', sum.first.id === 'p-ach');
  // H. everything in the notice is strictly after windowEnd, so the 14-day
  //    projection (which excludes d > windowEnd) is unaffected by the notice.
  const start = parseCalendarDate(today);
  const windowEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 14);
  ok('Flow-H: all notice items are past windowEnd (projection unchanged)', outside14.every((p) => parseCalendarDate(p.payment_date) > windowEnd));
  // I/J. Switching the horizon to 30 days: the Oct 3 payment is now WITHIN the
  //      window, so it leaves the notice (and enters the normal projection).
  const outside30 = getOutsideHorizonCommitments(all, { today, windowDays: 30, extendedDays: 30 });
  ok('Flow-I/J: at 30d horizon the notice is empty (payment now projected)', outside30.length === 0);
  // K. no Yappy/ACH gate — an ACH entity is included purely on date/status.
  ok('Flow-K: ACH entity included (no rail gate)', outside14.some((p) => p.entity === 'Colegio Las Esclavas'));
  ok('Flow-K: no rail/method field consulted', outside14.every((p) => !('payment_method' in p) && !('rail' in p)));

  // L. Date stability (no UTC shift): 2026-10-03 renders as Oct 3 / 3 (never Oct 2).
  const d = parseCalendarDate('2026-10-03');
  ok('Flow-L: parsed to local Oct 3', d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 3);
  ok('Flow-L: en renders "Oct 3"', formatDate(d, 'en-US', { month: 'short', day: 'numeric' }) === 'Oct 3');
  ok('Flow-L: es renders day 3 (not 2)', /\b3\b/.test(formatDate(d, 'es-PA', { month: 'short', day: 'numeric' })));

  // ============================ REALISTIC FIXTURE ============================
  const fixture = [achMonthly];
  const fUp = getUpcomingScheduledPayments(fixture, today, 5);
  ok('Fixture: Bills shows Colegio immediately', fUp.length === 1 && fUp[0].entity === 'Colegio Las Esclavas' && fUp[0].amount === 580);
  const fOut = summarizeOutsideHorizonCommitments(getOutsideHorizonCommitments(fixture, { today, windowDays: 14, extendedDays: 30 }));
  ok('Fixture: 14-day notice shows 1 known payment', fOut.count === 1 && fOut.total === 580);
  ok('Fixture: 30-day horizon clears the notice', getOutsideHorizonCommitments(fixture, { today, windowDays: 30, extendedDays: 30 }).length === 0);
  ok('Fixture: no Yappy conversion (entity intact)', !/yappy/i.test(fUp[0].entity));

  // ============================ I18N ============================
  ok('i18n: bills.upcomingTitle EN/ES', en('bills.upcomingTitle') === 'Upcoming payments' && es('bills.upcomingTitle') === 'Pagos próximos');
  ok('i18n: bills.noUpcoming EN/ES', en('bills.noUpcoming') === 'No upcoming payments' && es('bills.noUpcoming') === 'No hay pagos próximos');
  ok('i18n: outsideHorizonTitleOne interpolates days', en('flow.outsideHorizonTitleOne', { days: 14 }) === '1 known payment outside this 14-day view');
  ok('i18n: outsideHorizonTitleOne ES', es('flow.outsideHorizonTitleOne', { days: 14 }) === '1 pago conocido fuera de esta vista de 14 días');
  ok('i18n: outsideHorizonTitleMany interpolates', en('flow.outsideHorizonTitleMany', { count: 3, days: 14 }) === '3 known payments outside this 14-day view');
  ok('i18n: outsideHorizonTitleMany ES', es('flow.outsideHorizonTitleMany', { count: 3, days: 14 }) === '3 pagos conocidos fuera de esta vista de 14 días');
  ok('i18n: outsideHorizonSubOne EN', en('flow.outsideHorizonSubOne', { amount: '$580.00', date: 'Oct 3' }) === '$580.00 due Oct 3');
  ok('i18n: outsideHorizonSubMany EN', en('flow.outsideHorizonSubMany', { amount: '$1,245.00' }) === '$1,245.00 due within the next 30 days');
  ok('i18n: outsideHorizonSubMany ES', es('flow.outsideHorizonSubMany', { amount: '$1,245.00' }) === '$1,245.00 vencen en los próximos 30 días');
  ok('i18n: viewThirtyDays EN/ES', en('flow.viewThirtyDays') === 'View 30 days' && es('flow.viewThirtyDays') === 'Ver 30 días');
  ok('i18n: notice title differs EN/ES', differs('flow.outsideHorizonSubMany'));
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
