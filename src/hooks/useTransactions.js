import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { processTransactionRow } from '../lib/engine/normalize';
import { fetchActiveUserRules } from '../lib/engine/userRules';

const useTransactions = (userId = null, options = {}) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);

  const { filters = {} } = options;
  const filterString = JSON.stringify(filters);

  const fetchTransactions = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setLoading(true);
      setError(null);

      let allLoadedData = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000;

      while (hasMore) {
        if (abortControllerRef.current.signal.aborted) return;

        const { data, fetchError } = await supabase
          .from('transactions')
          .select('*')
          .order('date', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (fetchError) throw fetchError;

        if (data && data.length > 0) {
          allLoadedData = [...allLoadedData, ...data];
          if (data.length < pageSize) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }

      // Load the user's active rules ONCE per fetch (a single tiny query for the
      // whole rule set, then reused for every row -- not per-row/N+1). Failure
      // returns [] so the engine falls back to static behavior.
      const userRules = await fetchActiveUserRules(supabase);

      // Route all raw data through the v2 Engine (USER rules injected; empty ->
      // identical to prior static-only behavior).
      const processedData = allLoadedData.map(t => processTransactionRow(t, { userRules }));

      let finalData = processedData;
      if (filters.dateRange === 'custom' && filters.startDate && filters.endDate) {
        finalData = processedData.filter(tx => tx.dateString >= filters.startDate && tx.dateString <= filters.endDate);
      }

      if (!abortControllerRef.current.signal.aborted) {
        setTransactions(finalData);
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Sync error:', err);
      if (!transactions.length) setTransactions([]);
      setError(err);
    } finally {
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        setLoading(false);
      }
    }
  }, [filterString]);

  useEffect(() => {
    fetchTransactions();
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [fetchTransactions]);

  const updateTransaction = async (id, updates) => {
      setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
      const { error } = await supabase.from('transactions').update(updates).eq('id', id);
  };

  const deleteTransaction = async (id) => {
      // Keep a copy in case the delete fails, so we can restore the row
      const previousTransactions = transactions;
      setTransactions(prev => prev.filter(t => t.id !== id));

      const { error } = await supabase.from('transactions').delete().eq('id', id);

      if (error) {
        // Roll back the optimistic removal if the database delete failed
        setTransactions(previousTransactions);
        throw error;
      }
  };

  return { transactions, loading, error, refetch: fetchTransactions, updateTransaction, deleteTransaction };
};

export default useTransactions;
