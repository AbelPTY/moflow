import React, { useState } from 'react';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import Icon from '../../components/AppIcon';
import useAccounts from '../../hooks/useAccounts';
import { ACCOUNT_TYPES, accountTypeLabel } from '../../lib/accountOptions';

// Accounts management (More -> Accounts). Free-form account names; multiple
// accounts of the same type are allowed. Each account is its own row (id), so
// creating a second savings/checking account never overwrites the first.

const CURRENCIES = ['USD', 'PAB', 'EUR', 'GBP', 'CAD', 'MXN'];

const BLANK = {
  account_name: '',
  account_type: 'checking',
  institution_name: '',
  currency: 'USD',
};

const AccountsManager = () => {
  const { accounts, loading, addAccount, updateAccount, deactivateAccount, reactivateAccount, deleteAccount } = useAccounts();
  const [form, setForm] = useState(null); // null closed; object add/edit
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const openAdd = () => { setErr(''); setForm({ ...BLANK }); };
  const openEdit = (a) => {
    setErr('');
    setForm({
      id: a.id,
      account_name: a.account_name ?? '',
      account_type: a.account_type ?? 'checking',
      institution_name: a.institution_name ?? '',
      currency: a.currency ?? 'USD',
    });
  };
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.account_name.trim()) { setErr('Account name is required.'); return; }
    setBusy(true);
    setErr('');
    try {
      if (form.id) await updateAccount(form.id, form);
      else await addAccount(form);
      setForm(null);
    } catch (e) {
      // Unique-name violation or missing table surfaces here.
      const msg = String(e?.message || e);
      setErr(/duplicate|unique/i.test(msg) ? 'You already have an account with that name.' : 'Failed to save account: ' + msg);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (a) => {
    try { await deactivateAccount(a.id); } catch (e) { alert('Failed to deactivate: ' + (e?.message || e)); }
  };
  const reactivate = async (a) => {
    try { await reactivateAccount(a.id); } catch (e) { alert('Failed to reactivate: ' + (e?.message || e)); }
  };
  const remove = async (a) => {
    if (!window.confirm(`Permanently delete "${a.account_name}"? Your transaction history is NOT deleted — existing transactions keep their account name.`)) return;
    try { await deleteAccount(a.id); } catch (e) { alert('Failed to delete: ' + (e?.message || e)); }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2.5 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Accounts</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Name your own accounts. You can add as many checking, savings, or cash accounts as you like.
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="font-bold text-foreground">Your accounts</div>
            {!form && (
              <button onClick={openAdd} className="text-sm font-semibold text-primary hover:opacity-80">
                + Add account
              </button>
            )}
          </div>

          {form && (
            <div className="p-5 bg-primary/5 border-b border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Account name</label>
                  <input className={inputCls} value={form.account_name} onChange={(e) => change('account_name', e.target.value)} placeholder="e.g. Banco General Payroll, Vacation Savings" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Account type</label>
                  <select className={inputCls} value={form.account_type} onChange={(e) => change('account_type', e.target.value)}>
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Currency</label>
                  <select className={inputCls} value={form.currency} onChange={(e) => change('currency', e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Institution (optional)</label>
                  <input className={inputCls} value={form.institution_name} onChange={(e) => change('institution_name', e.target.value)} placeholder="e.g. Banco General, UNFCU" />
                </div>
              </div>
              {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setForm(null)} className="px-4 py-3 min-h-[44px] text-muted-foreground hover:bg-muted rounded-md text-sm font-medium">Cancel</button>
                <button onClick={save} disabled={busy} className="px-4 py-3 min-h-[44px] bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save account'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="p-6 text-muted-foreground text-sm">Loading accounts…</div>
          ) : accounts.length === 0 && !form ? (
            <div className="p-8 text-center">
              <div className="mx-auto bg-primary/10 p-3 rounded-xl w-fit mb-3">
                <Icon name="Wallet" size={26} className="text-primary" />
              </div>
              <p className="font-bold text-foreground">No accounts yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Add your checking, savings, and cash accounts so imports and Flow can tell them apart.
              </p>
              <button onClick={openAdd} className="inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
                <Icon name="Plus" size={18} /> Add account
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {accounts.map((a) => {
                const active = a.is_active !== false;
                return (
                <div key={a.id} className={`px-5 py-4 flex items-center justify-between gap-4 ${active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0">
                    <div className="font-bold text-foreground truncate">
                      {a.account_name}
                      <span className="ml-2 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {accountTypeLabel(a.account_type)}
                      </span>
                      {!active && (
                        <span className="ml-2 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {a.institution_name ? `${a.institution_name} · ` : ''}{a.currency || 'USD'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => openEdit(a)} className="text-xs font-semibold text-primary hover:opacity-80">Edit</button>
                    {active ? (
                      <button onClick={() => deactivate(a)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Deactivate</button>
                    ) : (
                      <>
                        <button onClick={() => reactivate(a)} className="text-xs font-semibold text-primary hover:opacity-80">Reactivate</button>
                        <button onClick={() => remove(a)} className="text-xs font-semibold text-destructive hover:text-destructive/80">Delete</button>
                      </>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground mt-3">
          Deleting an account here does not delete transactions — existing transactions keep their account name.
        </p>
      </div>
    </div>
  );
};

export default AccountsManager;
