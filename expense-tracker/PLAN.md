# PLAN — Personal expense tracker MVP

Single-user, India-first expense tracker. Transactions arrive automatically from bank SMS
(iOS Shortcut → webhook) and bank alert emails (IMAP poller), get parsed, de-duplicated and
categorised, and feed a "safe to spend today" budget with rollover.

Everything lives in `expense-tracker/` so the existing static site at the repo root is untouched.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js (App Router) + React + TypeScript |
| Styling | Tailwind CSS v4, dark mode by default |
| DB | Postgres 16 via Drizzle ORM + `pg` (SQL migrations committed in `drizzle/`) |
| Charts | Recharts |
| Tests | Vitest (unit) + optional DB integration tests |
| Email | `imapflow` + `mailparser`, run as a separate worker process |
| Auth | Password from env → signed session cookie (`jose`, HS256) |

## Milestones

Each milestone ends with typecheck + lint + tests green, a commit, and a push to
`mvp/expense-tracker`.

1. **M0 — Scaffold.** Next.js + Tailwind + Drizzle + Vitest + ESLint config, docker-compose
   for Postgres, `.env.example`, PLAN/DECISIONS.
2. **M1 — Data model.** Tables: `transactions`, `raw_messages`, `categories`,
   `merchant_rules`, `settings`, `fixed_commitments`, `my_accounts`. First migration.
3. **M2 — Parser + tests.** `src/lib/parser`: noise filter (OTP / promo / due reminders /
   declined / collect requests), bank detection, generic + bank-specific extractors (amount,
   direction, merchant/VPA, account last-4, ref, date-time, balance). ≥30 fixtures covering
   HDFC, ICICI, SBI, Axis, Kotak, GPay/PhonePe/Paytm, SMS and email, one test each.
4. **M3 — Ingestion pipeline + dedupe.** `POST /api/ingest/sms` (bearer token),
   raw message storage, dedupe (ref first, then amount+direction+account±10 min),
   categoriser (keyword map + learned merchant rules), self-transfer and credit-kind
   detection, needs-review routing. Integration tests against Postgres.
5. **M4 — Budget engine + tests.** Pure function: period, naive daily budget, rollover
   "safe to spend today", daily series, category totals. Exhaustive unit tests.
6. **M5 — UI vertical slice.** Login, Home (safe-to-spend, today ring, month bar, recent),
   Transactions (grouped by day, filters, edit sheet), Quick add, Review inbox, Insights,
   Settings. PWA manifest, icons, service worker, dark/light toggle. Seed data.
7. **M6 — Email poller.** Worker (`npm run worker`) + one-shot mode + cron endpoint.
   Disabled cleanly when IMAP env vars are missing.
8. **M7 — Docs + polish.** `docs/IOS_SHORTCUT_SETUP.md`, `docs/DEPLOY.md` (Railway),
   README, CI workflow, MORNING_REPORT.md, PR.

## Definition of done (MVP)

- `docker compose up -d && npm i && npm run db:migrate && npm run db:seed && npm run dev`
  shows a live-looking app.
- `curl -X POST /api/ingest/sms` with a real-looking HDFC SMS creates a categorised
  transaction; sending the same transaction's email alert does not double count it.
- Unparseable bank messages show up in the Review inbox and can become a transaction in one tap.
- `npm run typecheck && npm run lint && npm test` all pass.
