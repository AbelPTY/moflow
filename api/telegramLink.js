import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../server/auth.js';

// Authenticated Telegram linking endpoint (Phase A2.2).
//
//   GET    -> the caller's own Telegram connection status (safe fields only)
//   POST   -> create/rotate a one-time link token; returns a t.me deep link
//   DELETE -> disconnect (hard-delete token first, then integration)
//
// Identity ALWAYS comes from the verified Supabase JWT (requireUser). The
// browser never supplies user_id or any Telegram identifier -- those are set
// only by the verified webhook (a later phase) via service-role. This endpoint
// never returns Telegram identity values, never logs tokens/secrets, and never
// exposes the service-role key.

const TOKEN_TTL_MINUTES = 10;

// Conservative Telegram username shape: letters, digits, underscore only.
const BOT_USERNAME_RE = /^[A-Za-z0-9_]{1,64}$/;

// Body fields a client must never be allowed to assert. Presence => 400.
const FORBIDDEN_BODY_FIELDS = [
  'user_id',
  'telegram_user_id',
  'telegram_chat_id',
  'token_hash',
  'raw_token',
];

let cachedServiceClient = null;
function getServiceClient() {
  if (cachedServiceClient) return cachedServiceClient;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedServiceClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedServiceClient;
}

function bodyHasForbiddenField(body) {
  if (!body || typeof body !== 'object') return false;
  return FORBIDDEN_BODY_FIELDS.some((f) =>
    Object.prototype.hasOwnProperty.call(body, f)
  );
}

export default async function handler(req, res) {
  // Never let a link token or connection state be cached anywhere.
  res.setHeader('Cache-Control', 'no-store');

  const method = req.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return; // 401 already sent

  const supabase = getServiceClient();
  if (!supabase) {
    // Fail closed without revealing which var is missing.
    return res.status(500).json({ error: 'Server is not configured' });
  }

  if (method === 'GET') return handleGet(res, supabase, user);
  if (method === 'POST') return handlePost(req, res, supabase, user);
  return handleDelete(req, res, supabase, user);
}

// --- GET: connection status -------------------------------------------------
async function handleGet(res, supabase, user) {
  try {
    const { data, error } = await supabase
      .from('user_telegram_integrations')
      .select('active, linked_at')
      .eq('user_id', user.id) // explicit owner scope even under service role
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      connected: !!data,
      active: data ? !!data.active : false,
      linked_at: data ? data.linked_at : null,
    });
  } catch (err) {
    console.error('telegramLink GET failed', err?.code || err?.name || 'error');
    return res.status(500).json({ error: 'Failed to load Telegram status' });
  }
}

// --- POST: create/rotate a one-time link token ------------------------------
async function handlePost(req, res, supabase, user) {
  // Trust boundary: the browser must not assert any identity/token fields.
  if (bodyHasForbiddenField(req.body)) {
    return res.status(400).json({ error: 'Unexpected fields in request' });
  }

  // Validate bot configuration BEFORE writing any token row.
  const rawUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').trim();
  const botUsername = rawUsername.startsWith('@')
    ? rawUsername.slice(1)
    : rawUsername;
  if (!botUsername || !BOT_USERNAME_RE.test(botUsername)) {
    console.error('telegramLink POST failed', 'bot-config-invalid');
    return res.status(500).json({ error: 'Server is not configured' });
  }

  try {
    // Already connected? Do not issue a token; require explicit disconnect.
    const { data: existing, error: existingErr } = await supabase
      .from('user_telegram_integrations')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      return res.status(409).json({ error: 'Telegram is already connected' });
    }

    // 256-bit URL-safe token; store only its SHA-256 (lowercase hex).
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);

    // One slot per user: UPSERT on user_id. created_at is reset so the row
    // describes the CURRENT issuance (satisfies expires_at > created_at).
    const { error: upsertErr } = await supabase
      .from('user_telegram_link_tokens')
      .upsert(
        {
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt.toISOString(),
          consumed_at: null,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (upsertErr) throw upsertErr;

    // Raw token appears ONLY here, in this HTTPS JSON response. Never logged.
    return res.status(200).json({
      deep_link: `https://t.me/${botUsername}?start=${rawToken}`,
      expires_at: expiresAt.toISOString(),
      connected: false,
    });
  } catch (err) {
    console.error('telegramLink POST failed', err?.code || err?.name || 'error');
    return res.status(500).json({ error: 'Failed to create Telegram link' });
  }
}

// --- DELETE: disconnect -----------------------------------------------------
async function handleDelete(req, res, supabase, user) {
  if (bodyHasForbiddenField(req.body)) {
    return res.status(400).json({ error: 'Unexpected fields in request' });
  }

  try {
    // Token first: invalidate any pending token so a webhook redemption racing
    // this disconnect cannot recreate a binding afterwards.
    const { error: tokenErr } = await supabase
      .from('user_telegram_link_tokens')
      .delete()
      .eq('user_id', user.id);
    if (tokenErr) throw tokenErr;

    const { error: integrationErr } = await supabase
      .from('user_telegram_integrations')
      .delete()
      .eq('user_id', user.id);
    if (integrationErr) throw integrationErr;

    // Idempotent: safe whether or not anything existed.
    return res.status(200).json({ connected: false });
  } catch (err) {
    console.error('telegramLink DELETE failed', err?.code || err?.name || 'error');
    return res.status(500).json({ error: 'Failed to disconnect Telegram' });
  }
}
