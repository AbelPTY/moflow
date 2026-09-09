-- Scheduled payments — persistent, frequency-aware recurrence.
--
-- ADDITIVE only. Adds a single canonical recurrence_frequency column so a
-- recurring scheduled_payment can roll over on its own cadence (weekly /
-- biweekly / semi-monthly / monthly) instead of the previous hardcoded
-- +1-month rollover. No parallel recurrence table is introduced.
--
-- Backward compatibility: the column is NULLABLE and defaults to NULL. Existing
-- recurring rows (is_recurring = true, recurrence_frequency = NULL) keep their
-- exact prior behavior — the client rollover treats a NULL frequency as
-- 'monthly'. No existing row is rewritten.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + DROP/ADD CONSTRAINT. RLS, indexes,
-- and every other column are untouched. PROPOSED — DO NOT APPLY until reviewed.

BEGIN;

ALTER TABLE public.scheduled_payments
  ADD COLUMN IF NOT EXISTS recurrence_frequency text;

-- A CHECK constraint cannot be edited in place, so drop-then-add keeps the
-- migration re-runnable. NULL is allowed (legacy recurring rows and one-time
-- payments); only the four canonical codes are otherwise accepted. Values stay
-- byte-identical to SCHEDULED_FREQUENCIES in src/lib/scheduledRecurrence.js.
ALTER TABLE public.scheduled_payments
  DROP CONSTRAINT IF EXISTS scheduled_payments_recurrence_frequency_allowed;

ALTER TABLE public.scheduled_payments
  ADD CONSTRAINT scheduled_payments_recurrence_frequency_allowed CHECK (
    recurrence_frequency IS NULL
    OR recurrence_frequency IN ('monthly', 'semi_monthly', 'biweekly', 'weekly')
  );

COMMIT;
