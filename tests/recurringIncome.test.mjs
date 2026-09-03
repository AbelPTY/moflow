// Flow V2.7 — semi-monthly / quincenal recurrence tests. Pure engine, loaded
// through Vite SSR (no DB, no network). FICTIONAL amounts only.
//
// Run (where Node exists) from repo root:  node tests/recurringIncome.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

const D = (y, m, d) => new Date(y, m - 1, d); // 1-indexed month for readability

try {
  const RI = await vite.ssrLoadModule('/src/lib/recurringIncome.js');
  const {
    INCOME_FREQUENCIES, LAST_DAY, DEFAULT_SEMI_MONTHLY,
    incomeOccurrences, normalizeSemiMonthly, validateSemiMonthly,
    resolveDayInMonth, daySpecsCollide,
  } = RI;
  const EN = await vite.ssrLoadModule('/src/i18n/en-US.js');
  const ES = await vite.ssrLoadModule('/src/i18n/es-PA.js');

  const semi = (first_day, second_day, first_amount, second_amount, same_amount = false) =>
    ({ first_day, second_day, first_amount, second_amount, same_amount });
  const occ = (freq, cfg, start, end, opts) => incomeOccurrences(freq, cfg, start, end, opts);
  const days = (list) => list.map((o) => o.dateStr);

  // S. canonical frequency value.
  ok('S: canonical includes semi_monthly', INCOME_FREQUENCIES.includes('semi_monthly'));
  ok('S: LAST_DAY canonical token', LAST_DAY === 'last_day');

  // ---- Whole-year cadence -------------------------------------------------
  const yearStart = D(2025, 1, 1);
  const yearEnd = D(2025, 12, 31);
  const semiYear = occ('semi_monthly', semi(15, LAST_DAY, 1000, 1000, true), yearStart, yearEnd, { strictlyAfterStart: false });
  // B. 24 occurrences over a full normal year.
  ok('B: semi-monthly = 24 / year', semiYear.length === 24);
  // biweekly ~26/year.
  const biYear = occ('biweekly', { anchor: '2025-01-03', amount: 1000 }, yearStart, yearEnd, { strictlyAfterStart: false });
  ok('C: biweekly ~26/year', biYear.length === 26 || biYear.length === 27);
  const weeklyYear = occ('weekly', { anchor: '2025-01-03', amount: 500 }, yearStart, yearEnd, { strictlyAfterStart: false });
  ok('C2: weekly ~52/year', weeklyYear.length === 52 || weeklyYear.length === 53);

  // A. semi-monthly != biweekly (different count AND different date pattern).
  ok('A: semi != biweekly (count)', semiYear.length !== biYear.length);
  ok('A: semi keeps calendar 15th every month', semiYear.filter((o) => o.installment === 1).every((o) => o.dateStr.slice(8) === '15'));
  ok('A: biweekly is NOT anchored to the 15th', !biYear.every((o) => o.dateStr.slice(8) === '15'));

  // ---- Month-end date safety ---------------------------------------------
  // D. Jan 15 + Jan 31.
  const jan = occ('semi_monthly', semi(15, LAST_DAY, 1850, 1950), D(2025, 1, 1), D(2025, 1, 31), { strictlyAfterStart: false });
  ok('D: Jan -> 15 + 31', days(jan).join(',') === '2025-01-15,2025-01-31');
  // E. Feb 15 + Feb 28 (non-leap).
  const feb = occ('semi_monthly', semi(15, LAST_DAY, 1850, 1950), D(2025, 2, 1), D(2025, 2, 28), { strictlyAfterStart: false });
  ok('E: Feb 2025 -> 15 + 28', days(feb).join(',') === '2025-02-15,2025-02-28');
  // F. leap-year Feb 15 + Feb 29.
  const febLeap = occ('semi_monthly', semi(15, LAST_DAY, 1850, 1950), D(2024, 2, 1), D(2024, 2, 29), { strictlyAfterStart: false });
  ok('F: Feb 2024 -> 15 + 29', days(febLeap).join(',') === '2024-02-15,2024-02-29');
  // G. Apr 15 + Apr 30.
  const apr = occ('semi_monthly', semi(15, LAST_DAY, 1850, 1950), D(2025, 4, 1), D(2025, 4, 30), { strictlyAfterStart: false });
  ok('G: Apr -> 15 + 30', days(apr).join(',') === '2025-04-15,2025-04-30');
  // Clamp: numeric day 31 in short months resolves to the real last day.
  ok('clamp: day 31 in Feb 2025 -> Feb 28', resolveDayInMonth(2025, 1, 31).getDate() === 28);
  ok('clamp: day 31 in Apr -> Apr 30', resolveDayInMonth(2025, 3, 31).getDate() === 30);
  ok('last_day: Feb 2024 -> 29', resolveDayInMonth(2024, 1, LAST_DAY).getDate() === 29);

  // H. custom first/second days.
  const custom = occ('semi_monthly', semi(5, 20, 800, 900), D(2025, 6, 1), D(2025, 6, 30), { strictlyAfterStart: false });
  ok('H: custom 5 + 20', days(custom).join(',') === '2025-06-05,2025-06-20');

  // I. unequal installment amounts.
  ok('I: unequal amounts kept', jan[0].amount === 1850 && jan[1].amount === 1950);

  // J. same-amount behavior mirrors the first amount into the second.
  const same = normalizeSemiMonthly({ first_day: 15, second_day: LAST_DAY, first_amount: 2000, second_amount: 111, same_amount: true });
  ok('J: same_amount mirrors first into second', same.first_amount === 2000 && same.second_amount === 2000);
  const diff = normalizeSemiMonthly({ first_day: 15, second_day: LAST_DAY, first_amount: 2000, second_amount: 111, same_amount: false });
  ok('J: independent amounts preserved', diff.first_amount === 2000 && diff.second_amount === 111);

  // ---- Horizons -----------------------------------------------------------
  // today Sep 12, config 15 + last_day.
  const cfg = semi(15, LAST_DAY, 1850, 1950);
  const t0 = D(2025, 9, 12);
  // K. 7-day horizon -> only Sep 15.
  const h7 = occ('semi_monthly', cfg, t0, D(2025, 9, 19));
  ok('K: 7-day horizon includes only Sep 15', days(h7).join(',') === '2025-09-15');
  // L. 14-day horizon -> Sep 15 (not Sep 30).
  const h14 = occ('semi_monthly', cfg, t0, D(2025, 9, 26));
  ok('L: 14-day horizon Sep 15 only', days(h14).join(',') === '2025-09-15');
  // M. 30-day horizon -> Sep 15 + Sep 30 (not Oct 15).
  const h30 = occ('semi_monthly', cfg, t0, D(2025, 10, 12));
  ok('M: 30-day horizon Sep 15 + Sep 30', days(h30).join(',') === '2025-09-15,2025-09-30');
  // N. custom horizon across a month boundary -> Sep 30 + Oct 15.
  const hCross = occ('semi_monthly', cfg, D(2025, 9, 28), D(2025, 10, 16));
  ok('N: cross-boundary Sep 30 + Oct 15', days(hCross).join(',') === '2025-09-30,2025-10-15');
  // strictlyAfterStart: an occurrence exactly on `start` is excluded by default.
  const onStart = occ('semi_monthly', cfg, D(2025, 9, 15), D(2025, 9, 30));
  ok('horizon: occurrence on start excluded by default', days(onStart).join(',') === '2025-09-30');

  // O. existing MONTHLY recurrence unchanged (one inflow per month on the day).
  const monthly = occ('monthly', { day: 15, amount: 3000 }, D(2025, 9, 12), D(2025, 12, 31));
  ok('O: monthly = one per month on the 15th', days(monthly).join(',') === '2025-09-15,2025-10-15,2025-11-15,2025-12-15');
  ok('O: monthly amount unchanged', monthly.every((o) => o.amount === 3000 && o.installment === 1));

  // P. weekly cadence is exactly every 7 days.
  const wk = occ('weekly', { anchor: '2025-09-01', amount: 400 }, D(2025, 9, 1), D(2025, 9, 30), { strictlyAfterStart: false });
  const gap = (list) => list.slice(1).map((o, i) => (o.date - list[i].date) / 86400000);
  ok('P: weekly gaps all 7 days', gap(wk).every((g) => g === 7));
  // Q. biweekly cadence is exactly every 14 days (distinct from semi-monthly).
  const bw = occ('biweekly', { anchor: '2025-09-01', amount: 800 }, D(2025, 9, 1), D(2025, 12, 1), { strictlyAfterStart: false });
  ok('Q: biweekly gaps all 14 days', gap(bw).every((g) => g === 14));
  ok('Q: biweekly != semi (dates diverge)', JSON.stringify(days(bw)) !== JSON.stringify(days(semiYear.filter((o) => o.dateStr >= '2025-09-01'))));

  // R. duplicate / reversed / valid config validation.
  ok('R: 15 + last_day valid', validateSemiMonthly({ first_day: 15, second_day: LAST_DAY }).valid === true);
  ok('R: 15 + 15 -> duplicateDate', validateSemiMonthly({ first_day: 15, second_day: 15 }).error === 'duplicateDate');
  ok('R: 31 + last_day -> duplicateDate', validateSemiMonthly({ first_day: 31, second_day: LAST_DAY }).error === 'duplicateDate');
  ok('R: 30 + last_day -> duplicateDate (Apr/Jun/Sep/Nov collide)', validateSemiMonthly({ first_day: 30, second_day: LAST_DAY }).error === 'duplicateDate');
  ok('R: 20 + 5 -> orderReversed', validateSemiMonthly({ first_day: 20, second_day: 5 }).error === 'orderReversed');
  ok('R: 15 + 30 valid', validateSemiMonthly({ first_day: 15, second_day: 30 }).valid === true);
  ok('R: collide helper (31 vs last_day in Jan)', daySpecsCollide(2025, 0, 31, LAST_DAY) === true);
  ok('R: no collide (15 vs last_day in Jan)', daySpecsCollide(2025, 0, 15, LAST_DAY) === false);

  // T. EN / ES labels distinguish quincenal from biweekly.
  const enFreq = EN.default.flow.freq;
  const esFreq = ES.default.flow.freq;
  ok('T: EN twiceMonthly = "Twice monthly"', enFreq.semiMonthly === 'Twice monthly');
  ok('T: ES twiceMonthly = "Quincenal"', esFreq.semiMonthly === 'Quincenal');
  ok('T: ES biweekly = "Cada 2 semanas" (not Quincenal)', esFreq.biweekly === 'Cada 2 semanas' && esFreq.biweekly !== esFreq.semiMonthly);
  ok('T: ES last-day label present', ES.default.flow.semiMonthly.lastDay === 'Último día del mes');
  ok('T: ES first/second payment labels', ES.default.flow.semiMonthly.firstPayment === 'Primera quincena' && ES.default.flow.semiMonthly.secondPayment === 'Segunda quincena');
  ok('T: ES same-amount label', ES.default.flow.semiMonthly.sameAmount === 'Mismo monto para ambos pagos');

  // U. Projected available cash receives BOTH events independently.
  // Simulate a running balance across a month with a spend between paydays.
  const cash0 = 500;
  const monthOcc = occ('semi_monthly', semi(15, LAST_DAY, 1850, 1950), D(2025, 9, 1), D(2025, 9, 30), { strictlyAfterStart: false });
  ok('U: two distinct dated events', monthOcc.length === 2 && monthOcc[0].dateStr !== monthOcc[1].dateStr);
  // Interleave a -1000 spend on the 20th; balance must reflect each inflow on its own date.
  const stream = [
    { date: D(2025, 9, 15), amt: monthOcc[0].amount },
    { date: D(2025, 9, 20), amt: -1000 },
    { date: D(2025, 9, 30), amt: monthOcc[1].amount },
  ].sort((a, b) => a.date - b.date);
  let running = cash0; const balances = stream.map((s) => (running += s.amt));
  ok('U: after 1st payment', balances[0] === 500 + 1850);
  ok('U: after mid-month spend', balances[1] === 500 + 1850 - 1000);
  ok('U: after 2nd payment', balances[2] === 500 + 1850 - 1000 + 1950);
  ok('U: both counted, not combined into one', (monthOcc[0].amount + monthOcc[1].amount) === 3800);

  console.log(`\nRecurring-income (semi-monthly) tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}
