import { useState, useEffect, useCallback } from 'react';
import { format, addDays } from 'date-fns';
import { supabase } from '../lib/supabase';
import { nextDueDate } from '../lib/cardGuard';

// Aggregates everything that needs attention into one list for the in-app bell:
// bills due/overdue, unpaid cards due soon, and to-dos due/overdue. Each source
// is best-effort so a missing table never breaks the bell.

const CARD_LOOKAHEAD_DAYS = 3;

export default function useNotifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const cardWindowStr = format(addDays(new Date(), CARD_LOOKAHEAD_DAYS), 'yyyy-MM-dd');

      const [pay, cards, tasks] = await Promise.all([
        supabase.from('scheduled_payments').select('*').eq('status', 'pending').lte('payment_date', tomorrowStr),
        supabase.from('credit_cards').select('*').eq('statement_paid', false),
        supabase.from('tasks').select('*').eq('done', false).lte('due_date', todayStr),
      ]);

      const list = [];

      (pay.data || []).forEach((p) => {
        const severity = p.payment_date < todayStr ? 'overdue' : p.payment_date === todayStr ? 'today' : 'soon';
        list.push({
          id: `bill-${p.id}`, kind: 'bill', severity,
          title: p.entity, subtitle: `$${Number(p.amount || 0).toFixed(2)}`, date: p.payment_date,
        });
      });

      (cards.data || []).forEach((c) => {
        const bal = Number(c.statement_balance) || 0;
        const due = nextDueDate(c.due_day);
        if (bal <= 0 || !due) return;
        const dueStr = format(due, 'yyyy-MM-dd');
        if (dueStr > cardWindowStr) return;
        const severity = dueStr < todayStr ? 'overdue' : dueStr === todayStr ? 'today' : 'soon';
        list.push({
          id: `card-${c.id}`, kind: 'card', severity,
          title: `${c.card_name} statement`, subtitle: `$${bal.toFixed(2)}`, date: dueStr,
        });
      });

      (tasks.data || []).forEach((t) => {
        const severity = t.due_date < todayStr ? 'overdue' : 'today';
        list.push({
          id: `task-${t.id}`, kind: 'task', severity,
          title: t.title, subtitle: 'to-do', date: t.due_date,
        });
      });

      const rank = { overdue: 0, today: 1, soon: 2 };
      list.sort((a, b) => (rank[a.severity] - rank[b.severity]) || String(a.date || '').localeCompare(String(b.date || '')));
      setItems(list);
    } catch (e) {
      console.error('notifications load failed:', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { items, count: items.length, loading, refetch: load };
}
