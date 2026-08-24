// Synthetic tests for Phase D2 (revised): server-enforced signup with a
// single-use approval token; the reusable invite never reaches Supabase.
//
// No network, no live Supabase, no Vercel. Behavioral tests drive the injectable
// handleSignup core and applyRateLimit with mocks; static tests assert source
// invariants (comments stripped to avoid false positives).
//
// ARCHITECTURE: reusable SIGNUP_INVITE_CODE is validated ONLY in api/signup.js.
// On success the server mints a random single-use approval token, stores only
// its SHA-256 hash, and forwards ONLY that token to the normal email-verify
// signUp. The "Before User Created" hook atomically consumes the token. No
// admin.createUser; email confirmation preserved.
//
// Run from repo root:
//   node tests/signupSecurity.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  handleSignup, timingSafeEqualStr, validateSignupInput,
  generateApprovalToken, hashToken,
} from '../api/signup.js';
import { applyRateLimit, RATE_LIMIT_POLICIES, hashIp } from '../api/rateLimit.js';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const blankStrings = (s) => s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}
function mockSupabase(results) {
  const calls = []; let i = 0;
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
const allowRow = () => ({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }] });
const denyRow = (retry = 3600) => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: retry }] });

const INVITE = 'synthetic-reusable-invite';
const APPROVAL = 'synthetic-approval-token';
function recorder(opts = {}) {
  const { enforceResult = true, issueApproval, signUp, revokeApproval } = opts;
  const inviteCode = Object.prototype.hasOwnProperty.call(opts, 'inviteCode') ? opts.inviteCode : INVITE;
  const state = { order: [], signUpArgs: null, revoked: [], issued: 0 };
  const deps = {
    applyRateLimit: async () => { state.order.push('ratelimit'); return enforceResult; },
    inviteCode,
    issueApproval: issueApproval || (async () => { state.order.push('issue'); state.issued++; return { token: APPROVAL }; }),
    signUp: signUp || (async (args) => { state.order.push('signup'); state.signUpArgs = args; return {}; }),
    revokeApproval: revokeApproval || (async (t) => { state.revoked.push(t); }),
  };
  return { state, deps };
}
const req = (method, body) => ({ method, body, headers: { 'x-forwarded-for': '203.0.113.7' } });
const goodBody = (over = {}) => ({ email: 'a@b.co', password: 'longenough', invite_code: INVITE, ...over });

// ---------------------------------------------------------------------------
// 1. helpers
// ---------------------------------------------------------------------------
ok('invite compare equal', timingSafeEqualStr(INVITE, INVITE) === true);
ok('invite compare wrong', timingSafeEqualStr('nope', INVITE) === false);
ok('invite compare non-string', timingSafeEqualStr(null, INVITE) === false);
ok('validate rejects short pw', validateSignupInput({ email: 'a@b.co', password: '123' }).ok === false);
ok('validate rejects bad email', validateSignupInput({ email: 'nope', password: 'longenough' }).ok === false);
ok('validate accepts ok', validateSignupInput({ email: 'a@b.co', password: 'longenough' }).ok === true);
{
  const t1 = generateApprovalToken();
  const t2 = generateApprovalToken();
  ok('approval token is base64url', /^[A-Za-z0-9_-]+$/.test(t1.raw) && t1.raw.length >= 40);
  ok('approval token random (differs)', t1.raw !== t2.raw);
  ok('approval hash is sha256 hex', /^[0-9a-f]{64}$/.test(t1.hash));
  ok('approval hash matches hashToken', t1.hash === hashToken(t1.raw));
  ok('approval hash != raw token', t1.hash !== t1.raw);
}

// ---------------------------------------------------------------------------
// 2. handleSignup behavior + ordering
// ---------------------------------------------------------------------------
{ const res = mockRes(); const { deps } = recorder(); await handleSignup(req('GET'), res, deps);
  ok('GET -> 405', res.statusCode === 405); }

{ const res = mockRes(); const { state, deps } = recorder({ enforceResult: false });
  await handleSignup(req('POST', goodBody()), res, deps);
  ok('rate-limit denial short-circuits (no issue/signup)', JSON.stringify(state.order) === JSON.stringify(['ratelimit'])); }

{ const res = mockRes(); const { state, deps } = recorder({ inviteCode: undefined });
  await handleSignup(req('POST', goodBody()), res, deps);
  ok('missing invite config -> 500, no issue', res.statusCode === 500 && state.issued === 0); }

{ const res = mockRes(); const { state, deps } = recorder();
  await handleSignup(req('POST', goodBody({ email: 'bad', password: '1' })), res, deps);
  ok('invalid input -> 400, no issue/signup', res.statusCode === 400 && state.issued === 0 && state.signUpArgs === null); }

{ const res = mockRes(); const { state, deps } = recorder();
  await handleSignup(req('POST', goodBody({ invite_code: 'wrong' })), res, deps);
  ok('wrong reusable invite -> 403, no token minted', res.statusCode === 403 && state.issued === 0 && state.signUpArgs === null); }

{ const res = mockRes(); const { state, deps } = recorder();
  await handleSignup(req('POST', goodBody()), res, deps);
  ok('correct invite -> 200 ok', res.statusCode === 200 && res.body.ok === true);
  ok('order rate-limit -> issue -> signup', JSON.stringify(state.order) === JSON.stringify(['ratelimit', 'issue', 'signup']));
  ok('signUp receives approvalToken (one-time), not the invite', state.signUpArgs.approvalToken === APPROVAL && state.signUpArgs.invite === undefined && state.signUpArgs.invite_code === undefined);
  ok('signUp args exactly email/password/approvalToken', JSON.stringify(Object.keys(state.signUpArgs).sort()) === JSON.stringify(['approvalToken', 'email', 'password']));
  ok('reusable invite value never reaches signUp', !JSON.stringify(state.signUpArgs).includes(INVITE));
  ok('approval token not returned to browser', !JSON.stringify(res.body).includes(APPROVAL) && res.body.token === undefined); }

// no caller-controlled identity forwarded
{ const res = mockRes(); const { state, deps } = recorder();
  await handleSignup(req('POST', goodBody({ user_id: 'attacker', role: 'service_role', app_metadata: { admin: true } })), res, deps);
  ok('no caller user_id/role/app_metadata forwarded', state.signUpArgs.user_id === undefined && state.signUpArgs.role === undefined && state.signUpArgs.app_metadata === undefined); }

// issue failure -> 503, no signUp
{ const res = mockRes(); const { state, deps } = recorder({ issueApproval: async () => { throw new Error('db down'); } });
  await handleSignup(req('POST', goodBody()), res, deps);
  ok('issue failure -> 503, no signUp', res.statusCode === 503 && state.signUpArgs === null); }

// provider error -> revoke token, neutral 200, no leak
{ const res = mockRes(); const { state, deps } = recorder({ signUp: async () => ({ error: { message: 'User already registered SECRET' } }) });
  await handleSignup(req('POST', goodBody()), res, deps);
  ok('provider error -> neutral 200', res.statusCode === 200 && res.body.ok === true);
  ok('provider error revokes unused token', state.revoked.length === 1 && state.revoked[0] === APPROVAL);
  ok('provider error text not leaked', !JSON.stringify(res.body).includes('SECRET')); }

// infra throw -> revoke + generic 503
{ const res = mockRes(); const { state, deps } = recorder({ signUp: async () => { throw new Error('boom SECRET'); } });
  await handleSignup(req('POST', goodBody()), res, deps);
  ok('infra throw -> 503', res.statusCode === 503 && !JSON.stringify(res.body).includes('SECRET'));
  ok('infra throw revokes token', state.revoked[0] === APPROVAL); }

// ---------------------------------------------------------------------------
// 3. signup rate-limit policy (IP-only) + applyRateLimit for signup scope
// ---------------------------------------------------------------------------
ok('signup policy exists', !!RATE_LIMIT_POLICIES.signup);
ok('signup policy IP 10/3600', RATE_LIMIT_POLICIES.signup.ip.limit === 10 && RATE_LIMIT_POLICIES.signup.ip.windowSeconds === 3600);
ok('signup policy has no user tier', RATE_LIMIT_POLICIES.signup.user === undefined);
ok('gemini_text unchanged', RATE_LIMIT_POLICIES.gemini_text.user.limit === 30 && RATE_LIMIT_POLICIES.gemini_text.ip.limit === 120);
{ const res = mockRes(); const sb = mockSupabase([allowRow()]);
  const proceed = await applyRateLimit({ req: req('POST', {}), res, user: null, scope: 'signup', supabase: sb, ipSalt: 'salt' });
  ok('signup limiter allows with no user (IP-only)', proceed === true && sb.calls.length === 1 && sb.calls[0].params.p_subject_type === 'ip');
  ok('signup ip key hashed (raw ip not persisted)', sb.calls[0].params.p_subject_key === hashIp('203.0.113.7', 'salt') && sb.calls[0].params.p_subject_key !== '203.0.113.7'); }
{ const res = mockRes(); const sb = mockSupabase([denyRow(3600)]);
  const proceed = await applyRateLimit({ req: req('POST', {}), res, user: null, scope: 'signup', supabase: sb, ipSalt: 'salt' });
  ok('signup over-limit -> 429 + Retry-After', proceed === false && res.statusCode === 429 && res.body.retry_after_seconds === 3600 && res.headers['Retry-After'] === '3600'); }
{ const r1 = mockRes(); await applyRateLimit({ req: req('POST', {}), res: r1, user: null, scope: 'signup', supabase: mockSupabase([allowRow()]), ipSalt: '' });
  ok('signup missing salt -> 500', r1.statusCode === 500);
  const r2 = mockRes(); await applyRateLimit({ req: { method: 'POST', headers: {} }, res: r2, user: null, scope: 'signup', supabase: mockSupabase([allowRow()]), ipSalt: 'salt' });
  ok('signup underivable ip -> 503', r2.statusCode === 503);
  const r3 = mockRes(); await applyRateLimit({ req: req('POST', {}), res: r3, user: null, scope: 'signup', supabase: mockSupabase([{ throw: true }]), ipSalt: 'salt' });
  ok('signup db failure -> 503', r3.statusCode === 503); }

// ---------------------------------------------------------------------------
// 4. api/signup.js static invariants (comments stripped)
// ---------------------------------------------------------------------------
const signupSrc = read('api/signup.js');
const code = stripComments(signupSrc);
ok('never uses VITE_SIGNUP_INVITE_CODE', !code.includes('VITE_SIGNUP_INVITE_CODE'));
ok('reads SIGNUP_INVITE_CODE env', code.includes('SIGNUP_INVITE_CODE'));
ok('timing-safe compare present', code.includes('timingSafeEqual'));
ok('rate-limits with signup scope', code.includes("scope: 'signup'"));
ok('preserves email-verify signUp (no admin.createUser)', code.includes('auth.signUp') && !code.includes('admin.createUser') && !code.includes('email_confirm'));
ok('forwards only signup_approval_token to metadata', code.includes('signup_approval_token') && code.includes('data: { signup_approval_token'));
ok('reusable invite NOT put in options.data', !code.includes('data: { invite') && !code.includes('invite_code: invite'));
ok('issueApproval takes no invite argument', code.includes('async function issueApproval()'));
ok('stores only token hash + expiry', code.includes('token_hash: hash') && code.includes('expires_at'));
ok('short approval TTL', code.includes('APPROVAL_TTL_SECONDS = 180'));
ok('never reads caller user_id/app_metadata/role', !code.includes('body.user_id') && !code.includes('app_metadata') && !code.includes('body.role'));
ok('no response returns a token', !/\.json\([^)]*token/i.test(code) && !/\.json\([^)]*approval/i.test(code));
// console hygiene
const consoleArgs = (() => {
  const out = []; const re = /console\.[a-z]+\s*\(/g; let m;
  while ((m = re.exec(code))) {
    const open = re.lastIndex - 1; let d = 0, end = -1;
    for (let i = open; i < code.length; i++) { if (code[i] === '(') d++; else if (code[i] === ')') { d--; if (d === 0) { end = i; break; } } }
    if (end !== -1) out.push(blankStrings(code.slice(open + 1, end)).toLowerCase());
  }
  return out;
})();
ok('logs no email/password/invite/token/hash/body/ip', consoleArgs.every((a) => !['email', 'password', 'invite', 'token', 'hash', 'req.body', 'body.', 'ip'].some((t) => a.includes(t))));
ok('logs no raw error object', consoleArgs.every((a) => { const x = a.replace(/safeerror\([^)]*\)/g, ''); return !/\b(error|err|e)\b/.test(x); }));

// ---------------------------------------------------------------------------
// 5. Auth Hook migration — one-time token consume, no reusable invite hash
// ---------------------------------------------------------------------------
const hookRaw = read('supabase/migrations/20260823040000_signup_invite_hook.sql');
// Strip SQL line comments (--) so comment prose can't create false positives.
const hook = hookRaw.replace(/--[^\n]*/g, ' ').toLowerCase();
ok('approval token table present', hook.includes('create table public.signup_approval_tokens'));
ok('token_hash unique + hex check', /token_hash\s+text\s+not\s+null\s+unique/i.test(hook) && /token_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(hook));
ok('hook reads exact Supabase user_metadata approval path', hook.includes("event #>> '{user,user_metadata,signup_approval_token}'"));
ok('no reusable-invite hash storage remains', !hook.includes('signup_invite_config') && !hook.includes('code_hash'));
ok('hook hashes the token with pg_catalog sha256', hook.includes("sha256(convert_to(v_token, 'utf8'))"));
ok('hook consumes atomically (delete ... returning)', hook.includes('delete from public.signup_approval_tokens') && hook.includes('returning'));
ok('hook checks expiry', hook.includes('expires_at > now()'));
ok('hook rejects when none consumed (403)', hook.includes('v_id is null') && hook.includes('403'));
ok('hook security invoker', hook.includes('security invoker') && !hook.includes('security definer'));
ok('hook pg_catalog-only search_path', hook.includes('set search_path = pg_catalog'));
ok('hook auth admin table grant is select+delete only', hook.includes('grant select, delete on table public.signup_approval_tokens to supabase_auth_admin'));
ok('hook auth admin select RLS policy', hook.includes('for select') && hook.includes('to supabase_auth_admin'));
ok('hook auth admin delete RLS policy', hook.includes('for delete') && hook.includes('to supabase_auth_admin'));
ok('hook grants schema usage to supabase_auth_admin', hook.includes('grant usage on schema public to supabase_auth_admin'));
ok('hook granted to supabase_auth_admin only', hook.includes('grant execute on function public.before_user_created_signup_guard(jsonb) to supabase_auth_admin'));
ok('hook execute revoked from anon/authenticated', hook.includes('from anon') && hook.includes('from authenticated'));
ok('token table service_role DML only', hook.includes('grant select, insert, update, delete on table public.signup_approval_tokens to service_role'));
ok('token table RLS + no client policy', hook.includes('enable row level security') && !/create\s+policy[\s\S]*to\s+(anon|authenticated)/i.test(hook));

// ---------------------------------------------------------------------------
// 6. Frontend static invariants
// ---------------------------------------------------------------------------
const login = read('src/components/auth/LoginScreen.jsx');
const loginCode = stripComments(login);
ok('LoginScreen drops VITE_SIGNUP_INVITE_CODE', !loginCode.includes('VITE_SIGNUP_INVITE_CODE'));
ok('LoginScreen posts to /api/signup', loginCode.includes("fetch('/api/signup'") || loginCode.includes('fetch("/api/signup"'));
ok('LoginScreen sends invite_code to server', loginCode.includes('invite_code'));
ok('LoginScreen no direct signUp for registration', !loginCode.includes('signUp('));
ok('invite not persisted in storage', !loginCode.includes('localStorage') && !loginCode.includes('sessionStorage'));
ok('invite cleared from state after submit', loginCode.includes("setInvite('')"));
const auth = stripComments(read('src/contexts/AuthContext.jsx'));
ok('AuthContext removes direct signUp path', !auth.includes('auth.signUp'));
ok('AuthContext keeps sign-in', auth.includes('signInWithPassword'));

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);

