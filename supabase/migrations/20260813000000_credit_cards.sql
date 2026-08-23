-- Credit card financing-fee guard
-- Per-card statement data so the app can warn "pay $X by <due date> to avoid
-- financing" and feed each card's statement balance into the cash-flow
-- coverage timeline. Statement close/due days are fixed monthly; only the
-- statement balance is refreshed each cycle.

create table public.credit_cards (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid(),
    card_name text not null,
    statement_close_day int,
    due_day int,
    statement_balance numeric(12,2) not null default 0,
    minimum_payment numeric(12,2) not null default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (user_id, card_name)
);

alter table public.credit_cards enable row level security;

create policy "users_manage_own_credit_cards"
on public.credit_cards
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
