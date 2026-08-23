// Synthetic security tests for the Telegram link flow (Phase A2.4).
//
// FICTIONAL values only -- no real Telegram IDs, bot handle, bot token, webhook
// secret, owner UUID, service-role key, or private data. No network calls, no
// Supabase connection, no production data.
//
// Two kinds of checks:
//   1. Behavioral tests of the webhook's exported PURE helpers
//      (timingSafeEqualStr, parseStartToken, statusToMessage).
//   2. Structural/static assertions over the runtime + migration SOURCE TEXT,
//      normalized to be robust against whitespace (not tied to line numbers),
//      guarding the security invariants of the endpoints and schema.
//
// Run from repo root (a recent Node may print MODULE_TYPELESS_PACKAGE_JSON --
// that warning is acceptable):
//   node tests/telegramLinkSecurity.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  timingSafeEqualStr,
  parseStartToken,
  statusToMessage,
} from '../api/telegramWebhook.js';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
// Collapse all runs of whitespace to a single space and lowercase, so
// assertions do not depend on exact formatting.
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const has = (hay, needle) => hay.includes(needle);

// ---------------------------------------------------------------------------
// 1. timingSafeEqualStr
// ---------------------------------------------------------------------------
ok('secret equal -> true', timingSafeEqualStr('synthetic-secret', 'synthetic-secret') === true);
ok('secret different same-length -> false', timingSafeEqualStr('aaaaaaaa', 'bbbbbbbb') === false);
ok('secret different length -> false', timingSafeEqualStr('short', 'a-much-longer-value') === false);
ok('secret empty vs empty -> true', timingSafeEqualStr('', '') === true);
ok('secret non-string a -> false', timingSafeEqualStr(undefined, 'x') === false);
ok('secret non-string b -> false', timingSafeEqualStr('x', null) === false);
ok('secret both non-string -> false', timingSafeEqualStr(123, 123) === false);

// ---------------------------------------------------------------------------
// 2. parseStartToken
// ---------------------------------------------------------------------------
ok('start accepts /start TOKEN', parseStartToken('/start SyntheticTok123') === 'SyntheticTok123');
ok('start accepts /start@Bot_Name TOKEN', parseStartToken('/start@Test_Bot SyntheticTok123') === 'SyntheticTok123');
ok('start trims surrounding whitespace', parseStartToken('   /start SyntheticTok123   ') === 'SyntheticTok123');
ok('start rejects bare /start', parseStartToken('/start') === null);
ok('start rejects extra payload', parseStartToken('/start TOK EXTRA') === null);
ok('start rejects /startfoo', parseStartToken('/startfoo TOK') === null);
ok('start rejects bad bot name', parseStartToken('/start@bad-name TOK') === null);
ok('start rejects empty text', parseStartToken('') === null);
ok('start rejects non-string', parseStartToken(null) === null);
ok('start rejects whitespace-only', parseStartToken('     ') === null);

// ---------------------------------------------------------------------------
// 3. statusToMessage
// ---------------------------------------------------------------------------
const invalidMsg = statusToMessage('invalid_input');
const statuses = ['linked', 'not_found', 'expired', 'used', 'already_linked', 'telegram_identity_taken', 'invalid_input'];
for (const s of statuses) {
  ok('status maps: ' + s, typeof statusToMessage(s) === 'string' && statusToMessage(s).length > 0);
}
ok('status linked distinct', statusToMessage('linked') !== invalidMsg);
ok('status expired distinct', statusToMessage('expired') !== invalidMsg);
ok('status used distinct', statusToMessage('used') !== invalidMsg);
ok('status already_linked distinct', statusToMessage('already_linked') !== invalidMsg);
ok('status telegram_identity_taken distinct', statusToMessage('telegram_identity_taken') !== invalidMsg);
ok('status not_found == invalid neutral', statusToMessage('not_found') === invalidMsg);
ok('status unknown -> neutral invalid msg', statusToMessage('some_unexpected_status') === invalidMsg);
// No status message discloses identity/id-like data.
ok('status messages disclose no ids', statuses.every((s) => !/\b(user_id|chat_id|uuid)\b/i.test(statusToMessage(s))));

// ---------------------------------------------------------------------------
// 4. Webhook static security (api/telegramWebhook.js)
// ---------------------------------------------------------------------------
const webhookSrc = read('api/telegramWebhook.js');
const webhookN = norm(webhookSrc);
ok('webhook POST-only', has(webhookN, "!== 'post'"));
ok('webhook checks secret header', has(webhookN, 'x-telegram-bot-api-secret-token'));
ok('webhook references TELEGRAM_WEBHOOK_SECRET', has(webhookSrc, 'TELEGRAM_WEBHOOK_SECRET'));
ok('webhook private-chat gate', has(webhookN, "chat.type !== 'private'"));
ok('webhook uses consume RPC name', has(webhookSrc, 'consume_telegram_link_token'));
ok('webhook uses message.from.id', has(webhookSrc, 'message.from.id'));
ok('webhook uses message.chat.id', has(webhookSrc, 'message.chat.id'));
ok('webhook SHA-256 hashing', has(webhookN, "createhash('sha256')"));
ok('webhook references TELEGRAM_BOT_TOKEN', has(webhookSrc, 'TELEGRAM_BOT_TOKEN'));
ok('webhook does NOT import/use requireUser', !has(webhookSrc, 'requireUser'));
ok('webhook does NOT reference TELEGRAM_CHAT_ID', !has(webhookSrc, 'TELEGRAM_CHAT_ID'));
ok('webhook does NOT touch integrations table directly', !has(webhookSrc, 'user_telegram_integrations'));
ok('webhook does NOT read identity from query string', !has(webhookSrc, 'req.query'));
// No sensitive value appears on any logging line.
const webhookConsoleLines = webhookSrc.split('\n').filter((l) => l.includes('console.'));
const forbiddenInLogs = ['req.body', 'message.text', 'tokenhash', 'rawtoken', 'telegramuserid', 'telegramchatid'];
ok('webhook uses no console.log', !webhookConsoleLines.some((l) => l.includes('console.log')));
ok('webhook logs contain no sensitive identifiers', webhookConsoleLines.every((l) => {
  const ln = l.toLowerCase();
  return !forbiddenInLogs.some((f) => ln.includes(f));
}));
// Ordering: the secret check must run BEFORE the update body is processed.
const idxSecretCheck = webhookSrc.indexOf('timingSafeEqualStr(String(providedSecret');
const idxBodyProcess = webhookSrc.indexOf('const body =');
ok('webhook secret check before body processing',
  idxSecretCheck !== -1 && idxBodyProcess !== -1 && idxSecretCheck < idxBodyProcess);
// Ordering: the required bot-token config check must run BEFORE the RPC call.
const idxBotTokenCheck = webhookSrc.indexOf('if (!process.env.TELEGRAM_BOT_TOKEN)');
const idxRpcCall = webhookSrc.indexOf('supabase.rpc(');
ok('webhook bot-token check before rpc',
  idxBotTokenCheck !== -1 && idxRpcCall !== -1 && idxBotTokenCheck < idxRpcCall);

// ---------------------------------------------------------------------------
// 5. Authenticated endpoint static security (api/telegramLink.js)
// ---------------------------------------------------------------------------
const linkSrc = read('api/telegramLink.js');
const linkN = norm(linkSrc);
ok('link uses requireUser', has(linkSrc, 'requireUser'));
ok('link supports GET', has(linkN, "'get'"));
ok('link supports POST', has(linkN, "'post'"));
ok('link supports DELETE', has(linkN, "'delete'"));
ok('link owner-scopes by user.id', has(linkN, ".eq('user_id', user.id)"));
for (const f of ['user_id', 'telegram_user_id', 'telegram_chat_id', 'token_hash', 'raw_token']) {
  ok('link forbids browser field: ' + f, has(linkSrc, "'" + f + "'"));
}
ok('link uses crypto.randomBytes(32)', has(linkN, 'crypto.randombytes(32)'));
ok('link SHA-256 hashing', has(linkN, "createhash('sha256')"));
ok('link 10-minute TTL', has(linkSrc, 'TOKEN_TTL_MINUTES = 10'));
ok('link upsert conflict target user_id', has(linkN, "onconflict: 'user_id'"));
ok('link resets created_at on rotation', has(linkN, 'created_at: now.toisostring()'));
ok('link does NOT reference TELEGRAM_CHAT_ID', !has(linkSrc, 'TELEGRAM_CHAT_ID'));
// DELETE deletes the token row BEFORE the integration row.
const delSlice = linkSrc.slice(linkSrc.indexOf('async function handleDelete'));
const idxTok = delSlice.indexOf("user_telegram_link_tokens");
const idxInt = delSlice.indexOf("user_telegram_integrations");
ok('link DELETE removes token before integration', idxTok !== -1 && idxInt !== -1 && idxTok < idxInt);
// GET does not return Telegram identity fields.
const getSlice = norm(linkSrc.slice(linkSrc.indexOf('async function handleGet'), linkSrc.indexOf('async function handlePost')));
ok('link GET exposes no telegram identity', !getSlice.includes('telegram_user_id') && !getSlice.includes('telegram_chat_id'));
// Trust boundary: the endpoint must never read caller-supplied ownership/identity.
const linkCallerSuppliedAbsent =
  !has(linkSrc, 'req.body.user_id') &&
  !has(linkSrc, 'req.query.user_id') &&
  !has(linkSrc, 'req.query.telegram_user_id') &&
  !has(linkSrc, 'req.query.telegram_chat_id') &&
  !has(linkSrc, 'req.query');
ok('link does not read req.body.user_id', !has(linkSrc, 'req.body.user_id'));
ok('link does not read req.query.user_id', !has(linkSrc, 'req.query.user_id'));
ok('link does not read req.query.telegram_user_id', !has(linkSrc, 'req.query.telegram_user_id'));
ok('link does not read req.query.telegram_chat_id', !has(linkSrc, 'req.query.telegram_chat_id'));
ok('link uses no caller-supplied owner scope', linkCallerSuppliedAbsent);

// ---------------------------------------------------------------------------
// 6a. Migration static security -- A1 identity table
// ---------------------------------------------------------------------------
const a1 = norm(read('supabase/migrations/20260823010000_create_user_telegram_integrations.sql'));
ok('A1 unique(user_id)', has(a1, 'unique (user_id)'));
ok('A1 unique(telegram_user_id)', has(a1, 'unique (telegram_user_id)'));
ok('A1 unique(telegram_chat_id)', has(a1, 'unique (telegram_chat_id)'));
ok('A1 authenticated SELECT-own policy', has(a1, 'for select to authenticated using (auth.uid() = user_id)'));
ok('A1 authenticated granted SELECT only', has(a1, 'grant select on table public.user_telegram_integrations to authenticated;'));
ok('A1 no authenticated DML grant', !has(a1, 'insert, update, delete on table public.user_telegram_integrations to authenticated'));
ok('A1 service_role explicit DML', has(a1, 'grant select, insert, update, delete on table public.user_telegram_integrations to service_role;'));
// Independently prove no INSERT/UPDATE/DELETE reaches authenticated: inspect
// every grant statement addressed "to authenticated".
const a1AuthGrants = a1.split(';').filter((s) => s.includes('grant') && s.includes('to authenticated'));
ok('A1 authenticated INSERT grant absent', a1AuthGrants.length > 0 && a1AuthGrants.every((s) => !s.includes('insert')));
ok('A1 authenticated UPDATE grant absent', a1AuthGrants.every((s) => !s.includes('update')));
ok('A1 authenticated DELETE grant absent', a1AuthGrants.every((s) => !s.includes('delete')));
ok('A1 explicit revoke from public/anon/authenticated',
  has(a1, 'revoke all on table public.user_telegram_integrations from public, anon, authenticated;'));

// ---------------------------------------------------------------------------
// 6b. Migration static security -- A2.1 link tokens + RPC
// ---------------------------------------------------------------------------
const a2 = norm(read('supabase/migrations/20260823020000_create_telegram_link_tokens.sql'));
ok('A2.1 unique(user_id) token slot', has(a2, 'unique (user_id)'));
ok('A2.1 unique(token_hash)', has(a2, 'unique (token_hash)'));
ok('A2.1 SHA-256 hex CHECK', has(a2, "check (token_hash ~ '^[0-9a-f]{64}$')"));
ok('A2.1 RLS enabled', has(a2, 'enable row level security'));
ok('A2.1 no authenticated policy on tokens', !has(a2, 'create policy'));
ok('A2.1 service_role token DML', has(a2, 'grant select, insert, update, delete on table public.user_telegram_link_tokens to service_role;'));
ok('A2.1 RPC SECURITY DEFINER', has(a2, 'security definer'));
ok('A2.1 RPC safe search_path', has(a2, 'set search_path = pg_catalog'));
ok('A2.1 RPC locks token FOR UPDATE', has(a2, 'for update'));
// Consume (mark token consumed) happens AFTER the integration insert.
const idxInsert = a2.indexOf('insert into public.user_telegram_integrations');
const idxConsume = a2.indexOf('set consumed_at = now()');
ok('A2.1 consume after successful insert', idxInsert !== -1 && idxConsume !== -1 && idxInsert < idxConsume);
ok('A2.1 RPC execute revoked from public', has(a2, 'revoke all on function public.consume_telegram_link_token(text, text, text) from public'));
ok('A2.1 RPC execute revoked from anon', has(a2, 'revoke all on function public.consume_telegram_link_token(text, text, text) from anon'));
ok('A2.1 RPC execute revoked from authenticated', has(a2, 'revoke all on function public.consume_telegram_link_token(text, text, text) from authenticated'));
ok('A2.1 RPC execute granted to service_role', has(a2, 'grant execute on function public.consume_telegram_link_token(text, text, text) to service_role;'));
// Unique-race handling inside the consume RPC.
ok('A2.1 RPC handles unique_violation', has(a2, 'when unique_violation then'));
ok('A2.1 RPC reads constraint_name', has(a2, 'get stacked diagnostics') && has(a2, 'constraint_name'));
ok('A2.1 RPC maps user-unique race to already_linked',
  has(a2, "'user_telegram_integrations_user_unique'") && has(a2, "return 'already_linked'"));
ok('A2.1 RPC maps telegram-identity race to telegram_identity_taken',
  has(a2, "return 'telegram_identity_taken'"));
// The exception mapping branch (else -> telegram_identity_taken) exists, and
// consumption still happens only AFTER a successful insert (idx check above).
ok('A2.1 RPC unique-race else branch present',
  a2.indexOf('when unique_violation then') < a2.indexOf("return 'telegram_identity_taken'", a2.indexOf('when unique_violation then')));

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);
