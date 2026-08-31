-- First-class user accounts (MoFlow Account Foundation V1.1).
--
-- Fixes the legacy assumption that "accounts" are only free-text account_name
-- strings on transactions (plus a hardcoded personal list). Accounts are now
-- durable rows identified by `id`, so a user can create MANY accounts of the
-- SAME type (e.g. two savings accounts) without one overwriting another.
--
-- Identity is the row id. There is intentionally NO unique constraint on
-- (user_id, account_type) -- that would collapse multiple same-type accounts.
-- A per-user case-insensitive uniqueness on the NAME prevents accidental exact
-- duplicates while still allowing "BG Savings" and "UNFCU Savings" to coexist.
--
-- Credit cards remain in public.credit_cards; this table does not duplicate them.

BEGIN;

create table public.accounts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,

    account_name text not null,
    account_type text not null,
    institution_name text,
    currency text not null default 'USD',
    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint accounts_type_allowed check (
      account_type in ('checking', 'savings', 'cash', 'investment', 'other')
    ),
    constraint accounts_name_not_blank check (length(btrim(account_name)) > 0)
);

alter table public.accounts enable row level security;

-- Owner-only access.
create policy "users_manage_own_accounts"
on public.accounts
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Fast per-user lookups.
create index accounts_user_id_idx on public.accounts (user_id);

-- Case-insensitive per-user uniqueness on the NAME only (NOT the type), so two
-- distinctly-named savings accounts are allowed but an exact duplicate name is
-- rejected. Scoped to active rows so a deactivated account frees its name.
create unique index accounts_user_name_unique
  on public.accounts (user_id, lower(btrim(account_name)))
  where is_active;

COMMIT;
