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
    deactivateAccount,
    reactivateAccount,
    deleteAccount,
    refetch: load,
  };
};

export default useAccounts;
