# CLAUDE.md — MoFlow Project Context

Standing context for anyone (human or AI) working on this repository. Read it
before making changes.

## What this project is

**MoFlow** is a personal-finance dashboard focused on **cash-flow clarity**:
how much money is available now, what obligations fall before the next expected
income, and what will be left over — so users can make informed spending
decisions. It is designed to serve multiple users (multi-market, e.g. Panama and
the United States), not a single operator.

- **Stack:** React + Vite (SPA); Supabase (Postgres, Auth, Row Level Security);
  hosted on Vercel (static frontend + serverless functions in `/api`).
- **AI:** Google Gemini is used only to reduce data-entry friction and interpret
  documents/voice (receipt/statement scanning, voice-to-tasks). **AI never
  performs monetary calculations** — money math is deterministic.

## How to work on this project

1. **Inspect real input before writing parser logic.** Validate extraction
   against a real sample and confirm expected counts/amounts before wiring it in.
2. **Test against representative data before shipping.**
3. **Verify the build locally** (`npm run build`) before deploying where possible.
4. **Prefer proposing a diff/plan for review** over silently editing many files.

## Critical data conventions

- **Amount sign:** expenses are NEGATIVE, income/credits are POSITIVE. Every
  parser must follow this.
- **Budget buckets** (distinct from categories): `NEEDS, WANTS, SAVINGS, INCOME,
  TRANSFERS, DEBT_FUNDING, Unsorted`.

## Categorization engine

Classification is deterministic and lives in `src/lib/engine/`:

- `ruleMatcher.js` — pure, data-agnostic matcher. Precedence:
  1. **manual** user rules (`user_merchant_rules`, `source='manual'`)
  2. **legacy-interleaved** static rules (`src/rules/merchant_rules.json`) and
     **migrated** user rules (`source='migrated'`, positioned by
     `priority = 1000 + originalStaticOrder`)
  3. **conditional fallback** user rules (`source='fallback'`, ordered `branches`)
  4. generic final fallback
  `learned` rules do not participate in this pass.
- `normalize.js` — per-row normalization consuming the matcher.
- `userRules.js` — owner-scoped rule loading (RLS-isolated; read-only in the
  client path).

Shared static rules (`merchant_rules.json`) must contain **no personal
identifiers** — only reusable global/market/institution knowledge. Personal or
per-user mappings belong in `user_merchant_rules` (isolated by RLS), never in
tracked source.

## Supabase / migrations

- RLS is per-owner (`auth.uid() = user_id`) on user-scoped tables; **preserve
  it**. Client queries rely on RLS for isolation.
- Server endpoints authenticate the caller's Supabase token before doing work.
- Add schema changes as SQL migrations under `supabase/migrations/`; wrap them in
  `BEGIN; … COMMIT;`. Migrations must contain **no personal data or secrets**.

## Security expectations

- **Never commit secrets** — no service-role keys, JWTs, private keys, passwords,
  or owner UUIDs in source, migrations, tests, docs, or comments. `.gitignore`
  excludes env files.
- Do not weaken RLS or expose the service-role key to the client.
- Do not run `npm audit fix` / `npm audit fix --force` automatically.
- Generated output (`build/`, `dist/`) must not be committed; both are gitignored.

## Tests

- Synthetic tests use **fictional identifiers only**. Example:
  `node tests/conditionalFallback.test.mjs`.
