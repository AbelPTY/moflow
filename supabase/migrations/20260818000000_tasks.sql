-- Action Plan tasks
-- Money to-dos captured by voice (or typed) and categorized by AI. A done flag
-- lets the user check them off; reminders can be layered on later.

create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid(),
    title text not null,
    category text not null default 'Other',
    due_date date,
    done boolean not null default false,
    created_at timestamptz default now()
);

create index idx_tasks_user_id on public.tasks(user_id);

alter table public.tasks enable row level security;

create policy "users_manage_own_tasks"
on public.tasks
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
