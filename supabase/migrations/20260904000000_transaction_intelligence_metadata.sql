-- Transaction Intelligence V1 — durable classification metadata (RECONCILED
-- with the live production schema).
--
-- The live public.transactions table ALREADY has a classification metadata
-- surface that this migration REUSES rather than duplicating:
--     classification_source     text    (live default 'manual')
--     classification_confidence numeric
--     needs_review              boolean (live default false)
-- Those columns are NOT read or written by any current application code (audit:
-- 0 references in src/), so 'manual' is a schema DEFAULT, not proven human
-- provenance. This migration therefore does NOT create parallel
-- category_source/category_confidence columns.
--
-- PURELY ADDITIVE + NON-DESTRUCTIVE. It only:
--   * adds the three genuinely-missing columns (transaction_nature,
--     user_categorized, normalized_merchant),
--   * adds CHECK constraints that every existing row already satisfies,
--   * adds one partial review index.
-- It does NOT: rewrite category/budget_bucket/merchant/description/amount/
-- account/date, change existing needs_review values, mutate classification_source
-- data, alter classification_confidence, or touch RLS / dedupe indexes.
--
-- Historical provenance normalization (classification_source 'manual' -> 'legacy')
-- is deliberately LEFT OUT of this schema migration: the engine protects both
-- 'manual' and 'legacy' resolved rows, so no rewrite is needed for safety, and
-- any such data update should be a separate, explicitly-approved step.
--
-- A confidence range CHECK on classification_confidence is intentionally DEFERRED:
-- its live min/max could not be re-verified at authoring time, and per the
-- preflight rule we do not add a CHECK that might invalidate an existing value.

BEGIN;

-- ---- Genuinely-new columns (idempotent) ------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_nature  text,
  ADD COLUMN IF NOT EXISTS user_categorized    boolean NOT NULL DEFAULT false,
  -- Deterministic normalized merchant (output of normalizeMerchant); distinct
  -- from the parser/AI fields merchant_clean/merchant_extracted, and used as the
  -- stable learned-rule key. Raw merchant/description remain untouched.
  ADD COLUMN IF NOT EXISTS normalized_merchant text;

-- ---- CHECK constraints (guarded; satisfied by all existing rows) ------------
DO $$
BEGIN
  -- transaction_nature: NULL (all history) or a canonical engine nature.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_transaction_nature_valid') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_transaction_nature_valid
      CHECK (transaction_nature IS NULL OR transaction_nature IN (
        'expense', 'income', 'transfer', 'refund', 'credit_card_payment',
        'loan_payment', 'fee', 'interest', 'savings', 'investment', 'unknown'
      ));
  END IF;

  -- classification_source (REUSED live column): NULL or a canonical value. The
  -- legacy default 'manual' is kept explicitly allowed for backward compat, so
  -- this constraint validates every current row (all 'manual'). New engine
  -- writes use: user | manual_rule | learned_rule | deterministic |
  -- merchant_rule | ai | import; 'legacy' is reserved for historical rows.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_classification_source_valid') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_classification_source_valid
      CHECK (classification_source IS NULL OR classification_source IN (
        'legacy', 'manual', 'user', 'manual_rule', 'learned_rule',
        'deterministic', 'merchant_rule', 'ai', 'import'
      ));
  END IF;
END $$;

-- ---- Review-queue index ----------------------------------------------------
-- Activity's "Needs review" list queries flagged rows for the current user,
-- newest first. Partial index keeps it tiny. Existing needs_review values are
-- NOT modified by this migration.
CREATE INDEX IF NOT EXISTS idx_transactions_needs_review
  ON public.transactions (user_id, date DESC)
  WHERE needs_review = true;

COMMIT;
