-- =============================================================================
-- user_telegram_integrations
-- -----------------------------------------------------------------------------
-- Server-managed binding between a MoFlow user and their Telegram identity.
-- This is infrastructure ONLY (Phase A1): no runtime code reads or writes it
-- yet, no rows are seeded, and the reminder cron is unchanged. It exists so
-- that a later phase can replace the single global TELEGRAM_CHAT_ID with
-- per-user, owner-scoped delivery.
--
-- This migration creates a NEW isolated table. It deliberately does NOT touch,
-- alter, or repurpose any existing table, policy, or grant.
--
-- SECURITY MODEL: Telegram identity binding is security-sensitive. The browser
-- must never be able to claim an arbitrary Telegram user/chat. Therefore RLS
-- grants authenticated users READ of their OWN row only; all writes (connect,
-- update, disconnect) are performed exclusively by trusted server code using
-- service_role, after the server verifies Telegram authenticity. There is
-- intentionally NO authenticated INSERT/UPDATE/DELETE policy.
--
-- Telegram identifiers are stored as TEXT on purpose so application code never
-- depends on JS integer precision or bigint serialization behavior.
--
-- Contains NO personal data: no owner UUID, no Telegram chat/user id, no bot
-- handle, no seed row.
-- =============================================================================

BEGIN;

create table public.user_telegram_integrations (
    id                uuid primary key default gen_random_uuid(),

    -- Ownership. Bound only by verified server code (service_role); the browser
    -- never supplies this. RLS (below) lets a user READ only the row where this
    -- equals their auth.uid().
    user_id           uuid not null
                        references auth.users(id) on delete cascade,

    -- Telegram identity. TEXT to avoid integer-precision/serialization issues.
    telegram_user_id  text not null,
    telegram_chat_id  text not null,

    active            boolean not null default true,

    linked_at         timestamptz not null default now(),
    created_at        timestamptz not null default now(),
    -- Maintained explicitly by the server (no trigger in this migration).
    updated_at        timestamptz not null default now(),

    -- One Telegram integration per MoFlow user.
    constraint user_telegram_integrations_user_unique
        unique (user_id),
    -- A given Telegram user cannot be bound to more than one MoFlow user.
    constraint user_telegram_integrations_tg_user_unique
        unique (telegram_user_id),
    -- A given Telegram chat cannot be bound to more than one MoFlow user.
    constraint user_telegram_integrations_tg_chat_unique
        unique (telegram_chat_id),

    -- Reject blank / whitespace-only identifiers (shape/numeric validation is
    -- intentionally left to the verified server path, not enforced here).
    constraint user_telegram_integrations_tg_user_not_blank
        check (btrim(telegram_user_id) <> ''),
    constraint user_telegram_integrations_tg_chat_not_blank
        check (btrim(telegram_chat_id) <> '')
);

-- =============================================================================
-- Row Level Security
-- -----------------------------------------------------------------------------
-- RLS decides WHICH ROWS a role may see (per-owner isolation). Grants (below)
-- decide WHICH OPERATIONS a role may attempt at all. service_role bypasses RLS
-- by design and is the ONLY path that writes this table (verified server code).
-- =============================================================================
alter table public.user_telegram_integrations enable row level security;

-- Read only your own integration row. No INSERT/UPDATE/DELETE policy exists on
-- purpose: authenticated clients can never create, alter, or remove a binding
-- directly -- those flows go through verified server endpoints (service_role).
create policy "user_telegram_integrations_select_own"
    on public.user_telegram_integrations
    for select
    to authenticated
    using (auth.uid() = user_id);

-- =============================================================================
-- Privileges (defense in depth alongside RLS)
-- -----------------------------------------------------------------------------
-- Anonymous visitors get no access at all. Authenticated users get SELECT only
-- (still row-gated by the policy above). service_role bypasses RLS by design AND
-- is granted explicit server-side DML privileges here (RLS bypass and table
-- privileges are separate concerns; we do not rely on Supabase defaults). Those
-- explicit privileges are what support future verified server-side
-- connect/disconnect and reminder processing.
-- =============================================================================
revoke all on table public.user_telegram_integrations from public, anon, authenticated;

grant select
on table public.user_telegram_integrations
to authenticated;

grant select, insert, update, delete
on table public.user_telegram_integrations
to service_role;

COMMIT;
