import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import Icon from '../../components/AppIcon';
import BalanceScanner from '../../components/BalanceScanner';
import { nextDueDate } from '../../lib/cardGuard';
import { trackProductEvent } from '../../lib/analytics';

// Flow Lite: the minimal Cards -> Flow onboarding bridge. It asks only three
// things (available cash, next income amount, next income date) and shows a
// simple projected-cash summary using the SAME data the full Cash Flow page
// already loads (unpaid card statements + pending scheduled payments).
// Everyday-spending modeling is intentionally excluded to keep setup friction
// near zero.
//
// TIMING MODEL: the primary coverage test is BEFORE the next income arrives
// (available cash minus commitments due on/before the next-income date). The
// post-income figure is shown only as secondary information and is never used
// to claim that pre-payday obligations are covered.
//
// SEPARATION FROM THE FULL ENGINE: the precise next-income DATE is stored on
// its own key (cashflow_next_income_date) and is intentionally kept SEPARATE
// from the full engine's recurring income model (cashflow_income_day). Flow
// Lite never overwrites the recurring day-of-month behind the user's back --
// choosing a one-time next-income date must not silently redefine a recurring
// schedule. The recurring income day is only read (never written) here, and
// only to prefill the date for convenience. Richer income-source modeling
// (multiple sources, a true date-based recurring schedule) is a follow-up.

const LS_NEXT_INCOME_DATE = 'cashflow_next_income_date';
const LS_INCOME_DAY = 'cashflow_income_day'; // read-only here (prefill only)

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const readInitialDate = () => {
  try {
    const stored = localStorage.getItem(LS_NEXT_INCOME_DATE);
    if (stored) return stored;
    // Prefill for existing users: derive the next occurrence of their saved
    // recurring income day so they see a result without re-entering anything.
    const day = localStorage.getItem(LS_INCOME_DAY);
    if (day) {
      const d = nextDueDate(day);
      if (d) return format(d, 'yyyy-MM-dd');
    }
  } catch {
    // Ignore storage read errors and start with an empty date.
  }
  return '';
};

const FlowLiteSetup = ({
  cards,
  payments,
  loading,
  availableCash,
  incomeAmount,
  onCashChange,
  onIncomeAmountChange,
  onBalanceApplied,
  onSeeFullFlow,
}) => {
  const [nextIncomeDate, setNextIncomeDate] = useState(readInitialDate);
  const [showScanner, setShowScanner] = useState(false);

  // Explicit apply: only the user's confirmation in BalanceScanner reaches the
  // existing available-cash setter. Available cash is never auto-overwritten.
  const applyScannedTotal = (total) => {
    onCashChange(String(Math.round((Number(total) || 0) * 100) / 100));
    if (onBalanceApplied) onBalanceApplied();
    trackProductEvent('balance_scan_applied', { source_screen: 'flow' });
    setShowScanner(false);
  };

  const handleDateChange = (value) => {
    setNextIncomeDate(value);
    try {
      if (value) localStorage.setItem(LS_NEXT_INCOME_DATE, value);
      else localStorage.removeItem(LS_NEXT_INCOME_DATE);
    } catch {
      // Non-fatal: keep the in-memory value even if persistence fails.
    }
    // NOTE: deliberately does NOT write cashflow_income_day. The one-time Lite
    // date must not silently redefine the full engine's recurring schedule.
  };

  const incomeDateObj =
    nextIncomeDate && !Number.isNaN(parseISO(nextIncomeDate).getTime())
      ? parseISO(nextIncomeDate)
      : null;

  // Known commitments due BEFORE the next income = unpaid card statements +
  // pending scheduled payments that fall on/before the next-income date.
  // Same-day (== income date) commitments are counted here (conservative): the
  // Lite model has no reliable proof that income posts before those debits, so
  // they must be covered from cash on hand. Reuses existing data only.
  const commitments = useMemo(() => {
    if (!incomeDateObj) return { items: [], total: 0 };

    const items = [];

    (cards || []).forEach((c) => {
      if (c.statement_paid) return;
      const bal = Number(c.statement_balance) || 0;
      if (bal <= 0 || !c.due_day) return;
      const due = nextDueDate(c.due_day);
      if (due && due <= incomeDateObj) {
        items.push({ label: `${c.card_name} statement`, amount: bal, date: due });
      }
    });

    (payments || []).forEach((p) => {
      if (p.status === 'paid' || !p.payment_date) return;
      const d = parseISO(p.payment_date);
      if (Number.isNaN(d.getTime())) return;
      if (d <= incomeDateObj) {
        items.push({
          label: p.entity,
          amount: Math.abs(Number(p.amount) || 0),
          date: d,
        });
      }
    });

    items.sort((a, b) => a.date - b.date);
    const total = items.reduce((sum, i) => sum + i.amount, 0);
    return { items, total };
  }, [cards, payments, nextIncomeDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const cash = parseFloat(availableCash) || 0;
  const income = parseFloat(incomeAmount) || 0;
  // PRIMARY test: can current cash cover commitments due before payday?
  const cashBeforeIncome = cash - commitments.total;
  // SECONDARY, informational only: position once next income arrives.
  const projectedAfterIncome = cashBeforeIncome + income;

  const hasMinInputs =
    String(availableCash ?? '') !== '' &&
    String(incomeAmount ?? '') !== '' &&
    !!incomeDateObj;

  // Fire flow_setup_completed once, when the minimum valid inputs first exist.
  const setupCompleteFired = useRef(false);
  useEffect(() => {
    if (hasMinInputs && !setupCompleteFired.current) {
      setupCompleteFired.current = true;
      trackProductEvent('flow_setup_completed', { source_screen: 'flow' });
    }
  }, [hasMinInputs]);

  const inputCls =
    'w-full border border-border rounded-lg p-3 text-lg font-bold text-foreground outline-none bg-background focus:ring-2 focus:ring-blue-500';

  return (
    <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 shadow-sm p-5 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="bg-blue-600/10 p-2.5 rounded-xl shrink-0">
          <Icon name="Wallet" size={22} className="text-blue-600" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-foreground">
            Can you comfortably cover what&apos;s due?
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tell MoFlow what cash you have now and when money comes in next.
          </p>
        </div>
      </div>

      {/* THREE MINIMAL INPUTS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Available cash now
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={availableCash}
            onChange={(e) => onCashChange(e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => {
              const opening = !showScanner;
              if (opening) trackProductEvent('balance_scan_started', { source_screen: 'flow' });
              setShowScanner(opening);
            }}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700"
          >
            <Icon name="Camera" size={14} />
            Scan balances
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Next income amount
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={incomeAmount}
            onChange={(e) => onIncomeAmountChange(e.target.value)}
            placeholder="0.00"
            className={`${inputCls} text-emerald-600`}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Next income date
          </label>
          <input
            type="date"
            value={nextIncomeDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className={`${inputCls} text-base`}
          />
        </div>
      </div>

      {showScanner && (
        <BalanceScanner onApply={applyScannedTotal} onClose={() => setShowScanner(false)} />
      )}

      {/* FLOW LITE RESULT */}
      {loading ? (
        <div className="mt-5 h-24 rounded-xl bg-card/60 animate-pulse" />
      ) : hasMinInputs ? (
        <div className="mt-5 rounded-xl border border-border bg-card p-4">
          {/* PRIMARY: coverage BEFORE next income */}
          <div className="grid grid-cols-2 gap-y-1.5 text-sm">
            <span className="text-muted-foreground">Available now</span>
            <span className="text-right font-semibold text-foreground">{money(cash)}</span>

            <span className="text-muted-foreground">
              Known commitments before next income
              {commitments.items.length > 0 ? ` (${commitments.items.length})` : ''}
            </span>
            <span className="text-right font-semibold text-foreground">-{money(commitments.total)}</span>

            <span className="col-span-2 border-t border-border my-1.5" />

            <span className="font-bold text-foreground">Remaining before next income</span>
            <span
              className={`text-right font-extrabold ${
                cashBeforeIncome < 0 ? 'text-red-600' : 'text-foreground'
              }`}
            >
              {money(cashBeforeIncome)}
            </span>
          </div>

          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              cashBeforeIncome < 0
                ? 'bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300 border border-red-200'
                : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200'
            }`}
          >
            {cashBeforeIncome < 0 ? (
              <>
                You may be short by approximately{' '}
                <span className="font-bold">{money(Math.abs(cashBeforeIncome))}</span> before
                your next income on{' '}
                <span className="font-bold">{format(incomeDateObj, 'MMM d')}</span>.
              </>
            ) : (
              <>
                Your known commitments before your next income on{' '}
                <span className="font-bold">{format(incomeDateObj, 'MMM d')}</span> are
                projected to be covered.
              </>
            )}
          </div>

          {/* SECONDARY: informational post-income position */}
          <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm border-t border-border pt-3">
            <span className="text-muted-foreground">Next income</span>
            <span className="text-right font-semibold text-emerald-600">+{money(income)}</span>

            <span className="text-muted-foreground">Projected after next income</span>
            <span
              className={`text-right font-bold ${
                projectedAfterIncome < 0 ? 'text-red-600' : 'text-foreground'
              }`}
            >
              {money(projectedAfterIncome)}
            </span>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            A projection from your known commitments only (unpaid card statements and
            scheduled payments due on/before your next income). Coverage is judged on
            cash available <span className="font-semibold">before</span> your next income;
            the post-income figure is informational and does not cover pre-payday
            obligations. It does not model everyday spending.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Enter your available cash, next income amount, and next income date to see a
          quick projection.
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onSeeFullFlow}
          className="inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
        >
          See full Flow
          <Icon name="ArrowDown" size={16} />
        </button>
      </div>
    </div>
  );
};

export default FlowLiteSetup;
