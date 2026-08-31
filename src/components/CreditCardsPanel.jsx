import React, {
  useState,
  useRef,
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
  const [form, setForm] = useState(null); // null = closed
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false); // true once a scan pre-fills the form
  const fileInputRef = useRef(null);

  const openAdd = () => {
    setScanned(false);
    setForm({
      ...BLANK,
      statement_paid: false,
      _origBalance: '',
    });
  };

  // Trigger the statement scanner from outside the panel (e.g. the Cards hero
  // CTA). Opens the add form if none is open, then reuses the same hidden file
  // input and scan pipeline -- no second scanner implementation.
  const triggerScan = () => {
    trackProductEvent('card_scan_started', { source_screen: 'cards' });
    fileInputRef.current?.click();
  };

  useImperativeHandle(ref, () => ({
    openScanner: () => {
      setForm((current) =>
        current || { ...BLANK, statement_paid: false, _origBalance: '' }
      );
      // Defer so the form/input are settled before opening the file picker.
      requestAnimationFrame(triggerScan);
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
      alert('Card name is required.');
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
      alert('Failed to save card: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.card_name}?`)) return;

    try {
      await onDelete(c.id);
    } catch (e) {
      alert('Failed to remove: ' + (e?.message || e));
    }
  };

  // Scan a photo of the statement summary and pre-fill the form. Compresses the
  // image client-side (like the receipt scanner) before sending to the vision API.
  const handleScanStatement = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file

    if (!file) return;

    setScanning(true);
    setScanned(false);

    const reader = new FileReader();

    reader.onerror = () => {
      setScanning(false);
      alert('Could not read that file.');
    };

    reader.onloadend = () => {
      const img = new Image();

      img.onerror = () => {
        setScanning(false);
        alert('Could not load that image.');
      };

      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const scale = Math.min(1, MAX_WIDTH / img.width);

          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);

          canvas
            .getContext('2d')
            .drawImage(img, 0, 0, canvas.width, canvas.height);

          const base64Image = canvas.toDataURL('image/jpeg', 0.7);

          const resp = await fetch('/api/scanCardStatement', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await authHeader()),
            },
            body: JSON.stringify({
              image: base64Image,
            }),
          });

          if (!resp.ok) {
            throw new Error(resp.statusText || 'scan failed');
          }

          const d = await resp.json();

          setForm((prev) => {
            const f = prev || { ...BLANK, statement_paid: false, _origBalance: '' };
            return {
            ...f,
            card_name: f.card_name || d.card_name_hint || '',
            current_balance:
              d.current_balance !== undefined &&
              d.current_balance !== null &&
              d.current_balance !== 0
                ? String(d.current_balance)
                : f.current_balance,
            statement_balance:
              d.statement_balance !== undefined &&
              d.statement_balance !== null &&
              d.statement_balance !== 0
                ? String(d.statement_balance)
                : f.statement_balance,
            minimum_payment:
              d.minimum_payment !== undefined &&
              d.minimum_payment !== null &&
              d.minimum_payment !== 0
                ? String(d.minimum_payment)
                : f.minimum_payment,
            apr:
              d.apr !== undefined && d.apr !== null
                ? String(d.apr)
                : f.apr,
            due_day:
              d.due_day !== undefined && d.due_day !== null
                ? String(d.due_day)
                : f.due_day,
            statement_close_day:
              d.statement_close_day !== undefined &&
              d.statement_close_day !== null
                ? String(d.statement_close_day)
                : f.statement_close_day,
            };
          });

          setScanned(true);
          trackProductEvent('card_scan_completed', { source_screen: 'cards' });
        } catch (err) {
          alert(
            'Could not read the statement photo — enter the numbers manually.\n\n' +
              (err?.message || err)
          );
        } finally {
          setScanning(false);
        }
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
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
      {/* Always-mounted file input so the scanner can be triggered from the
          in-form button OR externally (Cards hero) via the imperative handle. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleScanStatement}
        disabled={scanning}
        className="hidden"
      />

      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="font-bold text-foreground">
          Credit cards — financing guard
        </div>

        {!form && (
          <button
            onClick={openAdd}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            + Add card
          </button>
        )}
      </div>

      {form && (
        <div className="p-5 bg-blue-50/40 dark:bg-blue-950/10 border-b border-border">
          {/* SCAN STATEMENT */}
          <div className="mb-4">
            <button
              type="button"
              onClick={triggerScan}
              disabled={scanning}
              className={`inline-flex items-center gap-2 px-4 py-3 rounded-md text-sm font-semibold transition-colors min-h-[44px] ${
                scanning
                  ? 'bg-muted text-muted-foreground cursor-wait'
                  : 'bg-card border border-blue-200 text-blue-700 hover:bg-blue-50'
              }`}
            >
              <Icon name="Camera" size={16} />

              {scanning
                ? 'Reading statement…'
                : 'Scan or upload statement'}
            </button>

            <p className="text-[11px] text-muted-foreground mt-1">
              Take a photo or pick a screenshot of the statement&apos;s summary
              box — we&apos;ll fill the numbers below for you to confirm.
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
                <span className="font-bold">Statement detected.</span> Review
                the extracted details below and edit anything before saving —
                nothing is saved until you confirm.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* CARD NAME */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Card name
              </label>

              <input
                list="card-suggestions"
                className={inputCls}
                value={form.card_name}
                onChange={(e) => change('card_name', e.target.value)}
                placeholder="e.g. Banco General - Star CC"
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
                Current balance ($)
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
                placeholder="Total currently owed"
              />
            </div>

            {/* STATEMENT BALANCE */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Statement balance ($)
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
                placeholder="Pay in full to avoid interest"
              />
            </div>

            {/* MINIMUM PAYMENT */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Minimum payment ($)
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
                placeholder="Avoids the late fee"
              />
            </div>

            {/* APR */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                APR (%)
              </label>

              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.apr}
                onChange={(e) => change('apr', e.target.value)}
                placeholder="e.g. 24.99"
              />
            </div>

            {/* DUE DAY */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Payment due day (1-31)
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
                Statement close day (1-31)
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
                <span className="font-bold">Estimate:</span> carrying this{' '}
                {money(form.statement_balance)} statement could cost about{' '}
                <span className="font-bold">
                  {money(formFinancingEstimate)}
                </span>{' '}
                in financing over one month at {Number(form.apr)}% APR. Paying
                the statement in full by the due date may avoid this cost,
                subject to your card&apos;s terms. This is an educational
                one-month estimate, not your total financing cost.
              </p>
            </div>
          )}

          {/* REMINDER + FLOW communication */}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Save the card so MoFlow can track its due date, include it in your
            payment planning, and factor the statement balance into Flow.
          </p>

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setForm(null)}
              className="px-4 py-3 min-h-[44px] text-muted-foreground hover:bg-muted rounded-md text-sm font-medium"
            >
              Cancel
            </button>

            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-3 min-h-[44px] bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save card'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-6 text-muted-foreground text-sm">
          Loading cards…
        </div>
      ) : cards.length === 0 ? (
        <div className="p-6 text-muted-foreground text-sm italic">
          No cards yet — add one to track statement balances and never pay a
          financing fee.
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
      alert('Failed to update: ' + (e?.message || e));
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
          title={paid ? 'Mark as not paid' : 'Mark this statement paid'}
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
                  Current balance{' '}
                  <span className="font-semibold">
                    {money(currentBalance)}
                  </span>
                </>
              )}

              {currentBalance > 0 && apr > 0 && <span> · </span>}

              {apr > 0 && (
                <>
                  APR{' '}
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
              ✓ Paid — {money(bal)} cleared. Enter the next statement when it
              arrives.
            </p>
          ) : due ? (
            <p className={`text-sm mt-0.5 ${dueColor}`}>
              Pay <span className="font-bold">{money(bal)}</span> by{' '}
              <span className="font-bold">{format(due, 'MMM d')}</span>

              {dLeft !== null && (
                <span>
                  {' '}
                  (
                  {dLeft === 0
                    ? 'today'
                    : dLeft === 1
                      ? 'tomorrow'
                      : `in ${dLeft} days`}
                  )
                </span>
              )}{' '}
              in full to help avoid purchase financing charges, subject to your
              card&apos;s terms.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">
              Set a due day to activate the guard.
            </p>
          )}

          {!paid && min > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Paying at least the minimum{' '}
              <span className="font-semibold">{money(min)}</span> by the due
              date generally helps avoid late-payment penalties (the remaining
              balance still accrues interest).
            </p>
          )}

          {!paid && financingEstimate !== null && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Estimated financing to carry this statement one month: about{' '}
              <span className="font-semibold">{money(financingEstimate)}</span>{' '}
              at {apr}% APR (educational one-month estimate, not the total).
            </p>
          )}

          {!paid && bal > 0 && due && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <Icon name="CheckCircle2" size={12} />
              This statement is included in Flow.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          Edit
        </button>

        <button
          onClick={onDelete}
          className="text-xs font-semibold text-destructive hover:text-destructive/80"
        >
          Remove
        </button>
      </div>
    </div>
  );
}