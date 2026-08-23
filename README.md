# MoFlow / Finance Tracker

A personal-finance dashboard focused on **cash-flow clarity**: what money is
available now, what obligations are due before the next income, and what will be
left over. Built with React + Vite, Supabase (Postgres, Auth, RLS), and Vercel
serverless functions.

> Note: this file previously contained an obsolete copy of engine source code
> that embedded private data. It has been replaced with high-level documentation
> using only fictional examples. The source of truth is the code under `src/`
> and `api/`.

## Stack

- **Frontend:** React + Vite (SPA)
- **Data/Auth:** Supabase (Postgres, Auth, per-owner Row Level Security)
- **Serverless:** Vercel functions in `/api` (statement/receipt parsing, etc.)
- **AI:** Google Gemini (document/voice interpretation only — never money math)

## Merchant categorization (how it works)

Transactions are classified deterministically (no AI in the money path) by a
shared matcher in `src/lib/engine/ruleMatcher.js`, consumed by
`src/lib/engine/normalize.js` and the import flow in
`src/components/BulkUpload.jsx`.

Precedence is tiered:

1. **User rules** (`public.user_merchant_rules`, per-owner via RLS)
   - `source = 'manual'` — rules a user creates deliberately; evaluated first as
     intentional overrides.
   - `source = 'migrated'` — a user's private rules that reproduce a former
     static classification at their original position, encoded as
     `priority = 1000 + originalStaticOrder`.
2. **Static rules** (`src/rules/merchant_rules.json`) — reusable global / market
   / institution knowledge shared by all users. No personal identifiers.
3. **Fallbacks** — sign/keyword normalization and default buckets.

Each rule maps a matched pattern to a `category`, a `budgetBucket`
(`NEEDS`, `WANTS`, `SAVINGS`, `INCOME`, `TRANSFERS`, …), and a transfer flag.

### Example (fictional)

```jsonc
{
  "id": "example_group",
  "matchAny": ["EXAMPLE GROCERY", "EXAMPLE MARKET"],
  "assign": { "category": "Groceries", "budgetBucket": "NEEDS", "is_transfer": false }
}
```

Conceptually:

- `EXAMPLE GROCERY` → Groceries / NEEDS
- `EXAMPLE EMPLOYER` → Income / INCOME
- `EXAMPLE TRANSFER` → Transfer / TRANSFERS (excluded from spending)

Personal, per-user mappings (e.g. individual people or a user's own suppliers)
are **not** stored in the shared static file — they live only in that user's
`user_merchant_rules` rows, isolated by RLS.

## Amount sign convention

Expenses are **negative**; income/credits are **positive**. Every parser must
follow this.

## Project layout

- `src/pages/` — screens (overview, cash-flow, cards, budget, spending, goals,
  action-plan)
- `src/lib/engine/` — deterministic classification engine
- `src/rules/merchant_rules.json` — shared static rules (no personal data)
- `api/` — authenticated serverless endpoints (Gemini-backed parsing)
- `supabase/migrations/` — SQL migrations

## Development

Install dependencies and run the dev server:

```bash
npm install
npm run start
```

Build for production:

```bash
npm run build
```

Environment variables (see your Vercel/Supabase project settings) include
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `GEMINI_API_KEY`. Never commit
secrets or `.env` files.
