import React from 'react';
import { useNavigate } from 'react-router-dom';
import useAccounts from '../../hooks/useAccounts';
import {
  eligibleCashByCurrency,
  isEligibleCashType,
  hasKnownBalance,
  accountTypeLabel,
} from '../../lib/accountOptions';

// Flow "Cash accounts" section: shows each active eligible cash account (its own
// row/id) with its balance, and a per-currency total the user can EXPLICITLY
// apply to "Available cash now". It never changes available cash automatically,
// never sums different currencies, and never treats a null balance as $0.

const money = (n, cur = 'USD') => {
  const s = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === 'USD' ? `$${s}` : `${cur} ${s}`;
};

export default function CashAccountsPanel({ onApply }) {
  const { accounts, loading } = useAccounts();
  const navigate = useNavigate();

  if (loading) return null;

  const eligible = (accounts || []).filter(
    (a) => a.is_active !== false && isEligibleCashType(a.account_type)
  );

  if (eligible.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-bold text-foreground">Cash accounts</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add your checking, savings, and cash accounts to track balances here.{' '}
          <button onClick={() => navigate('/accounts')} className="text-primary font-semibold hover:opacity-80">
            Manage accounts
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
        <p className="text-sm font-bold text-foreground">Cash accounts</p>
        <button onClick={() => navigate('/accounts')} className="text-xs font-semibold text-primary hover:opacity-80">
          Manage / edit balances
        </button>
      </div>

      <div className="divide-y divide-border">
        {eligible.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{a.account_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {accountTypeLabel(a.account_type)} · {a.currency || 'USD'}
              </p>
            </div>
            <div className="text-right shrink-0">
              {hasKnownBalance(a) ? (
                <span className="text-sm font-bold text-foreground">{money(a.current_balance, a.currency)}</span>
              ) : (
                <span className="text-xs italic text-muted-foreground">Balance not set</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3 space-y-3">
        {currencies.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Set an account balance (here or via Scan balances) to compute your total available cash.
          </p>
        ) : (
          currencies.map((cur) => (
            <div key={cur} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Total across {cur} cash accounts
                </p>
                <p className="text-xl font-extrabold text-foreground">{money(totals[cur], cur)}</p>
              </div>
              <button
                onClick={() => onApply?.(totals[cur], cur)}
                className="px-4 py-2.5 min-h-[44px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90"
              >
                Use {money(totals[cur], cur)} as available cash
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        Available cash only changes when you tap &ldquo;Use&hellip; as available cash.&rdquo; Investment, credit-card,
        and loan balances are excluded, and different currencies are never combined.
      </p>
    </div>
  );
}
