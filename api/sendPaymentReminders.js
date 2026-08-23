import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify this request genuinely came from Vercel's own Cron scheduler
  // (via the Authorization header), OR was manually triggered for testing
  // by pasting a URL with ?secret=... into a browser. Either path requires
  // knowing the real CRON_SECRET, so a random visitor still can't trigger it.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    const querySecret = req.query?.secret;
    const isAuthorized = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
    if (!isAuthorized) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Service role key bypasses RLS -- required here since a cron job has
    // no logged-in user session to satisfy the table's per-owner RLS
    // policies (which check auth.uid(), unavailable in this context).
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Overdue (any date before today) + due today + due tomorrow. Kept
    // tight on purpose -- a full 7-day-out list would repeat the same
    // far-future items every single day and get noisy. The in-app banner
    // already covers that wider view when you actually open the app.
    const { data: payments, error } = await supabase
      .from('scheduled_payments')
      .select('*')
      .eq('status', 'pending')
      .lte('payment_date', tomorrowStr)
      .order('payment_date', { ascending: true });

    if (error) throw error;

    // Credit-card statements get a slightly wider heads-up than bills, since a
    // missed card payment triggers costly financing. Include unpaid cards due
    // within the next CARD_LOOKAHEAD_DAYS days (bills stay today/tomorrow).
    const CARD_LOOKAHEAD_DAYS = 3;
    const cardWindow = new Date(today);
    cardWindow.setUTCDate(cardWindow.getUTCDate() + CARD_LOOKAHEAD_DAYS);
    const cardWindowStr = cardWindow.toISOString().split('T')[0];

    const { data: cards, error: cardsError } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('statement_paid', false);
    if (cardsError) throw cardsError;

    const nextCardDueStr = (dueDay) => {
      const d = Number(dueDay);
      if (!d || d < 1 || d > 31) return null;
      let year = today.getUTCFullYear();
      let month = today.getUTCMonth();
      if (d < today.getUTCDate()) { month += 1; if (month > 11) { month = 0; year += 1; } }
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };

    const cardsDue = (cards || [])
      .filter((c) => c.due_day && Number(c.statement_balance) > 0)
      .map((c) => ({ card_name: c.card_name, amount: Number(c.statement_balance) || 0, dueStr: nextCardDueStr(c.due_day) }))
      .filter((c) => c.dueStr && c.dueStr <= cardWindowStr)
      .sort((a, b) => a.dueStr.localeCompare(b.dueStr));

    // Action Plan tasks due today or overdue and not done. Best-effort -- don't
    // break the whole reminder if the tasks table isn't present yet.
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('done', false)
      .lte('due_date', todayStr)
      .order('due_date', { ascending: true });
    const tasksDue = tasks || [];

    // Bills (scheduled payments) keep the tight today/tomorrow window.
    const overdue = (payments || []).filter((p) => p.payment_date < todayStr);
    const dueToday = (payments || []).filter((p) => p.payment_date === todayStr);
    const dueTomorrow = (payments || []).filter((p) => p.payment_date === tomorrowStr);

    if (overdue.length === 0 && dueToday.length === 0 && dueTomorrow.length === 0 && cardsDue.length === 0 && tasksDue.length === 0) {
      return res.status(200).json({ message: 'No reminders needed today.' });
    }

    // Two daily sends share this handler. The evening cron can pass
    // ?window=evening; otherwise fall back to the UTC hour -- the evening cron
    // fires ~03:00 UTC (10pm Panama) and the morning cron ~12:00 UTC (7am), so
    // a UTC hour before 06:00 means it's the evening run. (?window=evening also
    // lets you preview the evening message when testing manually.)
    const isEvening =
      (req.query?.window || (new Date().getUTCHours() < 6 ? 'evening' : 'morning')) === 'evening';

    const header = isEvening
      ? `🌙 *End-of-Day Check*`
      : `☀️ *Good Morning — Payment Reminder*`;
    const overdueLabel = isEvening ? 'Still Overdue' : 'Overdue';
    const todayLabel = isEvening ? 'Due Today — not marked paid' : 'Due Today';

    let message = `${header}\n\n`;

    if (overdue.length > 0) {
      message += `⛔ *${overdueLabel} (${overdue.length}):*\n`;
      overdue.forEach((p) => {
        message += `  • ${p.entity} — $${Number(p.amount).toFixed(2)} (was due ${p.payment_date})\n`;
      });
      message += `\n`;
    }

    if (dueToday.length > 0) {
      message += `🔴 *${todayLabel} (${dueToday.length}):*\n`;
      dueToday.forEach((p) => {
        message += `  • ${p.entity} — $${Number(p.amount).toFixed(2)}\n`;
      });
      message += `\n`;
    }

    if (dueTomorrow.length > 0) {
      message += `🟡 *Due Tomorrow (${dueTomorrow.length}):*\n`;
      dueTomorrow.forEach((p) => {
        message += `  • ${p.entity} — $${Number(p.amount).toFixed(2)}\n`;
      });
    }

    if (cardsDue.length > 0) {
      const dayLabel = (dueStr) => {
        const dl = Math.round((Date.parse(dueStr) - Date.parse(todayStr)) / 86400000);
        return dl <= 0 ? 'today' : dl === 1 ? 'tomorrow' : `in ${dl} days`;
      };
      message += `\n💳 *Card statements due soon (${cardsDue.length}):*\n`;
      cardsDue.forEach((c) => {
        message += `  • ${c.card_name} — $${c.amount.toFixed(2)} (due ${c.dueStr}, ${dayLabel(c.dueStr)})\n`;
      });
    }

    if (tasksDue.length > 0) {
      message += `\n📋 *To-dos (${tasksDue.length}):*\n`;
      tasksDue.forEach((t) => {
        const tag = t.due_date < todayStr ? `overdue, was due ${t.due_date}` : 'today';
        message += `  • ${t.title} (${tag})\n`;
      });
    }

    const billsTotal = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const cardsTotal = cardsDue.reduce((sum, c) => sum + c.amount, 0);
    const totalDue = billsTotal + cardsTotal;
    message += `\n*Total: $${totalDue.toFixed(2)}*`;
    if (isEvening) {
      message += `\n\n_Tap a payment in the app to mark it paid._`;
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown'
        })
      }
    );

    const telegramResult = await telegramResponse.json();
    if (!telegramResult.ok) {
      throw new Error(`Telegram API error: ${telegramResult.description}`);
    }

    return res.status(200).json({ message: 'Reminder sent successfully', count: (payments?.length || 0) + cardsDue.length + tasksDue.length });
  } catch (error) {
    console.error('sendPaymentReminders error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error sending reminders' });
  }
}
