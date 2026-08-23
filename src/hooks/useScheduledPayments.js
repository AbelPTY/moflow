import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const useScheduledPayments = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);

  const fetchPayments = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('scheduled_payments')
        .select('*')
        .order('payment_date', { ascending: true });

      if (fetchError) throw fetchError;

      // Transform data if needed
      const processedData = data.map(p => ({
        ...p,
        dateString: p.payment_date // Ensure we have a string date 'YYYY-MM-DD'
      }));

      if (!abortControllerRef.current.signal.aborted) {
        setPayments(processedData);
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error fetching scheduled payments:', err);
      setError(err);
    } finally {
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchPayments();
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [fetchPayments]);

  const addPayment = async (newPayment) => {
    // Get the current user ID
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) {
      throw new Error('Must be logged in to add a payment.');
    }

    const payload = { ...newPayment, user_id: userData.user.id };

    const { data, error } = await supabase
      .from('scheduled_payments')
      .insert([payload])
      .select();

    if (error) {
      console.error('Error adding payment:', error);
      throw error;
    }

    if (data && data[0]) {
      setPayments(prev => [...prev, { ...data[0], dateString: data[0].payment_date }]);
    }
    return data;
  };

  // --- HONEST UPDATE ---
  const updatePayment = async (id, updates) => {
    // 1. Wait for Supabase to actually update the database first
    const { data, error } = await supabase
      .from('scheduled_payments')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Supabase Error:', error);
      alert('Failed to update in database! Check console.');
      throw error;
    }

    // If RLS blocked it, Supabase returns an empty array without throwing an error
    if (!data || data.length === 0) {
        alert('Blocked by Supabase! You need to add an UPDATE policy to the scheduled_payments table in your Supabase dashboard.');
        return;
    }

    // 2. Only update the screen if the database succeeded
    setPayments(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // --- HONEST DELETE ---
  const deletePayment = async (id) => {
    // 1. Wait for Supabase to actually delete the row first
    const { error } = await supabase
      .from('scheduled_payments')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Supabase Error:', error);
      alert('Failed to delete in database! Check console.');
      throw error;
    }

    // 2. Only remove from the screen if the database succeeded
    setPayments(prev => prev.filter(p => p.id !== id));
  };

  return { payments, loading, error, refetch: fetchPayments, addPayment, updatePayment, deletePayment };
};

export default useScheduledPayments;
