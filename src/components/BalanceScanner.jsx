import React, { useMemo, useRef, useState } from 'react';
import Icon from './AppIcon';
import { authHeader } from '../lib/apiClient';
import { dedupeDetectedAccounts, isEligibleCashType, mergeAccountOptions, matchAccountByName } from '../lib/accountOptions';
import useAccounts from '../hooks/useAccounts';
import { useI18n } from '../i18n';

// Reusable balance-screenshot scanner. Takes a photo/upload of a banking-app
// account summary, calls /api/scanAccountBalances, and lets the user review and
// edit the extracted rows before EXPLICITLY applying a single-currency total to
// "available cash". It never persists anything and never applies a total on its
// own -- the parent's onApply is called only when the user confirms.
//
// Credit-card / line-of-credit rows are shown for context but can never count
// toward available cash (available credit is not cash, and debt is not cash).
//
// This is screenshot extraction, NOT a live bank connection.

const money = (n) =>
  `${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Format a currency total for display. USD gets a leading $, other codes are
// shown as "CODE 1,234.56" so nothing is silently treated as dollars.
const formatCurrency = (amount, currency) =>
  currency === 'USD' ? `$${money(amount)}` : `${currency} ${money(amount)}`;

const CREDIT_TYPES = new Set(['credit_card', 'credit', 'loan', 'debt', 'line_of_credit']);

const isCreditRow = (row) => row.is_credit || CREDIT_TYPES.has(row.type);

const MAX_IMAGES = 5;

const todayStr = () => new Date().toISOString().split('T')[0];

const BalanceScanner = ({ onApply, onClose, onBalancesUpdated }) => {
  const { t } = useI18n();
  const fileInputRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(null); // null = nothing scanned yet
  const [images, setImages] = useState([]); // compressed dataURLs for a session
  const [savingBalances, setSavingBalances] = useState(false);
  const [balancesNote, setBalancesNote] = useState('');

  // First-class accounts the user already created, so each detected balance row
  // can be associated with a real account (e.g. "Banco General Checking") rather
  // than a bare type. Active accounts only.
  const { accounts, updateAccountBalances, addAccount, updateAccountBalance } = useAccounts();
  const accountNames = useMemo(
    () => mergeAccountOptions(accounts, []).map((o) => o.name),
    [accounts]
  );

  const triggerPick = () => fileInputRef.current?.click();

  const compressImage = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onloadend = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('load failed'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const scale = Math.min(1, MAX_WIDTH / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setError('');

    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(t('scanner.maxImages', { max: MAX_IMAGES }));
      return;
    }
    if (files.length > room) setError(t('scanner.onlyFirst', { max: MAX_IMAGES }));

    try {
      const compressed = await Promise.all(files.slice(0, room).map(compressImage));
      setImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES));
    } catch {
      setError(t('scanner.couldNotReadImage'));
    }
  };

  const removeImage = (idx) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const scanImages = async () => {
    if (images.length === 0) return;
    setScanning(true);
    setError('');

    try {
      const resp = await fetch('/api/scanAccountBalances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ images }),
      });
      if (!resp.ok) throw new Error(resp.statusText || 'scan failed');

      const data = await resp.json();
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];

      // Merge accounts across screenshots: the SAME account is shown once (never
      // summed); distinct accounts stay separate even if same type/institution.
      const merged = dedupeDetectedAccounts(accounts);

      // Map into editable rows. Only eligible cash types (checking/savings/cash)
      // count toward available cash by default; credit never does.
      const mapped = merged.map((a, idx) => {
        const credit = isCreditRow(a);
        // Preselect an existing account ONLY on a strong (normalized) name match.
        // A bare "savings"/"checking" never auto-resolves to one of several.
        const strong = matchAccountByName(a.name, accounts);
        return {
          id: `row-${idx}-${Date.now()}`,
          name: strong ? strong.account_name : (a.name || ''),
          balance: String(a.balance ?? ''),
          currency: (a.currency || 'USD').toUpperCase(),
          type: a.type || 'other',
          is_credit: credit,
          include: !credit && isEligibleCashType(a.type),
        };
      });

      setRows(mapped);
      if (mapped.length === 0) {
        setError(t('balanceScanner.noDetected'));
      }
    } catch (err) {
      setError(t('balanceScanner.couldNotRead') + (err?.message || ''));
    } finally {
      setScanning(false);
    }
  };

  const updateRow = (id, patch) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));

  // Persist each detected balance to its OWN account (by id). Rows assigned to an
  // existing account update that account; rows with a new name create the account
  // (the explicit button click is the confirmation) then set its balance. A
  // savings balance can never overwrite another account -- each write is by id.
  const persistBalances = async () => {
    const eligibleRows = (rows || []).filter(
      (r) => !isCreditRow(r) && isEligibleCashType(r.type) && r.name.trim() &&
        r.balance !== '' && Number.isFinite(parseFloat(r.balance))
    );
    if (eligibleRows.length === 0) {
      setBalancesNote(t('balanceScanner.noEligibleToSave'));
      return;
    }
    setSavingBalances(true);
    setBalancesNote('');
    try {
      const batch = [];
      let created = 0;
      for (const r of eligibleRows) {
        const match = matchAccountByName(r.name, accounts);
        if (match) {
          batch.push({ id: match.id, current_balance: parseFloat(r.balance), balance_as_of: todayStr() });
        } else {
          const acc = await addAccount({
            account_name: r.name.trim(),
            account_type: isEligibleCashType(r.type) ? r.type : 'other',
            currency: r.currency,
          });
          if (acc?.id) {
            await updateAccountBalance(acc.id, { current_balance: parseFloat(r.balance), balance_as_of: todayStr() });
            created += 1;
          }
        }
      }
      if (batch.length) await updateAccountBalances(batch);
      const total = batch.length + created;
      setBalancesNote(`Saved ${total} account balance${total === 1 ? '' : 's'}${created ? ` (${created} new account${created === 1 ? '' : 's'})` : ''}.`);
      if (onBalancesUpdated) onBalancesUpdated();
    } catch (e) {
      setBalancesNote(t('balanceScanner.someBalancesFailed', { msg: e?.message || e }));
    } finally {
      setSavingBalances(false);
    }
  };

  // Live totals for the rows the user has chosen to count, grouped by currency.
  const totals = useMemo(() => {
    const byCurrency = {};
    (rows || []).forEach((r) => {
      if (!r.include || isCreditRow(r)) return;
      const amt = parseFloat(r.balance) || 0;
      byCurrency[r.currency] = (byCurrency[r.currency] || 0) + amt;
    });
    return byCurrency;
  }, [rows]);

  const currenciesSelected = Object.keys(totals);
  const singleCurrency = currenciesSelected.length === 1 ? currenciesSelected[0] : null;
  const singleCurrencyTotal = singleCurrency ? totals[singleCurrency] : 0;
  const canApply = !!singleCurrency;

  const inputCls =
    'w-full border border-border rounded-md p-2 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-extrabold text-foreground">{t('balanceScanner.title')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('balanceScanner.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('scanner.close')}
          className="p-1 text-muted-foreground hover:text-foreground shrink-0"
        >
          <Icon name="X" size={18} />
        </button>
      </div>

      {/* Hidden input: accept image/* offers both the camera and the photo
          library on mobile (screenshots live in the library), and a normal file
          picker on desktop. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {rows === null ? (
        <div className="mt-4">
          {images.length === 0 ? (
            <button
              type="button"
              onClick={triggerPick}
              disabled={scanning}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-bold transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Icon name="Camera" size={18} />
              {t('scanner.addScreenshots')}
            </button>
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                {t('scanner.imagesSelected', { count: images.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                {images.map((src, idx) => (
                  <div key={idx} className="relative">
                    <img src={src} alt={`Page ${idx + 1}`} className="h-20 w-16 object-cover rounded-lg border border-border" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      aria-label={`Remove page ${idx + 1}`}
                      className="absolute -top-2 -right-2 bg-card border border-border rounded-full p-0.5 text-muted-foreground hover:text-destructive shadow-sm"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                ))}
                {images.length < MAX_IMAGES && (
                  <button
                    type="button"
                    onClick={triggerPick}
                    className="h-20 w-16 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary"
                  >
                    <Icon name="Plus" size={18} />
                    <span className="text-[10px] mt-0.5">{t('scanner.add')}</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={scanImages}
                disabled={scanning}
                className={`mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
                  scanning ? 'bg-muted text-muted-foreground cursor-wait' : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                <Icon name="ScanLine" size={18} />
                {scanning ? t('scanner.reading') : (images.length === 1 ? t('scanner.scanImage') : t('scanner.scanImages', { count: images.length }))}
              </button>
            </>
          )}
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm font-semibold text-foreground">
            {t('balanceScanner.foundBalances')}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            {t('balanceScanner.reviewText')}
          </p>

          <div className="space-y-2">
            {rows.map((r) => {
              const credit = isCreditRow(r);
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2"
                >
                  {/* ASSIGN TO AN EXISTING FIRST-CLASS ACCOUNT (or keep/edit the
                      scanned name below to create/label a new one). */}
                  {accountNames.length > 0 && !credit && (
                    <select
                      value={accountNames.includes(r.name) ? r.name : ''}
                      onChange={(e) => { if (e.target.value) updateRow(r.id, { name: e.target.value }); }}
                      className={`${inputCls} w-full`}
                    >
                      <option value="">{t('balanceScanner.assignToAccount')}</option>
                      {accountNames.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  {/* COUNT TOGGLE */}
                  <label
                    className={`flex items-center gap-2 shrink-0 ${
                      credit ? 'opacity-60' : 'cursor-pointer'
                    }`}
                    title={credit ? t('balanceScanner.creditCantCount') : t('balanceScanner.countTowardCash')}
                  >
                    <input
                      type="checkbox"
                      checked={r.include && !credit}
                      disabled={credit}
                      onChange={(e) => updateRow(r.id, { include: e.target.checked })}
                      className="w-5 h-5 rounded border-border"
                    />
                    <span className="text-[10px] uppercase font-bold text-muted-foreground sm:hidden">
                      {t('balanceScanner.countLabel')}
                    </span>
                  </label>

                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => updateRow(r.id, { name: e.target.value })}
                    placeholder={t('balanceScanner.accountNamePlaceholder')}
                    className={`${inputCls} flex-1`}
                  />

                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={r.balance}
                    onChange={(e) => updateRow(r.id, { balance: e.target.value })}
                    placeholder="0.00"
                    className={`${inputCls} sm:w-32`}
                  />

                  <span className="text-xs font-bold text-muted-foreground w-14 text-center shrink-0">
                    {r.currency}
                  </span>

                  <div className="flex items-center gap-2 shrink-0">
                    {credit && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {t('balanceScanner.creditNotCash')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      aria-label={t('balanceScanner.removeRow')}
                      className="p-2 text-muted-foreground hover:text-destructive"
                    >
                      <Icon name="Trash2" size={16} />
                    </button>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* SELECTED TOTAL */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            {currenciesSelected.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('balanceScanner.nothingSelected')}
              </p>
            ) : singleCurrency ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                  {t('balanceScanner.selectedTotal')}
                </span>
                <span className="text-2xl font-extrabold text-foreground">
                  {formatCurrency(singleCurrencyTotal, singleCurrency)}
                </span>
              </div>
            ) : (
              <div>
                <p className="text-sm font-bold text-amber-700">
                  {t('balanceScanner.multipleCurrencies')}
                </p>
                <div className="mt-1 text-sm text-foreground">
                  {currenciesSelected.map((c) => (
                    <div key={c} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{c}</span>
                      <span className="font-semibold">{formatCurrency(totals[c], c)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-amber-700 mt-2">
                  {t('balanceScanner.currencyNote')}
                </p>
              </div>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {balancesNote && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{balancesNote}</p>}

          {/* ACTIONS: (1) persist each balance to its account, (2) apply the total */}
          <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 min-h-[48px] rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={persistBalances}
              disabled={savingBalances}
              className="px-5 py-3 min-h-[48px] rounded-xl border border-border text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50"
            >
              {savingBalances ? t('balanceScanner.saving') : t('balanceScanner.updateBalances')}
            </button>
            <button
              type="button"
              onClick={() => canApply && onApply(singleCurrencyTotal)}
              disabled={!canApply}
              className="px-5 py-3 min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {canApply
                ? t('balanceScanner.useAsAvailable', { amount: formatCurrency(singleCurrencyTotal, singleCurrency) })
                : t('balanceScanner.selectSingleCurrency')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BalanceScanner;
