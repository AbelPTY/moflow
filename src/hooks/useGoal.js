import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// The savings goal used to be a hardcoded GOAL_TARGET constant. It now persists
// to the Supabase `goals` table (one row per user). This hook loads that row,
// falls back to sensible defaults when none exists yet, and upserts on save.

export const DEFAULT_GOAL = {
  name: '2026 Trip Fund & Reserves',
  milestoneLabel: 'Feb 2026 Trip',
  milestoneSublabel: 'Orlando / Punta Cana',
  targetAmount: 15000,
};

function rowToGoal(row) {
  return {
    name: row.name ?? DEFAULT_GOAL.name,
    milestoneLabel: row.milestone_label ?? DEFAULT_GOAL.milestoneLabel,
    milestoneSublabel: row.milestone_sublabel ?? DEFAULT_GOAL.milestoneSublabel,
    targetAmount: Number(row.target_amount) || DEFAULT_GOAL.targetAmount,
  };
}

const useGoal = () => {
  const [goal, setGoalState] = useState(DEFAULT_GOAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const getUserId = async () => {
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data?.user?.id) {
      throw new Error('Must be logged in to manage goals.');
    }
    return data.user.id;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // At most one row per user (user_id is unique), so maybeSingle is safe.
      const { data, error: fetchError } = await supabase
        .from('goals')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (fetchError) throw fetchError;

      setGoalState(data ? rowToGoal(data) : DEFAULT_GOAL);
    } catch (err) {
      console.error('Error loading goal:', err);
      setError(err);
      setGoalState(DEFAULT_GOAL);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // DB-first save (mirrors useScheduledPayments/useBudgets): only update local
  // state once the upsert has succeeded.
  const saveGoal = async (next) => {
    try {
      const userId = await getUserId();
      const normalized = {
        name: next.name,
        milestoneLabel: next.milestoneLabel,
        milestoneSublabel: next.milestoneSublabel,
        targetAmount: Number(next.targetAmount) || 0,
      };

      const { error: upsertError } = await supabase
        .from('goals')
        .upsert(
          {
            user_id: userId,
            name: normalized.name,
            milestone_label: normalized.milestoneLabel,
            milestone_sublabel: normalized.milestoneSublabel,
            target_amount: normalized.targetAmount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (upsertError) throw upsertError;

      setGoalState(normalized);
    } catch (err) {
      console.error('Error saving goal:', err);
      alert('Failed to save goal to the database. Check the console for details.');
      throw err;
    }
  };

  return { goal, loading, error, saveGoal, refetch: load };
};

export default useGoal;
