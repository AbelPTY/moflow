-- Extend the product_events event_name allowlist for Transaction Intelligence
-- V1. ADDITIVE only: it replaces the CHECK constraint with the SAME set plus the
-- six new aggregate (non-sensitive) event names. source_screen CHECK, RLS,
-- grants, and every other event are unchanged. The list is kept byte-identical
-- to the client allowlist in src/lib/analytics.js.
--
-- A CHECK constraint cannot be edited in place, so we DROP the old one and ADD
-- the superset. No data is touched (product_events rows carry no identity and
-- no existing event name is removed).

BEGIN;

ALTER TABLE public.product_events
  DROP CONSTRAINT IF EXISTS product_events_event_name_allowed;

ALTER TABLE public.product_events
  ADD CONSTRAINT product_events_event_name_allowed CHECK (
    event_name IN (
      -- Cards
      'card_scan_started', 'card_scan_completed', 'card_saved',
      -- Flow
      'flow_opened', 'flow_setup_completed', 'balance_scan_started',
      'balance_scan_applied', 'extra_income_added', 'custom_horizon_used',
      -- Activity
      'activity_scan_started', 'activity_scan_completed', 'activity_import_completed',
      -- Onboarding
      'onboarding_flow_bridge_clicked', 'onboarding_activity_prompt_clicked',
      -- Loans
      'loan_section_opened', 'loan_added', 'loan_edited', 'loan_simulator_opened',
      'loan_extra_payment_tested', 'loan_recurring_extra_tested', 'loan_payment_added_to_flow',
      -- Transaction Intelligence (aggregate only; no merchant/amount/category/id)
      'transaction_auto_categorized', 'transaction_suggestion_accepted',
      'transaction_suggestion_changed', 'transaction_rule_created',
      'transaction_bulk_reclassified', 'categorization_review_opened'
    )
  );

COMMIT;
