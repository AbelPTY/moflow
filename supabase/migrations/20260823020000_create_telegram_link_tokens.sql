-- =============================================================================
-- user_telegram_link_tokens  +  consume_telegram_link_token(...)
-- -----------------------------------------------------------------------------
-- Database infrastructure ONLY for the secure one-time Telegram linking flow
-- (Phase A2.1). No HTTP endpoints, no webhook registration, no runtime code and
-- no rows are created here. It builds on the A1 identity table
-- (public.user_telegram_integrations), which this migration does NOT modify.
--
-- SECURITY MODEL
--   * The browser gets NO access to link tokens at all: RLS is enabled with no
--     anon/authenticated policies, and all privileges are revoked from
--     public/anon/authenticated. Only service_role (trusted server code) may
--     read/write tokens or execute the consume RPC.
--   * The server stores ONLY a SHA-256 hash of the raw token (lowercase hex),
--     never the raw token or the deep link.
--   * Redemption is performed by an atomic SECURITY DEFINER function that locks
--     the token row FOR UPDATE, so concurrent/replayed redemptions and identity
--     races cannot double-bind or leave partial state.
--
-- Contains NO personal data: no owner UUID, no Telegram chat/user id, no bot
-- username/token, no raw link token, no seed row.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Token table. Exactly one slot per MoFlow user (UNIQUE(user_id)); the future
-- POST /api/telegramLink UPSERTs this row when rotating a token, so a user can
-- never have two live tokens at once.
-- -----------------------------------------------------------------------------
create table public.user_telegram_link_tokens (
    id           uuid primary key default gen_random_uuid(),

    -- Owner. Bound only by trusted server code (service_role); the browser never
    -- supplies or reads this.
    user_id      uuid not null
                   references auth.users(id) on delete cascade,

    -- SHA-256 (lowercase hex) of the raw token. The raw token is returned to the
    -- browser exactly once, over HTTPS, and is never persisted.
    token_hash   text not null,

    -- Server sets this ~10 minutes into the future at issue time (no DB TTL
    -- default -- the TTL policy lives in the server).
    expires_at   timestamptz not null,

    -- NULL = unused. Set (atomically, in the RPC) only on a successful bind.
    consumed_at  timestamptz,

    created_at   timestamptz not null default now(),
    -- Maintained explicitly by the server / the consume RPC.
    updated_at   timestamptz not null default now(),

    -- One token slot per user (prevents concurrent issuance leaving multiple
    -- valid tokens). Also provides the user_id index -- do NOT add another.
    constraint user_telegram_link_tokens_user_unique
        unique (user_id),

    -- The hash is the hot lookup key and must be globally unique.
    constraint user_telegram_link_tokens_hash_unique
        unique (token_hash),

    -- Enforce the SHA-256 lowercase-hex shape so malformed hashes never persist.
    constraint user_telegram_link_tokens_hash_shape
        check (token_hash ~ '^[0-9a-f]{64}$'),

    -- Deterministic time-integrity check (no now() -- CHECK must be immutable).
    constraint user_telegram_link_tokens_expiry_after_created
        check (expires_at > created_at)
);

-- =============================================================================
-- Row Level Security / privileges
-- -----------------------------------------------------------------------------
-- Authenticated and anonymous clients require NO access whatsoever: RLS is on
-- with zero policies, and privileges are revoked. service_role bypasses RLS AND
-- is granted explicit DML (RLS bypass and table privileges are separate
-- concerns; we do not rely on Supabase defaults).
-- =============================================================================
alter table public.user_telegram_link_tokens enable row level security;
-- (Intentionally NO policies for anon or authenticated.)

revoke all on table public.user_telegram_link_tokens from public, anon, authenticated;

grant select, insert, update, delete
on table public.user_telegram_link_tokens
to service_role;

-- =============================================================================
-- Atomic redemption RPC
-- -----------------------------------------------------------------------------
-- Consumes a one-time token and binds the token owner's MoFlow user to the
-- Telegram identity taken from the verified webhook update. Returns a small,
-- non-disclosing TEXT status. SECURITY DEFINER with a locked-down search_path;
-- every application object is fully qualified. EXECUTE is granted to
-- service_role only, so a browser client can never invoke it (nor use it as an
-- RLS bypass).
-- =============================================================================
create or replace function public.consume_telegram_link_token(
    p_token_hash        text,
    p_telegram_user_id  text,
    p_telegram_chat_id  text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_token               public.user_telegram_link_tokens%rowtype;
    v_tg_user             text;
    v_tg_chat             text;
    v_conflict_constraint text;
begin
    -- Input validation (before touching any data).
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
        return 'invalid_input';
    end if;

    v_tg_user := btrim(coalesce(p_telegram_user_id, ''));
    v_tg_chat := btrim(coalesce(p_telegram_chat_id, ''));
    if v_tg_user = '' or v_tg_chat = '' then
        return 'invalid_input';
    end if;

    -- Lock the token row so concurrent redemptions of the same token serialize.
    select * into v_token
    from public.user_telegram_link_tokens
    where token_hash = p_token_hash
    for update;

    if not found then
        return 'not_found';
    end if;
    if v_token.consumed_at is not null then
        return 'used';
    end if;
    -- Do NOT consume an expired token.
    if v_token.expires_at <= now() then
        return 'expired';
    end if;

    -- The token owner already has an integration: never silently replace or
    -- transfer -- an explicit disconnect must happen first.
    if exists (
        select 1 from public.user_telegram_integrations
        where user_id = v_token.user_id
    ) then
        return 'already_linked';
    end if;

    -- The Telegram identity is already bound to a different integration. Do not
    -- disclose which identifier conflicted or who owns it.
    if exists (
        select 1 from public.user_telegram_integrations
        where telegram_user_id = v_tg_user
           or telegram_chat_id = v_tg_chat
    ) then
        return 'telegram_identity_taken';
    end if;

    -- Atomic bind + consume. The nested block is a subtransaction: if a
    -- concurrent writer wins a UNIQUE race, the failed INSERT rolls back to the
    -- savepoint (no partial integration) and we return WITHOUT consuming the
    -- token, so no false consumption can occur.
    begin
        insert into public.user_telegram_integrations
            (user_id, telegram_user_id, telegram_chat_id, active)
        values
            (v_token.user_id, v_tg_user, v_tg_chat, true);
    exception
        when unique_violation then
            get stacked diagnostics v_conflict_constraint = constraint_name;
            if v_conflict_constraint = 'user_telegram_integrations_user_unique' then
                -- The token owner's own integration appeared concurrently.
                return 'already_linked';
            else
                -- Telegram user/chat uniqueness lost the race to another binding.
                return 'telegram_identity_taken';
            end if;
    end;

    update public.user_telegram_link_tokens
    set consumed_at = now(),
        updated_at  = now()
    where id = v_token.id;

    return 'linked';
end;
$$;

-- Only verified server code (service_role) may execute the RPC.
revoke all on function public.consume_telegram_link_token(text, text, text) from public;
revoke all on function public.consume_telegram_link_token(text, text, text) from anon;
revoke all on function public.consume_telegram_link_token(text, text, text) from authenticated;
grant execute on function public.consume_telegram_link_token(text, text, text) to service_role;

COMMIT;
