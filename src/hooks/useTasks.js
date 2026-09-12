import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { buildTaskEditPatch, mergeUpdatedTask } from '../lib/actionPlanNote';

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

  // Edit an existing task's note text and/or due date (a direct correction).
  // The SINGLE content-update path: it updates the SAME row via its id — no
  // re-transcription, no AI re-interpretation, no second record, and no change
  // to category/done/id/created_at/user_id. The patch is strictly
  // { title, due_date } (see buildTaskEditPatch). Optimistic update sets both
  // fields; on failure the previous task list is restored so BOTH the original
  // note and the original due date stay visible. `tasks` has no updated_at
  // column, so none is written.
  const updateTask = async (id, { title, dueDate }) => {
    const patch = buildTaskEditPatch({ title, dueDate }); // throws EMPTY_NOTE on blank
    const prev = tasks;
    setTasks((p) => p.map((t) => (t.id === id ? mergeUpdatedTask(t, patch) : t)));

    const { data, error: updateError } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .select();

    // RLS-blocked updates return an empty array without throwing; treat that as
    // a failure and roll back so the visible note AND due date stay original.
    if (updateError || !data || data.length === 0) {
      setTasks(prev);
      throw updateError || new Error('Update failed');
    }
    return data[0];
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

  return { tasks, loading, error, addTasks, updateTask, toggleDone, deleteTask, refetch: load };
};

export default useTasks;
