import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import Icon from '../../components/AppIcon';

// Compact management of one-time dated extra-income events (V2.6). The parent
// owns the persisted array and the CRUD callbacks; this component is purely the
// collapsed/add/edit UI plus the list. It never touches recurring income.

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const LABEL_SUGGESTIONS = [
  'Bonus',
  'Freelance',
  'Reimbursement',
  'Sale',
  'Extra shift',
  'Other',
];

const todayStr = () => format(new Date(), 'yyyy-MM-dd');

const BLANK = { label: '', amount: '', date: '' };

const ExtraIncomePanel = ({ items, onAdd, onUpdate, onDelete }) => {
  const [form, setForm] = useState(null); // null = collapsed; {} = adding/editing
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const openAdd = () => {
    setEditingId(null);
    setError('');
    setForm({ ...BLANK, date: todayStr() });
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setError('');
    setForm({
      label: item.label || '',
      amount: String(item.amount ?? ''),
      date: item.date || todayStr(),
    });
  };

  const close = () => {
    setForm(null);
    setEditingId(null);
    setError('');
  };

  const save = () => {
    const amount = parseFloat(form.amount);
    if (!(amount > 0)) {
      setError('Enter an amount greater than 0.');
      return;
    }
    const parsed = form.date ? parseISO(form.date) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      setError('Pick a valid date.');
      return;
    }

    const payload = {
      label: form.label.trim() || 'Extra income',
      amount: Math.round(amount * 100) / 100,
      date: form.date,
    };

    if (editingId) onUpdate(editingId, payload);
    else onAdd(payload);

    close();
  };

  // Sort chronologically; flag strictly-past entries so nothing is hidden but
  // they read as inactive for future projections.
  const sorted = useMemo(() => {
    const t = todayStr();
    return [...(items || [])]
      .filter((i) => i && i.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((i) => ({ ...i, isPast: i.date < t }));
  }, [items]);

  const inputCls =
    'w-full border border-border rounded-lg p-2.5 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="PlusCircle" size={16} className="text-emerald-600" />
          <span className="text-sm font-bold text-foreground">Extra income</span>
          {sorted.length > 0 && (
            <span className="text-xs text-muted-foreground">({sorted.length})</span>
          )}
        </div>
        {!form && (
          <button
            type="button"
            onClick={openAdd}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            + Add extra income
          </button>
        )}
      </div>

      {form && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_130px_160px] gap-2 items-end">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Label
            </label>
            <input
              list="extra-income-labels"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Bonus, Freelance…"
              className={inputCls}
            />
            <datalist id="extra-income-labels">
              {LABEL_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Amount
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className={`${inputCls} text-emerald-600 font-bold`}
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Date
            </label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className={inputCls}
            />
          </div>

          {error && (
            <p className="sm:col-span-3 text-[11px] text-red-600">{error}</p>
          )}

          <div className="sm:col-span-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="mt-3 divide-y divide-border">
          {sorted.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {item.label || 'Extra income'}
                  {item.isPast && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      past
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(item.date), 'MMM d, yyyy')}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-bold text-emerald-600">
                  +{money(item.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="text-xs font-semibold text-destructive hover:text-destructive/80"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExtraIncomePanel;
