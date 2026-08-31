// Synthetic tests for the pure loan amortization engine (src/lib/loanMath.js).
// FICTIONAL numbers only. Loaded through Vite SSR so the date-fns import resolves
// exactly as in the build.
//
// Run (where Node exists) from repo root:  node tests/loanMath.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { simulate, analyzeLoan, describeMonths, payoffDateFrom } =
    await vite.ssrLoadModule('/src/lib/loanMath.js');

  // 1. Normal amortizing loan.
  const normal = simulate({ remainingPrincipal: 20000, apr: 6, monthlyPayment: 400 });
  ok('normal loan amortizes', normal.valid && normal.amortizes);
  ok('normal loan has finite months > 0', normal.months > 0 && Number.isFinite(normal.months));
  ok('normal loan accrues interest', normal.totalInterest > 0);
  ok('normal final payment is positive and <= a regular payment',
    normal.finalPaymentAmount > 0 && normal.finalPaymentAmount <= 400 + 0.01);

  // 2. Zero APR: pure principal division.
  const zero = simulate({ remainingPrincipal: 1200, apr: 0, monthlyPayment: 100 });
  ok('zero APR amortizes', zero.amortizes);
  ok('zero APR has no interest', zero.totalInterest === 0);
  ok('zero APR pays off in 12 months', zero.months === 12);

  // 3. Payment <= monthly interest -> non-amortizing warning.
  // 10000 @ 12% APR => 1%/mo => 100 interest month 1; paying exactly 100 never reduces principal.
  const stuck = simulate({ remainingPrincipal: 10000, apr: 12, monthlyPayment: 100 });
  ok('non-amortizing flagged', stuck.valid && stuck.amortizes === false);
  ok('non-amortizing has a warning', typeof stuck.warning === 'string' && stuck.warning.length > 0);

  // 4. One-time extra shortens payoff and saves interest.
  const a1 = analyzeLoan({ remainingPrincipal: 20000, apr: 6, monthlyPayment: 400, oneTimeExtraPrincipal: 3000 });
  ok('one-time extra shortens payoff', a1.scenario.months < a1.baseline.months);
  ok('one-time months saved > 0', a1.monthsSaved > 0);
  ok('one-time interest saved >= 0', a1.interestSaved >= 0);
  ok('one-time interest saved is actually positive here', a1.interestSaved > 0);

  // 5. Recurring extra shortens payoff.
  const a2 = analyzeLoan({ remainingPrincipal: 20000, apr: 6, monthlyPayment: 400, recurringExtraMonthly: 100 });
  ok('recurring extra shortens payoff', a2.scenario.months < a2.baseline.months);
  ok('recurring months saved > 0', a2.monthsSaved > 0);
  ok('recurring interest saved >= 0', a2.interestSaved >= 0);

  // 6. Combined one-time + recurring is at least as good as either alone.
  const a3 = analyzeLoan({ remainingPrincipal: 20000, apr: 6, monthlyPayment: 400, oneTimeExtraPrincipal: 3000, recurringExtraMonthly: 100 });
  ok('combined saves at least as much time as one-time alone', a3.monthsSaved >= a1.monthsSaved);

  // 7. Huge one-time extra pays the loan off immediately.
  const paid = simulate({ remainingPrincipal: 20000, apr: 6, monthlyPayment: 400, oneTimeExtraPrincipal: 25000 });
  ok('huge extra -> paid off immediately', paid.paidOffImmediately && paid.months === 0);
  ok('paid off has zero interest', paid.totalInterest === 0);

  // 8. Final payment never produces a negative balance (interest saved bounded by baseline interest).
  ok('scenario interest never exceeds baseline', a1.scenario.totalInterest <= a1.baseline.totalInterest + 0.01);

  // 9. Invalid inputs fail safely (no throw, valid:false).
  ok('negative principal invalid', simulate({ remainingPrincipal: -100, apr: 6, monthlyPayment: 400 }).valid === false);
  ok('zero payment invalid', simulate({ remainingPrincipal: 10000, apr: 6, monthlyPayment: 0 }).valid === false);
  ok('missing inputs invalid', simulate({}).valid === false);
  let threw = false;
  try { simulate({ remainingPrincipal: 'x', apr: null, monthlyPayment: undefined }); } catch { threw = true; }
  ok('invalid input never throws', threw === false);

  // 10. Helpers.
  ok('describeMonths(110) = 9 years 2 months', describeMonths(110) === '9 years 2 months');
  ok('describeMonths(12) = 1 year', describeMonths(12) === '1 year');
  ok('describeMonths(0) = 0 months', describeMonths(0) === '0 months');
  const d = payoffDateFrom('2026-09-01', 12);
  ok('payoffDateFrom month 12 -> 11 months later', d && d.getFullYear() === 2027 && d.getMonth() === 7); // Aug 2027
  ok('payoffDateFrom(null) -> null', payoffDateFrom(null, 12) === null);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
