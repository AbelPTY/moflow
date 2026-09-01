import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ACCOUNT_TYPES } from '../lib/accountOptions';

// First-class per-user accounts (public.accounts). Mirrors useCreditCards /
// useLoans. Identity is the row id: adds are INSERTs (never upserts keyed on
// type/name), so creating a second savings/checking account can never overwrite
// an existing one. RLS scopes every row to the owner.

const VALID_TYPES = ACCOUNT_TYPES.map((t) => t.value);

const toPayload = (a) => ({
  account_name: String(a.account_name || '').trim(),
  account_type: VALID_TYPES.includes(a.account_type) ? a.account_type : 'other',
  institution_name: a.institution_name ? String(a.institution_name).trim() : null,
  currency: (a.currency ? String(a.currency).trim().toUpperCase() : 'USD') || 'USD',
});

const useAccounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('accounts')
        .select('*')
        .order('created_at', { ascending: true });
      if (fetchError) throw fetchError;
      setAccounts(data || []);
    } catch (err) {
      // The accounts table may not exist yet on older deployments; fail soft so
      // the rest of the app keeps working with legacy transaction-derived names.
      console.error('Error loading accounts:', err);
      setError(err);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addAccount = async (account) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) throw new Error('Must be logged in to add an account.');

    const payload = {
      ...toPayload(account),
      user_id: userData.user.id,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { data, error: insertError } = await supabase
      .from('accounts')
      .insert(payload)   // INSERT, not upsert -> never overwrites another row
      .select();
    if (insertError) throw insertError;
    await load();
    return data?.[0];
  };

  const updateAccount = async (id, updates) => {
    const existing = accounts.find((a) => a.id === id);
    const oldName = existing?.account_name || '';

    const payload = { ...toPayload(updates), updated_at: new Date().toISOString() };
    const newName = payload.account_name;

    const { error: updateError } = await supabase
      .from('accounts')
      .update(payload)
      .eq('id', id);   // scoped to the specific row id
    if (updateError) throw updateError;

    // Rename propagation: ONLY when the account NAME actually changed, update
    // this user's existing transactions that use the OLD EXACT name so their
    // history follows the account. RLS scopes these updates to the owner's rows.
    // Type / institution / currency changes never touch transactions.
    if (oldName && newName && oldName !== newName) {
      try {
        await supabase.from('transactions').update({ account_name: newName }).eq('account_name', oldName);
        await supabase.from('transactions').update({ source_account: newName }).eq('source_account', oldName);
      } catch (e) {
        // Non-fatal: the account is renamed; a failed propagation can be retried
        // by renaming again (idempotent exact-match update).
        console.error('Account rename propagation failed (non-fatal):', e);
      }
    }

    await load();
  };

  // Deactivate hides the account from active selectors but NEVER touches
  // transactions -- history is preserved and its old name still resolves via
  // the legacy transaction-derived path.
  const deactivateAccount = async (id) => {
    const { error: e } = await supabase
      .from('accounts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (e) throw e;
    await load();
  };

  const reactivateAccount = async (id) => {
    const { error: e } = await supabase
      .from('accounts')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (e) throw e;
    await load();
  };

  // Normalize a balance input: '' / null / undefined -> null ("not set"),
  // never 0. Otherwise a finite number (or null if unparseable).
  const normBalance = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Update ONE account's balance, strictly by row id. Never keyed by type or
  // name, so a savings balance can never overwrite another savings account.
  const updateAccountBalance = async (id, { current_balance, balance_as_of } = {}) => {
    if (!id) throw new Error('updateAccountBalance requires an account id.');
    const payload = {
      current_balance: normBalance(current_balance),
      balance_as_of: balance_as_of || null,
      balance_updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('accounts').update(payload).eq('id', id);
    if (error) throw error;
    await load();
  };

  // Batch balance update. Each write targets its OWN account id; a failure on
  // one (Promise.allSettled) never affects another. Returns per-update results.
  const updateAccountBalances = async (updates = []) => {
    const now = new Date().toISOString();
    const results = await Promise.allSettled(
      (updates || [])
        .filter((u) => u && u.id)
        .map((u) =>
          supabase
            .from('accounts')
            .update({
              current_balance: normBalance(u.current_balance),
              balance_as_of: u.balance_as_of || null,
              balance_updated_at: now,
            })
            .eq('id', u.id)
            .then((res) => {
              if (res.error) throw res.error;
              return res;
            })
        )
    );
    await load();
    return results;
  };

  const deleteAccount = async (id) => {
    const { error: deleteError } = await supabase.from('accounts').delete().eq('id', id);
    if (deleteError) throw deleteError;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const saveAccount = async (account) =>
    account?.id ? updateAccount(account.id, account) : addAccount(account);

  return {
    accounts,
    loading,
    error,
    addAccount,
    updateAccount,
    saveAccount,
    updateAccountBalance,
    updateAccountBalances,
    deactivateAccount,
    reactivateAccount,
    deleteAccount,
    refetch: load,
  };
};

export default useAccounts;
