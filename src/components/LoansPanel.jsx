import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import Icon from './AppIcon';
import useLoans from '../hooks/useLoans';
import useScheduledPayments from '../hooks/useScheduledPayments';
import { analyzeLoan, describeMonths } from '../lib/loanMath';
import { trackProductEvent } from '../lib/analytics';

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const LOAN_TYPES = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'auto', label: 'Auto' },
  { value: 'personal', label: 'Personal' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
];

const typeLabel = (v) => LOAN_TYPES.find((t) => t.value === v)?.label || 'Other';

const BLANK = {
  loan_name: '',
  loan_type: 'mortgage',
  remaining_principal: '',
  apr: '',
  monthly_payment: '',
  next_payment_date: '',
  remaining_months: '',
  maturity_date: '',
};

const DISCLOSURE =
  "Estimate assumes a fixed interest rate, monthly payments, and that extra payments are applied directly to principal with no prepayment penalty. Your lender's actual calculation may differ.";

const fmtMonth = (date) => (date ? format(date, 'MMM yyyy') : null);

export default function LoansPanel() {
  const { loans, loading, addLoan, updateLoan, deleteLoan } = useLoans();
  const { payments, addPayment } = useScheduledPayments();

  const [form, setForm] = useState(null); // null = closed; object = add/edit
  const [busy, setBusy] = useState(false);
  const [simulatorId, setSimulatorId] = useState(null);

  const openAdd = () => setForm({ ...BLANK });
  const openEdit = (loan) =>
    setForm({
      id: loan.id,
      loan_name: loan.loan_name ?? '',
      loan_type: loan.loan_type ?? 'other',
      remaining_principal: loan.remaining_principal ?? '',
      apr: loan.apr ?? '',
      monthly_payment: loan.monthly_payment ?? '',
      next_payment_date: loan.next_payment_date ?? '',
      remaining_months: loan.remaining_months ?? '',
      maturity_date: loan.maturity_date ?? '',
    });

  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.loan_name.trim()) { alert('Loan name is required.'); return; }
    if (!(Number(form.remaining_principal) > 0)) { alert('Remaining principal must be greater than 0.'); return; }
    if (!(Number(form.monthly_payment) > 0)) { alert('Monthly payment must be greater than 0.'); return; }
    if (Number(form.apr) < 0) { alert('APR cannot be negative.'); return; }

    setBusy(true);
    const isEdit = !!form.id;
    try {
      if (isEdit) await updateLoan(form.id, form);
      else await addLoan(form);
      trackProductEvent(isEdit ? 'loan_edited' : 'loan_added', { source_screen: 'cards' });
      setForm(null);
    } catch (e) {
      alert('Failed to save loan: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (loan) => {
    if (!window.confirm(`Remove ${loan.loan_name}?`)) return;
    try { await deleteLoan(loan.id); } catch (e) { alert('Failed to remove: ' + (e?.message || e)); }
  };

  const openSimulator = (loan) => {
    setSimulatorId((cur) => {
      const next = cur === loan.id ? null : loan.id;
      if (next) trackProductEvent('loan_simulator_opened', { source_screen: 'cards' });
      return next;
    });
  };

  const inputCls =
    'w-full border border-border rounded-md p-2.5 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm mb-8 overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="font-bold text-foreground">Loans</div>
        {!form && loans.length > 0 && (
          <button onClick={openAdd} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            + Add loan
          </button>
        )}
      </div>

      {/* FORM */}
      {form && (
        <div className="p-5 bg-blue-50/40 dark:bg-blue-950/10 border-b border-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Loan name</label>
              <input className={inputCls} value={form.loan_name} onChange={(e) => change('loan_name', e.target.value)} placeholder="e.g. Home mortgage" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Loan type</label>
              <select className={inputCls} value={form.loan_type} onChange={(e) => change('loan_type', e.target.value)}>
                {LOAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Remaining principal ($)</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={form.remaining_principal} onChange={(e) => change('remaining_principal', e.target.value)} placeholder="Amount still owed" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">APR (%)</label>
              <input type="number" inputMode="decimal" min="0" step="0.001" className={inputCls} value={form.apr} onChange={(e) => change('apr', e.target.value)} placeholder="e.g. 6.5" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Monthly payment ($)</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={form.monthly_payment} onChange={(e) => change('monthly_payment', e.target.value)} placeholder="Regular payment" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Next payment date</label>
              <input type="date" className={inputCls} value={form.next_payment_date} onChange={(e) => change('next_payment_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Remaining months (optional)</label>
              <input type="number" inputMode="numeric" min="1" step="1" className={inputCls} value={form.remaining_months} onChange={(e) => change('remaining_months', e.target.value)} placeholder="For your context" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Maturity date (optional)</label>
              <input type="date" className={inputCls} value={form.maturity_date} onChange={(e) => change('maturity_date', e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setForm(null)} className="px-4 py-3 min-h-[44px] text-muted-foreground hover:bg-muted rounded-md text-sm font-medium">Cancel</button>
            <button onClick={save} disabled={busy} className="px-4 py-3 min-h-[44px] bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save loan'}
            </button>
          </div>
        </div>
      )}

      {/* LIST / EMPTY STATE */}
      {loading ? (
        <div className="p-6 text-muted-foreground text-sm">Loading loans…</div>
      ) : loans.length === 0 && !form ? (
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 p-3 rounded-xl shrink-0">
              <Icon name="TrendingDown" size={26} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-extrabold leading-tight">
                See how much sooner you could be debt-free.
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                Track a loan and test how extra principal payments could change your payoff
                date and interest.
              </p>
            </div>
          </div>
          <button onClick={openAdd} className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[52px] rounded-xl bg-blue-600 text-white text-base font-bold hover:bg-blue-700 transition-colors">
            <Icon name="Plus" size={20} />
            Add loan
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {loans.map((loan) => (
            <LoanRow
              key={loan.id}
              loan={loan}
              payments={payments}
              addPayment={addPayment}
              onEdit={() => openEdit(loan)}
              onDelete={() => remove(loan)}
              simulatorOpen={simulatorId === loan.id}
              onToggleSimulator={() => openSimulator(loan)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LoanRow({ loan, payments, addPayment, onEdit, onDelete, simulatorOpen, onToggleSimulator }) {
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowNote, setFlowNote] = useState('');

  const baseline = useMemo(
    () =>
      analyzeLoan({
        remainingPrincipal: loan.remaining_principal,
        apr: loan.apr,
        monthlyPayment: loan.monthly_payment,
        nextPaymentDate: loan.next_payment_date || null,
      }),
    [loan.remaining_principal, loan.apr, loan.monthly_payment, loan.next_payment_date]
  );

  // Best-effort duplicate detection for the regular monthly commitment.
  const monthlyAlreadyInFlow = useMemo(() => {
    const name = normalize(loan.loan_name);
    if (!name) return false;
    return (payments || []).some(
      (p) => p.status !== 'paid' && p.is_recurring && normalize(p.entity).includes(name)
    );
  }, [payments, loan.loan_name]);

  const addMonthlyToFlow = async () => {
    if (!loan.next_payment_date) { setFlowNote('Add a next payment date to this loan first.'); return; }
    setFlowBusy(true);
    setFlowNote('');
    try {
      await addPayment({
        entity: loan.loan_name,
        amount: Math.abs(Number(loan.monthly_payment)) || 0,
        payment_date: loan.next_payment_date,
        status: 'pending',
        is_recurring: true,
      });
      trackProductEvent('loan_payment_added_to_flow', { source_screen: 'cards' });
      setFlowNote('Monthly payment added to Flow.');
    } catch (e) {
      setFlowNote('Could not add to Flow: ' + (e?.message || e));
    } finally {
      setFlowBusy(false);
    }
  };

  const payoffText = baseline.baseline.amortizes
    ? fmtMonth(baseline.baselinePayoffDate) || `in ${describeMonths(baseline.baseline.months)}`
    : '—';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-bold text-foreground truncate">
            {loan.loan_name}
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {typeLabel(loan.loan_type)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Balance <span className="font-semibold text-foreground">{money(loan.remaining_principal)}</span></span>
            <span>APR <span className="font-semibold text-foreground">{Number(loan.apr)}%</span></span>
            <span>Payment <span className="font-semibold text-foreground">{money(loan.monthly_payment)}</span></span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {baseline.baseline.amortizes ? (
              <>Estimated payoff <span className="font-semibold text-foreground">{payoffText}</span> · Estimated remaining interest <span className="font-semibold text-foreground">{money(baseline.baseline.totalInterest)}</span></>
            ) : (
              <span className="text-amber-700">{baseline.baseline.warning}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button onClick={onEdit} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Edit</button>
          <button onClick={onDelete} className="text-xs font-semibold text-red-500 hover:text-red-600">Remove</button>
        </div>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button
          onClick={onToggleSimulator}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
        >
          <Icon name="Calculator" size={16} />
          {simulatorOpen ? 'Hide simulator' : 'Analyze extra payments'}
        </button>
        <button
          onClick={addMonthlyToFlow}
          disabled={flowBusy || monthlyAlreadyInFlow}
          title={monthlyAlreadyInFlow ? 'A recurring payment for this loan already looks present in Flow.' : ''}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Icon name="CalendarClock" size={16} />
          {monthlyAlreadyInFlow ? 'Already in Flow' : 'Add monthly payment to Flow'}
        </button>
      </div>
      {flowNote && <p className="text-[11px] text-muted-foreground mt-2">{flowNote}</p>}

      {simulatorOpen && (
        <LoanSimulator loan={loan} baseline={baseline} addPayment={addPayment} />
      )}
    </div>
  );
}

function LoanSimulator({ loan, baseline, addPayment }) {
  const [oneTime, setOneTime] = useState('');
  const [recurring, setRecurring] = useState('');
  const [active, setActive] = useState(false);
  const [extraDate, setExtraDate] = useState(loan.next_payment_date || new Date().toISOString().split('T')[0]);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraNote, setExtraNote] = useState('');

  const result = useMemo(() => {
    if (!active) return null;
    return analyzeLoan({
      remainingPrincipal: loan.remaining_principal,
      apr: loan.apr,
      monthlyPayment: loan.monthly_payment,
      nextPaymentDate: loan.next_payment_date || null,
      oneTimeExtraPrincipal: Number(oneTime) || 0,
      recurringExtraMonthly: Number(recurring) || 0,
    });
  }, [active, oneTime, recurring, loan.remaining_principal, loan.apr, loan.monthly_payment, loan.next_payment_date]);

  const calculate = () => {
    const hasOneTime = (Number(oneTime) || 0) > 0;
    const hasRecurring = (Number(recurring) || 0) > 0;
    if (!hasOneTime && !hasRecurring) { setActive(false); return; }
    setActive(true);
    // Analytics: deliberate scenario test. NO financial values are ever sent.
    if (hasOneTime) trackProductEvent('loan_extra_payment_tested', { source_screen: 'cards' });
    if (hasRecurring) trackProductEvent('loan_recurring_extra_tested', { source_screen: 'cards' });
  };

  const addExtraToFlow = async () => {
    const amt = Number(oneTime) || 0;
    if (!(amt > 0)) { setExtraNote('Enter a one-time extra amount first.'); return; }
    if (!extraDate) { setExtraNote('Choose a date for the extra payment.'); return; }
    setExtraBusy(true);
    setExtraNote('');
    try {
      await addPayment({
        entity: `${loan.loan_name} — Extra principal`,
        amount: Math.abs(amt),
        payment_date: extraDate,
        status: 'pending',
        is_recurring: false,
      });
      trackProductEvent('loan_payment_added_to_flow', { source_screen: 'cards' });
      setExtraNote('One-time extra payment added to Flow.');
    } catch (e) {
      setExtraNote('Could not add to Flow: ' + (e?.message || e));
    } finally {
      setExtraBusy(false);
    }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2.5 text-lg font-bold bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500';

  const basePayoff = baseline.baseline.amortizes ? fmtMonth(baseline.baselinePayoffDate) : null;
  const scenPayoff = result?.scenario?.amortizes ? fmtMonth(result.scenarioPayoffDate) : null;
  const paidNow = result?.scenario?.paidOffImmediately;

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-4">
      {/* BASELINE FIRST */}
      <div className="grid grid-cols-2 gap-y-1 text-sm mb-4">
        <span className="text-muted-foreground">Estimated payoff (baseline)</span>
        <span className="text-right font-bold text-foreground">
          {baseline.baseline.amortizes ? (basePayoff || `in ${describeMonths(baseline.baseline.months)}`) : '—'}
        </span>
        <span className="text-muted-foreground">Estimated remaining interest</span>
        <span className="text-right font-bold text-foreground">
          {baseline.baseline.amortizes ? money(baseline.baseline.totalInterest) : '—'}
        </span>
      </div>

      {/* SCENARIO INPUTS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">One-time extra principal ($)</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={oneTime} onChange={(e) => setOneTime(e.target.value)} placeholder="0.00" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Recurring extra each month ($)</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={recurring} onChange={(e) => setRecurring(e.target.value)} placeholder="0.00" className={inputCls} />
        </div>
      </div>

      <button onClick={calculate} className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
        <Icon name="Sparkles" size={16} />
        Calculate impact
      </button>

      {/* RESULTS */}
      {active && result && (
        <div className="mt-4">
          {paidNow ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4">
              <p className="text-lg font-extrabold text-emerald-800 dark:text-emerald-300">
                That one-time payment clears the balance — the loan is estimated paid off right away.
              </p>
            </div>
          ) : result.scenario?.amortizes ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4">
              {basePayoff && scenPayoff && (
                <p className="text-lg sm:text-xl font-extrabold text-foreground">
                  Estimated payoff: {basePayoff} <span className="text-emerald-600">→ {scenPayoff}</span>
                </p>
              )}
              {result.monthsSaved > 0 && (
                <p className="text-base font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                  {describeMonths(result.monthsSaved)} sooner
                </p>
              )}
              {result.interestSaved !== null && (
                <p className="text-sm text-foreground mt-1">
                  Estimated interest saved: <span className="font-bold">{money(result.interestSaved)}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                If you pay this extra toward principal, your estimated payoff could move up by{' '}
                <span className="font-semibold">{describeMonths(result.monthsSaved || 0)}</span>.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {result.scenario?.warning || 'This scenario does not pay off within the modeled horizon.'}
            </div>
          )}

          {/* ADD ONE-TIME EXTRA TO FLOW (explicit only) */}
          {(Number(oneTime) || 0) > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Add this one-time extra payment to Flow
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input type="date" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} className="border border-border rounded-md p-2.5 text-sm bg-background text-foreground min-h-[44px]" />
                <button onClick={addExtraToFlow} disabled={extraBusy} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                  <Icon name="CalendarPlus" size={16} />
                  Add this payment to Flow
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                This adds a one-time commitment to Flow. It does not change your regular loan payment.
              </p>
              {extraNote && <p className="text-[11px] text-muted-foreground mt-1">{extraNote}</p>}
            </div>
          )}

          {/* DISCLOSURE */}
          <p className="text-[11px] text-muted-foreground mt-3">{DISCLOSURE}</p>
        </div>
      )}
    </div>
  );
}
