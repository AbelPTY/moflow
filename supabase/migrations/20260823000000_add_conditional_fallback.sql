-- =============================================================================
-- Generic conditional-fallback support for user_merchant_rules (Phase 1, additive)
-- -----------------------------------------------------------------------------
-- Adds:
--   * a nullable `branches` JSONB column holding an ORDERED array of conditional
--     branches (evaluated in application code, first-match-wins), and
--   * a new `source = 'fallback'` value marking rows that run as a post-static,
--     owner-scoped fallback tier (after manual + legacy static/migrated, before
--     the app's generic final fallback).
--
-- Existing rows and behaviour are unchanged; rows with branches = NULL and the
-- pre-existing source values behave exactly as before. The normalized unique
-- index and all RLS policies/grants are intentionally left untouched.
--
-- Contains NO personal data. Deep branch validation lives in the application
-- (src/lib/engine/ruleMatcher.js), not in Postgres.
-- =============================================================================

BEGIN;

alter table public.user_merchant_rules
  add column if not exists branches jsonb;

-- `branches` must be a JSON array when present (shape/field validation is done
-- in application code, not here).
alter table public.user_merchant_rules
  add constraint user_merchant_rules_branches_is_array
  check (branches is null or jsonb_typeof(branches) = 'array');

-- Allow the new 'fallback' source alongside the existing provenance values.
-- (Recreate the existing CHECK by its known name; no data is affected.)
alter table public.user_merchant_rules
  drop constraint if exists user_merchant_rules_source_valid;
alter table public.user_merchant_rules
  add constraint user_merchant_rules_source_valid
  check (source in ('manual', 'learned', 'migrated', 'fallback'));

-- Unique index (user_id, lower(btrim(pattern)), match_type, match_field) is
-- deliberately NOT modified: one fallback row per primary pattern, with its
-- conditional variants held inside `branches`.

COMMIT;
