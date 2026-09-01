-- Account-aware transaction de-duplication.
--
-- WHY: The transactions table protects against duplicate imports with two
-- partial unique indexes (verified live definitions):
--     unique_transaction_with_ref     (user_id, date, merchant, amount, bank_reference)  WHERE bank_reference IS NOT NULL
--     unique_transaction_without_ref  (user_id, date, merchant, amount)                  WHERE bank_reference IS NULL
-- Neither includes the account, so an identical-looking transaction that
-- genuinely belongs to a DIFFERENT account (e.g. the same $9.50 Starbucks on
-- the same day appearing in both a checking and a savings statement) is wrongly
-- REJECTED at insert time. This migration replaces ONLY those two indexes with
-- account-aware versions so duplicates are scoped to the destination account,
-- while still rejecting true duplicates WITHIN the same account.
--
-- The ONLY identity change is adding a normalized account expression:
--     lower(btrim(coalesce(nullif(btrim(account_name), ''), nullif(btrim(source_account), ''), '')))
-- which follows the same source order the client uses: the first NON-BLANK of
-- account_name then source_account, else '' (a blank/whitespace-only
-- account_name falls through to source_account). The predicates (bank_reference
-- IS NOT NULL / IS NULL) and the existing columns (user_id, date, merchant,
-- amount, bank_reference) are preserved exactly.
--
-- Account identity: transactions have no account_id yet, so identity is derived
-- from the stored name -- trim + case-fold only, NO personal aliasing (so
-- "UNFCU Savings" and "BG Savings" stay distinct). Legacy blank-account rows
-- normalize to '' and so still collide only with other blank-account rows
-- (conservative, not exempt). This mirrors the client-side identity in
-- src/lib/dedupeTransactions.js (acctKeyOf).

BEGIN;

DROP INDEX IF EXISTS public.unique_transaction_with_ref;
DROP INDEX IF EXISTS public.unique_transaction_without_ref;

-- Rows WITH a bank reference: existing identity + normalized account.
CREATE UNIQUE INDEX unique_transaction_with_ref
  ON public.transactions (
    user_id,
    (lower(btrim(coalesce(nullif(btrim(account_name), ''), nullif(btrim(source_account), ''), '')))),
    date,
    merchant,
    amount,
    bank_reference
  )
  WHERE bank_reference IS NOT NULL;

-- Rows WITHOUT a bank reference: existing identity + normalized account.
CREATE UNIQUE INDEX unique_transaction_without_ref
  ON public.transactions (
    user_id,
    (lower(btrim(coalesce(nullif(btrim(account_name), ''), nullif(btrim(source_account), ''), '')))),
    date,
    merchant,
    amount
  )
  WHERE bank_reference IS NULL;

COMMIT;
