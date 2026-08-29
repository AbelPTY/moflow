import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { applyRateLimit } from '../server/rateLimit.js';
import { safeError } from '../server/safeError.js';

// Server-enforced signup (P0 Phase D2, revised for single-use approval tokens).
//
// The reusable invite (SIGNUP_INVITE_CODE) is validated ONLY here and is NEVER
// forwarded to Supabase, placed in options.data, stored in any table, logged, or
// returned. After the reusable invite passes, the server mints a fresh, random,
// short-lived, SINGLE-USE approval token, persists ONLY its SHA-256 hash, and
// forwards ONLY that token to the normal email-verification signUp flow. The
// Supabase "Before User Created" hook atomically consumes the token to authorize
// creation, so a direct anon-key signUp without a server-issued token is rejected.
//
// Order: POST guard -> IP rate limit -> config check -> input validation ->
// timing-safe invite compare -> mint+persist approval token -> normal signUp.
// Never accepts caller user_id/role/metadata. Never logs email/password/invite/
// token/hash/body/IP or raw provider errors. Responses are neutral.

const APPROVAL_TTL_SECONDS = 180; // 3 minutes (short-lived, single-use)

// Constant-time compare (SHA-256 both -> fixed length, no length branch).
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const da = crypto.createHash('sha256').update(a, 'utf8').digest();
  const db = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

// SHA-256 hex of a token (lowercase). The raw token is never persisted/logged.
export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

// 256-bit URL-safe one-time approval token + its stored hash.
export function generateApprovalToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function validateSignupInput({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string') return { ok: false };
  const e = email.trim();
  if (e.length < 3 || e.length > 320 || !e.includes('@')) return { ok: false };
  if (password.length < 6 || password.length > 512) return { ok: false };
  return { ok: true };
}

// Testable core with injected dependencies (no network in tests).
//   deps.applyRateLimit({ req, res, user, scope }) -> boolean
//   deps.inviteCode: string | undefined (reusable server invite)
//   deps.issueApproval() -> { token } (persists ONLY the hash; returns raw token)
//   deps.signUp({ email, password, approvalToken }) -> { error? }
//   deps.revokeApproval(rawToken) -> void (best-effort; may reject)
export async function handleSignup(req, res, deps) {
  const { applyRateLimit: enforce, inviteCode, issueApproval, signUp, revokeApproval } = deps;

  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Rate limit FIRST (IP-only).
  const allowed = await enforce({ req, res, user: null, scope: 'signup' });
  if (!allowed) return;

  // 2. Fail closed if the reusable invite is not configured.
  if (!inviteCode) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // 3. Defensive input validation (only these three fields are ever read).
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const invite = typeof body.invite_code === 'string' ? body.invite_code.trim() : '';
  if (!validateSignupInput({ email, password }).ok) {
    return res.status(400).json({ error: 'Invalid signup request' });
  }

  // 4. Reusable invite check (timing-safe). Neutral response. The invite goes
  //    no further than this comparison.
  if (!invite || !timingSafeEqualStr(invite, inviteCode)) {
    return res.status(403).json({ error: 'Signup not allowed' });
  }

  // 5. Mint + persist a single-use approval token (only its hash is stored).
  let approval;
  try {
    approval = await issueApproval();
  } catch (err) {
    console.error('signup failed', safeError(err));
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  // 6. Normal email-verification signUp; forward ONLY the one-time token.
  try {
    const result = await signUp({ email, password, approvalToken: approval.token });
    if (result && result.error) {
      // Account not created -> the token was not consumed by the hook; revoke it.
      try { await revokeApproval(approval.token); } catch { /* best effort */ }
      return res.status(200).json({ ok: true }); // neutral (anti-enumeration)
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    try { await revokeApproval(approval.token); } catch { /* best effort */ }
    console.error('signup failed', safeError(err));
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
}

// --- Production wiring -------------------------------------------------------
function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function issueApproval() {
  const supabase = serviceClient();
  if (!supabase) throw new Error('signup approval store not configured');
  const { raw, hash } = generateApprovalToken();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_SECONDS * 1000).toISOString();
  // Best-effort bounded cleanup of expired rows (no permanent audit growth).
  try { await supabase.from('signup_approval_tokens').delete().lt('expires_at', new Date().toISOString()); } catch { /* best effort */ }
  const { error } = await supabase
    .from('signup_approval_tokens')
    .insert({ token_hash: hash, expires_at: expiresAt });
  if (error) throw error;
  return { token: raw };
}

async function revokeApproval(rawToken) {
  const supabase = serviceClient();
  if (!supabase) return;
  await supabase.from('signup_approval_tokens').delete().eq('token_hash', hashToken(rawToken));
}

async function realSignUp({ email, password, approvalToken }) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('signup client not configured');
  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Only the one-time approval token is forwarded -- never the reusable invite.
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { signup_approval_token: approvalToken } },
  });
}

export default function handler(req, res) {
  return handleSignup(req, res, {
    applyRateLimit,
    inviteCode: process.env.SIGNUP_INVITE_CODE,
    issueApproval,
    signUp: realSignUp,
    revokeApproval,
  });
}
