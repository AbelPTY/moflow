import React, {
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { format } from 'date-fns';
import Icon from './AppIcon';
import {
  nextDueDate,
  daysUntil,
  estimateMonthlyFinancingCost,
} from '../lib/cardGuard';
import { authHeader } from '../lib/apiClient';
import { trackProductEvent } from '../lib/analytics';
import ImageScanTray from './ImageScanTray';
import { useI18n } from '../i18n';

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const BLANK = {
  card_name: '',
  current_balance: '',
  statement_balance: '',
  minimum_payment: '',
  apr: '',
  statement_close_day: '',
  due_day: '',
};

// Suggested names so entries stay consistent with the cleaned-up accounts.
const CARD_SUGGESTIONS = [
  'Banco General - Mileage CC',
  'Banco General - Star CC',
  'Davivienda CC',
  'Cooperativa Profesionales Mastercard',
  'UNFCU Visa Elite 5659',
];

const CreditCardsPanel = forwardRef(function CreditCardsPanel(
  { cards, loading, onSave, onDelete, onSetPaid, onSaved },
  ref
) {
  const { t } = useI18n();
  const [form, setForm] = useState(null); // null = closed
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false); // true once a scan pre-fills the form
  const [scanImages, setScanImages] = useState([]); // multi-page statement images

  const openAdd = () => {
    setScanned(false);
    setScanImages([]);
    setForm({
      ...BLANK,
      statement_paid: false,
      _origBalance: '',
    });
  };

  // Open the add form (with the multi-image tray) from outside the panel, e.g.
  // the Cards hero CTA. Reuses the same scan pipeline -- no second scanner.
  useImperativeHandle(ref, () => ({
    openScanner: () => {
      setScanned(false);
      setScanImages([]);
      setForm((current) =>
        current || { ...BLANK, statement_paid: false, _origBalance: '' }
      );
    },
    openAdd,
  }));

  const openEdit = (c) =>
    setForm({
      id: c.id,
      card_name: c.card_name,
      current_balance: c.current_balance ?? '',
      statement_balance: c.statement_balance ?? '',
      minimum_payment: c.minimum_payment ?? '',
      apr: c.apr ?? '',
      statement_close_day: c.statement_close_day ?? '',
      due_day: c.due_day ?? '',
      statement_paid: c.statement_paid ?? false,
      _origBalance: c.statement_balance ?? '',
    });

  const change = (k, v) =>
    setForm((f) => ({
      ...f,
      [k]: v,
    }));

  const save = async () => {
    if (!form.card_name.trim()) {
      alert(t('cards.cardNameRequired'));
      return;
    }

    // Entering a new statement balance is a new bill -> reset the paid flag.
    const balanceChanged =
      String(form.statement_balance ?? '') !==
      String(form._origBalance ?? '');

    const payload = {
      ...form,
      statement_paid: balanceChanged ? false : form.statement_paid,
    };

    setBusy(true);

    try {
      await onSave(payload);
      setForm(null);
      // Let the Cards page surface the "Check my Flow" bridge after a save.
      onSaved?.(payload);
    } catch (e) {
      alert(t('cards.saveFailed', { msg: e?.message || e }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(t('cards.removeConfirm', { name: c.card_name }))) return;

    try {
      await onDelete(c.id);
    } catch (e) {
      alert(t('cards.removeFailed', { msg: e?.message || e }));
    }
  };

  // Scan one or more statement pages and pre-fill the form. All selected pages
  // are sent as ONE logical statement ({ images: [...] }); the endpoint
  // synthesizes a single card record. Never auto-saves.
  const runCardScan = async () => {
    if (scanImages.length === 0) return;
    setScanning(true);
    setScanned(false);
    trackProductEvent('card_scan_started', { source_screen: 'cards' });

    try {
      const resp = await fetch('/api/scanCardStatement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ images: scanImages }),
      });
      if (!resp.ok) throw new Error(resp.statusText || 'scan failed');

      const d = await resp.json();

      setForm((prev) => {
        const f = prev || { ...BLANK, statement_paid: false, _origBalance: '' };
        return {
          ...f,
          card_name: f.card_name || d.card_name_hint || '',
          current_balance:
            d.current_balance !== undefined && d.current_balance !== null && d.current_balance !== 0
              ? String(d.current_balance)
              : f.current_balance,
          statement_balance:
            d.statement_balance !== undefined && d.statement_balance !== null && d.statement_balance !== 0
              ? String(d.statement_balance)
              : f.statement_balance,
          minimum_payment:
            d.minimum_payment !== undefined && d.minimum_payment !== null && d.minimum_payment !== 0
              ? String(d.minimum_payment)
              : f.minimum_payment,
          apr: d.apr !== undefined && d.apr !== null ? String(d.apr) : f.apr,
          due_day: d.due_day !== undefined && d.due_day !== null ? String(d.due_day) : f.due_day,
          statement_close_day:
            d.statement_close_day !== undefined && d.statement_close_day !== null
              ? String(d.statement_close_day)
              : f.statement_close_day,
        };
      });

      setScanned(true);
      trackProductEvent('card_scan_completed', { source_screen: 'cards' });
    } catch (err) {
      alert(t('cards.scanFailed') + '\n\n' + (err?.message || err));
    } finally {
      setScanning(false);
    }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-background text-foreground';

  // Live one-month financing estimate from the values currently in the form,
  // so the user sees the implication before saving.
  const formFinancingEstimate = form
    ? estimateMonthlyFinancingCost(form.statement_balance, form.apr)
    : null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm mb-8 overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="font-bold text-foreground">
          {t('cards.financingGuard')}
        </div>

        {!form && (
          <button
            onClick={openAdd}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            {t('cards.addCard')}
          </button>
        )}
      </div>

      {form && (
        <div className="p-5 bg-blue-50/40 dark:bg-blue-950/10 border-b border-border">
          {/* SCAN STATEMENT (multi-page) */}
          <div className="mb-4">
            <ImageScanTray
              images={scanImages}
              setImages={setScanImages}
              onScan={runCardScan}
              scanning={scanning}
              addLabel={t('cards.scanOrUpload')}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('cards.scanHint')}
            </p>
          </div>

          {/* STATEMENT DETECTED confirmation */}
          {scanned && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
              <Icon
                name="CheckCircle2"
                size={16}
                className="text-emerald-600 mt-0.5 shrink-0"
              />
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                <span className="font-bold">{t('cards.statementDetected')}</span> {t('cards.statementDetectedBody')}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* CARD NAME */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.cardName')}
              </label>

              <input
                list="card-suggestions"
                className={inputCls}
                value={form.card_name}
                onChange={(e) => change('card_name', e.target.value)}
                placeholder={t('cards.cardNamePlaceholder')}
              />

              <datalist id="card-suggestions">
                {CARD_SUGGESTIONS.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>

            {/* CURRENT BALANCE */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.currentBalanceUsd')}
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.current_balance}
                onChange={(e) =>
                  change('current_balance', e.target.value)
                }
                placeholder={t('cards.currentBalancePlaceholder')}
              />
            </div>

            {/* STATEMENT BALANCE */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.statementBalanceUsd')}
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.statement_balance}
                onChange={(e) =>
                  change('statement_balance', e.target.value)
                }
                placeholder={t('cards.statementBalancePlaceholder')}
              />
            </div>

            {/* MINIMUM PAYMENT */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.minimumPaymentUsd')}
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.minimum_payment}
                onChange={(e) =>
                  change('minimum_payment', e.target.value)
                }
                placeholder={t('cards.minimumPaymentPlaceholder')}
              />
            </div>

            {/* APR */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.aprPct')}
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.apr}
                onChange={(e) => change('apr', e.target.value)}
                placeholder={t('cards.aprPlaceholder')}
              />
            </div>

            {/* DUE DAY */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.dueDayLabel')}
              </label>

              <input
                type="number"
                min="1"
                max="31"
                className={inputCls}
                value={form.due_day}
                onChange={(e) => change('due_day', e.target.value)}
              />
            </div>

            {/* CLOSE DAY */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('cards.closeDayLabel')}
              </label>

              <input
                type="number"
                min="1"
                max="31"
                className={inputCls}
                value={form.statement_close_day}
                onChange={(e) =>
                  change('statement_close_day', e.target.value)
                }
              />
            </div>
          </div>

          {/* FINANCING-COST ESTIMATE (educational, one month, only when APR known) */}
          {formFinancingEstimate !== null && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <span className="font-bold">{t('cards.estimatePrefix')}</span> {t('cards.financingEstimateLive', { balance: money(form.statement_balance), cost: money(formFinancingEstimate), apr: Number(form.apr) })}
              </p>
            </div>
          )}

          {/* REMINDER + FLOW communication */}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t('cards.saveCardNote')}
          </p>

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setForm(null)}
              className="px-4 py-3 min-h-[44px] text-muted-foreground hover:bg-muted rounded-md text-sm font-medium"
            >
              {t('common.cancel')}
            </button>

            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-3 min-h-[44px] bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? t('cards.saving') : t('cards.saveCard')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-6 text-muted-foreground text-sm">
          {t('cards.loadingCards')}
        </div>
      ) : cards.length === 0 ? (
        <div className="p-6 text-muted-foreground text-sm italic">
          {t('cards.noCardsYet')}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {cards.map((c) => (
            <CardRow
              key={c.id}
              c={c}
              onEdit={() => openEdit(c)}
              onDelete={() => remove(c)}
              onSetPaid={onSetPaid}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default CreditCardsPanel;

function CardRow({ c, onEdit, onDelete, onSetPaid }) {
  const { t } = useI18n();
  const due = nextDueDate(c.due_day);
  const dLeft = daysUntil(due);

  const bal = Number(c.statement_balance) || 0;
  const currentBalance = Number(c.current_balance) || 0;
  const min = Number(c.minimum_payment) || 0;
  const apr = Number(c.apr) || 0;
  const paid = !!c.statement_paid;
  const financingEstimate = estimateMonthlyFinancingCost(bal, apr);

  const urgent = dLeft !== null && dLeft <= 3;
  const soon = dLeft !== null && dLeft <= 7;

  const dueColor = urgent
    ? 'text-red-600'
    : soon
      ? 'text-amber-600'
      : 'text-foreground';

  const togglePaid = async () => {
    try {
      await onSetPaid?.(c.id, !paid);
    } catch (e) {
      alert(t('cards.updateFailed', { msg: e?.message || e }));
    }
  };

  return (
    <div
      className={`px-5 py-4 flex items-start justify-between gap-4 group ${
        paid ? 'bg-green-50/40 dark:bg-green-950/10' : ''
      }`}
    >
      <div className="flex items-start gap-3 flex-1">
        {/* PAID TOGGLE */}
        <button
          onClick={togglePaid}
          title={paid ? t('cards.markNotPaid') : t('cards.markPaidTitle')}
          className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center transition-all shrink-0 ${
            paid
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-border hover:border-green-500 bg-card'
          }`}
        >
          {paid && <Icon name="Check" size={12} />}
        </button>

        <div className="flex-1">
          <div
            className={`font-bold ${
              paid ? 'text-green-800 dark:text-green-400' : 'text-foreground'
            }`}
          >
            {c.card_name}
          </div>

          {(currentBalance > 0 || apr > 0) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {currentBalance > 0 && (
                <>
                  {t('cards.currentBalanceInline')}{' '}
                  <span className="font-semibold">
                    {money(currentBalance)}
                  </span>
                </>
              )}

              {currentBalance > 0 && apr > 0 && <span> · </span>}

              {apr > 0 && (
                <>
                  {t('cards.aprInline')}{' '}
                  <span className="font-semibold">
                    {apr.toLocaleString('en-US', {
                      maximumFractionDigits: 3,
                    })}
                    %
                  </span>
                </>
              )}
            </p>
          )}

          {paid ? (
            <p className="text-sm mt-0.5 text-green-700 dark:text-green-400">
              {t('cards.paidCleared', { amount: money(bal) })}
            </p>
          ) : due ? (
            <p className={`text-sm mt-0.5 ${dueColor}`}>
              {t('cards.pay')} <span className="font-bold">{money(bal)}</span> {t('cards.by')}{' '}
              <span className="font-bold">{format(due, 'MMM d')}</span>

              {dLeft !== null && (
                <span>
                  {' '}
                  (
                  {dLeft === 0
                    ? t('cards.dueToday')
                    : dLeft === 1
                      ? t('cards.dueTomorrow')
                      : t('cards.dueInDays', { count: dLeft })}
                  )
                </span>
              )}{' '}
              {t('cards.inFullAvoid')}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('cards.setDueDay')}
            </p>
          )}

          {!paid && min > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('cards.minimumNote', { amount: money(min) })}
            </p>
          )}

          {!paid && financingEstimate !== null && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {t('cards.financingCarry', { amount: money(financingEstimate), apr })}
            </p>
          )}

          {!paid && bal > 0 && due && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <Icon name="CheckCircle2" size={12} />
              {t('cards.includedInFlow')}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          {t('cards.edit')}
        </button>

        <button
          onClick={onDelete}
          className="text-xs font-semibold text-destructive hover:text-destructive/80"
        >
          {t('cards.remove')}
        </button>
      </div>
    </div>
  );
}