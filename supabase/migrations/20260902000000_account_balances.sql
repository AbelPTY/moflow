-- Persistent per-account cash balances (MoFlow Flow Account Balances V1).
--
-- Additive: adds nullable balance fields to public.accounts. A NULL
-- current_balance means "balance not set" -- NEVER $0.00. Existing account ids,
-- RLS, constraints, and transaction history are untouched. No uniqueness by
-- type is added. The existing owner-only RLS policy automatically protects
-- these new columns.

BEGIN;

alter table public.accounts
  add column if not exists current_balance numeric(14,2),
  add column if not exists balance_as_of date,
  add column if not exists balance_updated_at timestamptz;

COMMIT;
