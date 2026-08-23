import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Loads/manages Action Plan tasks (tasks table). RLS scopes rows to the user.
const useTasks = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('tasks')
        .select('*')
        .order('done', { ascending: true })
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setTasks(data || []);
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError(err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getUserId = async () => {
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data?.user?.id) throw new Error('Must be logged in.');
    return data.user.id;
  };

  // Insert a batch of tasks (e.g. the AI-extracted set).
  const addTasks = async (items) => {
    const clean = (items || [])
      .map((t) => ({ title: String(t.title || '').trim(), category: t.category || 'Other', due_date: t.due_date || null }))
      .filter((t) => t.title);
    if (clean.length === 0) return;
    const userId = await getUserId();
    const rows = clean.map((t) => ({ ...t, user_id: userId }));
    const { error: insertError } = await supabase.from('tasks').insert(rows);
    if (insertError) throw insertError;
    await load();
  };

  const toggleDone = async (id, done) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done } : t)));
    const { error: updateError } = await supabase.from('tasks').update({ done }).eq('id', id);
    if (updateError) { await load(); throw updateError; }
  };

  const deleteTask = async (id) => {
    const prev = tasks;
    setTasks((p) => p.filter((t) => t.id !== id));
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', id);
    if (deleteError) { setTasks(prev); throw deleteError; }
  };

  return { tasks, loading, error, addTasks, toggleDone, deleteTask, refetch: load };
};

export default useTasks;
