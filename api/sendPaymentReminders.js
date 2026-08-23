import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Per-user outbound payment reminders (P0 Phase B).
//
// SECURITY MODEL
//   * Cron auth fails closed: CRON_SECRET must be configured server-side, and is
//     accepted ONLY via `Authorization: Bearer <CRON_SECRET>` (never a query
//     param), compared in constant time. Missing config => 500; bad/absent
//     header => 401.
//   * Strict per-user isolation: we iterate the active rows of
//     public.user_telegram_integrations and, for EACH user, query that user's
//     financial data explicitly scoped by user_id (never a global collection).
//     Each user's message is sent only to that same row's telegram_chat_id. The
//     destination chat id is a per-iteration local, so one user's data can never
//     reach another user's chat, and one user's send failure cannot re-route or
//     retry to anyone else.
//   * No global Telegram destination environment variable is used.
//   * Logs never contain chat/user ids, secrets, tokens, or financial content.

const CARD_LOOKAHEAD_DAYS = 3;

// --- Constant-time secret compare (SHA-256 both -> fixed-length, no length
// branch, never logs either input). ---
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const da = crypto.createHash('sha256').update(a, 'utf8').digest();
  const db = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

// --- Cron auth gate. Returns { ok } or { ok:false, status, error }. ---
export function checkCronAuth(req, cronSecret) {
  if (!cronSecret) {
    // Fail closed: the job must never run without configured auth.
    return { ok: false, status: 500, error: 'Server configuration error' };
  }
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  const expected = `Bearer ${cronSecret}`;
  if (!header || !timingSafeEqualStr(String(header), expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

// --- Pure date helpers ---
function ymd(date) {
  return date.toISOString().split('T')[0];
}

// Next calendar date (YYYY-MM-DD) a card's monthly due-day falls on, at/after
// today. Returns null for an invalid due day.
export function nextCardDueStr(dueDay, today) {
  const d = Number(dueDay);
  if (!d || d < 1 || d > 31) return null;
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth();
  if (d < today.getUTCDate()) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// --- Pure: reduce one user's raw rows into the due buckets. ---
export function computeDue({ payments = [], cards = [], tasks = [] }, today) {
  const todayStr = ymd(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = ymd(tomorrow);

  const cardWindow = new Date(today);
  cardWindow.setUTCDate(cardWindow.getUTCDate() + CARD_LOOKAHEAD_DAYS);
  const cardWindowStr = ymd(cardWindow);

  const overdue = payments.filter((p) => p.payment_date < todayStr);
  const dueToday = payments.filter((p) => p.payment_date === todayStr);
  const dueTomorrow = payments.filter((p) => p.payment_date === tomorrowStr);

  const cardsDue = cards
    .filter((c) => c.due_day && Number(c.statement_balance) > 0)
    .map((c) => ({
      card_name: c.card_name,
      amount: Number(c.statement_balance) || 0,
      dueStr: nextCardDueStr(c.due_day, today),
    }))
    .filter((c) => c.dueStr && c.dueStr <= cardWindowStr)
    .sort((a, b) => a.dueStr.localeCompare(b.dueStr));

  const tasksDue = tasks || [];

  const billsTotal = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const cardsTotal = cardsDue.reduce((sum, c) => sum + c.amount, 0);

  return {
    todayStr,
    overdue,
    dueToday,
    dueTomorrow,
    cardsDue,
    tasksDue,
    totalDue: billsTotal + cardsTotal,
  };
}

// --- Pure: build one user's reminder text, or null if nothing is due. ---
export function buildMessage(due, isEvening) {
  const { overdue, dueToday, dueTomorrow, cardsDue, tasksDue, totalDue, todayStr } = due;
  if (
    overdue.length === 0 && dueToday.length === 0 && dueTomorrow.length === 0 &&
    cardsDue.length === 0 && tasksDue.length === 0
  ) {
    return null;
  }

  const header = isEvening ? `🌙 *End-of-Day Check*` : `☀️ *Good Morning — Payment Reminder*`;
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

  message += `\n*Total: $${totalDue.toFixed(2)}*`;
  if (isEvening) {
    message += `\n\n_Tap a payment in the app to mark it paid._`;
  }
  return message;
}

// --- Injectable core: strictly per-user, no direct network/Supabase here. ---
// integrations: [{ user_id, telegram_chat_id, active }]
// loadUserData(userId): resolves { payments, cards, tasks } scoped to that user.
// sendMessage(chatId, text): resolves truthy on success; may reject/throw.
export async function runReminders({ integrations, loadUserData, sendMessage, now, isEvening }) {
  const today = now || new Date();
  let sent = 0, skipped = 0, failed = 0;

  for (const integ of integrations || []) {
    // Only active, linked integrations receive reminders.
    if (!integ || !integ.active || !integ.telegram_chat_id || !integ.user_id) {
      skipped++;
      continue;
    }
    // Destination is bound to THIS row for the whole iteration and never shared
    // with another user's processing.
    const chatId = integ.telegram_chat_id;
    const ownerId = integ.user_id;

    let data;
    try {
      data = await loadUserData(ownerId); // MUST be scoped by ownerId
    } catch {
      failed++;
      continue;
    }

    const due = computeDue(data || {}, today);
    const message = buildMessage(due, isEvening);
    if (!message) {
      skipped++;
      continue;
    }

    try {
      const okSend = await sendMessage(chatId, message);
      if (okSend) sent++; else failed++;
    } catch {
      // A send failure is contained to this user; loop continues with the next
      // integration's own chatId.
      failed++;
    }
  }

  return { sent, skipped, failed };
}

export default async function handler(req, res) {
  // Cron auth: configured secret + Bearer header only, fail closed.
  const auth = checkCronAuth(req, process.env.CRON_SECRET);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!url || !serviceKey || !botToken) {
    console.error('sendPaymentReminders config missing');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const isEvening =
    (req.query?.window || (now.getUTCHours() < 6 ? 'evening' : 'morning')) === 'evening';

  try {
    // Active, linked destinations only. RLS is bypassed by the service role, so
    // isolation is enforced by EXPLICIT user_id scoping below -- never relied on
    // as a side effect of a broad query.
    const { data: integrations, error: integErr } = await supabase
      .from('user_telegram_integrations')
      .select('user_id, telegram_chat_id, active')
      .eq('active', true);
    if (integErr) throw integErr;

    // Load one user's financial data, every query explicitly scoped by user_id.
    const loadUserData = async (userId) => {
      const [payRes, cardRes, taskRes] = await Promise.all([
        supabase
          .from('scheduled_payments')
          .select('entity, amount, payment_date, status')
          .eq('user_id', userId)
          .eq('status', 'pending'),
        supabase
          .from('credit_cards')
          .select('card_name, statement_balance, due_day, statement_paid')
          .eq('user_id', userId)
          .eq('statement_paid', false),
        supabase
          .from('tasks')
          .select('title, due_date, done')
          .eq('user_id', userId)
          .eq('done', false),
      ]);
      if (payRes.error) throw payRes.error;
      if (cardRes.error) throw cardRes.error;
      // Tasks are best-effort; a tasks failure should not sink the reminder.
      return {
        payments: payRes.data || [],
        cards: cardRes.data || [],
        tasks: taskRes.error ? [] : (taskRes.data || []),
      };
    };

    // Send to a single user's chat. Detects HTTP 4xx/5xx and never throws.
    const sendMessage = async (chatId, text) => {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
          }
        );
        if (!response.ok) {
          console.error('sendPaymentReminders send failed', 'http');
          return false;
        }
        return true;
      } catch {
        console.error('sendPaymentReminders send failed', 'network');
        return false;
      }
    };

    const result = await runReminders({
      integrations,
      loadUserData,
      sendMessage,
      now,
      isEvening,
    });

    // Aggregate counts only -- no chat ids, no financial content.
    return res.status(200).json({ message: 'Reminders processed', ...result });
  } catch (error) {
    console.error('sendPaymentReminders error', error?.code || error?.name || 'error');
    return res.status(500).json({ error: 'Failed to process reminders' });
  }
}
