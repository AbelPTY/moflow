import React from 'react';
import { useNavigate } from 'react-router-dom';
import useAccounts from '../../hooks/useAccounts';
import {
  eligibleCashByCurrency,
  isEligibleCashType,
  hasKnownBalance,
} from '../../lib/accountOptions';
import { useI18n } from '../../i18n';

// Flow "Cash accounts" section: shows each active eligible cash account (its own
// row/id) with its balance, and a per-currency total the user can EXPLICITLY
// apply to "Available cash now". It never changes available cash automatically,
// never sums different currencies, and never treats a null balance as $0.

export default function CashAccountsPanel({ onApply }) {
  const { accounts, loading } = useAccounts();
  const { t, formatCurrency } = useI18n();
  const money = (n, cur = 'USD') => formatCurrency(n, cur || 'USD');
  const navigate = useNavigate();

  if (loading) return null;

  const eligible = (accounts || []).filter(
    (a) => a.is_active !== false && isEligibleCashType(a.account_type)
  );

  if (eligible.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-bold text-foreground">{t('flow.cashAccounts')}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t('flow.addCashAccountsHint')}{' '}
          <button onClick={() => navigate('/accounts')} className="text-primary font-semibold hover:opacity-80">
            {t('flow.manageAccounts')}
          </button>
        </p>
      </div>
    );
  }

  const totals = eligibleCashByCurrency(accounts);
  const currencies = Object.keys(totals);

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-bold text-foreground">{t('flow.cashAccounts')}</p>
        <button onClick={() => navigate('/accounts')} className="text-xs font-semibold text-primary hover:opacity-80">
          {t('flow.manageEditBalances')}
        </button>
      </div>

      <div className="divide-y divide-border">
        {eligible.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{a.account_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {t(`accountTypes.${a.account_type}`)} · {a.currency || 'USD'}
              </p>
            </div>
            <div className="text-right shrink-0">
              {hasKnownBalance(a) ? (
                <span className="text-sm font-bold text-foreground">{money(a.current_balance, a.currency)}</span>
              ) : (
                <span className="text-xs italic text-muted-foreground">{t('flow.balanceNotSet')}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3 space-y-3">
        {currencies.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('flow.setBalanceHint')}
          </p>
        ) : (
          currencies.map((cur) => (
            <div key={cur} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t('flow.totalAcrossCurrency', { cur })}
                </p>
                <p className="text-xl font-extrabold text-foreground">{money(totals[cur], cur)}</p>
              </div>
              <button
                onClick={() => onApply?.(totals[cur], cur)}
                className="px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
              >
                {t('flow.useAsAvailable', { amount: money(totals[cur], cur) })}
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        {t('flow.availableCashNote')}
      </p>
    </div>
  );
}
