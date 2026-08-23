-- Fees-avoided ledger
-- One row is logged each time a card statement is marked paid in full, storing
-- an estimate of the interest that would have accrued had the balance been
-- carried. The Cards tab surfaces the running total ("financing fees avoided").

create table public.fee_savings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid(),
    card_name text,
    statement_balance numeric(12,2) not null default 0,
    interest_saved numeric(12,2) not null default 0,
    saved_on date not null default ((now() at time zone 'utc')::date),
    created_at timestamptz default now()
);

create index idx_fee_savings_user_id on public.fee_savings(user_id);

alter table public.fee_savings enable row level security;

create policy "users_manage_own_fee_savings"
on public.fee_savings
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
