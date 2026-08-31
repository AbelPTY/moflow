-- Loans (MoFlow Loans V1). Per-user loan tracking for payoff / extra-payment
-- analysis. Deterministic math lives in the client (src/lib/loanMath.js); this
-- table only stores the loan inputs. Mirrors the per-user security model used
-- by public.credit_cards and the other user-scoped tables.

BEGIN;

create table public.loans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,

    loan_name text not null,
    loan_type text not null,

    remaining_principal numeric(14,2) not null,
    apr numeric(6,3) not null,
    monthly_payment numeric(14,2) not null,

    -- Optional user context. The payoff engine derives its own horizon from
    -- principal/APR/payment; neither of these is required.
    next_payment_date date,
    remaining_months integer,
    maturity_date date,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint loans_loan_type_allowed check (
      loan_type in ('mortgage', 'auto', 'personal', 'student', 'other')
    ),
    constraint loans_principal_positive check (remaining_principal > 0),
    constraint loans_apr_nonneg check (apr >= 0),
    constraint loans_payment_positive check (monthly_payment > 0),
    constraint loans_remaining_months_positive check (
      remaining_months is null or remaining_months > 0
    )
);

alter table public.loans enable row level security;

-- Owner-only access: authenticated users manage only their own loans.
create policy "users_manage_own_loans"
on public.loans
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index loans_user_id_idx on public.loans (user_id);

COMMIT;
