-- =============================================================================
-- Server-issued single-use signup approval tokens (P0 Phase D2, revised)
-- -----------------------------------------------------------------------------
-- !!! REVIEW REQUIRED BEFORE APPLYING !!!  (NOT applied yet.)
--
-- WHY THIS REPLACES THE EARLIER DESIGN:
-- The reusable signup invite (SIGNUP_INVITE_CODE) must NEVER be forwarded to
-- Supabase Auth, because supabase.auth.signUp options.data becomes persistent
-- user_metadata and the Before-User-Created hook cannot rewrite/sanitize it.
-- So the reusable invite is validated ONLY inside api/signup.js. On success the
-- server mints a fresh, cryptographically random, short-lived, SINGLE-USE
-- approval token, stores only its SHA-256 hash here, and forwards ONLY that
-- token to Supabase. The hook atomically consumes the token to authorize
-- creation. A direct anon-key signUp without a valid server-issued token is
-- rejected by the hook.
--
-- What remains in user_metadata on a successful user: only signup_approval_token
-- -- a random, short-lived, single-use value that is ALREADY CONSUMED (deleted)
-- before creation proceeds, so it is useless afterward. The reusable invite is
-- never present.
--
-- MANUAL STEPS (do not automate here):
--   1. Verify the hook `event` shape for YOUR Supabase version (see extract below).
--   2. Enable public.before_user_created_signup_guard as the "Before user created"
--      Auth Hook (Authentication -> Hooks). It runs as role supabase_auth_admin.
--
-- Contains NO secret, no invite value, no token, no personal data, no seed row.
-- =============================================================================

BEGIN;

-- Durable store of pending approval tokens. Only the SHA-256 hex hash is kept;
-- the raw token exists only transiently in the server and in the signUp call.
create table public.signup_approval_tokens (
    id          uuid primary key default gen_random_uuid(),
    token_hash  text not null unique,
    expires_at  timestamptz not null,
    created_at  timestamptz not null default now(),
    constraint signup_approval_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint signup_approval_tokens_expiry_after_created check (expires_at > created_at)
);

alter table public.signup_approval_tokens enable row level security;
-- No client policies whatsoever.
revoke all on table public.signup_approval_tokens from public, anon, authenticated;
-- api/signup.js (service role) mints/cleans tokens.
grant select, insert, update, delete on table public.signup_approval_tokens to service_role;
-- The Auth Hook runs as supabase_auth_admin (SECURITY INVOKER).
-- DELETE ... WHERE ... RETURNING requires both SELECT and DELETE privileges.
grant select, delete on table public.signup_approval_tokens to supabase_auth_admin;

create policy "signup approval tokens auth admin select"
on public.signup_approval_tokens
as permissive for select
to supabase_auth_admin
using (true);

create policy "signup approval tokens auth admin delete"
on public.signup_approval_tokens
as permissive for delete
to supabase_auth_admin
using (true);
-- Before-User-Created Auth Hook. Reads the one-time approval token from the
-- incoming signup metadata, hashes it, and atomically consumes a matching
-- unexpired row. Returns '{}' to ALLOW, an { error } object to REJECT. Never
-- mutates user_metadata. The hook runs with the invoker's minimal privileges
-- (supabase_auth_admin) and a locked-down pg_catalog-only search_path.
create or replace function public.before_user_created_signup_guard(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
    v_token text;
    v_hash  text;
    v_id    uuid;
begin
    -- REVIEW: confirm where signUp options.data lands for your Supabase version.
    v_token := event #>> '{user,user_metadata,signup_approval_token}';
    if v_token is null or btrim(v_token) = '' then
        return jsonb_build_object('error',
            jsonb_build_object('http_code', 403, 'message', 'Signup not allowed'));
    end if;

    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

    -- Atomic single-use consume: only one concurrent signup can take the row,
    -- and only while unexpired.
    delete from public.signup_approval_tokens
    where token_hash = v_hash
      and expires_at > now()
    returning id into v_id;

    if v_id is null then
        -- Absent, expired, or already consumed -> reject.
        return jsonb_build_object('error',
            jsonb_build_object('http_code', 403, 'message', 'Signup not allowed'));
    end if;

    -- Authorized. Allow without mutating metadata.
    return '{}'::jsonb;
end;
$$;

-- Only the auth admin role may execute the hook.
revoke all on function public.before_user_created_signup_guard(jsonb) from public;
revoke all on function public.before_user_created_signup_guard(jsonb) from anon;
revoke all on function public.before_user_created_signup_guard(jsonb) from authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created_signup_guard(jsonb) to supabase_auth_admin;

COMMIT;
