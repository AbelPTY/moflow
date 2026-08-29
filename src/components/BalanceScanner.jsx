import React, { useMemo, useRef, useState } from 'react';
import Icon from './AppIcon';
import { authHeader } from '../lib/apiClient';

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

const BalanceScanner = ({ onApply, onClose }) => {
  const fileInputRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(null); // null = nothing scanned yet

  const triggerPick = () => fileInputRef.current?.click();

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;

    setScanning(true);
    setError('');

    const reader = new FileReader();
    reader.onerror = () => {
      setScanning(false);
      setError('Could not read that file.');
    };

    reader.onloadend = () => {
      const img = new Image();
      img.onerror = () => {
        setScanning(false);
        setError('Could not load that image.');
      };

      img.onload = async () => {
        try {
          // Compress client-side like the card-statement scanner.
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const scale = Math.min(1, MAX_WIDTH / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64Image = canvas.toDataURL('image/jpeg', 0.7);

          const resp = await fetch('/api/scanAccountBalances', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await authHeader()),
            },
            body: JSON.stringify({ image: base64Image }),
          });

          if (!resp.ok) throw new Error(resp.statusText || 'scan failed');

          const data = await resp.json();
          const accounts = Array.isArray(data?.accounts) ? data.accounts : [];

          // Map into editable rows. Credit rows default to NOT counting.
          const mapped = accounts.map((a, idx) => {
            const credit = isCreditRow(a);
            return {
              id: `row-${idx}-${Date.now()}`,
              name: a.name || '',
              balance: String(a.balance ?? ''),
              currency: (a.currency || 'USD').toUpperCase(),
              type: a.type || 'other',
              is_credit: credit,
              include: !credit, // deposit rows count by default; credit never
            };
          });

          setRows(mapped);
          if (mapped.length === 0) {
            setError('No account balances were clearly detected. Try a clearer screenshot or enter cash manually.');
          }
        } catch (err) {
          setError(
            'Could not read that screenshot — try again or enter cash manually. ' +
              (err?.message || '')
          );
        } finally {
          setScanning(false);
        }
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  };

  const updateRow = (id, patch) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));

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
          <p className="font-extrabold text-foreground">Scan account balances</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Take or upload a screenshot of your banking-app summary. This reads the
            image only — it is not a live bank connection.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
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
        onChange={handleFile}
        className="hidden"
      />

      {rows === null ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={triggerPick}
            disabled={scanning}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
              scanning
                ? 'bg-muted text-muted-foreground cursor-wait'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Icon name="Camera" size={18} />
            {scanning ? 'Reading screenshot…' : 'Take photo or upload'}
          </button>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm font-semibold text-foreground">
            MoFlow found these balances.
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            Review what should count as cash available to you. Edit any value, untick
            what shouldn&apos;t count, or remove a row.
          </p>

          <div className="space-y-2">
            {rows.map((r) => {
              const credit = isCreditRow(r);
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  {/* COUNT TOGGLE */}
                  <label
                    className={`flex items-center gap-2 shrink-0 ${
                      credit ? 'opacity-60' : 'cursor-pointer'
                    }`}
                    title={credit ? 'Credit balances can’t count as cash' : 'Count toward available cash'}
                  >
                    <input
                      type="checkbox"
                      checked={r.include && !credit}
                      disabled={credit}
                      onChange={(e) => updateRow(r.id, { include: e.target.checked })}
                      className="w-5 h-5 rounded border-border"
                    />
                    <span className="text-[10px] uppercase font-bold text-muted-foreground sm:hidden">
                      Count
                    </span>
                  </label>

                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => updateRow(r.id, { name: e.target.value })}
                    placeholder="Account name"
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
                        Credit — not cash
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      aria-label="Remove row"
                      className="p-2 text-muted-foreground hover:text-destructive"
                    >
                      <Icon name="Trash2" size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* SELECTED TOTAL */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            {currenciesSelected.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing selected to count as available cash yet.
              </p>
            ) : singleCurrency ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                  Selected total
                </span>
                <span className="text-2xl font-extrabold text-foreground">
                  {formatCurrency(singleCurrencyTotal, singleCurrency)}
                </span>
              </div>
            ) : (
              <div>
                <p className="text-sm font-bold text-amber-700">
                  Multiple currencies selected
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
                  MoFlow won&apos;t sum different currencies. Select a single currency to
                  apply, or adjust manually — no exchange-rate conversion is done here.
                </p>
              </div>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          {/* ACTIONS */}
          <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 min-h-[48px] rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => canApply && onApply(singleCurrencyTotal)}
              disabled={!canApply}
              className="px-5 py-3 min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {canApply
                ? `Use ${formatCurrency(singleCurrencyTotal, singleCurrency)} as available cash`
                : 'Select a single currency to apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BalanceScanner;
