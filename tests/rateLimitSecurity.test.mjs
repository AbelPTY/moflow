// Synthetic security tests for the durable rate-limit foundation (P0 Phase C1).
//
// FICTIONAL values only. No network, no Supabase/Vercel connection. Behavioral
// tests drive the pure/injectable helpers with a mock supabase whose rpc()
// records its parameters; static tests assert migration + helper invariants.
//
// Run from repo root:
//   node tests/rateLimitSecurity.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getClientIp,
  hashIp,
  consumeLimit,
  enforceRateLimit,
  RateLimitConfigError,
} from '../api/rateLimit.js';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const has = (h, n) => h.includes(n);

// Mock supabase: rpc records calls and returns queued results.
function mockSupabase(results) {
  const calls = [];
  let i = 0;
  return {
    calls,
    rpc: async (name, params) => {
      calls.push({ name, params });
      const r = typeof results === 'function' ? results(params, i) : results[i];
      i++;
      if (r && r.throw) throw new Error('db down');
      return { data: r ? r.data : null, error: r ? r.error || null : null };
    },
  };
}
const allowRow = (remaining = 5) => ({ data: [{ allowed: true, remaining, retry_after_seconds: 0 }] });
const denyRow = (retry = 30) => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: retry }] });

// ---------------------------------------------------------------------------
// 1. getClientIp -- headers only
// ---------------------------------------------------------------------------
ok('xff single', getClientIp({ headers: { 'x-forwarded-for': '203.0.113.7' } }) === '203.0.113.7');
ok('xff comma list -> first', getClientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 70.0.0.1, 10.0.0.1' } }) === '203.0.113.7');
ok('xff array -> first', getClientIp({ headers: { 'x-forwarded-for': ['203.0.113.7', '70.0.0.1'] } }) === '203.0.113.7');
ok('x-real-ip fallback', getClientIp({ headers: { 'x-real-ip': '198.51.100.9' } }) === '198.51.100.9');
ok('xff preferred over x-real-ip', getClientIp({ headers: { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.9' } }) === '203.0.113.7');
ok('no headers -> null', getClientIp({ headers: {} }) === null);
// Ownership/identity in body/query must be ignored entirely.
ok('ignores body/query ip', getClientIp({ headers: {}, body: { ip: '1.1.1.1' }, query: { ip: '2.2.2.2' } }) === null);

// ---------------------------------------------------------------------------
// 2. hashIp -- HMAC-SHA256, raw IP never in output
// ---------------------------------------------------------------------------
const H1 = hashIp('203.0.113.7', 'synthetic-salt');
ok('hashIp is 64-hex', /^[0-9a-f]{64}$/.test(H1));
ok('hashIp deterministic', hashIp('203.0.113.7', 'synthetic-salt') === H1);
ok('hashIp salt-sensitive', hashIp('203.0.113.7', 'other-salt') !== H1);
ok('hashIp does not contain raw ip', !H1.includes('203.0.113.7'));
ok('hashIp null on missing ip', hashIp(null, 'synthetic-salt') === null);
ok('hashIp null on missing salt', hashIp('203.0.113.7', '') === null);

// ---------------------------------------------------------------------------
// 3. consumeLimit -- field mapping + error propagation
// ---------------------------------------------------------------------------
{
  const sb = mockSupabase([allowRow(4)]);
  const r = await consumeLimit({ supabase: sb, scope: 's', subjectType: 'user', subjectKey: 'u1', limit: 5, windowSeconds: 60 });
  ok('consumeLimit maps allowed/remaining', r.allowed === true && r.remaining === 4 && r.retryAfterSeconds === 0);
  ok('consumeLimit passes RPC params', sb.calls[0].params.p_scope === 's' && sb.calls[0].params.p_subject_type === 'user' && sb.calls[0].params.p_subject_key === 'u1' && sb.calls[0].params.p_limit === 5 && sb.calls[0].params.p_window_seconds === 60);
}
{
  const sb = mockSupabase([{ throw: true }]);
  let threw = false;
  try { await consumeLimit({ supabase: sb, scope: 's', subjectType: 'user', subjectKey: 'u1', limit: 5, windowSeconds: 60 }); }
  catch { threw = true; }
  ok('consumeLimit throws on rpc error', threw);
}

// ---------------------------------------------------------------------------
// 4. enforceRateLimit -- identity, independence, denial, fail-closed
// ---------------------------------------------------------------------------
// 4a. User subject comes ONLY from the authenticated user object.
{
  const sb = mockSupabase([allowRow()]);
  const res = await enforceRateLimit({
    supabase: sb, scope: 'gemini', user: { id: 'auth-user-1' },
    userLimit: 5, userWindowSeconds: 60,
    // Attacker-controlled fields that must be ignored:
    req: { headers: {}, body: { user_id: 'attacker' }, query: { user_id: 'attacker' } },
  });
  ok('enforce user subject from user.id', res.allowed === true && sb.calls[0].params.p_subject_key === 'auth-user-1');
  ok('enforce ignores body/query user_id', sb.calls[0].params.p_subject_key !== 'attacker');
}
// 4b. User and IP limits are independently consumed (two RPC calls).
{
  const sb = mockSupabase([allowRow(), allowRow()]);
  const res = await enforceRateLimit({
    supabase: sb, scope: 'gemini', user: { id: 'u1' },
    userLimit: 5, userWindowSeconds: 60,
    ipLimit: 10, ipWindowSeconds: 60,
    req: { headers: { 'x-forwarded-for': '203.0.113.7' } }, ipSalt: 'synthetic-salt',
  });
  const types = sb.calls.map((c) => c.params.p_subject_type);
  ok('enforce consumes both subjects', res.allowed === true && sb.calls.length === 2 && types.includes('user') && types.includes('ip'));
  // IP subject key is the HMAC digest, not the raw IP.
  const ipCall = sb.calls.find((c) => c.params.p_subject_type === 'ip');
  ok('enforce ip key is hashed', ipCall.params.p_subject_key === hashIp('203.0.113.7', 'synthetic-salt') && ipCall.params.p_subject_key !== '203.0.113.7');
}
// 4c. User-limit denial blocks the request.
{
  const sb = mockSupabase([denyRow(45)]);
  const res = await enforceRateLimit({
    supabase: sb, scope: 'gemini', user: { id: 'u1' },
    userLimit: 5, userWindowSeconds: 60,
    ipLimit: 10, ipWindowSeconds: 60,
    req: { headers: { 'x-forwarded-for': '203.0.113.7' } }, ipSalt: 'synthetic-salt',
  });
  ok('enforce user-denial blocks', res.allowed === false && res.subjectType === 'user' && res.retryAfterSeconds === 45);
}
// 4d. IP-limit denial blocks the request (user allowed, ip denied).
{
  const sb = mockSupabase([allowRow(), denyRow(20)]);
  const res = await enforceRateLimit({
    supabase: sb, scope: 'gemini', user: { id: 'u1' },
    userLimit: 5, userWindowSeconds: 60,
    ipLimit: 10, ipWindowSeconds: 60,
    req: { headers: { 'x-forwarded-for': '203.0.113.7' } }, ipSalt: 'synthetic-salt',
  });
  ok('enforce ip-denial blocks', res.allowed === false && res.subjectType === 'ip');
}
// 4e. Missing RATE_LIMIT_IP_SALT fails closed with a typed config error.
{
  let err = null;
  try {
    await enforceRateLimit({
      supabase: mockSupabase([allowRow()]), scope: 'gemini', user: { id: 'u1' },
      ipLimit: 10, ipWindowSeconds: 60,
      req: { headers: { 'x-forwarded-for': '203.0.113.7' } }, ipSalt: '',
    });
  } catch (e) { err = e; }
  ok('missing salt -> RateLimitConfigError', err instanceof RateLimitConfigError);
}
// 4f. Missing authenticated user (when user limit required) fails closed typed.
{
  let err = null;
  try {
    await enforceRateLimit({
      supabase: mockSupabase([allowRow()]), scope: 'gemini', user: null,
      userLimit: 5, userWindowSeconds: 60,
    });
  } catch (e) { err = e; }
  ok('missing user -> RateLimitConfigError', err instanceof RateLimitConfigError);
}
// 4g. RPC/DB failure fails closed (deny), does not throw.
{
  const sb = mockSupabase([{ throw: true }]);
  const res = await enforceRateLimit({
    supabase: sb, scope: 'gemini', user: { id: 'u1' },
    userLimit: 5, userWindowSeconds: 60,
  });
  ok('db failure fails closed (deny)', res.allowed === false && res.failClosed === true);
}
// 4h. Required IP but not derivable -> fail closed (deny).
{
  const sb = mockSupabase([allowRow()]);
  const res = await enforceRateLimit({
    supabase: sb, scope: 'gemini', user: { id: 'u1' },
    ipLimit: 10, ipWindowSeconds: 60,
    req: { headers: {} }, ipSalt: 'synthetic-salt',
  });
  ok('underivable required ip fails closed', res.allowed === false && res.failClosed === true);
}

// ---------------------------------------------------------------------------
// 5. Helper source hygiene -- no sensitive logging, references salt env
// ---------------------------------------------------------------------------
const helperSrc = read('api/rateLimit.js');
ok('helper does no logging', !helperSrc.includes('console.'));
ok('helper uses HMAC', helperSrc.includes('createHmac'));
ok('helper references RATE_LIMIT_IP_SALT', helperSrc.includes('RATE_LIMIT_IP_SALT'));
ok('helper never reads req.body', !helperSrc.includes('req.body'));
ok('helper never reads req.query', !helperSrc.includes('req.query'));

// ---------------------------------------------------------------------------
// 6. Migration static security
// ---------------------------------------------------------------------------
const mig = norm(read('supabase/migrations/20260823030000_create_api_rate_limits.sql'));
ok('mig creates bucket table', has(mig, 'create table public.api_rate_limit_buckets'));
for (const col of ['scope', 'subject_type', 'subject_key', 'window_started_at', 'request_count', 'updated_at']) {
  ok('mig has column: ' + col, has(mig, col));
}
ok('mig primary key on triple', has(mig, 'primary key (scope, subject_type, subject_key)'));
ok('mig subject_type restricted', has(mig, "subject_type in ('user', 'ip')"));
ok('mig count nonneg check', has(mig, 'check (request_count >= 0)'));
ok('mig scope nonblank check', has(mig, 'check (btrim(scope) <> '));
ok('mig subject_key nonblank check', has(mig, 'check (btrim(subject_key) <> '));
ok('mig RLS enabled', has(mig, 'enable row level security'));
ok('mig no client policy', !has(mig, 'create policy'));
ok('mig revokes from public/anon/authenticated', has(mig, 'revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;'));
ok('mig grants table DML to service_role only', has(mig, 'grant select, insert, update, delete on table public.api_rate_limit_buckets to service_role;'));
// RPC hardening.
ok('mig RPC SECURITY DEFINER', has(mig, 'security definer'));
ok('mig RPC safe search_path', has(mig, 'set search_path = pg_catalog'));
ok('mig RPC no dynamic SQL', !has(mig, 'execute format') && !has(mig, 'execute (') && !has(mig, "execute '"));
ok('mig RPC input validation', (mig.match(/raise exception/g) || []).length >= 5);
ok('mig atomic first-use insert', has(mig, 'on conflict (scope, subject_type, subject_key) do nothing'));
ok('mig locks bucket FOR UPDATE', has(mig, 'for update'));
ok('mig window reset via make_interval', has(mig, 'make_interval'));
ok('mig RPC execute revoked from public', has(mig, 'revoke all on function public.consume_api_rate_limit(text, text, text, integer, integer) from public'));
ok('mig RPC execute revoked from anon', has(mig, 'revoke all on function public.consume_api_rate_limit(text, text, text, integer, integer) from anon'));
ok('mig RPC execute revoked from authenticated', has(mig, 'revoke all on function public.consume_api_rate_limit(text, text, text, integer, integer) from authenticated'));
ok('mig RPC execute granted to service_role', has(mig, 'grant execute on function public.consume_api_rate_limit(text, text, text, integer, integer) to service_role;'));
// Denied branch must NOT reset/extend the window (only updated_at moves).
const denyIdx = mig.indexOf('denied:');
const denySlice = denyIdx === -1 ? '' : mig.slice(denyIdx, mig.indexOf(';', denyIdx) + 1);
ok('mig deny branch touches only updated_at',
  denySlice.includes('set updated_at = v_now') && !denySlice.includes('window_started_at') && !denySlice.includes('request_count ='));

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);
