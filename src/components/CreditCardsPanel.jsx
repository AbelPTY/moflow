import React, { useState } from 'react';
import { format } from 'date-fns';
import Icon from './AppIcon';
import { nextDueDate, daysUntil } from '../lib/cardGuard';
import { authHeader } from '../lib/apiClient';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BLANK = { card_name: '', statement_close_day: '', due_day: '', statement_balance: '', minimum_payment: '' };

// Suggested names so entries stay consistent with the cleaned-up accounts.
const CARD_SUGGESTIONS = [
  'Banco General - Mileage CC',
  'Banco General - Star CC',
  'Davivienda CC',
  'Cooperativa Profesionales Mastercard',
  'UNFCU Visa Elite 5659',
];

export default function CreditCardsPanel({ cards, loading, onSave, onDelete, onSetPaid }) {
  const [form, setForm] = useState(null); // null = closed
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const openAdd = () => setForm({ ...BLANK, statement_paid: false, _origBalance: '' });
  const openEdit = (c) => setForm({
    id: c.id,
    card_name: c.card_name,
    statement_close_day: c.statement_close_day ?? '',
    due_day: c.due_day ?? '',
    statement_balance: c.statement_balance ?? '',
    minimum_payment: c.minimum_payment ?? '',
    statement_paid: c.statement_paid ?? false,
    _origBalance: c.statement_balance ?? '',
  });
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.card_name.trim()) { alert('Card name is required.'); return; }
    // Entering a new statement balance is a new bill -> reset the paid flag.
    const balanceChanged = String(form.statement_balance ?? '') !== String(form._origBalance ?? '');
    const payload = { ...form, statement_paid: balanceChanged ? false : form.statement_paid };
    setBusy(true);
    try {
      await onSave(payload);
      setForm(null);
    } catch (e) {
      alert('Failed to save card: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.card_name}?`)) return;
    try { await onDelete(c.id); } catch (e) { alert('Failed to remove: ' + (e?.message || e)); }
  };

  // Scan a photo of the statement summary and pre-fill the form. Compresses the
  // image client-side (like the receipt scanner) before sending to the vision API.
  const handleScanStatement = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setScanning(true);

    const reader = new FileReader();
    reader.onerror = () => { setScanning(false); alert('Could not read that file.'); };
    reader.onloadend = () => {
      const img = new Image();
      img.onerror = () => { setScanning(false); alert('Could not load that image.'); };
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const scale = Math.min(1, MAX_WIDTH / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64Image = canvas.toDataURL('image/jpeg', 0.7);

          const resp = await fetch('/api/scanCardStatement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
            body: JSON.stringify({ image: base64Image }),
          });
          if (!resp.ok) throw new Error(resp.statusText || 'scan failed');
          const d = await resp.json();

          setForm((f) => ({
            ...f,
            card_name: f.card_name || d.card_name_hint || '',
            statement_balance: d.statement_balance ? String(d.statement_balance) : f.statement_balance,
            minimum_payment: d.minimum_payment ? String(d.minimum_payment) : f.minimum_payment,
            due_day: d.due_day ? String(d.due_day) : f.due_day,
            statement_close_day: d.statement_close_day ? String(d.statement_close_day) : f.statement_close_day,
          }));
        } catch (err) {
          alert('Could not read the statement photo — enter the numbers manually.\n\n' + (err?.message || err));
        } finally {
          setScanning(false);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const inputCls = 'w-full border border-border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm mb-8 overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="font-bold text-foreground">Credit cards — financing guard</div>
        {!form && <button onClick={openAdd} className="text-sm font-semibold text-blue-600 hover:text-blue-700">+ Add card</button>}
      </div>

      {form && (
        <div className="p-5 bg-blue-50/40 border-b border-border">
          {/* SCAN STATEMENT */}
          <div className="mb-4">
            <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold cursor-pointer transition-colors ${scanning ? 'bg-muted text-muted-foreground cursor-wait' : 'bg-card border border-blue-200 text-blue-700 hover:bg-blue-50'}`}>
              <Icon name="Camera" size={16} />
              {scanning ? 'Reading statement…' : 'Scan or upload statement'}
              <input type="file" accept="image/*" onChange={handleScanStatement} disabled={scanning} className="hidden" />
            </label>
            <p className="text-[11px] text-muted-foreground mt-1">Take a photo or pick a screenshot of the statement's summary box — we'll fill the numbers below for you to confirm.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Card name</label>
              <input list="card-suggestions" className={inputCls} value={form.card_name} onChange={(e) => change('card_name', e.target.value)} placeholder="e.g. Banco General - Star CC" />
              <datalist id="card-suggestions">
                {CARD_SUGGESTIONS.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Statement balance ($)</label>
              <input type="number" className={inputCls} value={form.statement_balance} onChange={(e) => change('statement_balance', e.target.value)} placeholder="Pay in full to avoid interest" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Minimum payment ($)</label>
              <input type="number" className={inputCls} value={form.minimum_payment} onChange={(e) => change('minimum_payment', e.target.value)} placeholder="Avoids the late fee" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Payment due day (1-31)</label>
              <input type="number" min="1" max="31" className={inputCls} value={form.due_day} onChange={(e) => change('due_day', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Statement close day (1-31)</label>
              <input type="number" min="1" max="31" className={inputCls} value={form.statement_close_day} onChange={(e) => change('statement_close_day', e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setForm(null)} className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-md text-sm font-medium">Cancel</button>
            <button onClick={save} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save card'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-6 text-muted-foreground text-sm">Loading cards…</div>
      ) : cards.length === 0 ? (
        <div className="p-6 text-muted-foreground text-sm italic">No cards yet — add one to track statement balances and never pay a financing fee.</div>
      ) : (
        <div className="divide-y divide-border">
          {cards.map((c) => <CardRow key={c.id} c={c} onEdit={() => openEdit(c)} onDelete={() => remove(c)} onSetPaid={onSetPaid} />)}
        </div>
      )}
    </div>
  );
}

function CardRow({ c, onEdit, onDelete, onSetPaid }) {
  const due = nextDueDate(c.due_day);
  const dLeft = daysUntil(due);
  const bal = Number(c.statement_balance) || 0;
  const min = Number(c.minimum_payment) || 0;
  const paid = !!c.statement_paid;

  const urgent = dLeft !== null && dLeft <= 3;
  const soon = dLeft !== null && dLeft <= 7;
  const dueColor = urgent ? 'text-red-600' : soon ? 'text-amber-600' : 'text-foreground';

  const togglePaid = async () => {
    try { await onSetPaid?.(c.id, !paid); } catch (e) { alert('Failed to update: ' + (e?.message || e)); }
  };

  return (
    <div className={`px-5 py-4 flex items-start justify-between gap-4 group ${paid ? 'bg-green-50/40' : ''}`}>
      <div className="flex items-start gap-3 flex-1">
        {/* Paid toggle */}
        <button
          onClick={togglePaid}
          title={paid ? 'Mark as not paid' : 'Mark this statement paid'}
          className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center transition-all shrink-0 ${paid ? 'bg-green-500 border-green-500 text-white' : 'border-border hover:border-green-500 bg-card'}`}
        >
          {paid && <Icon name="Check" size={12} />}
        </button>

        <div className="flex-1">
          <div className={`font-bold ${paid ? 'text-green-800' : 'text-foreground'}`}>{c.card_name}</div>
          {paid ? (
            <p className="text-sm mt-0.5 text-green-700">
              ✓ Paid — {money(bal)} cleared. Enter the next statement when it arrives.
            </p>
          ) : due ? (
            <p className={`text-sm mt-0.5 ${dueColor}`}>
              Pay <span className="font-bold">{money(bal)}</span> by <span className="font-bold">{format(due, 'MMM d')}</span>
              {dLeft !== null && <span> ({dLeft === 0 ? 'today' : dLeft === 1 ? 'tomorrow' : `in ${dLeft} days`})</span>} to avoid financing.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">Set a due day to activate the guard.</p>
          )}
          {!paid && min > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">Minimum <span className="font-semibold">{money(min)}</span> avoids a late fee (the rest still accrues interest).</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Edit</button>
        <button onClick={onDelete} className="text-xs font-semibold text-red-500 hover:text-red-600">Remove</button>
      </div>
    </div>
  );
}
