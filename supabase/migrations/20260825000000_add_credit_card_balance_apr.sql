alter table public.credit_cards
  add column if not exists current_balance numeric(12,2),
  add column if not exists apr numeric(6,3);
