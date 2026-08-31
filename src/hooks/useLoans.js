import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Loads/saves per-user loans (public.loans). Mirrors useCreditCards: owner
// scoping is enforced by RLS; every write carries the authenticated user's
// user_id. No server API endpoint is involved.

const LOAN_TYPES = ['mortgage', 'auto', 'personal', 'student', 'other'];

const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Coerce a form loan into a clean DB payload (never includes user_id here).
const toPayload = (loan) => ({
  loan_name: String(loan.loan_name || '').trim(),
  loan_type: LOAN_TYPES.includes(loan.loan_type) ? loan.loan_type : 'other',
  remaining_principal: Number(loan.remaining_principal) || 0,
  apr: Number(loan.apr) || 0,
  monthly_payment: Number(loan.monthly_payment) || 0,
  next_payment_date: loan.next_payment_date || null,
  remaining_months: loan.remaining_months ? Math.trunc(numOrNull(loan.remaining_months) || 0) || null : null,
  maturity_date: loan.maturity_date || null,
});

const useLoans = () => {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('loans')
        .select('*')
        .order('created_at', { ascending: true });
      if (fetchError) throw fetchError;
      setLoans(data || []);
    } catch (err) {
      console.error('Error loading loans:', err);
      setError(err);
      setLoans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addLoan = async (loan) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) throw new Error('Must be logged in to save a loan.');

    const payload = {
      ...toPayload(loan),
      user_id: userData.user.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error: insertError } = await supabase
      .from('loans')
      .insert(payload)
      .select();
    if (insertError) throw insertError;
    await load();
    return data?.[0];
  };

  const updateLoan = async (id, updates) => {
    const payload = { ...toPayload(updates), updated_at: new Date().toISOString() };
    const { error: updateError } = await supabase
      .from('loans')
      .update(payload)
      .eq('id', id);
    if (updateError) throw updateError;
    await load();
  };

  // Convenience: dispatch to add or update based on whether an id is present.
  const saveLoan = async (loan) => {
    if (loan?.id) return updateLoan(loan.id, loan);
    return addLoan(loan);
  };

  const deleteLoan = async (id) => {
    const { error: deleteError } = await supabase.from('loans').delete().eq('id', id);
    if (deleteError) throw deleteError;
    setLoans((prev) => prev.filter((l) => l.id !== id));
  };

  return { loans, loading, error, addLoan, updateLoan, saveLoan, deleteLoan, refetch: load };
};

export default useLoans;
