import React, { useMemo, useState, useEffect } from 'react';
import { format, addDays, parseISO } from 'date-fns';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import UpcomingPaymentsCalendar from '../../components/UpcomingPaymentsCalendar';
import useScheduledPayments from '../../hooks/useScheduledPayments';
import useTransactions from '../../hooks/useTransactions';
import useCreditCards from '../../hooks/useCreditCards';
import { nextDueDate } from '../../lib/cardGuard';

// Cash Flow tab: answers "will I get hit with a late/financing fee?" by walking
// your available cash forward day-by-day against upcoming bills (and your
// recurring income), flagging the first date you'd run short.
//
// v1 keeps the inputs simple and local (localStorage): you enter your real
// available cash, and your recurring monthly income is auto-detected from
// history but editable. These can move to Supabase later.

const WINDOW_OPTIONS = [7, 14, 30];
const LS_CASH = 'cashflow_available_cash';
const LS_INCOME_AMT = 'cashflow_income_amount';
const LS_INCOME_DAY = 'cashflow_income_day';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CashFlow = () => {
  const { payments, loading: payLoading } = useScheduledPayments();
  const { transactions, loading: txLoading } = useTransactions(null, { filters: { dateRange: 'all' } });
  const { cards, loading: cardsLoading } = useCreditCards();

  const [windowDays, setWindowDays] = useState(14);
  const [availableCash, setAvailableCash] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeDay, setIncomeDay] = useState('');

  // Detect a sensible default monthly income from history: the total of the
  // most recent month's INCOME rows, arriving on the day of the latest deposit.
  const detected = useMemo(() => {
    if (!transactions) return { amount: 0, day: 1 };
    const incomes = transactions
      .filter((t) => t.budgetBucket === 'INCOME' && t.amount > 0 && t.dateString)
      .sort((a, b) => new Date(b.dateString) - new Date(a.dateString));
    if (incomes.length === 0) return { amount: 0, day: 1 };
    const latest = incomes[0];
    const day = parseInt(latest.dateString.split('-')[2], 10) || 1;
    const ym = latest.dateString.substring(0, 7);
    const monthTotal = incomes
      .filter((t) => t.dateString.substring(0, 7) === ym)
      .reduce((s, t) => s + t.amount, 0);
    return { amount: Math.round(monthTotal), day };
  }, [transactions]);

  // Load persisted inputs; seed income from detection when not set yet.
  useEffect(() => {
    const c = localStorage.getItem(LS_CASH);
    if (c !== null) setAvailableCash(c);
    const ia = localStorage.getItem(LS_INCOME_AMT);
    setIncomeAmount(ia !== null ? ia : (detected.amount ? String(detected.amount) : ''));
    const id = localStorage.getItem(LS_INCOME_DAY);
    setIncomeDay(id !== null ? id : (detected.day ? String(detected.day) : ''));
  }, [detected.amount, detected.day]);

  const setCash = (v) => { setAvailableCash(v); localStorage.setItem(LS_CASH, v); };
  const setIncAmt = (v) => { setIncomeAmount(v); localStorage.setItem(LS_INCOME_AMT, v); };
  const setIncDay = (v) => { setIncomeDay(v); localStorage.setItem(LS_INCOME_DAY, v); };

  const cash = parseFloat(availableCash) || 0;
  const incAmt = parseFloat(incomeAmount) || 0;
  const incDay = parseInt(incomeDay, 10) || 0;

  // Build the day-by-day coverage projection.
  const proj = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowEnd = addDays(start, windowDays);
    const events = [];

    (payments || []).forEach((p) => {
      if (p.status === 'paid' || !p.payment_date) return;
      const d = parseISO(p.payment_date);
      if (d <= windowEnd) {
        const overdue = d < start;
        events.push({
          date: overdue ? start : d,
          dateStr: format(overdue ? start : d, 'yyyy-MM-dd'),
          label: p.entity,
          amount: -Math.abs(Number(p.amount) || 0),
          type: 'bill',
          overdue,
        });
      }
    });

    if (incAmt > 0 && incDay >= 1 && incDay <= 31) {
      for (let m = 0; m <= 1; m++) {
        const d = new Date(start.getFullYear(), start.getMonth() + m, incDay);
        if (d >= start && d <= windowEnd) {
          events.push({ date: d, dateStr: format(d, 'yyyy-MM-dd'), label: 'Expected income', amount: incAmt, type: 'income' });
        }
      }
    }

    // Credit-card statement balances due within the window (from the card guard).
    (cards || []).forEach((c) => {
      if (c.statement_paid) return; // already paid -> not an upcoming obligation
      const bal = Number(c.statement_balance) || 0;
      const due = nextDueDate(c.due_day);
      if (bal > 0 && due && due <= windowEnd) {
        events.push({ date: due, dateStr: format(due, 'yyyy-MM-dd'), label: `${c.card_name} statement`, amount: -bal, type: 'card' });
      }
    });

    // Same-day: apply income before bills (money in, then out).
    events.sort((a, b) => a.date - b.date || (a.type === 'income' ? -1 : 1));

    let running = cash;
    let lowest = cash;
    let lowestDate = null;
    let shortfall = null;
    const rows = events.map((e) => {
      running += e.amount;
      if (running < lowest) { lowest = running; lowestDate = e.dateStr; }
      if (shortfall === null && running < 0) shortfall = { date: e.dateStr, label: e.label, balance: running };
      return { ...e, running };
    });

    const totalBills = events.filter((e) => e.type === 'bill').reduce((s, e) => s + e.amount, 0);
    const totalIncome = events.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    return { rows, lowest, lowestDate, shortfall, totalBills, totalIncome, projectedEnd: running };
  }, [payments, cards, cash, incAmt, incDay, windowDays]);

  // Card statement due dates as read-only calendar markers (links the Cards
  // tab data into the Cash Flow calendar).
  const cardCalendarEvents = useMemo(() => (
    (cards || [])
      .filter((c) => (Number(c.statement_balance) || 0) > 0 && c.due_day)
      .map((c) => {
        const due = nextDueDate(c.due_day);
        if (!due) return null;
        return {
          id: `card-${c.id}`,
          entity: `${c.card_name} statement`,
          amount: Number(c.statement_balance) || 0,
          payment_date: format(due, 'yyyy-MM-dd'),
          status: c.statement_paid ? 'paid' : 'pending',
          readOnly: true,
        };
      })
      .filter(Boolean)
  ), [cards]);

  const loading = payLoading || txLoading || cardsLoading;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Cash Flow</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Stay ahead of bills so you never pay a late or financing fee.
          </p>
        </div>

        {/* INPUTS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Available cash now</label>
            <div className="flex items-center gap-1">
              <span className="text-2xl font-bold text-muted-foreground">$</span>
              <input
                type="number"
                value={availableCash}
                onChange={(e) => setCash(e.target.value)}
                placeholder="0.00"
                className="w-full text-2xl font-bold text-foreground outline-none bg-transparent"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Your real spendable balance across accounts.</p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Recurring income</label>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-muted-foreground">$</span>
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
                placeholder="—"
                className="w-12 text-xl font-bold text-foreground outline-none bg-transparent border-b border-border"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Auto-detected from your history — adjust if needed.</p>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col justify-between">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Look ahead</label>
            <div className="flex gap-2">
              {WINDOW_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setWindowDays(d)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${windowDays === d ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted'}`}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-card p-12 rounded-xl border border-border text-center text-muted-foreground">Loading cash flow…</div>
        ) : (
          <>
            {/* SUMMARY */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <SummaryStat label={`Cash now`} value={money(cash)} tone="neutral" />
              <SummaryStat label={`Income (${windowDays}d)`} value={`+${money(proj.totalIncome)}`} tone="positive" />
              <SummaryStat label={`Bills (${windowDays}d)`} value={money(proj.totalBills)} tone="negative" />
              <SummaryStat
                label="Projected low point"
                value={money(proj.lowest)}
                sub={proj.lowestDate ? `on ${proj.lowestDate}` : 'no bills in range'}
                tone={proj.lowest < 0 ? 'danger' : 'positive'}
              />
            </div>

            {/* SHORTFALL BANNER */}
            {proj.shortfall ? (
              <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-bold text-red-800">Projected shortfall on {proj.shortfall.date}</p>
                  <p className="text-sm text-red-700">
                    Your balance dips to <span className="font-bold">{money(proj.shortfall.balance)}</span> right at
                    {' '}<span className="font-bold">{proj.shortfall.label}</span>. Move funds or delay a payment to avoid a late / financing fee.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-6 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <span className="text-2xl">✅</span>
                <p className="text-sm text-emerald-800 font-medium">
                  You're covered — your balance stays positive through the next {windowDays} days, ending near <span className="font-bold">{money(proj.projectedEnd)}</span>.
                </p>
              </div>
            )}

            {/* TIMELINE */}
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-8">
              <div className="px-5 py-3 border-b border-border font-bold text-foreground">Coverage timeline</div>
              {proj.rows.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm italic">No bills or income in the next {windowDays} days.</div>
              ) : (
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-5 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider bg-background/50">
                    <span>Starting balance</span>
                    <span>{money(cash)}</span>
                  </div>
                  {proj.rows.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-mono w-20 ${r.overdue ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>{r.overdue ? 'overdue' : r.dateStr}</span>
                        <span className="text-sm font-medium text-foreground">{r.label}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-sm font-semibold ${r.amount >= 0 ? 'text-emerald-600' : 'text-foreground'}`}>
                          {r.amount >= 0 ? '+' : ''}{money(r.amount)}
                        </span>
                        <span className={`text-sm font-bold w-24 text-right ${r.running < 0 ? 'text-red-600' : 'text-foreground'}`}>
                          {money(r.running)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CALENDAR */}
            <UpcomingPaymentsCalendar extraEvents={cardCalendarEvents} />
          </>
        )}
      </div>
    </div>
  );
};

const SummaryStat = ({ label, value, sub, tone }) => {
  const toneClass = {
    positive: 'text-emerald-600',
    negative: 'text-foreground',
    danger: 'text-red-600',
    neutral: 'text-foreground',
  }[tone] || 'text-foreground';
  return (
    <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
};

export default CashFlow;
