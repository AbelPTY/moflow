import React, { useMemo, useState } from 'react';
import useAccounts from '../hooks/useAccounts';
import useLegacyAccountNames from '../hooks/useLegacyAccountNames';
import { mergeAccountOptions, ACCOUNT_TYPES } from '../lib/accountOptions';
import { useI18n } from '../i18n';

// Reusable "Import into account" control. Shows the user's active first-class
// accounts + legacy transaction-derived names + an explicit Cash/Manual
// fallback, plus an inline "+ Add new account" path that creates the account
// (free-form name, type, institution, currency) via useAccounts.addAccount and
// selects it. Accounts are NEVER created silently -- only on the explicit
// "Create & use account" click. Identity is the account name/id, never type.
//
// Props:
//   value                : currently selected account name
//   onChange(name)       : called with the selected/created account name
//   includeCashManual    : show the Cash/Manual fallback (default true)
//   allowLegacy          : include legacy transaction-derived names (default true)

const CURRENCIES = ['USD', 'PAB', 'EUR', 'GBP', 'CAD', 'MXN'];
const BLANK = { account_name: '', account_type: 'checking', institution_name: '', currency: 'USD' };

export default function AccountSelect({ value, onChange, includeCashManual = true, allowLegacy = true }) {
  const { t } = useI18n();
  const { accounts, addAccount } = useAccounts();
  const legacyNames = useLegacyAccountNames();

  const options = useMemo(
    () => mergeAccountOptions(accounts, allowLegacy ? legacyNames : []).map((o) => o.name),
    [accounts, legacyNames, allowLegacy]
  );

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const change = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSelect = (v) => {
    if (v === '__new__') { setErr(''); setForm(BLANK); setCreating(true); return; }
    onChange(v);
  };

  const create = async () => {
    if (!form.account_name.trim()) { setErr('Account name is required.'); return; }
    setBusy(true);
    setErr('');
    try {
      const acc = await addAccount(form); // explicit user action; not silent
      const name = acc?.account_name || form.account_name.trim();
      onChange(name);
      setCreating(false);
      setForm(BLANK);
    } catch (e) {
      const msg = String(e?.message || e);
      setErr(/duplicate|unique/i.test(msg) ? 'You already have an account with that name.' : 'Could not create account: ' + msg);
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full border border-border rounded-md p-2.5 text-sm bg-background text-foreground outline-none focus:ring-2 focus:ring-primary';

  if (creating) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.accountName')}</label>
            <input className={inputCls} value={form.account_name} onChange={(e) => change('account_name', e.target.value)} placeholder={t('accounts.createNamePlaceholder')} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('accounts.typeLabel')}</label>
            <select className={inputCls} value={form.account_type} onChange={(e) => change('account_type', e.target.value)}>
              {ACCOUNT_TYPES.map((opt) => <option key={opt.value} value={opt.value}>{t(`accountTypes.${opt.value}`)}</option>)}
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
        </div>
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={() => setCreating(false)} className="px-3 py-2.5 min-h-[44px] rounded-md text-sm font-medium text-muted-foreground hover:bg-muted">{t('common.cancel')}</button>
          <button type="button" onClick={create} disabled={busy} className="px-4 py-2.5 min-h-[44px] rounded-md bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
            {busy ? t('accounts.creating') : t('accounts.createAndUse')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      value={value || ''}
      onChange={(e) => handleSelect(e.target.value)}
      className={inputCls}
    >
      <option value="">{t('accounts.selectAccount')}</option>
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
      {includeCashManual && <option value="Cash/Manual">Cash/Manual</option>}
      <option value="__new__">{t('accounts.addNewAccount')}</option>
    </select>
  );
}
