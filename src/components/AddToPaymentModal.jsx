import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import useScheduledPayments from '../hooks/useScheduledPayments';
import {
  FREQUENCIES,
  suggestNextDueDate,
  suggestFrequency,
  buildPaymentFromTransaction,
  findDuplicatePayment,
} from '../lib/paymentFromActivity';

// Activity → Add to Payments confirmation form.
//
// Turns a historical expense transaction into a FUTURE recurring obligation in
// the existing scheduled_payments model (reusing useScheduledPayments.addPayment
// — no new table, no direct Flow write; Flow consumes it through the normal
// Payments pipeline). Nothing is created without explicit confirmation, and a
// likely duplicate is surfaced before any write.
//
// Props: open, transaction (processed row), transactions (history for the
// frequency suggestion), todayStr?, onClose, onCreated?
export default function AddToPaymentModal({
  open,
  transaction,
  transactions = [],
  todayStr,
  onClose,
  onCreated,
}) {
  const { t, tCategory } = useI18n();
  const { payments, addPayment } = useScheduledPayments();

  const today = todayStr || new Date().toISOString().split('T')[0];

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dupCandidate, setDupCandidate] = useState(null); // likely existing payment
  const [overrideDup, setOverrideDup] = useState(false); // "Create anyway" confirmed
  const [created, setCreated] = useState(null); // success payload

  // Prefill from the selected transaction each time the modal opens.
  useEffect(() => {
    if (!open || !transaction) return;
    const suggested = suggestFrequency(transaction, transactions);
    const freq = suggested || 'monthly';
    setName(transaction.merchant || '');
    setAmount(String(Math.abs(Number(transaction.amount) || 0)));
    // Only preselect a frequency when history actually suggests one; otherwise
    // leave it unselected so the user makes an explicit choice.
    setFrequency(suggested || '');
    setNextDueDate(suggestNextDueDate(transaction.dateString || transaction.date, freq, today) || '');
    setError('');
    setDupCandidate(null);
    setOverrideDup(false);
    setCreated(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  // Recompute the SUGGESTED next due date when the user picks a frequency. The
  // user can still edit the date afterward.
  const onFrequencyChange = (value) => {
    setFrequency(value);
    if (value && transaction) {
      const s = suggestNextDueDate(transaction.dateString || transaction.date, value, today);
      if (s) setNextDueDate(s);
    }
  };

  const categoryLabel = useMemo(
    () => (transaction?.category ? tCategory(transaction.category) : ''),
    [transaction, tCategory]
  );

  if (!open || !transaction) return null;

  const close = () => {
    if (busy) return;
    onClose?.();
  };

  const doCreate = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = buildPaymentFromTransaction(transaction, {
        name,
        amount,
        frequency,
        nextDueDate,
      });
      await addPayment(payload);
      // Provenance: scheduled_payments has no source column, and the product
      // analytics allowlist is pinned to a DB CHECK constraint (adding an event
      // would require a migration, out of scope here), so origin is intentionally
      // not persisted. The payment is a plain user-created obligation.
      setCreated(payload);
      onCreated?.(payload);
    } catch (e) {
      setError(t('addToPayments.createFailed', { msg: e?.message || e }));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!frequency) {
      setError(t('addToPayments.pickFrequency'));
      return;
    }
    let payload;
    try {
      payload = buildPaymentFromTransaction(transaction, { name, amount, frequency, nextDueDate });
    } catch (err) {
      setError(t('addToPayments.pickDueDate'));
      return;
    }
    // Duplicate detection before writing (unless the user chose "Create anyway").
    if (!overrideDup) {
      const dup = findDuplicatePayment(payload, payments || []);
      if (dup) {
        setDupCandidate(dup);
        return;
      }
    }
    await doCreate();
  };

  // --- SUCCESS ---
  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
        <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3 text-2xl">✓</div>
          <h2 className="text-lg font-bold text-foreground">{t('addToPayments.successTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{created.entity} · ${Number(created.amount).toFixed(2)}</p>
          <div className="flex gap-2 justify-center mt-5">
            <a href="/bills" className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted">{t('addToPayments.viewPayment')}</a>
            <button onClick={close} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">{t('common.close')}</button>
          </div>
        </div>
      </div>
    );
  }

  // --- DUPLICATE WARNING ---
  if (dupCandidate) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
        <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-foreground mb-1">{t('addToPayments.duplicateTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {dupCandidate.entity} · ${Number(dupCandidate.amount).toFixed(2)}
            {dupCandidate.payment_date ? ` · ${dupCandidate.payment_date}` : ''}
          </p>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <div className="flex flex-col gap-2 mt-5">
            <button onClick={close} disabled={busy} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50">
              {t('addToPayments.useExisting')}
            </button>
            <button
              onClick={async () => { setOverrideDup(true); setDupCandidate(null); await doCreate(); }}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
            >
              {t('addToPayments.createAnyway')}
            </button>
            <button onClick={() => setDupCandidate(null)} disabled={busy} className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg text-sm font-medium disabled:opacity-50">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- FORM ---
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <form className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className="text-lg font-bold text-foreground mb-1">{t('addToPayments.title')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('addToPayments.subtitle')}</p>

        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t('addToPayments.name')}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-border rounded-lg p-2 text-sm mb-3 bg-card" required />

        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t('addToPayments.amount')}</label>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border border-border rounded-lg p-2 text-sm mb-3 bg-card" required />

        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t('addToPayments.frequency')}</label>
        <select value={frequency} onChange={(e) => onFrequencyChange(e.target.value)} className="w-full border border-border rounded-lg p-2 text-sm mb-3 bg-card">
          <option value="">{t('addToPayments.frequencyUnset')}</option>
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>{t(`addToPayments.freq.${f}`)}</option>
          ))}
        </select>

        <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t('addToPayments.nextDueDate')}</label>
        <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} className="w-full border border-border rounded-lg p-2 text-sm mb-3 bg-card" required />

        {/* Context (from the transaction) — canonical values shown, not stored. */}
        <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 mb-4 text-xs text-muted-foreground space-y-1">
          {categoryLabel && <div>{t('addToPayments.categoryContext', { value: categoryLabel })}</div>}
          {transaction.account && <div>{t('addToPayments.accountContext', { value: transaction.account })}</div>}
          <div>{t('addToPayments.fromTransaction', { date: transaction.dateString || transaction.date })}</div>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg text-sm font-medium disabled:opacity-50">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {busy ? t('addToPayments.creating') : t('addToPayments.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
