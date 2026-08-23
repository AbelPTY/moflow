import crypto from 'node:crypto';

// Durable rate-limit server helper (P0 Phase C1). Reusable by the authenticated
// Gemini/upload endpoints in Phase C2. Backed by the atomic Postgres RPC
// public.consume_api_rate_limit (durable across serverless instances).
//
// PRIVACY / SECURITY
//   * IP is derived ONLY from server request headers -- never from body/query.
//   * The persisted IP subject key is an HMAC-SHA256 digest keyed by the
//     server-only RATE_LIMIT_IP_SALT; the raw IP is never persisted.
//   * The user subject comes ONLY from the already-verified authenticated user
//     object (requireUser); user_id is never read from body/query/headers.
//   * This module logs NOTHING (no IPs, hashes, user ids, tokens, keys, or
//     content). Callers surface only safe, generic errors.
//   * Fail closed: a missing IP salt (when IP limiting is required) is a typed
//     configuration error; an unavailable limiter (RPC/DB error, or an
//     underivable required IP) denies the request.

// Typed configuration error so callers can map it to a 500 (server
// misconfiguration) distinctly from a normal 429 rate-limit denial.
export class RateLimitConfigError extends Error {
  constructor(message = 'rate limit misconfigured') {
    super(message);
    this.name = 'RateLimitConfigError';
  }
}

// Derive the client IP from trusted proxy headers only. Returns a normalized
// string or null. Never reads request body or query parameters.
export function getClientIp(req) {
  const h = (req && req.headers) || {};
  let xff = h['x-forwarded-for'] ?? h['X-Forwarded-For'];
  if (Array.isArray(xff)) xff = xff[0];
  if (typeof xff === 'string' && xff.trim() !== '') {
    // May be "client, proxy1, proxy2" -- the first hop is the client.
    return xff.split(',')[0].trim();
  }
  let xr = h['x-real-ip'] ?? h['X-Real-IP'];
  if (Array.isArray(xr)) xr = xr[0];
  if (typeof xr === 'string' && xr.trim() !== '') return xr.trim();
  return null;
}

// Keyed HMAC-SHA256 of the IP. Returns lowercase hex, or null if either input
// is missing. The raw IP never appears in the output.
export function hashIp(ip, salt) {
  if (!ip || !salt) return null;
  return crypto.createHmac('sha256', String(salt)).update(String(ip)).digest('hex');
}

// Invoke the atomic RPC once for a single subject. Throws on RPC/DB error so the
// caller can fail closed. Never logs.
export async function consumeLimit({ supabase, scope, subjectType, subjectKey, limit, windowSeconds }) {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_scope: scope,
    p_subject_type: subjectType,
    p_subject_key: subjectKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('rate limit: empty result');
  return {
    allowed: !!row.allowed,
    remaining: Number(row.remaining) || 0,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
  };
}

// Enforce per-user and/or per-IP limits for a scope. Denies if EITHER subject is
// exhausted. Returns one of:
//   { allowed: true }
//   { allowed: false, retryAfterSeconds, subjectType }            // normal 429
//   { allowed: false, failClosed: true, retryAfterSeconds, reason } // limiter down -> deny
// Throws RateLimitConfigError for a server misconfiguration (map to 500).
export async function enforceRateLimit({
  supabase,
  scope,
  user,
  userLimit,
  userWindowSeconds,
  ipLimit,
  ipWindowSeconds,
  req,
  ipSalt,
}) {
  const checks = [];

  if (userLimit) {
    // Identity comes ONLY from the verified authenticated user object.
    const uid = user && user.id;
    if (!uid) throw new RateLimitConfigError('missing authenticated user for rate limit');
    checks.push({
      subjectType: 'user',
      subjectKey: String(uid),
      limit: userLimit,
      windowSeconds: userWindowSeconds,
    });
  }

  if (ipLimit) {
    const salt = ipSalt !== undefined ? ipSalt : process.env.RATE_LIMIT_IP_SALT;
    if (!salt) throw new RateLimitConfigError('missing RATE_LIMIT_IP_SALT');
    const hashed = hashIp(getClientIp(req), salt);
    if (!hashed) {
      // IP limiting is required but the IP is not derivable -> fail closed.
      return { allowed: false, failClosed: true, retryAfterSeconds: ipWindowSeconds || 0, reason: 'ip_unavailable' };
    }
    checks.push({
      subjectType: 'ip',
      subjectKey: hashed,
      limit: ipLimit,
      windowSeconds: ipWindowSeconds,
    });
  }

  for (const c of checks) {
    let res;
    try {
      res = await consumeLimit({ supabase, scope, ...c });
    } catch {
      // RPC/DB unavailable -> deny (expensive work must not proceed).
      return { allowed: false, failClosed: true, retryAfterSeconds: c.windowSeconds || 0, reason: 'limiter_unavailable' };
    }
    if (!res.allowed) {
      return { allowed: false, retryAfterSeconds: res.retryAfterSeconds, subjectType: c.subjectType };
    }
  }

  return { allowed: true };
}
