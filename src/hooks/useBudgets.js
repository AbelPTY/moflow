import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Budgets used to live only in browser localStorage. They now persist to the
// Supabase `budgets` table (one row per user+category). This hook loads them
// into the same { [category]: { limit, active } } shape the budget page uses,
// migrates any legacy localStorage budgets into Supabase once, and reconciles
// the full set on save (upsert current categories, delete removed ones).

const MIGRATED_FLAG = 'budgets_migrated_to_supabase';

// Old budget category names -> real transaction categories. Two old keys can
// merge into one (Housing + Utilities -> Household/Utilities), handled by
// summing limits in migrateBudgetKeys below.
const CATEGORY_MIGRATION_MAP = {
  'Housing': 'Household/Utilities',
  'Utilities': 'Household/Utilities',
  'Food & Groceries': 'Groceries',
  'Car Maintenance': 'Transportation',
  'Car Insurance': 'Insurance',
  'Medical': 'Medical/Health',
  'Debt Service': 'Loan Payment',
  'Mandatory Capital': 'Savings',
  'Membership Fees': 'Subscriptions',
  'Dining': 'Dining Out',
};

function migrateBudgetKeys(budgets) {
  const result = {};
  Object.keys(budgets).forEach((oldKey) => {
    const newKey = CATEGORY_MIGRATION_MAP[oldKey] || oldKey;
    const entry = budgets[oldKey] || {};
    const limit = Number(entry.limit) || 0;
    const active = entry.active !== false;
    if (result[newKey]) {
      result[newKey] = {
        limit: (Number(result[newKey].limit) || 0) + limit,
        active: result[newKey].active || active,
      };
    } else {
      result[newKey] = { limit, active };
    }
  });
  return result;
}

// Read whatever budgets are saved in localStorage (any legacy version),
// normalized to { [category]: { limit, active } } with real category names.
function readLocalBudgets() {
  try {
    const v3 = localStorage.getItem('user_budgets_v3');
    if (v3) return JSON.parse(v3);

    const v2 = localStorage.getItem('user_budgets_v2');
    if (v2) return migrateBudgetKeys(JSON.parse(v2));

    const v1 = localStorage.getItem('user_budgets');
    if (v1) {
      const old = JSON.parse(v1);
      const asV2 = {};
      Object.keys(old).forEach((k) => { asV2[k] = { limit: old[k], active: true }; });
      return migrateBudgetKeys(asV2);
    }
  } catch (e) {
    console.error('readLocalBudgets error', e);
  }
  return null;
}

function rowsToObject(rows) {
  const obj = {};
  (rows || []).forEach((r) => {
    obj[r.category] = { limit: Number(r.limit_amount) || 0, active: r.active !== false };
  });
  return obj;
}

const useBudgets = () => {
  const [budgets, setBudgetsState] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const getUserId = async () => {
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data?.user?.id) {
      throw new Error('Must be logged in to manage budgets.');
    }
    return data.user.id;
  };

  // Reconcile the full budget object against the DB: upsert every current
  // category, then delete any rows for categories that were removed.
  const persist = useCallback(async (budgetObj) => {
    const userId = await getUserId();
    const entries = Object.entries(budgetObj || {});
    const keep = entries.map(([category]) => category);

    if (entries.length > 0) {
      const payload = entries.map(([category, v]) => ({
        user_id: userId,
        category,
        limit_amount: Number(v.limit) || 0,
        active: v.active !== false,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from('budgets')
        .upsert(payload, { onConflict: 'user_id,category' });
      if (upsertError) throw upsertError;
    }

    // Delete rows for categories no longer present in the saved set.
    const { data: existing, error: existingError } = await supabase
      .from('budgets')
      .select('category')
      .eq('user_id', userId);
    if (existingError) throw existingError;

    const toDelete = (existing || [])
      .map((r) => r.category)
      .filter((c) => !keep.includes(c));

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('budgets')
        .delete()
        .eq('user_id', userId)
        .in('category', toDelete);
      if (deleteError) throw deleteError;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('budgets')
        .select('*');
      if (fetchError) throw fetchError;

      if (data && data.length > 0) {
        setBudgetsState(rowsToObject(data));
        return;
      }

      // No rows yet: one-time migration of legacy localStorage budgets so the
      // user's existing saved limits carry over to the database.
      if (!localStorage.getItem(MIGRATED_FLAG)) {
        const local = readLocalBudgets();
        if (local && Object.keys(local).length > 0) {
          await persist(local);
          localStorage.setItem(MIGRATED_FLAG, '1');
          setBudgetsState(local);
          return;
        }
        localStorage.setItem(MIGRATED_FLAG, '1');
      }

      // Brand-new user with nothing saved; the page falls back to its defaults.
      setBudgetsState({});
    } catch (err) {
      console.error('Error loading budgets:', err);
      setError(err);
      setBudgetsState({});
    } finally {
      setLoading(false);
    }
  }, [persist]);

  useEffect(() => { load(); }, [load]);

  // DB-first save (mirrors the "honest update" pattern in useScheduledPayments):
  // only update local state once the database write has succeeded.
  const saveBudgets = async (budgetObj) => {
    try {
      await persist(budgetObj);
      setBudgetsState(budgetObj);
    } catch (err) {
      console.error('Error saving budgets:', err);
      alert('Failed to save budgets to the database. Check the console for details.');
      throw err;
    }
  };

  return { budgets, loading, error, saveBudgets, refetch: load };
};

export default useBudgets;
