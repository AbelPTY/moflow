import React, { useState } from 'react';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import Icon from '../../components/AppIcon';
import useAccounts from '../../hooks/useAccounts';
import { ACCOUNT_TYPES, hasKnownBalance } from '../../lib/accountOptions';
import { useI18n } from '../../i18n';

// Accounts management (More -> Accounts). Free-form account names; multiple
// accounts of the same type are allowed. Each account is its own row (id), so
// creating a second savings/checking account never overwrites the first.

const CURRENCIES = ['USD', 'PAB', 'EUR', 'GBP', 'CAD', 'MXN'];

const BLANK = {
  account_name: '',
  account_type: 'checking',
  institution_name: '',
  currency: 'USD',
  current_balance: '',
  balance_as_of: '',
};

const AccountsManager = () => {
  const { accounts, loading, addAccount, updateAccount, updateAccountBalance, deactivateAccount, reactivateAccount, deleteAccount } = useAccounts();
  const { t, formatCurrency } = useI18n();
  // Locale-aware display of the canonical account_type (stored value unchanged).
  const typeLabel = (value) => t(`accountTypes.${value}`);
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
      current_balance: a.current_balance ?? '',
      balance_as_of: a.balance_as_of ?? '',
    });
  };
  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.account_name.trim()) { setErr(t('accounts.nameRequired')); return; }
    setBusy(true);
    setErr('');
    try {
      // Identity/details first, then the balance (persisted by account id).
      let id = form.id;
      if (id) await updateAccount(id, form);
      else { const created = await addAccount(form); id = created?.id; }
      if (id) await updateAccountBalance(id, { current_balance: form.current_balance, balance_as_of: form.balance_as_of });
      setForm(null);
    } catch (e) {
      // Unique-name violation or missing table surfaces here.
      const msg = String(e?.message || e);
      setErr(/duplicate|unique/i.test(msg) ? t('accounts.duplicateName') : t('accounts.saveFailed', { msg }));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (a) => {
    try { await deactivateAccount(a.id); } catch (e) { alert(t('accounts.deactivateFailed', { msg: e?.message || e })); }
  };
  const reactivate = async (a) => {
    try { await reactivateAccount(a.id); } catch (e) { alert(t('accounts.reactivateFailed', { msg: e?.message || e })); }
  };
  const remove = async (a) => {
    if (!window.confirm(t('accounts.deleteConfirm', { name: a.account_name }))) return;
    try { await deleteAccount(a.id); } catch (e) { alert(t('accounts.deleteFailed', { msg: e?.message || e })); }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2.5 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">{t('accounts.title')}</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            {t('accounts.subtitle')}
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="font-bold text-foreground">{t('accounts.yourAccounts')}</div>
            {!form && (
              <button onClick={openAdd} className="text-sm font-semibold text-primary hover:opacity-80">
                {t('accounts.addNewAccount')}
              </button>
            )}
          </div>

          {form && (
            <div className="p-5 bg-primary/5 border-b border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.accountName')}</label>
                  <input className={inputCls} value={form.account_name} onChange={(e) => change('account_name', e.target.value)} placeholder={t('accounts.namePlaceholder')} autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.accountType')}</label>
                  <select className={inputCls} value={form.account_type} onChange={(e) => change('account_type', e.target.value)}>
                    {ACCOUNT_TYPES.map((opt) => <option key={opt.value} value={opt.value}>{typeLabel(opt.value)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.currency')}</label>
                  <select className={inputCls} value={form.currency} onChange={(e) => change('currency', e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.institutionOptional')}</label>
                  <input className={inputCls} value={form.institution_name} onChange={(e) => change('institution_name', e.target.value)} placeholder={t('accounts.institutionPlaceholder')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.currentBalanceOptional')}</label>
                  <input type="number" inputMode="decimal" step="0.01" className={inputCls} value={form.current_balance} onChange={(e) => change('current_balance', e.target.value)} placeholder={t('accounts.balanceBlankHint')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.balanceAsOfOptional')}</label>
                  <input type="date" className={inputCls} value={form.balance_as_of} onChange={(e) => change('balance_as_of', e.target.value)} />
                </div>
              </div>
              {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setForm(null)} className="px-4 py-3 min-h-[44px] text-muted-foreground hover:bg-muted rounded-md text-sm font-medium">{t('common.cancel')}</button>
                <button onClick={save} disabled={busy} className="px-4 py-3 min-h-[44px] bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                  {busy ? t('accounts.saving') : t('accounts.saveAccount')}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="p-6 text-muted-foreground text-sm">{t('accounts.loadingAccounts')}</div>
          ) : accounts.length === 0 && !form ? (
            <div className="p-8 text-center">
              <div className="mx-auto bg-primary/10 p-3 rounded-xl w-fit mb-3">
                <Icon name="Wallet" size={26} className="text-primary" />
              </div>
              <p className="font-bold text-foreground">{t('accounts.noAccountsTitle')}</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {t('accounts.noAccountsBody')}
              </p>
              <button onClick={openAdd} className="inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
                <Icon name="Plus" size={18} /> {t('accounts.addAccount')}
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
                        {typeLabel(a.account_type)}
                      </span>
                      {!active && (
                        <span className="ml-2 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {t('accounts.inactive')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {a.institution_name ? `${a.institution_name} · ` : ''}{a.currency || 'USD'}
                    </div>
                    <div className="text-sm mt-1">
                      {hasKnownBalance(a) ? (
                        <span className="font-bold text-foreground">{formatCurrency(a.current_balance, a.currency || 'USD')}</span>
                      ) : (
                        <span className="text-muted-foreground italic">{t('accounts.balanceNotSet')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => openEdit(a)} className="text-xs font-semibold text-primary hover:opacity-80">{t('common.edit')}</button>
                    {active ? (
                      <button onClick={() => deactivate(a)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">{t('accounts.deactivate')}</button>
                    ) : (
                      <>
                        <button onClick={() => reactivate(a)} className="text-xs font-semibold text-primary hover:opacity-80">{t('accounts.reactivate')}</button>
                        <button onClick={() => remove(a)} className="text-xs font-semibold text-destructive hover:text-destructive/80">{t('common.delete')}</button>
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
          {t('accounts.deleteFootnote')}
        </p>
      </div>
    </div>
  );
};

export default AccountsManager;
