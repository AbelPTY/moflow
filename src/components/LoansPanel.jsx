import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import Icon from './AppIcon';
import useLoans from '../hooks/useLoans';
import useScheduledPayments from '../hooks/useScheduledPayments';
import { analyzeLoan } from '../lib/loanMath';
import { trackProductEvent } from '../lib/analytics';
import { authHeader } from '../lib/apiClient';
import ImageScanTray from './ImageScanTray';
import { useI18n } from '../i18n';

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Canonical loan_type values (stored). Display labels come from i18n loanTypes.*
const LOAN_TYPE_VALUES = ['mortgage', 'auto', 'personal', 'student', 'other'];

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

const fmtMonth = (date) => (date ? format(date, 'MMM yyyy') : null);

// Map loanMath's language-neutral warning codes to i18n keys (falls back to the
// engine's English `warning` string if a code is ever missing).
const WARN_KEY = {
  INVALID_INPUTS: 'loans.warnInvalidInputs',
  NON_AMORTIZING: 'loans.warnNonAmortizing',
  OVER_100_YEARS: 'loans.warnOver100Years',
};
const warnText = (t, sim) => (sim?.warningCode && WARN_KEY[sim.warningCode] ? t(WARN_KEY[sim.warningCode]) : (sim?.warning || ''));

export default function LoansPanel() {
  const { t } = useI18n();
  const { loans, loading, addLoan, updateLoan, deleteLoan } = useLoans();
  const { payments, addPayment } = useScheduledPayments();

  const [form, setForm] = useState(null); // null = closed; object = add/edit
  const [busy, setBusy] = useState(false);
  const [simulatorId, setSimulatorId] = useState(null);
  const [scanned, setScanned] = useState(false); // true when the form was prefilled by a scan
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanImages, setScanImages] = useState([]); // multi-page statement images
  const [scanOpen, setScanOpen] = useState(false);  // collecting images before scan

  const openAdd = () => { setScanned(false); setScanError(''); setScanOpen(false); setForm({ ...BLANK }); };

  const openScan = () => { setScanError(''); setScanImages([]); setScanOpen(true); };

  // Scan one or more loan-statement pages as ONE logical statement
  // ({ images, mode:'loan' }), prefill the EXISTING form, and let the user
  // review before saving. Never auto-saves. Reuses /api/scanCardStatement.
  const runLoanScan = async () => {
    if (scanImages.length === 0) return;
    setScanning(true);
    setScanError('');
    try {
      const resp = await fetch('/api/scanCardStatement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ images: scanImages, mode: 'loan' }),
      });
      if (!resp.ok) throw new Error(resp.statusText || 'scan failed');

      const d = await resp.json();

      const principal = Number(d.remaining_principal) || 0;
      const payment = Number(d.monthly_payment) || 0;
      const hasUseful =
        principal > 0 || payment > 0 || (d.apr !== null && d.apr !== undefined) || !!d.loan_name_hint;

      if (!hasUseful) {
        setScanError(t('loans.scanFailedRead'));
        return;
      }

      // Prefill ONLY detected values; leave undetected fields blank.
      setForm({
        ...BLANK,
        loan_name: d.loan_name_hint || '',
        loan_type: d.loan_type || BLANK.loan_type,
        remaining_principal: principal > 0 ? String(principal) : '',
        apr: d.apr !== null && d.apr !== undefined ? String(d.apr) : '',
        monthly_payment: payment > 0 ? String(payment) : '',
        next_payment_date: d.next_payment_date || '',
        remaining_months: d.remaining_months ? String(d.remaining_months) : '',
        maturity_date: d.maturity_date || '',
      });
      setScanned(true);
      setScanOpen(false);
    } catch (err) {
      setScanError(t('loans.scanFailedGeneric') + (err?.message || ''));
    } finally {
      setScanning(false);
    }
  };

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
    if (!form.loan_name.trim()) { alert(t('loans.nameRequired')); return; }
    if (!(Number(form.remaining_principal) > 0)) { alert(t('loans.principalGt0')); return; }
    if (!(Number(form.monthly_payment) > 0)) { alert(t('loans.paymentGt0')); return; }
    if (Number(form.apr) < 0) { alert(t('loans.aprNegative')); return; }

    setBusy(true);
    const isEdit = !!form.id;
    try {
      if (isEdit) await updateLoan(form.id, form);
      else await addLoan(form);
      trackProductEvent(isEdit ? 'loan_edited' : 'loan_added', { source_screen: 'cards' });
      setForm(null);
    } catch (e) {
      alert(t('loans.saveFailed', { msg: e?.message || e }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (loan) => {
    if (!window.confirm(t('loans.removeConfirm', { name: loan.loan_name }))) return;
    try { await deleteLoan(loan.id); } catch (e) { alert(t('loans.removeFailed', { msg: e?.message || e })); }
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
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="font-bold text-foreground">{t('loans.loans')}</div>
        {!form && !scanOpen && loans.length > 0 && (
          <div className="flex items-center gap-3">
            <button onClick={openScan} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:opacity-80">
              <Icon name="Camera" size={14} />
              {t('loans.scanAnotherLoan')}
            </button>
            <button onClick={openAdd} className="text-sm font-semibold text-primary hover:opacity-80">
              + {t('loans.addLoan')}
            </button>
          </div>
        )}
      </div>

      {/* SCAN SESSION: collect statement pages, then scan them together. */}
      {!form && scanOpen && (
        <div className="p-5 bg-primary/5 border-b border-border">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-bold text-foreground">{t('loans.scanStatement')}</p>
            <button onClick={() => setScanOpen(false)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">{t('common.cancel')}</button>
          </div>
          <ImageScanTray
            images={scanImages}
            setImages={setScanImages}
            onScan={runLoanScan}
            scanning={scanning}
            addLabel={t('loans.addStatementPages')}
          />
          <p className="text-[11px] text-muted-foreground mt-2">
            {t('loans.scanPagesHint')}
          </p>
          {scanError && <p className="text-xs text-red-600 mt-2">{scanError}</p>}
        </div>
      )}

      {!form && !scanOpen && scanError && (
        <div className="px-5 py-2 text-xs text-red-600 border-b border-border">{scanError}</div>
      )}

      {/* FORM */}
      {form && (
        <div className="p-5 bg-blue-50/40 dark:bg-blue-950/10 border-b border-border">
          {scanned && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
              <Icon name="CheckCircle2" size={16} className="text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                <span className="font-bold">{t('loans.statementDetectedTitle')}</span> {t('loans.statementDetectedBody')}
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.loanName')}</label>
              <input className={inputCls} value={form.loan_name} onChange={(e) => change('loan_name', e.target.value)} placeholder={t('loans.loanNamePlaceholder')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.loanType')}</label>
              <select className={inputCls} value={form.loan_type} onChange={(e) => change('loan_type', e.target.value)}>
                {LOAN_TYPE_VALUES.map((v) => <option key={v} value={v}>{t(`loanTypes.${v}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.remainingPrincipalUsd')}</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={form.remaining_principal} onChange={(e) => change('remaining_principal', e.target.value)} placeholder={t('loans.remainingPrincipalPlaceholder')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.aprPct')}</label>
              <input type="number" inputMode="decimal" min="0" step="0.001" className={inputCls} value={form.apr} onChange={(e) => change('apr', e.target.value)} placeholder={t('loans.aprPlaceholder')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.monthlyPaymentUsd')}</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={form.monthly_payment} onChange={(e) => change('monthly_payment', e.target.value)} placeholder={t('loans.monthlyPaymentPlaceholder')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.nextPaymentDate')}</label>
              <input type="date" className={inputCls} value={form.next_payment_date} onChange={(e) => change('next_payment_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.remainingMonthsOptional')}</label>
              <input type="number" inputMode="numeric" min="1" step="1" className={inputCls} value={form.remaining_months} onChange={(e) => change('remaining_months', e.target.value)} placeholder={t('loans.remainingMonthsPlaceholder')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.maturityOptional')}</label>
              <input type="date" className={inputCls} value={form.maturity_date} onChange={(e) => change('maturity_date', e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setForm(null)} className="px-4 py-3 min-h-[44px] text-muted-foreground hover:bg-muted rounded-md text-sm font-medium">{t('common.cancel')}</button>
            <button onClick={save} disabled={busy} className="px-4 py-3 min-h-[44px] bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {busy ? t('loans.saving') : t('loans.saveLoan')}
            </button>
          </div>
        </div>
      )}

      {/* LIST / EMPTY STATE */}
      {loading ? (
        <div className="p-6 text-muted-foreground text-sm">{t('loans.loadingLoans')}</div>
      ) : loans.length === 0 && !form && !scanOpen ? (
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 p-3 rounded-xl shrink-0">
              <Icon name="TrendingDown" size={26} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-extrabold leading-tight">
                {t('loans.emptyTitle')}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                {t('loans.emptyBody')}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button onClick={openScan} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[52px] rounded-xl bg-primary text-primary-foreground text-base font-bold hover:bg-primary/90 transition-colors">
              <Icon name="Camera" size={20} />
              {t('loans.scanStatement')}
            </button>
            <button onClick={openAdd} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[52px] rounded-xl border border-border text-foreground text-base font-semibold hover:bg-muted transition-colors">
              <Icon name="Plus" size={20} />
              {t('loans.addLoanManually')}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t('loans.reviewBeforeSaved')}</p>
          {scanError && <p className="text-xs text-red-600 mt-2">{scanError}</p>}
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
  const { t, formatDuration } = useI18n();
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
    if (!loan.next_payment_date) { setFlowNote(t('loans.addNextDateFirst')); return; }
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
      setFlowNote(t('loans.monthlyAddedToFlow'));
    } catch (e) {
      setFlowNote(t('loans.couldNotAddFlow', { msg: e?.message || e }));
    } finally {
      setFlowBusy(false);
    }
  };

  const payoffText = baseline.baseline.amortizes
    ? fmtMonth(baseline.baselinePayoffDate) || t('loans.inYear', { duration: formatDuration(baseline.baseline.months) })
    : '—';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-bold text-foreground truncate">
            {loan.loan_name}
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {t(`loanTypes.${loan.loan_type}`)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{t('loans.balance')} <span className="font-semibold text-foreground">{money(loan.remaining_principal)}</span></span>
            <span>{t('loans.apr')} <span className="font-semibold text-foreground">{Number(loan.apr)}%</span></span>
            <span>{t('loans.payment')} <span className="font-semibold text-foreground">{money(loan.monthly_payment)}</span></span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {baseline.baseline.amortizes ? (
              <>{t('loans.estimatedPayoff')} <span className="font-semibold text-foreground">{payoffText}</span> · {t('loans.estimatedRemainingInterest')} <span className="font-semibold text-foreground">{money(baseline.baseline.totalInterest)}</span></>
            ) : (
              <span className="text-amber-700">{warnText(t, baseline.baseline)}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button onClick={onEdit} className="text-xs font-semibold text-blue-600 hover:text-blue-700">{t('loans.edit')}</button>
          <button onClick={onDelete} className="text-xs font-semibold text-destructive hover:text-destructive/80">{t('loans.remove')}</button>
        </div>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button
          onClick={onToggleSimulator}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
        >
          <Icon name="Calculator" size={16} />
          {simulatorOpen ? t('loans.hideSimulator') : t('loans.analyzeExtra')}
        </button>
        <button
          onClick={addMonthlyToFlow}
          disabled={flowBusy || monthlyAlreadyInFlow}
          title={monthlyAlreadyInFlow ? t('loans.alreadyInFlowTitle') : ''}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Icon name="CalendarClock" size={16} />
          {monthlyAlreadyInFlow ? t('loans.alreadyInFlow') : t('loans.addMonthlyToFlow')}
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
  const { t, formatDuration } = useI18n();
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
    if (!(amt > 0)) { setExtraNote(t('loans.enterOneTimeFirst')); return; }
    if (!extraDate) { setExtraNote(t('loans.chooseDate')); return; }
    setExtraBusy(true);
    setExtraNote('');
    try {
      await addPayment({
        entity: `${loan.loan_name} — ${t('loans.extraPrincipalSuffix')}`,
        amount: Math.abs(amt),
        payment_date: extraDate,
        status: 'pending',
        is_recurring: false,
      });
      trackProductEvent('loan_payment_added_to_flow', { source_screen: 'cards' });
      setExtraNote(t('loans.oneTimeAddedToFlow'));
    } catch (e) {
      setExtraNote(t('loans.couldNotAddFlow', { msg: e?.message || e }));
    } finally {
      setExtraBusy(false);
    }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2.5 text-lg font-bold bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500';

  const basePayoff = baseline.baseline.amortizes ? fmtMonth(baseline.baselinePayoffDate) : null;
  const scenPayoff = result?.scenario?.amortizes ? fmtMonth(result.scenarioPayoffDate) : null;
  const paidNow = result?.scenario?.paidOffImmediately;

  const baselineInterest = baseline.baseline.amortizes ? money(baseline.baseline.totalInterest) : '—';
  const baselinePayoffText = baseline.baseline.amortizes
    ? (basePayoff || t('loans.inYear', { duration: formatDuration(baseline.baseline.months) }))
    : '—';

  return (
    <div className="mt-4 space-y-3">
      {/* INPUT AREA */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
          {t('loans.testExtraPayments')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.oneTimeExtraUsd')}</label>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={oneTime} onChange={(e) => setOneTime(e.target.value)} placeholder="0.00" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('loans.recurringExtraUsd')}</label>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={recurring} onChange={(e) => setRecurring(e.target.value)} placeholder="0.00" className={inputCls} />
          </div>
        </div>
        <button onClick={calculate} className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
          <Icon name="Sparkles" size={16} />
          {t('loans.calculateImpact')}
        </button>
      </div>

      {/* RESULT AREA */}
      {!active || !result ? (
        <div className="rounded-xl border border-border bg-background/40 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('loans.estimatedPayoffBaseline')}</span>
            <span className="font-bold text-foreground">{baselinePayoffText}</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-muted-foreground">{t('loans.estimatedRemainingInterest')}</span>
            <span className="font-bold text-foreground">{baselineInterest}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {t('loans.enterExtraHint')}
          </p>
        </div>
      ) : paidNow ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{t('loans.estimatedNewPayoff')}</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-emerald-800 dark:text-emerald-300 mt-1">{t('loans.paidOffRightAway')}</p>
          <p className="text-sm text-emerald-800 dark:text-emerald-300 mt-1">
            {t('loans.paidOffBody')}
          </p>
        </div>
      ) : result.scenario?.amortizes ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-5 shadow-sm">
          {/* 1. New estimated payoff (primary) */}
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{t('loans.estimatedNewPayoff')}</p>
          <p className="text-3xl font-extrabold text-emerald-800 dark:text-emerald-300 mt-1 leading-tight">
            {scenPayoff || t('loans.inYear', { duration: formatDuration(result.scenario.months) })}
          </p>

          {/* 2. Time saved */}
          {result.monthsSaved > 0 && (
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1">
              {t('loans.sooner', { months: formatDuration(result.monthsSaved) })}
            </p>
          )}

          {/* 3. Interest saved */}
          {result.interestSaved !== null && result.interestSaved > 0 && (
            <p className="text-sm text-foreground mt-2">
              {t('loans.interestSaved')} <span className="font-extrabold text-emerald-700 dark:text-emerald-400">{money(result.interestSaved)}</span>
            </p>
          )}

          {/* 4. Baseline comparison (secondary) */}
          {basePayoff && scenPayoff && (
            <p className="text-xs text-muted-foreground mt-3">
              {t('loans.baselineComparison', { from: basePayoff, to: scenPayoff })}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-300">
          {warnText(t, result.scenario) || t('loans.scenarioNoPayoff')}
        </div>
      )}

      {/* ADD ONE-TIME EXTRA TO FLOW (explicit only) */}
      {active && result && (Number(oneTime) || 0) > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
            {t('loans.addOneTimeToFlow')}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input type="date" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} className="border border-border rounded-md p-2.5 text-sm bg-background text-foreground min-h-[44px]" />
            <button onClick={addExtraToFlow} disabled={extraBusy} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
              <Icon name="CalendarPlus" size={16} />
              {t('loans.addThisToFlow')}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t('loans.oneTimeFlowNote')}
          </p>
          {extraNote && <p className="text-xs text-muted-foreground mt-1">{extraNote}</p>}
        </div>
      )}

      {/* DISCLOSURE (secondary) */}
      {active && result && (
        <p className="text-xs text-muted-foreground">{t('loans.disclosure')}</p>
      )}
    </div>
  );
}
