import React, { useMemo, useRef, useState } from 'react';
import Icon from './AppIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { authHeader } from '../lib/apiClient';
import { flagDuplicateActivityRows } from '../lib/dedupeTransactions';
import { trackProductEvent } from '../lib/analytics';

// Reusable recent-activity screenshot importer. Reads ONE banking-app activity
// screenshot the user chooses, extracts visible transactions (via the shared
// scanReceipt endpoint in mode:'activity'), lets the user review/edit/select,
// flags likely duplicates, and imports the selected rows into the SAME
// transactions table + fields the rest of the app uses. Nothing is auto-imported.
//
// This reads the image the user uploads. It is NOT a bank connection.

const money = (n) =>
  `${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const todayStr = () => new Date().toISOString().split('T')[0];

// yyyy-MM-dd -> stable midday ISO (matches BulkUpload's date handling so the
// same-day dedup indexes line up).
const toIsoDate = (dateStr) => {
  const s = String(dateStr || '').slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date();
  return Number.isNaN(d.getTime())
    ? new Date(`${todayStr()}T12:00:00`).toISOString()
    : d.toISOString();
};

const RecentActivityScanner = ({ accounts = [], onImported, onClose }) => {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(null); // null = nothing scanned yet
  const [done, setDone] = useState(null); // { count }

  const knownAccounts = useMemo(
    () => (accounts || []).filter(Boolean),
    [accounts]
  );
  // No silent fallback: the user must explicitly pick or type a destination.
  const [account, setAccount] = useState(''); // '' = nothing chosen yet
  const [customAccount, setCustomAccount] = useState('');
  const noKnownAccounts = knownAccounts.length === 0;
  // With no known accounts we show the custom input directly (implicitly custom).
  const usingCustom = noKnownAccounts || account === '__custom__';
  const effectiveAccount = (usingCustom ? customAccount : account).trim();
  const accountChosen = effectiveAccount.length > 0;

  const triggerPick = () => {
    trackProductEvent('activity_scan_started', { source_screen: 'activity' });
    fileInputRef.current?.click();
  };

  const runDuplicateFlags = async (mapped) => {
    // Query the user's existing rows in the scanned date range and flag likely
    // duplicates using the shared strategy. Non-blocking: on any error we just
    // proceed with nothing flagged.
    try {
      const dates = mapped.map((r) => r.date).filter(Boolean).sort();
      if (!user?.id || dates.length === 0) return mapped.map((r) => ({ ...r }));

      const { data: existing } = await supabase
        .from('transactions')
        .select('date, amount, bank_reference, description, merchant')
        .eq('user_id', user.id)
        .gte('date', dates[0])
        .lte('date', `${dates[dates.length - 1]}T23:59:59`);

      return flagDuplicateActivityRows(mapped, existing || []);
    } catch {
      return mapped.map((r) => ({ ...r }));
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanning(true);
    setError('');
    setDone(null);

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
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const scale = Math.min(1, MAX_WIDTH / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64Image = canvas.toDataURL('image/jpeg', 0.7);

          const resp = await fetch('/api/scanReceipt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await authHeader()),
            },
            body: JSON.stringify({ image: base64Image, mode: 'activity' }),
          });

          if (!resp.ok) throw new Error(resp.statusText || 'scan failed');

          const data = await resp.json();
          const txns = Array.isArray(data?.transactions) ? data.transactions : [];
          trackProductEvent('activity_scan_completed', { source_screen: 'activity' });

          const mapped = txns.map((t, idx) => ({
            id: `row-${idx}-${Date.now()}`,
            date: String(t.date || todayStr()).slice(0, 10),
            description: String(t.description || '').trim(),
            amount: String(t.amount ?? ''),
            reference: String(t.reference || '').trim(),
          }));

          const flagged = await runDuplicateFlags(mapped);

          // Likely duplicates default to NOT selected; everything else selected.
          setRows(
            flagged.map((r) => ({ ...r, include: !r.isDuplicate }))
          );

          if (flagged.length === 0) {
            setError('No transactions were clearly detected. Try a clearer screenshot.');
          }
        } catch (err) {
          setError('Could not read that screenshot — try again. ' + (err?.message || ''));
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

  // Hard duplicates (willFailSave) can never be selected/imported -- the DB
  // would reject them. Only non-hard, ticked rows count as selected.
  const selected = useMemo(
    () => (rows || []).filter((r) => r.include && !r.willFailSave),
    [rows]
  );
  const selectedTotal = useMemo(
    () => selected.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
    [selected]
  );
  const hardDupCount = useMemo(
    () => (rows || []).filter((r) => r.willFailSave).length,
    [rows]
  );
  const softDupCount = useMemo(
    () => (rows || []).filter((r) => r.isDuplicate && !r.willFailSave).length,
    [rows]
  );

  const importSelected = async () => {
    if (!user?.id) {
      setError('Please sign in again to import.');
      return;
    }
    if (!accountChosen) {
      setError('Choose which account these transactions belong to before importing.');
      return;
    }
    // `selected` already excludes hard duplicates, so they can never reach here.
    const toImport = selected.filter(
      (r) => r.description && parseFloat(r.amount) !== 0 && !Number.isNaN(parseFloat(r.amount))
    );
    if (toImport.length === 0) {
      setError('Select at least one row with a description and non-zero amount.');
      return;
    }

    setImporting(true);
    setError('');
    try {
      const formatted = toImport.map((r) => ({
        user_id: user.id,
        date: toIsoDate(r.date),
        description: r.description,
        description_raw: r.description,
        merchant: r.description,
        amount: parseFloat(r.amount),
        category: 'Uncategorized',
        budget_bucket: 'Unsorted',
        account_name: effectiveAccount,
        source_account: effectiveAccount,
        bank_reference: r.reference || null,
        notes: 'Imported via activity scan',
      }));

      const { error: insertError } = await supabase.from('transactions').insert(formatted);
      if (insertError) throw insertError;

      setDone({ count: formatted.length });
      setRows(null);
      if (onImported) onImported(formatted.length);
    } catch (err) {
      setError('Import failed: ' + (err?.message || 'unknown error'));
    } finally {
      setImporting(false);
    }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-extrabold text-foreground">Scan recent activity</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload screenshots from your banking app and review transactions before
            importing. MoFlow reads the image you choose to upload — it is not a bank
            connection.
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />

      {/* SUCCESS STATE */}
      {done && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4">
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
            {done.count} transaction{done.count === 1 ? '' : 's'} imported
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
            MoFlow can now use these transactions to improve spending and
            recurring-payment insights.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setDone(null)}
              className="px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
            >
              Scan another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* INITIAL / SCAN STATE */}
      {!done && rows === null && (
        <div className="mt-4">
          <button
            type="button"
            onClick={triggerPick}
            disabled={scanning}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
              scanning
                ? 'bg-muted text-muted-foreground cursor-wait'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            <Icon name="Camera" size={18} />
            {scanning ? 'Reading screenshot…' : 'Take photo or upload'}
          </button>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* REVIEW STATE */}
      {!done && rows !== null && (
        <div className="mt-4">
          {/* ACCOUNT DESTINATION (required, no silent fallback) */}
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            Import into account <span className="text-red-500">*</span>
          </label>
          {noKnownAccounts ? (
            <input
              type="text"
              value={customAccount}
              onChange={(e) => setCustomAccount(e.target.value)}
              placeholder="Type the account name these transactions belong to"
              className={`${inputCls} mb-2`}
            />
          ) : (
            <>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className={`${inputCls} mb-2`}
              >
                <option value="">Select account…</option>
                {knownAccounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                <option value="__custom__">+ Type a different account…</option>
              </select>
              {usingCustom && (
                <input
                  type="text"
                  value={customAccount}
                  onChange={(e) => setCustomAccount(e.target.value)}
                  placeholder="Account name"
                  className={`${inputCls} mb-2`}
                />
              )}
            </>
          )}
          {!accountChosen && (
            <p className="text-[11px] text-amber-700 mb-2">
              Choose an account to enable importing.
            </p>
          )}

          <p className="text-xs text-muted-foreground mb-3">
            MoFlow found these transactions. Review, edit, and choose which to import.
            {hardDupCount > 0 && (
              <>
                {' '}
                <span className="font-semibold text-red-600">
                  {hardDupCount} already imported
                </span>{' '}
                (locked, can&apos;t be re-imported).
              </>
            )}
            {softDupCount > 0 && (
              <>
                {' '}
                <span className="font-semibold text-amber-700">
                  {softDupCount} possible duplicate{softDupCount === 1 ? '' : 's'}
                </span>{' '}
                unticked by default.
              </>
            )}
          </p>

          <div className="space-y-2">
            {rows.map((r) => {
              const isHard = !!r.willFailSave;
              const isSoft = r.isDuplicate && !isHard;
              return (
              <div
                key={r.id}
                className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center gap-2 ${
                  isHard
                    ? 'border-red-200 bg-red-50/50 dark:bg-red-950/10 opacity-70'
                    : isSoft
                      ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/10'
                      : 'border-border bg-card'
                }`}
              >
                <label
                  className={`flex items-center gap-2 shrink-0 ${isHard ? 'opacity-60' : 'cursor-pointer'}`}
                  title={isHard ? 'Already imported — can’t be re-imported' : 'Import this transaction'}
                >
                  <input
                    type="checkbox"
                    checked={r.include && !isHard}
                    disabled={isHard}
                    onChange={(e) => updateRow(r.id, { include: e.target.checked })}
                    className="w-5 h-5 rounded border-border"
                  />
                  <span className="text-[10px] uppercase font-bold text-muted-foreground sm:hidden">
                    Import
                  </span>
                </label>

                <input
                  type="date"
                  value={r.date}
                  onChange={(e) => updateRow(r.id, { date: e.target.value })}
                  className={`${inputCls} sm:w-40`}
                />
                <input
                  type="text"
                  value={r.description}
                  onChange={(e) => updateRow(r.id, { description: e.target.value })}
                  placeholder="Description"
                  className={`${inputCls} flex-1`}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={r.amount}
                  onChange={(e) => updateRow(r.id, { amount: e.target.value })}
                  placeholder="0.00"
                  className={`${inputCls} sm:w-32 ${
                    (parseFloat(r.amount) || 0) >= 0 ? 'text-emerald-600' : 'text-foreground'
                  }`}
                />
                <div className="flex items-center gap-2 shrink-0">
                  {isHard ? (
                    <span
                      title={r.duplicateNote || 'Already imported'}
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                    >
                      Already imported
                    </span>
                  ) : isSoft ? (
                    <span
                      title={r.duplicateNote || 'A similar transaction already exists'}
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                    >
                      Possible duplicate
                    </span>
                  ) : null}
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

          {/* COUNT + SELECTED TOTAL */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4 flex items-center justify-between">
            <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              {selected.length} selected
            </span>
            <span
              className={`text-xl font-extrabold ${
                selectedTotal >= 0 ? 'text-emerald-600' : 'text-foreground'
              }`}
            >
              {selectedTotal >= 0 ? '+' : '-'}${money(Math.abs(selectedTotal))}
            </span>
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

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
              onClick={importSelected}
              disabled={importing || selected.length === 0 || !accountChosen}
              className="px-5 py-3 min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? 'Importing…' : `Import selected (${selected.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecentActivityScanner;
