// Server-only safe error classifier (P0 Phase D1).
//
// Reduces an unknown thrown value to a bounded, non-sensitive { name, code }
// suitable for logs. It NEVER exposes error.message, stack, cause, or any nested
// provider/DB payload, and never spreads or JSON.stringifies the error. Only the
// error's own `name` and `code`, each sanitized to a short primitive matching a
// strict character set, are returned; anything uncertain becomes a generic
// fallback. This module logs nothing itself.

const SAFE_CHARS = /^[A-Za-z0-9_.-]+$/;
const MAX_LEN = 64;

// Accept only a short primitive string/number of safe characters; otherwise
// return undefined. This is what keeps user content, messages, or long provider
// blobs from ever leaking through `name`/`code`.
function sanitize(value) {
  let v = value;
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t === '' || t.length > MAX_LEN || !SAFE_CHARS.test(t)) return undefined;
  return t;
}

// Returns { name, code } with only sanitized primitives. `code` may be undefined.
export function safeError(err) {
  if (!err || typeof err !== 'object') {
    return { name: 'Error', code: undefined };
  }
  return {
    name: sanitize(err.name) || 'Error',
    code: sanitize(err.code),
  };
}
