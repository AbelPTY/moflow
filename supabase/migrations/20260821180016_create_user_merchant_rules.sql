-- =============================================================================
-- user_merchant_rules
-- -----------------------------------------------------------------------------
-- Per-user merchant classification rules. This is infrastructure ONLY: the app
-- does not read or write this table yet, no rules are seeded, and the existing
-- static rule engine (src/rules/merchant_rules.json + the shared matcher) is
-- unchanged. It will eventually hold manually-created, learned, and migrated
-- personal rules -- each row owned by exactly one authenticated Supabase user.
--
-- This migration creates a NEW isolated table. It deliberately does NOT touch,
-- alter, or repurpose public.merchants (which the app does not use).
--
-- PRIORITY CONVENTION: lower `priority` number = higher priority (evaluated
-- first). This orders rules WITHIN the user-rule tier only; cross-tier
-- precedence (user > institution > market > global) is decided in application
-- code, not here.
-- =============================================================================

create table public.user_merchant_rules (
    id            uuid primary key default gen_random_uuid(),

    -- Ownership. The browser never supplies this; it defaults to the caller's
    -- auth.uid(). RLS (below) enforces that it can only ever equal the caller.
    user_id       uuid not null default auth.uid()
                    references auth.users(id) on delete cascade,

    -- Optional human-readable name for the rule (e.g. a user's own label).
    label         text,

    -- The value to be matched. Must not be empty/whitespace-only.
    pattern       text not null,

    -- How `pattern` is compared. CHECK instead of a PG enum so the set can
    -- evolve without a type migration.
    match_type    text not null default 'contains',

    -- Which field of a transaction `pattern` is compared against. Preserves the
    -- existing distinction: static rules are substring/description-oriented,
    -- learned rules are exact merchant-oriented.
    match_field   text not null default 'merchant',

    -- Classification the rule assigns. `budget_bucket` intentionally has no DB
    -- enum so the app taxonomy can evolve.
    category      text not null,
    subcategory   text,
    budget_bucket text not null,

    -- Transfer semantics override. NULL (the default -- note: NO default false)
    -- means "this rule does not explicitly override transfer semantics", so a
    -- user rule never forcibly marks something non-transfer unless it says so.
    is_transfer   boolean,

    -- Provenance of the rule.
    source        text not null default 'manual',

    -- Confidence in [0,1]. Manual rules default to full confidence.
    confidence    numeric(3,2) not null default 1,

    -- Ordering within the user-rule tier. Lower = higher priority (see header).
    priority      integer not null default 100,

    active        boolean not null default true,

    created_at    timestamptz not null default now(),
    -- Maintained explicitly by the application (no trigger in this P0 migration).
    updated_at    timestamptz not null default now(),

    constraint user_merchant_rules_pattern_not_blank
        check (char_length(btrim(pattern)) > 0),
    constraint user_merchant_rules_match_type_valid
        check (match_type in ('exact', 'contains')),
    constraint user_merchant_rules_match_field_valid
        check (match_field in ('merchant', 'description')),
    constraint user_merchant_rules_source_valid
        check (source in ('manual', 'learned', 'migrated')),
    constraint user_merchant_rules_confidence_range
        check (confidence >= 0 and confidence <= 1)
);

-- -----------------------------------------------------------------------------
-- Uniqueness: one rule per (user, normalized pattern, match_type, match_field).
-- Pattern is normalized case-insensitively and trimmed so "  Netflix " and
-- "NETFLIX" collide. Category is deliberately NOT part of the key -- a user
-- should UPDATE an existing mapping rather than create conflicting ones.
-- -----------------------------------------------------------------------------
create unique index user_merchant_rules_unique_match
    on public.user_merchant_rules (user_id, lower(btrim(pattern)), match_type, match_field);

-- Hot path: fetch a user's active rules ordered by priority.
create index user_merchant_rules_lookup
    on public.user_merchant_rules (user_id, active, priority);

-- =============================================================================
-- Row Level Security
-- -----------------------------------------------------------------------------
-- RLS decides WHICH ROWS a role may see/modify (per-owner isolation). Grants
-- (further below) decide WHICH OPERATIONS a role may attempt at all. Both are
-- required for defense in depth: RLS without grants, or grants without RLS,
-- each leaves a gap. service_role bypasses RLS by design (used only by trusted
-- server code) and is not configured here.
-- =============================================================================
alter table public.user_merchant_rules enable row level security;

-- Read only your own rules.
create policy "user_merchant_rules_select_own"
    on public.user_merchant_rules
    for select
    to authenticated
    using (auth.uid() = user_id);

-- Insert only rows you own.
create policy "user_merchant_rules_insert_own"
    on public.user_merchant_rules
    for insert
    to authenticated
    with check (auth.uid() = user_id);

-- Update only your own rows, and you cannot reassign ownership: USING gates the
-- pre-image (must already be yours) and WITH CHECK gates the post-image (must
-- still be yours), so user_id can never be moved to another user.
create policy "user_merchant_rules_update_own"
    on public.user_merchant_rules
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Delete only your own rows.
create policy "user_merchant_rules_delete_own"
    on public.user_merchant_rules
    for delete
    to authenticated
    using (auth.uid() = user_id);

-- =============================================================================
-- Privileges (defense in depth alongside RLS)
-- -----------------------------------------------------------------------------
-- Anonymous visitors get no access to this table at all. Authenticated users
-- get exactly the CRUD verbs this feature needs -- still row-gated by the RLS
-- policies above. service_role is intentionally left untouched (Supabase
-- manages its bypass).
-- =============================================================================
revoke all on table public.user_merchant_rules from public, anon, authenticated;

grant select, insert, update, delete
on table public.user_merchant_rules
to authenticated;
