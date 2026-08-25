import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// Loads/saves per-card statement data (credit_cards table) for the financing
// guard, and tracks financing fees avoided: each time a statement is marked
// paid (in full), we log an estimate of the interest you would have paid had
// you carried that balance, and surface the running total. RLS scopes all rows
// to the logged-in user.


const useCreditCards = () => {
  const [cards, setCards] = useState([]);
  const [feeSavings, setFeeSavings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadFeeSavings = useCallback(async () => {
    const { data } = await supabase.from('fee_savings').select('*');
    setFeeSavings(data || []);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('credit_cards')
        .select('*')
        .order('card_name', { ascending: true });
      if (fetchError) throw fetchError;
      setCards(data || []);
      await loadFeeSavings();
    } catch (err) {
      console.error('Error loading credit cards:', err);
      setError(err);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [loadFeeSavings]);

  useEffect(() => { load(); }, [load]);

  const saveCard = async (card) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) throw new Error('Must be logged in to save a card.');

    const payload = {
      user_id: userData.user.id,
      card_name: String(card.card_name).trim(),
      statement_close_day: card.statement_close_day ? Number(card.statement_close_day) : null,
      due_day: card.due_day ? Number(card.due_day) : null,
      statement_balance: Number(card.statement_balance) || 0,
      current_balance: Number(card.current_balance) || 0,
      apr: Number(card.apr) || null,
      minimum_payment: Number(card.minimum_payment) || 0,
      statement_paid: !!card.statement_paid,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from('credit_cards')
      .upsert(payload, { onConflict: 'user_id,card_name' });
    if (upsertError) throw upsertError;
    await load();
  };

  // Toggle the paid flag. On paid, log the estimated interest avoided; on
  // un-paid (a correction), remove the most recent logged entry for that card
  // so the total stays honest and re-toggling never double-counts.
  const setPaid = async (id, paid) => {
    const card = cards.find((c) => c.id === id) || {};

    const { error: updateError } = await supabase
      .from('credit_cards')
      .update({ statement_paid: paid, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw updateError;
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, statement_paid: paid } : c)));

    // Fee-savings ledger is best-effort -- never block the paid toggle on it.
    try {
      if (paid) {
        const bal = Number(card.statement_balance) || 0;
        // Use the card's real APR when present; 24% is the documented fallback.
        const monthlyRate = (Number(card.apr) || 24) / 100 / 12;
        const interest = Math.round(bal * monthlyRate * 100) / 100;
        await supabase.from('fee_savings').insert({
          card_name: card.card_name || null,
          statement_balance: bal,
          interest_saved: interest,
        });
      } else if (card.card_name) {
        const { data: latest } = await supabase
          .from('fee_savings')
          .select('id')
          .eq('card_name', card.card_name)
          .order('created_at', { ascending: false })
          .limit(1);
        if (latest && latest[0]) {
          await supabase.from('fee_savings').delete().eq('id', latest[0].id);
        }
      }
      await loadFeeSavings();
    } catch (e) {
      console.error('fee_savings update failed (non-fatal):', e);
    }
  };

  const deleteCard = async (id) => {
    const { error: deleteError } = await supabase.from('credit_cards').delete().eq('id', id);
    if (deleteError) throw deleteError;
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const feeSavingsTotals = useMemo(() => {
    const all = feeSavings.reduce((s, r) => s + Number(r.interest_saved || 0), 0);
    const yearStr = String(new Date().getUTCFullYear());
    const thisYear = feeSavings
      .filter((r) => String(r.saved_on || r.created_at || '').startsWith(yearStr))
      .reduce((s, r) => s + Number(r.interest_saved || 0), 0);
    return { all, thisYear, count: feeSavings.length };
  }, [feeSavings]);

  return { cards, loading, error, saveCard, deleteCard, setPaid, feeSavings, feeSavingsTotals, refetch: load };
};

export default useCreditCards;
