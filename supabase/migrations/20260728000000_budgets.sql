-- Budgets persistence
-- Moves per-category monthly budget targets out of browser localStorage and
-- into Supabase so they survive a browser clear or device switch, consistent
-- with how transactions and scheduled_payments already persist.

create table public.budgets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    category text not null,
    limit_amount numeric(12,2) not null default 0,
    active boolean not null default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (user_id, category)
);

create index idx_budgets_user_id on public.budgets(user_id);

alter table public.budgets enable row level security;

-- Users manage only their own budget rows (mirrors the transactions policy).
create policy "users_manage_own_budgets"
on public.budgets
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
