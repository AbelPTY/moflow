// Pure, deterministic amortization engine for MoFlow Loans V1.
//
// NO AI is ever used for loan math. Everything here is a plain month-by-month
// simulation of a standard fixed-rate amortizing loan.
//
// V1 assumptions (must be disclosed in the UI):
//   * fixed APR, monthly payments, interest accrues monthly
//   * standard amortizing loan; extra payments reduce principal directly
//   * no prepayment penalty; no escrow/taxes/insurance
//   * the regular payment stays constant unless a scenario adds a recurring
//     extra; extra principal does NOT recast (lower) the monthly payment
import { addMonths, parseISO } from 'date-fns';

const MAX_MONTHS = 1200; // safety cap (100 years)

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Simulate a loan to payoff. Returns a plain result object; never throws.
//   remainingPrincipal, apr (percent), monthlyPayment  -- required, > 0 / >= 0
//   oneTimeExtraPrincipal  -- applied to principal BEFORE the first month
//   recurringExtraMonthly  -- added to every month's payment (extra principal)
export function simulate({
  remainingPrincipal,
  apr,
  monthlyPayment,
  oneTimeExtraPrincipal = 0,
  recurringExtraMonthly = 0,
} = {}) {
  const P0 = Number(remainingPrincipal);
  const rate = Number(apr) / 100 / 12;
  const pay = Number(monthlyPayment);
  const oneTime = Math.max(0, Number(oneTimeExtraPrincipal) || 0);
  const recurring = Math.max(0, Number(recurringExtraMonthly) || 0);

  // Invalid inputs fail safely (no throw, clearly flagged).
  if (
    !Number.isFinite(P0) || P0 <= 0 ||
    !Number.isFinite(pay) || pay <= 0 ||
    !Number.isFinite(rate) || rate < 0
  ) {
    return {
      valid: false,
      amortizes: false,
      paidOffImmediately: false,
      months: 0,
      totalInterest: 0,
      finalPaymentAmount: 0,
      warning: 'Enter a positive principal and payment, and a non-negative APR.',
    };
  }

  let balance = P0 - oneTime;

  // A one-time extra >= the whole balance pays the loan off up front.
  if (balance <= 0) {
    return {
      valid: true,
      amortizes: true,
      paidOffImmediately: true,
      months: 0,
      totalInterest: 0,
      finalPaymentAmount: 0,
      warning: '',
    };
  }

  const payThisMonth = pay + recurring;
  let totalInterest = 0;
  let months = 0;
  let finalPaymentAmount = 0;

  for (let i = 0; i < MAX_MONTHS; i += 1) {
    const interest = balance * rate;
    const principalReduction = payThisMonth - interest;

    // Payment doesn't cover interest -> the balance would never fall.
    if (principalReduction <= 0) {
      return {
        valid: true,
        amortizes: false,
        paidOffImmediately: false,
        months: Infinity,
        totalInterest: Infinity,
        finalPaymentAmount: 0,
        warning:
          'This payment does not cover the monthly interest, so the balance would never go down.',
      };
    }

    months += 1;
    totalInterest += interest;

    // Final (possibly partial) payment: never force a full payment or go negative.
    if (balance + interest <= payThisMonth) {
      finalPaymentAmount = round2(balance + interest);
      balance = 0;
      break;
    }

    balance -= principalReduction;
  }

  if (balance > 0) {
    // Hit the safety cap without paying off.
    return {
      valid: true,
      amortizes: false,
      paidOffImmediately: false,
      months: MAX_MONTHS,
      totalInterest: round2(totalInterest),
      finalPaymentAmount: 0,
      warning: 'At this payment the loan would take over 100 years to pay off.',
    };
  }

  return {
    valid: true,
    amortizes: true,
    paidOffImmediately: false,
    months,
    totalInterest: round2(totalInterest),
    finalPaymentAmount,
    warning: '',
  };
}

// The estimated payoff Date from a next-payment date + number of months.
// Month 1 lands on nextPaymentDate, so payoff is nextPaymentDate + (months-1).
export function payoffDateFrom(nextPaymentDate, months) {
  if (!nextPaymentDate || !Number.isFinite(months) || months < 1) return null;
  const start = parseISO(nextPaymentDate);
  if (Number.isNaN(start.getTime())) return null;
  return addMonths(start, months - 1);
}

// Human phrase for a duration in months, e.g. "9 years 2 months", "1 year",
// "3 months". Pure and testable.
export function describeMonths(totalMonths) {
  const m = Math.max(0, Math.round(Number(totalMonths) || 0));
  if (m === 0) return '0 months';
  const years = Math.floor(m / 12);
  const months = m % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}

// Full analysis: baseline + optional scenario + savings. This is what the UI
// consumes. Time saved and interest saved are baseline minus scenario, floored
// at zero (a scenario can never be worse than baseline for extra payments).
export function analyzeLoan({
  remainingPrincipal,
  apr,
  monthlyPayment,
  nextPaymentDate = null,
  oneTimeExtraPrincipal = 0,
  recurringExtraMonthly = 0,
} = {}) {
  const baseline = simulate({ remainingPrincipal, apr, monthlyPayment });

  const hasScenario =
    (Number(oneTimeExtraPrincipal) || 0) > 0 ||
    (Number(recurringExtraMonthly) || 0) > 0;

  const scenario = hasScenario
    ? simulate({
        remainingPrincipal,
        apr,
        monthlyPayment,
        oneTimeExtraPrincipal,
        recurringExtraMonthly,
      })
    : null;

  const baselinePayoffDate = baseline.amortizes
    ? payoffDateFrom(nextPaymentDate, baseline.months)
    : null;

  const scenarioPayoffDate =
    scenario && scenario.amortizes
      ? payoffDateFrom(nextPaymentDate, scenario.months)
      : null;

  let monthsSaved = null;
  let interestSaved = null;
  if (baseline.amortizes && scenario && scenario.amortizes) {
    monthsSaved = Math.max(0, baseline.months - scenario.months);
    interestSaved = Math.max(0, round2(baseline.totalInterest - scenario.totalInterest));
  }

  return {
    baseline,
    scenario,
    baselinePayoffDate,
    scenarioPayoffDate,
    monthsSaved,
    interestSaved,
  };
}

export default analyzeLoan;
