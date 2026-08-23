import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Verified Telegram webhook (Phase A2.3).
//
// Machine-authenticated by Telegram's webhook secret header (NOT a browser
// JWT). It accepts only private-chat "/start <token>" deep-link redemptions,
// hashes the presented raw token, and calls the atomic RPC
// consume_telegram_link_token(...), which is the ONLY binding path. Telegram
// identity is taken exclusively from the verified update; no browser/query
// value is ever trusted. The endpoint never logs tokens, hashes, identities, or
// secrets, and returns 200 for all handled/ignored application states so
// Telegram does not storm retries.

const RPC_NAME = 'consume_telegram_link_token';

// Neutral, non-disclosing replies per RPC status.
const STATUS_MESSAGES = {
  linked: 'Telegram is connected to MoFlow.',
  expired: 'This connection link has expired. Create a new one in MoFlow.',
  used: 'This connection link has already been used. Create a new one if needed.',
  already_linked: 'Your MoFlow account is already connected to Telegram.',
  telegram_identity_taken: 'This Telegram account is already connected.',
  not_found: 'This connection link is invalid or expired.',
  invalid_input: 'This connection link is invalid or expired.',
};

// Constant-time string compare. Both inputs are SHA-256'd first so the compared
// buffers are always the same fixed size (32 bytes) -- there is no branch on
// input length, and equal-length digests keep timingSafeEqual leak-free.
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

// Parse a Telegram "/start" deep-link command. Returns the single payload token
// or null. Accepts "/start <token>" and "/start@BotName <token>". Rejects any
// form with zero or more-than-one payload piece.
export function parseStartToken(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) return null; // command + exactly one payload
  const [command, payload] = parts;
  if (!/^\/start(@[A-Za-z0-9_]{1,64})?$/.test(command)) return null;
  if (!payload) return null;
  return payload;
}

// Map an RPC status to a user-facing message (falls back to the invalid text).
export function statusToMessage(status) {
  return STATUS_MESSAGES[status] || STATUS_MESSAGES.invalid_input;
}

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

// Best-effort Telegram reply. Never throws; failures are logged with a safe
// label only and never affect the binding result.
async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    // fetch does not throw on 4xx/5xx -- detect and log with a safe label only.
    if (!response.ok) {
      console.error('telegramWebhook sendMessage failed', 'http');
    }
  } catch {
    console.error('telegramWebhook sendMessage failed', 'network');
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Webhook secret auth (BEFORE touching the update body) ---
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret =
    req.headers?.['x-telegram-bot-api-secret-token'] ||
    req.headers?.['X-Telegram-Bot-Api-Secret-Token'] ||
    '';
  if (!expectedSecret || !providedSecret ||
      !timingSafeEqualStr(String(providedSecret), String(expectedSecret))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // From here on: authenticated Telegram request. Prefer 200 for handled/
  // ignored application states; reserve 500 for unexpected infra failures.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const message = body.message;

  // Only handle plain messages with the fields we need; ignore edits,
  // callbacks, joins, channel posts, etc.
  if (
    !message ||
    typeof message !== 'object' ||
    typeof message.text !== 'string' ||
    !message.from ||
    message.from.id === undefined ||
    message.from.id === null ||
    !message.chat ||
    message.chat.id === undefined ||
    message.chat.id === null
  ) {
    return res.status(200).json({ ok: true });
  }

  // Private-chat only: never let a group/supergroup/channel become a reminder
  // destination.
  if (message.chat.type !== 'private') {
    await sendTelegramMessage(
      message.chat.id,
      'Please open a private chat with the bot to connect MoFlow.'
    );
    return res.status(200).json({ ok: true });
  }

  const token = parseStartToken(message.text);
  if (!token) {
    // Not a valid deep-link start payload; nothing to do.
    return res.status(200).json({ ok: true });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    // Infrastructure misconfiguration -- worth a retry.
    console.error('telegramWebhook unexpected failure', 'not-configured');
    return res.status(500).json({ error: 'Server error' });
  }

  // Bot token is required to confirm the bind to the user. Do NOT bind if the
  // server is deterministically missing required bot configuration.
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('telegramWebhook unexpected failure', 'not-configured');
    return res.status(500).json({ error: 'Server error' });
  }

  // Hash the presented token; only the hash ever leaves this function.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const telegramUserId = String(message.from.id);
  const telegramChatId = String(message.chat.id);

  let status;
  try {
    const { data, error } = await supabase.rpc(RPC_NAME, {
      p_token_hash: tokenHash,
      p_telegram_user_id: telegramUserId,
      p_telegram_chat_id: telegramChatId,
    });
    if (error) throw error;
    status = typeof data === 'string' ? data : (data && data[0]);
  } catch (err) {
    console.error('telegramWebhook RPC failed', err?.code || err?.name || 'error');
    return res.status(500).json({ error: 'Server error' });
  }

  // Deterministic application status -> neutral reply, always 200.
  await sendTelegramMessage(telegramChatId, statusToMessage(status));
  return res.status(200).json({ ok: true });
}
