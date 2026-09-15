// Calendar Event Consistency V1 — pure derivation of calendar markers from the
// EXISTING scheduled_payments (+ read-only card extras). FICTIONAL data only.
// No DB, no new table, no persistence: this proves that any dated financial
// event MoFlow knows about produces a marker on its exact local calendar date,
// independent of the displayed month, the "upcoming" summary limit, and Flow's
// projection horizon.
//
// Run (where Node exists) from repo root:  node tests/calendarEvents.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { groupEventsByCalendarDate, calendarDateKey } =
    await vite.ssrLoadModule('/src/lib/calendarEvents.js');
  const { getUpcomingScheduledPayments } =
    await vite.ssrLoadModule('/src/lib/futureCommitments.js');

  // Realistic Las Esclavas fixture (from the spec) — two pending recurring
  // obligations on the SAME date, no rail/payment-method field.
  const adele = { id: 'p-adele', entity: 'Colegio Las Esclavas - Adele', amount: 290, payment_date: '2026-10-08', status: 'pending', is_recurring: true, recurrence_frequency: 'monthly' };
  const bella = { id: 'p-bella', entity: 'Colegio Las Esclavas - Bella', amount: 290, payment_date: '2026-10-08', status: 'pending', is_recurring: true, recurrence_frequency: 'monthly' };

  // A. one pending scheduled payment creates a marker on its exact date.
  {
    const g = groupEventsByCalendarDate([adele]);
    ok('A: single pending payment marks its exact date', Array.isArray(g['2026-10-08']) && g['2026-10-08'].length === 1);
    ok('A: no marker leaks onto adjacent days', !g['2026-10-07'] && !g['2026-10-09']);
  }

  // B. two payments on the same date produce a multiple-event indication.
  {
    const g = groupEventsByCalendarDate([adele, bella]);
    ok('B: same-date payments both grouped (multiple-event indication)', g['2026-10-08'].length === 2);
  }

  // C. Adele + Bella fixture marks Oct 8.
  {
    const g = groupEventsByCalendarDate([adele, bella]);
    ok('C: Las Esclavas fixture marks Oct 8', !!g['2026-10-08'] && g['2026-10-08'].length === 2);
  }

  // D. selecting Oct 8 returns BOTH payments (day-detail lookup by date key).
  {
    const g = groupEventsByCalendarDate([adele, bella]);
    const day = g['2026-10-08'] || [];
    ok('D: Oct 8 day-detail exposes Adele', day.some((p) => p.id === 'p-adele' && p.amount === 290));
    ok('D: Oct 8 day-detail exposes Bella', day.some((p) => p.id === 'p-bella' && p.amount === 290));
  }

  // E. a payment outside the top-five summary STILL marks the calendar.
  {
    const today = '2026-09-15';
    // Six future payments; the summary keeps only the earliest five.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `p-${i}`, entity: `Bill ${i}`, amount: 10 + i,
      payment_date: `2026-10-0${i + 1}`, status: 'pending', is_recurring: false, recurrence_frequency: null,
    }));
    const summary = getUpcomingScheduledPayments(many, today, 5);
    const sixth = many[5]; // 2026-10-06, the one dropped by limit=5
    ok('E: sixth payment is NOT in the top-five summary', summary.length === 5 && !summary.some((p) => p.id === sixth.id));
    const g = groupEventsByCalendarDate(many); // markers derive from full list, never the summary
    ok('E: sixth payment STILL marks its calendar date', !!g[sixth.payment_date]);
  }

  // F. a payment outside Flow's 14-day horizon still marks the displayed month.
  //    today Sep 15, horizon 14d -> windowEnd Sep 29; Oct 8 is beyond it, yet the
  //    October calendar must mark Oct 8. Marker generation ignores the horizon.
  {
    const g = groupEventsByCalendarDate([adele]);
    ok('F: Oct 8 marked though beyond the 14-day Flow horizon', !!g['2026-10-08']);
  }

  // G. paid-event handling follows screen semantics: paid events are still
  //    GROUPED (the calendar decides dot color/label by status); grouping does
  //    not silently drop them, so historical context is preserved where used.
  {
    const paid = { id: 'p-paid', entity: 'Netflix', amount: 12.99, payment_date: '2026-10-08', status: 'paid', is_recurring: true };
    const g = groupEventsByCalendarDate([adele, paid]);
    ok('G: paid event retained in grouping (status carried for the calendar)', g['2026-10-08'].some((p) => p.id === 'p-paid' && p.status === 'paid'));
    ok('G: pending + paid coexist on the same day', g['2026-10-08'].length === 2);
  }

  // H. one-time scheduled payment (is_recurring=false) marks its date.
  {
    const oneTime = { id: 'p-once', entity: 'Plumber', amount: 120, payment_date: '2026-10-08', status: 'pending', is_recurring: false, recurrence_frequency: null };
    ok('H: one-time payment marks its date', groupEventsByCalendarDate([oneTime])['2026-10-08'].length === 1);
  }

  // I. recurring scheduled payment marks its stored occurrence date.
  {
    ok('I: recurring payment marks its stored date', groupEventsByCalendarDate([adele])['2026-10-08'].length === 1);
  }

  // J. ACH rail has no effect — there is no rail field; date/status alone decide.
  {
    const ach = { id: 'p-ach', entity: 'Tuition ACH', amount: 580, payment_date: '2026-10-08', status: 'pending', payment_method: 'ach' };
    // An event WITHOUT any rail field marks identically to the ACH one, proving
    // the rail is never consulted.
    const noRail = { id: 'p-norail', entity: 'Tuition', amount: 580, payment_date: '2026-10-08', status: 'pending' };
    const g = groupEventsByCalendarDate([ach]);
    ok('J: ACH payment marks its date (rail ignored)', !!g['2026-10-08']);
    ok('J: rail presence/absence makes no difference', !!groupEventsByCalendarDate([noRail])['2026-10-08'] === !!g['2026-10-08']);
  }

  // K. manual cash has no effect — same as J, no source gate.
  {
    const cash = { id: 'p-cash', entity: 'Cash obligation', amount: 75, payment_date: '2026-10-08', status: 'pending' };
    ok('K: manual cash payment marks its date (no source gate)', !!groupEventsByCalendarDate([cash])['2026-10-08']);
  }

  // L. YYYY-MM-DD does not shift timezone — and a value WITH a time suffix keys
  //    to the same local day (the exact divergence this pass removes).
  {
    ok('L: plain date keys to itself', calendarDateKey('2026-10-08') === '2026-10-08');
    ok('L: date never shifts to Oct 7', calendarDateKey('2026-10-08') !== '2026-10-07');
    ok('L: timestamp suffix keys to the same local day', calendarDateKey('2026-10-08T00:00:00+00:00') === '2026-10-08');
    const withTime = { id: 'p-ts', entity: 'Timestamped', amount: 50, payment_date: '2026-10-08T03:30:00Z', status: 'pending' };
    ok('L: event with time component still marks Oct 8', !!groupEventsByCalendarDate([withTime])['2026-10-08']);
    ok('L: unparseable date produces no marker', calendarDateKey('not-a-date') === null && Object.keys(groupEventsByCalendarDate([{ payment_date: 'nope' }])).length === 0);
  }

  // M. September -> October navigation reveals October markers. Grouping is by
  //    the event's own date, not the displayed month, so navigating months only
  //    changes which keys the UI reads — the Oct 8 key already exists.
  {
    const g = groupEventsByCalendarDate([adele, bella]);
    const septemberKeys = Object.keys(g).filter((k) => k.startsWith('2026-09'));
    const octoberKeys = Object.keys(g).filter((k) => k.startsWith('2026-10'));
    ok('M: no September marker exists for this fixture', septemberKeys.length === 0);
    ok('M: October key present regardless of "current month"', octoberKeys.includes('2026-10-08'));
  }

  // N. no duplicate scheduled_payment is created — grouping is derived-only:
  //    it neither mutates inputs nor invents rows.
  {
    const input = [adele, bella];
    const before = JSON.stringify(input);
    const g = groupEventsByCalendarDate(input);
    const total = Object.values(g).reduce((n, arr) => n + arr.length, 0);
    ok('N: grouping creates no extra rows (count preserved)', total === input.length);
    ok('N: input array is not mutated', JSON.stringify(input) === before && input.length === 2);
    ok('N: grouped entries are the SAME object references (no copies)', g['2026-10-08'][0] === adele || g['2026-10-08'][0] === bella);
  }

  // O. existing card markers remain intact — read-only card-statement extras
  //    group by date just like payments, carrying their readOnly flag through.
  {
    const cardEvent = { id: 'card-1', entity: 'Visa Statement', amount: 430, payment_date: '2026-10-08', status: 'pending', readOnly: true };
    const g = groupEventsByCalendarDate([adele, bella, cardEvent]);
    ok('O: card statement marker retained', g['2026-10-08'].some((p) => p.readOnly === true && p.id === 'card-1'));
    ok('O: card + scheduled payments coexist on the day', g['2026-10-08'].length === 3);
  }

  // P. existing behavior not regressed — a plain-date-only dataset (the prior
  //    common case) groups identically to the old raw-string grouping.
  {
    const mix = [
      { id: 'a', entity: 'A', amount: 10, payment_date: '2026-09-20', status: 'pending' },
      { id: 'b', entity: 'B', amount: 20, payment_date: '2026-10-08', status: 'pending' },
      { id: 'c', entity: 'C', amount: 30, payment_date: '2026-10-08', status: 'paid' },
    ];
    const g = groupEventsByCalendarDate(mix);
    ok('P: plain-date grouping matches expected keys', Object.keys(g).sort().join(',') === '2026-09-20,2026-10-08');
    ok('P: Oct 8 holds both b and c', g['2026-10-08'].length === 2);
    ok('P: empty/undefined input is safe', Object.keys(groupEventsByCalendarDate([])).length === 0 && Object.keys(groupEventsByCalendarDate(undefined)).length === 0);
  }
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
