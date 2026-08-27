import React, { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import UpcomingPaymentsCalendar from '../../components/UpcomingPaymentsCalendar';
import useScheduledPayments from '../../hooks/useScheduledPayments';
import useTransactions from '../../hooks/useTransactions';
import useCreditCards from '../../hooks/useCreditCards';
import { nextDueDate } from '../../lib/cardGuard';

const WINDOW_OPTIONS = [7, 14, 30];
const HISTORY_DAYS = 60;

const LS_CASH = 'cashflow_available_cash';
const LS_INCOME_AMT = 'cashflow_income_amount';
const LS_INCOME_DAY = 'cashflow_income_day';
const LS_EXPECTED_DAILY = 'cashflow_expected_daily_spend';

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const looksLikeCreditAccount = (account) => {
  const value = String(account || '').toLowerCase();
  return (
    value.includes('credit card') ||
    value.includes('mastercard') ||
    value.includes('visa') ||
    /\bcc\b/.test(value)
  );
};

const dateForDayOfMonth = (year, monthIndex, day) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay));
};

const CashFlow = () => {
  const { payments, loading: payLoading } = useScheduledPayments();
  const { transactions, loading: txLoading } = useTransactions(null, {
    filters: { dateRange: 'all' },
  });
  const { cards, loading: cardsLoading } = useCreditCards();

  const [windowDays, setWindowDays] = useState(14);
  const [availableCash, setAvailableCash] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeDay, setIncomeDay] = useState('');
  const [expectedDailySpend, setExpectedDailySpend] = useState('');
  const [whatIfSpend, setWhatIfSpend] = useState('');

  // Keep the existing simple recurring-income model for now:
  // latest month's INCOME total, using the latest deposit's day-of-month.
  const detectedIncome = useMemo(() => {
    if (!transactions?.length) return { amount: 0, day: 1 };

    const incomes = transactions
      .filter(
        (t) =>
          t.budgetBucket === 'INCOME' &&
          Number(t.amount) > 0 &&
          t.dateString
      )
      .sort((a, b) => parseISO(b.dateString) - parseISO(a.dateString));

    if (incomes.length === 0) return { amount: 0, day: 1 };

    const latest = incomes[0];
    const day = parseInt(latest.dateString.split('-')[2], 10) || 1;
    const ym = latest.dateString.substring(0, 7);

    const monthTotal = incomes
      .filter((t) => t.dateString.substring(0, 7) === ym)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    return { amount: Math.round(monthTotal), day };
  }, [transactions]);

  // Estimate everyday CASH spending from recent history.
  //
  // Important:
  // - excludes transfers and credit-card purchase accounts because those do not
  //   reduce checking/savings cash at the moment of purchase;
  // - uses only NEEDS/WANTS expenses;
  // - excludes transactions that clearly match a scheduled payment entity,
  //   reducing double-counting with known commitments;
  // - remains editable by the user.
  const detectedDailySpend = useMemo(() => {
    if (!transactions?.length) {
      return { daily: 0, count: 0, total: 0 };
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const historyStart = addDays(start, -HISTORY_DAYS);

    const scheduledLabels = (payments || [])
      .map((p) => normalizeText(p.entity))
      .filter((label) => label.length >= 4);

    const qualifying = transactions.filter((t) => {
      if (!t.dateString || Number(t.amount) >= 0) return false;
      if (t.is_transfer) return false;
      if (!['NEEDS', 'WANTS'].includes(t.budgetBucket)) return false;
      if (looksLikeCreditAccount(t.account)) return false;

      const d = parseISO(t.dateString);
      if (Number.isNaN(d.getTime()) || d < historyStart || d >= start) {
        return false;
      }

      const description = normalizeText(
        `${t.merchant || ''} ${t.description || ''}`
      );

      const matchesKnownBill = scheduledLabels.some(
        (label) => description.includes(label)
      );

      return !matchesKnownBill;
    });

    const total = qualifying.reduce(
      (sum, t) => sum + Math.abs(Number(t.amount) || 0),
      0
    );

    return {
      daily: Math.round((total / HISTORY_DAYS) * 100) / 100,
      count: qualifying.length,
      total,
    };
  }, [transactions, payments]);

  // Load persisted assumptions. If no value has been set yet, seed from history.
  useEffect(() => {
    const cashStored = localStorage.getItem(LS_CASH);
    if (cashStored !== null) setAvailableCash(cashStored);

    const incomeStored = localStorage.getItem(LS_INCOME_AMT);
    setIncomeAmount(
      incomeStored !== null
        ? incomeStored
        : detectedIncome.amount
          ? String(detectedIncome.amount)
          : ''
    );

    const incomeDayStored = localStorage.getItem(LS_INCOME_DAY);
    setIncomeDay(
      incomeDayStored !== null
        ? incomeDayStored
        : detectedIncome.day
          ? String(detectedIncome.day)
          : ''
    );

    const spendStored = localStorage.getItem(LS_EXPECTED_DAILY);
    setExpectedDailySpend(
      spendStored !== null
        ? spendStored
        : detectedDailySpend.daily
          ? String(detectedDailySpend.daily)
          : ''
    );
  }, [
    detectedIncome.amount,
    detectedIncome.day,
    detectedDailySpend.daily,
  ]);

  const setCash = (value) => {
    setAvailableCash(value);
    localStorage.setItem(LS_CASH, value);
  };

  const setIncAmt = (value) => {
    setIncomeAmount(value);
    localStorage.setItem(LS_INCOME_AMT, value);
  };

  const setIncDay = (value) => {
    setIncomeDay(value);
    localStorage.setItem(LS_INCOME_DAY, value);
  };

  const setDailySpend = (value) => {
    setExpectedDailySpend(value);
    localStorage.setItem(LS_EXPECTED_DAILY, value);
  };

  const cash = parseFloat(availableCash) || 0;
  const incAmt = parseFloat(incomeAmount) || 0;
  const incDay = parseInt(incomeDay, 10) || 0;
  const dailySpend = Math.max(0, parseFloat(expectedDailySpend) || 0);
  const scenarioSpend = Math.max(0, parseFloat(whatIfSpend) || 0);

  const proj = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowEnd = addDays(start, windowDays);
    const events = [];

    // Pending scheduled bills. Overdue bills are pulled to today.
    (payments || []).forEach((p) => {
      if (p.status === 'paid' || !p.payment_date) return;

      const d = parseISO(p.payment_date);
      if (Number.isNaN(d.getTime()) || d > windowEnd) return;

      const overdue = d < start;
      const eventDate = overdue ? start : d;

      events.push({
        date: eventDate,
        dateStr: format(eventDate, 'yyyy-MM-dd'),
        label: p.entity,
        amount: -Math.abs(Number(p.amount) || 0),
        type: 'bill',
        overdue,
      });
    });

    // Future recurring income.
    // Strictly future (> today) so "available cash now" does not double-count
    // income that may already have posted today.
    if (incAmt > 0 && incDay >= 1 && incDay <= 31) {
      for (let m = 0; m <= 2; m += 1) {
        const d = dateForDayOfMonth(
          start.getFullYear(),
          start.getMonth() + m,
          incDay
        );

        if (d > start && d <= windowEnd) {
          events.push({
            date: d,
            dateStr: format(d, 'yyyy-MM-dd'),
            label: 'Expected income',
            amount: incAmt,
            type: 'income',
          });
        }
      }
    }

    // Unpaid credit-card statement balances due inside the selected window.
    (cards || []).forEach((card) => {
      if (card.statement_paid) return;

      const balance = Number(card.statement_balance) || 0;
      const due = nextDueDate(card.due_day);

      if (balance > 0 && due && due <= windowEnd) {
        events.push({
          date: due,
          dateStr: format(due, 'yyyy-MM-dd'),
          label: `${card.card_name} statement`,
          amount: -balance,
          type: 'card',
        });
      }
    });

    // Expected everyday cash spending is modeled day-by-day.
    // Start tomorrow because "available cash now" is the current balance.
    if (dailySpend > 0) {
      for (let day = 1; day <= windowDays; day += 1) {
        const d = addDays(start, day);
        events.push({
          date: d,
          dateStr: format(d, 'yyyy-MM-dd'),
          label: 'Expected everyday spending',
          amount: -dailySpend,
          type: 'expected',
        });
      }
    }

    // Scenario input is immediate and intentionally not persisted.
    if (scenarioSpend > 0) {
      events.push({
        date: start,
        dateStr: format(start, 'yyyy-MM-dd'),
        label: 'What-if cash spend',
        amount: -scenarioSpend,
        type: 'scenario',
      });
    }

    const priority = {
      income: 0,
      bill: 1,
      card: 1,
      scenario: 2,
      expected: 3,
    };

    events.sort(
      (a, b) =>
        a.date - b.date ||
        (priority[a.type] ?? 9) - (priority[b.type] ?? 9)
    );

    let running = cash;
    let lowest = cash;
    let lowestDate = null;
    let shortfall = null;

    const rows = events.map((event) => {
      running += event.amount;

      if (running < lowest) {
        lowest = running;
        lowestDate = event.dateStr;
      }

      if (shortfall === null && running < 0) {
        shortfall = {
          date: event.dateStr,
          label: event.label,
          balance: running,
        };
      }

      return { ...event, running };
    });

    const totalIncome = events
      .filter((e) => e.type === 'income')
      .reduce((sum, e) => sum + e.amount, 0);

    const totalBills = Math.abs(
      events
        .filter((e) => e.type === 'bill')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalCards = Math.abs(
      events
        .filter((e) => e.type === 'card')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalExpectedSpending = Math.abs(
      events
        .filter((e) => e.type === 'expected')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    const totalScenarioSpend = Math.abs(
      events
        .filter((e) => e.type === 'scenario')
        .reduce((sum, e) => sum + e.amount, 0)
    );

    return {
      rows,
      lowest,
      lowestDate,
      shortfall,
      totalIncome,
      totalBills,
      totalCards,
      totalKnownCommitments: totalBills + totalCards,
      totalExpectedSpending,
      totalScenarioSpend,
      projectedEnd: running,
    };
  }, [
    payments,
    cards,
    cash,
    incAmt,
    incDay,
    dailySpend,
    scenarioSpend,
    windowDays,
  ]);

  const cardCalendarEvents = useMemo(
    () =>
      (cards || [])
        .filter(
          (card) =>
            (Number(card.statement_balance) || 0) > 0 && card.due_day
        )
        .map((card) => {
          const due = nextDueDate(card.due_day);
          if (!due) return null;

          return {
            id: `card-${card.id}`,
            entity: `${card.card_name} statement`,
            amount: Number(card.statement_balance) || 0,
            payment_date: format(due, 'yyyy-MM-dd'),
            status: card.statement_paid ? 'paid' : 'pending',
            readOnly: true,
          };
        })
        .filter(Boolean),
    [cards]
  );

  const loading = payLoading || txLoading || cardsLoading;
  const hasSpendEstimate = dailySpend > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Cash Flow</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            See what your cash is likely to look like after income, known
            commitments, and normal everyday spending.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
              Available cash now
            </label>
            <div className="flex items-center gap-1">
              <span className="text-2xl font-bold text-muted-foreground">
                $
              </span>
              <input
                type="number"
                value={availableCash}
                onChange={(e) => setCash(e.target.value)}
                placeholder="0.00"
                className="w-full text-2xl font-bold text-foreground outline-none bg-transparent"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Your current spendable cash across checking, savings, and cash.
            </p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
              Recurring income
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-muted-foreground">
                $
              </span>
              <input
                type="number"
                value={incomeAmount}
                onChange={(e) => setIncAmt(e.target.value)}
                placeholder="0"
                className="w-24 text-xl font-bold text-emerald-600 outline-none bg-transparent"
              />
              <span className="text-sm text-muted-foreground">on day</span>
              <input
                type="number"
                min="1"
                max="31"
                value={incomeDay}
                onChange={(e) => setIncDay(e.target.value)}
                placeholder="-"
                className="w-12 text-xl font-bold text-foreground outline-none bg-transparent border-b border-border"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Auto-detected from history and editable.
            </p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
              Expected everyday cash spend
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xl font-bold text-muted-foreground">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={expectedDailySpend}
                onChange={(e) => setDailySpend(e.target.value)}
                placeholder="0.00"
                className="w-full text-xl font-bold text-foreground outline-none bg-transparent"
              />
              <span className="text-sm text-muted-foreground">/ day</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Based on the last {HISTORY_DAYS} days of non-card NEEDS/WANTS
              spending. Editable.
            </p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col justify-between">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Look ahead
            </label>
            <div className="flex gap-2">
              {WINDOW_OPTIONS.map((days) => (
                <button
                  key={days}
                  onClick={() => setWindowDays(days)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                    windowDays === days
                      ? 'bg-blue-600 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {days} days
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-card p-12 rounded-xl border border-border text-center text-muted-foreground">
            Loading cash flow...
          </div>
        ) : (
          <>
            <div className="bg-card rounded-2xl border border-border shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Projected available cash
                  </p>
                  <p
                    className={`text-4xl md:text-5xl font-extrabold mt-1 ${
                      proj.projectedEnd < 0
                        ? 'text-red-600'
                        : 'text-foreground'
                    }`}
                  >
                    {money(proj.projectedEnd)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Estimated position {windowDays} days from now.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-5 gap-y-3 text-sm">
                  <BreakdownItem label="Cash now" value={money(cash)} />
                  <BreakdownItem
                    label="Income"
                    value={`+${money(proj.totalIncome)}`}
                    tone="positive"
                  />
                  <BreakdownItem
                    label="Known"
                    value={`-${money(proj.totalKnownCommitments)}`}
                  />
                  <BreakdownItem
                    label="Expected"
                    value={`-${money(proj.totalExpectedSpending)}`}
                  />
                  <BreakdownItem
                    label="What-if"
                    value={`-${money(proj.totalScenarioSpend)}`}
                  />
                </div>
              </div>

              {!hasSpendEstimate && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No everyday-spending estimate is active. This projection
                  currently reflects known commitments and income only.
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
              <SummaryStat
                label={`Known commitments (${windowDays}d)`}
                value={money(proj.totalKnownCommitments)}
                sub={`${money(proj.totalBills)} bills + ${money(
                  proj.totalCards
                )} card statements`}
                tone="neutral"
              />
              <SummaryStat
                label={`Expected spending (${windowDays}d)`}
                value={money(proj.totalExpectedSpending)}
                sub={
                  hasSpendEstimate
                    ? `${money(dailySpend)} per day`
                    : 'No estimate active'
                }
                tone="neutral"
              />
              <SummaryStat
                label="Projected low point"
                value={money(proj.lowest)}
                sub={
                  proj.lowestDate
                    ? `on ${proj.lowestDate}`
                    : 'no decline in range'
                }
                tone={proj.lowest < 0 ? 'danger' : 'positive'}
              />

              <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  What-if cash spend
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-muted-foreground">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={whatIfSpend}
                    onChange={(e) => setWhatIfSpend(e.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 text-xl font-bold text-foreground outline-none bg-transparent"
                  />
                  {scenarioSpend > 0 && (
                    <button
                      type="button"
                      onClick={() => setWhatIfSpend('')}
                      className="px-3 py-1.5 rounded-lg bg-muted text-xs font-bold text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Instantly test a purchase or other cash outflow today.
                </p>
              </div>
            </div>

            {proj.shortfall ? (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="font-bold text-red-800">
                  Projected cash shortfall on {proj.shortfall.date}
                </p>
                <p className="text-sm text-red-700 mt-1">
                  The projection reaches{' '}
                  <span className="font-bold">
                    {money(proj.shortfall.balance)}
                  </span>{' '}
                  at{' '}
                  <span className="font-bold">{proj.shortfall.label}</span>.
                  Review the timing of income, commitments, expected spending,
                  or the what-if scenario.
                </p>
              </div>
            ) : (
              <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="text-sm text-emerald-800 font-medium">
                  Projection stays above $0 through the next {windowDays} days
                  based on the assumptions shown above. The lowest projected
                  balance is{' '}
                  <span className="font-bold">{money(proj.lowest)}</span>.
                </p>
              </div>
            )}

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-8">
              <div className="px-5 py-3 border-b border-border">
                <p className="font-bold text-foreground">Cash flow timeline</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Known obligations and income are shown alongside modeled
                  everyday spending.
                </p>
              </div>

              {proj.rows.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm italic">
                  No projected cash-flow events in the next {windowDays} days.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-5 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider bg-background/50">
                    <span>Starting balance</span>
                    <span>{money(cash)}</span>
                  </div>

                  {proj.rows.map((row, index) => (
                    <div
                      key={`${row.dateStr}-${row.type}-${index}`}
                      className={`flex items-center justify-between gap-4 px-5 py-3 ${
                        row.type === 'expected' ? 'bg-background/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`text-xs font-mono w-20 shrink-0 ${
                            row.overdue
                              ? 'text-red-500 font-bold'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {row.overdue ? 'overdue' : row.dateStr}
                        </span>

                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {row.label}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {eventTypeLabel(row.type)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <span
                          className={`text-sm font-semibold ${
                            row.amount >= 0
                              ? 'text-emerald-600'
                              : 'text-foreground'
                          }`}
                        >
                          {row.amount >= 0 ? '+' : ''}
                          {money(row.amount)}
                        </span>
                        <span
                          className={`text-sm font-bold w-24 text-right ${
                            row.running < 0
                              ? 'text-red-600'
                              : 'text-foreground'
                          }`}
                        >
                          {money(row.running)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <UpcomingPaymentsCalendar extraEvents={cardCalendarEvents} />
          </>
        )}
      </div>
    </div>
  );
};

const eventTypeLabel = (type) => {
  const labels = {
    income: 'Income',
    bill: 'Known bill',
    card: 'Card statement',
    expected: 'Expected spending',
    scenario: 'What-if scenario',
  };

  return labels[type] || 'Cash flow';
};

const BreakdownItem = ({ label, value, tone = 'neutral' }) => {
  const toneClass =
    tone === 'positive' ? 'text-emerald-600' : 'text-foreground';

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`font-bold mt-0.5 ${toneClass}`}>{value}</p>
    </div>
  );
};

const SummaryStat = ({ label, value, sub, tone }) => {
  const toneClass =
    {
      positive: 'text-emerald-600',
      danger: 'text-red-600',
      neutral: 'text-foreground',
    }[tone] || 'text-foreground';

  return (
    <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-xl font-bold ${toneClass}`}>{value}</p>
      {sub && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
      )}
    </div>
  );
};

export default CashFlow;
