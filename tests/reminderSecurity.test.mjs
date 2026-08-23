// Synthetic security tests for per-user payment reminders (P0 Phase B).
//
// FICTIONAL values only. No network, no Supabase, no Telegram, no real secrets
// or ids. Behavioral tests drive the injectable pure core (checkCronAuth,
// runReminders, computeDue, buildMessage); static tests assert source-level
// invariants (no global chat id, every financial query user-scoped).
//
// Run from repo root:
//   node tests/reminderSecurity.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  checkCronAuth,
  runReminders,
  computeDue,
  buildMessage,
} from '../api/sendPaymentReminders.js';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = readFileSync(join(root, 'api/sendPaymentReminders.js'), 'utf8');

// ---------------------------------------------------------------------------
// 1. Cron auth gate
// ---------------------------------------------------------------------------
const SECRET = 'synthetic-cron-secret';
ok('missing CRON_SECRET fails closed (undefined)',
  checkCronAuth({ headers: { authorization: `Bearer ${SECRET}` } }, undefined).status === 500);
ok('missing CRON_SECRET fails closed (empty)',
  checkCronAuth({ headers: { authorization: `Bearer ${SECRET}` } }, '').status === 500);
ok('query-string secret is rejected (no header)',
  checkCronAuth({ headers: {}, query: { secret: SECRET } }, SECRET).status === 401);
ok('wrong Authorization secret is rejected',
  checkCronAuth({ headers: { authorization: 'Bearer wrong-value' } }, SECRET).status === 401);
ok('absent Authorization is rejected',
  checkCronAuth({ headers: {} }, SECRET).status === 401);
ok('correct Bearer passes auth gate',
  checkCronAuth({ headers: { authorization: `Bearer ${SECRET}` } }, SECRET).ok === true);
// A secret that only appears as a query param must NOT authorize.
ok('query secret does not authorize even if header wrong',
  checkCronAuth({ headers: { authorization: 'Bearer x' }, query: { secret: SECRET } }, SECRET).ok !== true);

// ---------------------------------------------------------------------------
// 2. Static source invariants
// ---------------------------------------------------------------------------
ok('TELEGRAM_CHAT_ID absent from source', !src.includes('TELEGRAM_CHAT_ID'));
ok('no query-string secret handling', !src.includes('query.secret') && !src.includes('querySecret'));
// Every financial-data query is explicitly scoped by user_id.
function scopedByUser(source, table) {
  const start = source.indexOf(`.from('${table}')`);
  if (start === -1) return false;
  const rest = source.slice(start + 1);
  const nextFrom = rest.indexOf('.from(');
  const block = nextFrom === -1 ? rest : rest.slice(0, nextFrom);
  return block.includes(".eq('user_id', userId)");
}
ok('scheduled_payments scoped by user_id', scopedByUser(src, 'scheduled_payments'));
ok('credit_cards scoped by user_id', scopedByUser(src, 'credit_cards'));
ok('tasks scoped by user_id', scopedByUser(src, 'tasks'));
// Integrations are filtered to active destinations.
ok('integrations filtered to active', src.includes(".eq('active', true)"));

// ---------------------------------------------------------------------------
// 3. runReminders — isolation behavior
// ---------------------------------------------------------------------------
const now = new Date('2026-08-23T12:00:00.000Z');
const todayStr = now.toISOString().split('T')[0];
// Per-user data with a marker embedded in the payment entity so we can prove
// which user's content ended up in which chat.
const dataFor = (userId) => ({
  payments: [{ entity: `OWNER-${userId}`, amount: 10, payment_date: todayStr, status: 'pending' }],
  cards: [],
  tasks: [],
});

// 3a. Inactive / unlinked users are skipped; only the valid one is sent.
{
  const integrations = [
    { user_id: 'user-a', telegram_chat_id: 'chat-a', active: true },
    { user_id: 'user-b', telegram_chat_id: 'chat-b', active: false }, // inactive
    { user_id: 'user-c', telegram_chat_id: null, active: true },      // unlinked
  ];
  const calls = [];
  const result = await runReminders({
    integrations,
    now,
    isEvening: false,
    loadUserData: async (uid) => dataFor(uid),
    sendMessage: async (chatId, text) => { calls.push({ chatId, text }); return true; },
  });
  ok('inactive/unlinked users skipped (one send)', calls.length === 1 && calls[0].chatId === 'chat-a');
  ok('skip counters reflect skipped users', result.sent === 1 && result.skipped === 2);
}

// 3b. Each user's message goes ONLY to that same user's chat id.
{
  const integrations = [
    { user_id: 'user-a', telegram_chat_id: 'chat-a', active: true },
    { user_id: 'user-b', telegram_chat_id: 'chat-b', active: true },
  ];
  const calls = [];
  await runReminders({
    integrations,
    now,
    isEvening: false,
    loadUserData: async (uid) => dataFor(uid),
    sendMessage: async (chatId, text) => { calls.push({ chatId, text }); return true; },
  });
  const byChat = Object.fromEntries(calls.map((c) => [c.chatId, c.text]));
  ok('two sends, one per user', calls.length === 2);
  ok('chat-a receives only user-a content',
    byChat['chat-a'].includes('OWNER-user-a') && !byChat['chat-a'].includes('OWNER-user-b'));
  ok('chat-b receives only user-b content',
    byChat['chat-b'].includes('OWNER-user-b') && !byChat['chat-b'].includes('OWNER-user-a'));
}

// 3c. loadUserData is always called with the SAME user_id as the destination row.
{
  const integrations = [
    { user_id: 'user-a', telegram_chat_id: 'chat-a', active: true },
    { user_id: 'user-b', telegram_chat_id: 'chat-b', active: true },
  ];
  const pairs = [];
  await runReminders({
    integrations,
    now,
    isEvening: false,
    loadUserData: async (uid) => { pairs.push({ loaded: uid }); return dataFor(uid); },
    sendMessage: async (chatId) => { pairs[pairs.length - 1].sentTo = chatId; return true; },
  });
  ok('data loaded for user-a routed to chat-a',
    pairs.some((p) => p.loaded === 'user-a' && p.sentTo === 'chat-a'));
  ok('data loaded for user-b routed to chat-b',
    pairs.some((p) => p.loaded === 'user-b' && p.sentTo === 'chat-b'));
}

// 3d. One user's send failure cannot re-route/retry to another user.
{
  const integrations = [
    { user_id: 'user-a', telegram_chat_id: 'chat-a', active: true },
    { user_id: 'user-b', telegram_chat_id: 'chat-b', active: true },
  ];
  const calls = [];
  const result = await runReminders({
    integrations,
    now,
    isEvening: false,
    loadUserData: async (uid) => dataFor(uid),
    sendMessage: async (chatId, text) => {
      if (chatId === 'chat-a') throw new Error('telegram down for A');
      calls.push({ chatId, text });
      return true;
    },
  });
  ok('failing send does not reach another chat',
    calls.length === 1 && calls[0].chatId === 'chat-b');
  ok('user-b still gets only user-b content after A failed',
    calls[0].text.includes('OWNER-user-b') && !calls[0].text.includes('OWNER-user-a'));
  ok('failure counted, other user still sent', result.failed === 1 && result.sent === 1);
}

// 3e. A loadUserData failure for one user is contained.
{
  const integrations = [
    { user_id: 'user-a', telegram_chat_id: 'chat-a', active: true },
    { user_id: 'user-b', telegram_chat_id: 'chat-b', active: true },
  ];
  const calls = [];
  const result = await runReminders({
    integrations,
    now,
    isEvening: false,
    loadUserData: async (uid) => { if (uid === 'user-a') throw new Error('db error'); return dataFor(uid); },
    sendMessage: async (chatId, text) => { calls.push({ chatId, text }); return true; },
  });
  ok('data-load failure contained to that user',
    calls.length === 1 && calls[0].chatId === 'chat-b' && result.failed === 1);
}

// ---------------------------------------------------------------------------
// 4. Pure helpers sanity (no leakage into empty case)
// ---------------------------------------------------------------------------
ok('buildMessage returns null when nothing due',
  buildMessage(computeDue({ payments: [], cards: [], tasks: [] }, now), false) === null);
ok('buildMessage includes due payment entity',
  buildMessage(computeDue(dataFor('user-x'), now), false).includes('OWNER-user-x'));
ok('empty integrations -> nothing sent', (await runReminders({
  integrations: [], now, isEvening: false,
  loadUserData: async () => dataFor('none'),
  sendMessage: async () => true,
})).sent === 0);

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);
