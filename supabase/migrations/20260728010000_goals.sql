-- Savings goal persistence
-- Replaces the hardcoded GOAL_TARGET constant in the goals-progress page with
-- an editable, per-user goal stored in Supabase. One row per user (user_id is
-- unique), so saving just upserts that row.

create table public.goals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique,
    name text not null default '2026 Trip Fund & Reserves',
    milestone_label text default 'Feb 2026 Trip',
    milestone_sublabel text default 'Orlando / Punta Cana',
    target_amount numeric(12,2) not null default 15000,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table public.goals enable row level security;

-- Users manage only their own goal (mirrors the transactions/budgets policy).
create policy "users_manage_own_goals"
on public.goals
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
