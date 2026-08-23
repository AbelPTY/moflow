import { supabase } from './supabase';

// Authorization header for calling our protected /api endpoints.
//
// Reads the current Supabase session's access token live (never a hard-coded
// or cached constant, so it can't go stale). Throws a friendly error when
// there is no active session, so callers surface "please sign in" instead of
// silently hitting a 401.
//
// Usage (JSON):
//   headers: { 'Content-Type': 'application/json', ...(await authHeader()) }
// Usage (FormData -- do NOT set Content-Type, keep the browser's multipart
// boundary intact):
//   headers: { ...(await authHeader()) }
export async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Your session has expired — please sign in again.');
  return { Authorization: `Bearer ${token}` };
}
