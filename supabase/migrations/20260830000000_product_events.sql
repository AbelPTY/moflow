-- Product-experience analytics (privacy-preserving, aggregate only).
--
-- This table stores ONLY a product ACTION name plus an optional non-personal
-- screen label. It deliberately holds NO user_id, email, name, session or
-- device identifier, and NO financial values or account/card/loan/transaction
-- identifiers of any kind. The goal is aggregate funnel/usage analysis that can
-- never expose personal or financial data.

BEGIN;

create table public.product_events (
    id uuid primary key default gen_random_uuid(),
    event_name text not null,
    source_screen text,
    created_at timestamptz not null default now(),

    -- Defense-in-depth: the database enforces the SAME allowlist as
    -- src/lib/analytics.js, so even a direct write through the authenticated
    -- Supabase client (bypassing the client guard) cannot store an arbitrary
    -- event_name or source_screen. Keep these two lists in sync with the client.
    constraint product_events_event_name_allowed check (
      event_name in (
        -- Cards
        'card_scan_started', 'card_scan_completed', 'card_saved',
        -- Flow
        'flow_opened', 'flow_setup_completed', 'balance_scan_started',
        'balance_scan_applied', 'extra_income_added', 'custom_horizon_used',
        -- Activity
        'activity_scan_started', 'activity_scan_completed', 'activity_import_completed',
        -- Onboarding
        'onboarding_flow_bridge_clicked', 'onboarding_activity_prompt_clicked',
        -- Loans (accepted by the client allowlist; reserved for the Loans feature)
        'loan_section_opened', 'loan_added', 'loan_edited', 'loan_simulator_opened',
        'loan_extra_payment_tested', 'loan_recurring_extra_tested', 'loan_payment_added_to_flow'
      )
    ),

    -- source_screen: NULL or one of the enum values. 'loans' is intentionally
    -- NOT accepted yet -- it matches the client, which does not accept it either.
    constraint product_events_source_screen_allowed check (
      source_screen is null or source_screen in ('cards', 'flow', 'activity')
    )
);

alter table public.product_events enable row level security;

-- Authenticated users may only INSERT safe events. Rows carry no identity, so
-- inserts are intentionally NOT scoped to a user (with check (true)). No SELECT,
-- UPDATE, or DELETE policy exists, so the client can append events but can never
-- read, change, or remove them -- and no row can ever be tied back to a user.
create policy "authenticated_can_insert_product_events"
on public.product_events
for insert
to authenticated
with check (true);

COMMIT;
