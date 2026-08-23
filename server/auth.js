import { createClient } from '@supabase/supabase-js';

// Shared server-side auth guard for the Gemini / statement-import API endpoints.
//
// It verifies the caller's Supabase access token against Supabase Auth using
// the PUBLIC anon key (never the service-role key) and returns the
// authenticated user. On any failure it writes a safe 401 JSON response and
// returns null, so handlers use it as:
//
//     const user = await requireUser(req, res);
//     if (!user) return;              // 401 already sent
//     // ...proceed, trusting user.id from the verified token only
//
// Security posture:
//  - Never trusts a user id sent in the request body (identity comes from the
//    verified token only).
//  - Does a real Supabase Auth verification (getUser(token)) -- not a local,
//    unverified JWT decode.
//  - Never logs the token or document contents.
//  - Never exposes Gemini or Supabase credentials in responses.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

let cachedClient = null;
function getAuthClient() {
  if (cachedClient) return cachedClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

function unauthorized(res, message = 'Unauthorized') {
  res.status(401).json({ error: message });
  return null;
}

// Returns the authenticated Supabase user, or null after sending a 401/500.
export async function requireUser(req, res) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  if (!match) return unauthorized(res, 'Missing or malformed Authorization header');

  const token = match[1].trim();
  if (!token) return unauthorized(res);

  const client = getAuthClient();
  if (!client) {
    // Server misconfiguration -- fail closed without revealing which var is
    // missing or leaking any secret.
    res.status(500).json({ error: 'Authentication is not configured' });
    return null;
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return unauthorized(res, 'Invalid or expired token');
    return data.user;
  } catch {
    return unauthorized(res, 'Invalid or expired token');
  }
}
