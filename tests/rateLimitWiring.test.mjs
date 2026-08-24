// Synthetic tests for Phase C2: rate-limit policy + endpoint wiring.
//
// FICTIONAL values only. No Supabase/Gemini/Telegram/Vercel network, no real
// user ids, ips, or secrets. Behavioral tests drive applyRateLimit with a mock
// req/res and a mock supabase; static tests assert every endpoint wires the
// durable limiter after auth and before expensive work, with the right scope.
//
// Run from repo root:
//   node tests/rateLimitWiring.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyRateLimit, RATE_LIMIT_POLICIES } from '../api/rateLimit.js';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}
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
const reqWith = (headers = {}, extra = {}) => ({ headers, ...extra });

// ---------------------------------------------------------------------------
// 1. Centralized policy matrix
// ---------------------------------------------------------------------------
ok('policy object exists', RATE_LIMIT_POLICIES && typeof RATE_LIMIT_POLICIES === 'object');
ok('policy is frozen', Object.isFrozen(RATE_LIMIT_POLICIES));
ok('policy.gemini_text frozen', Object.isFrozen(RATE_LIMIT_POLICIES.gemini_text));
const P = RATE_LIMIT_POLICIES;
ok('gemini_text user 30/600', P.gemini_text.user.limit === 30 && P.gemini_text.user.windowSeconds === 600);
ok('gemini_text ip 120/600', P.gemini_text.ip.limit === 120 && P.gemini_text.ip.windowSeconds === 600);
ok('gemini_vision user 12/600', P.gemini_vision.user.limit === 12 && P.gemini_vision.user.windowSeconds === 600);
ok('gemini_vision ip 48/600', P.gemini_vision.ip.limit === 48 && P.gemini_vision.ip.windowSeconds === 600);
ok('gemini_pdf user 6/600', P.gemini_pdf.user.limit === 6 && P.gemini_pdf.user.windowSeconds === 600);
ok('gemini_pdf ip 24/600', P.gemini_pdf.ip.limit === 24 && P.gemini_pdf.ip.windowSeconds === 600);
ok('local_pdf user 12/600', P.local_pdf.user.limit === 12 && P.local_pdf.user.windowSeconds === 600);
ok('local_pdf ip 48/600', P.local_pdf.ip.limit === 48 && P.local_pdf.ip.windowSeconds === 600);

// ---------------------------------------------------------------------------
// 2. applyRateLimit response mapping
// ---------------------------------------------------------------------------
// 2a. Allowed -> true, no response written.
{
  const res = mockRes();
  const sb = mockSupabase([allowRow(), allowRow()]);
  const proceed = await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }), res, user: { id: 'u1' },
    scope: 'gemini_text', supabase: sb, ipSalt: 'synthetic-salt',
  });
  ok('allowed -> proceed true', proceed === true && res.statusCode === null);
}
// 2b. Identity is the authenticated user, not body/query.
{
  const res = mockRes();
  const sb = mockSupabase([allowRow(), allowRow()]);
  await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }, { body: { user_id: 'attacker' }, query: { user_id: 'attacker' } }),
    res, user: { id: 'auth-user-1' }, scope: 'gemini_text', supabase: sb, ipSalt: 'synthetic-salt',
  });
  const userCall = sb.calls.find((c) => c.params.p_subject_type === 'user');
  ok('subject key is authenticated user.id', userCall.params.p_subject_key === 'auth-user-1');
  ok('body/query user_id ignored', sb.calls.every((c) => c.params.p_subject_key !== 'attacker'));
}
// 2c. User-limit exhausted -> 429 with Retry-After, masked subject.
{
  const res = mockRes();
  const sb = mockSupabase([denyRow(45)]);
  const proceed = await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }), res, user: { id: 'u1' },
    scope: 'gemini_text', supabase: sb, ipSalt: 'synthetic-salt',
  });
  ok('user-limit -> 429', proceed === false && res.statusCode === 429);
  ok('429 body shape', res.body.error === 'Too many requests' && res.body.retry_after_seconds === 45);
  ok('429 sets Retry-After header', res.headers['Retry-After'] === '45');
  ok('429 does not reveal subject', JSON.stringify(res.body).indexOf('user') === -1 && JSON.stringify(res.body).indexOf('"ip"') === -1 && !('subjectType' in res.body));
}
// 2d. IP-limit exhausted -> 429 (user allowed first).
{
  const res = mockRes();
  const sb = mockSupabase([allowRow(), denyRow(20)]);
  const proceed = await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }), res, user: { id: 'u1' },
    scope: 'gemini_vision', supabase: sb, ipSalt: 'synthetic-salt',
  });
  ok('ip-limit -> 429', proceed === false && res.statusCode === 429 && res.body.retry_after_seconds === 20);
  ok('ip-limit 429 masks subject', !('subjectType' in res.body));
}
// 2e. Missing salt -> 500 config error, no proceed.
{
  const res = mockRes();
  const proceed = await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }), res, user: { id: 'u1' },
    scope: 'gemini_text', supabase: mockSupabase([allowRow()]), ipSalt: '',
  });
  ok('missing salt -> 500', proceed === false && res.statusCode === 500 && res.body.error === 'Server configuration error');
}
// 2f. Unknown scope -> 500 config error.
{
  const res = mockRes();
  const proceed = await applyRateLimit({
    req: reqWith({}), res, user: { id: 'u1' }, scope: 'nonexistent', supabase: mockSupabase([allowRow()]), ipSalt: 's',
  });
  ok('unknown scope -> 500', proceed === false && res.statusCode === 500);
}
// 2g. RPC/DB failure -> 503, no proceed.
{
  const res = mockRes();
  const sb = mockSupabase([{ throw: true }]);
  const proceed = await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }), res, user: { id: 'u1' },
    scope: 'gemini_text', supabase: sb, ipSalt: 'synthetic-salt',
  });
  ok('db failure -> 503', proceed === false && res.statusCode === 503 && res.body.error === 'Service temporarily unavailable');
}
// 2h. Required IP underivable -> 503, no proceed.
{
  const res = mockRes();
  const sb = mockSupabase([allowRow()]);
  const proceed = await applyRateLimit({
    req: reqWith({}), res, user: { id: 'u1' },
    scope: 'gemini_text', supabase: sb, ipSalt: 'synthetic-salt',
  });
  ok('underivable ip -> 503', proceed === false && res.statusCode === 503);
}
// 2i. Shared scope: exhausting via one call denies the sibling too (same bucket
// key). The bucket is keyed by (scope, subject) in the RPC, so two vision
// endpoints sharing 'gemini_vision' consume the SAME user bucket.
{
  const resA = mockRes();
  const sbShared = mockSupabase([denyRow(30)]); // simulate already-exhausted user bucket
  const proceed = await applyRateLimit({
    req: reqWith({ 'x-forwarded-for': '203.0.113.7' }), res: resA, user: { id: 'u1' },
    scope: 'gemini_vision', supabase: sbShared, ipSalt: 'synthetic-salt',
  });
  ok('shared-scope sibling is denied', proceed === false && resA.statusCode === 429);
  ok('shared-scope uses scope as bucket key', sbShared.calls[0].params.p_scope === 'gemini_vision');
}

// ---------------------------------------------------------------------------
// 3. Endpoint wiring (static)
// ---------------------------------------------------------------------------
const endpoints = [
  { file: 'api/identifyColumns.js', scope: 'gemini_text', expensive: 'new GoogleGenerativeAI' },
  { file: 'api/parseStatement.js', scope: 'gemini_text', expensive: 'new GoogleGenerativeAI' },
  { file: 'api/voiceToTasks.js', scope: 'gemini_text', expensive: 'new GoogleGenerativeAI' },
  { file: 'api/scanCardStatement.js', scope: 'gemini_vision', expensive: 'new GoogleGenerativeAI' },
  { file: 'api/scanReceipt.js', scope: 'gemini_vision', expensive: 'new GoogleGenerativeAI' },
  { file: 'api/parsePdfStatement.js', scope: 'gemini_pdf', expensive: 'formidable({' },
  { file: 'api/parseUNFCUStatement.js', scope: 'local_pdf', expensive: 'formidable({' },
];

for (const ep of endpoints) {
  const s = read(ep.file);
  const iImport = s.indexOf("from './rateLimit.js'");
  const iAuth = s.indexOf('requireUser(req, res)');
  const iRL = s.indexOf('applyRateLimit({');
  const iExp = s.indexOf(ep.expensive);
  const name = ep.file.replace('api/', '');
  ok(`${name} imports limiter`, iImport !== -1 && s.includes('applyRateLimit'));
  ok(`${name} uses scope ${ep.scope}`, s.includes(`scope: '${ep.scope}'`));
  ok(`${name} rate-limits with verified user`, s.includes("applyRateLimit({ req, res, user, scope:"));
  ok(`${name} auth before rate limit`, iAuth !== -1 && iRL !== -1 && iAuth < iRL);
  ok(`${name} rate limit before expensive work`, iRL !== -1 && iExp !== -1 && iRL < iExp);
  ok(`${name} keeps method guard`, s.includes("!== 'POST'"));
  ok(`${name} keeps requireUser guard`, s.includes('const user = await requireUser(req, res)'));
  // Limiter args do not read caller-supplied identity.
  const call = s.slice(iRL, iRL + 80);
  ok(`${name} limiter args carry no body/query identity`, !call.includes('req.body') && !call.includes('req.query') && !call.includes('user_id'));
}

// ---------------------------------------------------------------------------
// 4. Regression: Telegram/reminder untouched; no browser rate-limit endpoint.
// ---------------------------------------------------------------------------
for (const f of ['api/telegramWebhook.js', 'api/telegramLink.js', 'api/sendPaymentReminders.js']) {
  ok(`${f.replace('api/', '')} not wired to limiter`, !read(f).includes('applyRateLimit') && !read(f).includes("from './rateLimit.js'"));
}
ok('rateLimit.js has no HTTP handler (not browser-accessible)', !read('api/rateLimit.js').includes('export default'));

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);
