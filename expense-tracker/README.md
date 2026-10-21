# Kharcha — personal expense tracker

A single-user, India-first expense tracker. Bank SMS (via an iPhone Shortcut) and bank alert emails
(via IMAP) are parsed automatically, de-duplicated, categorised, and turned into a **"safe to spend
today"** number with rollover. Mobile-first PWA, dark by default.

- **Morning summary:** [MORNING_REPORT.md](./MORNING_REPORT.md)
- **Why things are the way they are:** [DECISIONS.md](./DECISIONS.md)
- **iPhone setup:** [docs/IOS_SHORTCUT_SETUP.md](./docs/IOS_SHORTCUT_SETUP.md)
- **Deploy (Railway):** [docs/DEPLOY.md](./docs/DEPLOY.md)

## Run it locally

Needs Node 22+ and Docker (or any Postgres — set `DATABASE_URL`).

```bash
cd expense-tracker
cp .env.example .env && docker compose up -d --wait   # Postgres 16 on localhost:5432
npm install
npm run setup        # migrations + ~7 weeks of realistic demo data
npm run dev          # http://localhost:3000 — password: change-me (APP_PASSWORD in .env)
```

Send a fake bank SMS to the local webhook (what the iPhone does):

```bash
npm run ingest:sample                    # random sample SMS → http://localhost:3000
npm run ingest:sample -- --list          # see all 52 sample messages
```

## What's inside

| Path | What |
| --- | --- |
| `src/lib/parser/` | Bank SMS/email parser: noise filter, per-bank templates (`formats.ts`), generic extractors, 52 fixtures (`fixtures.ts`) |
| `src/lib/ingest/pipeline.ts` | One pipeline for webhook, email and seed: store raw → parse → dedupe → classify → save |
| `src/lib/dedupe.ts` | UPI ref first, then amount + direction + account ± 10 min |
| `src/lib/categorise.ts` | Keyword map + learned per-merchant rules |
| `src/lib/classify.ts` | Salary / refund / reimbursement / income; self-transfers, card bills, fixed commitments |
| `src/lib/budget.ts` | Rollover budget engine (pure, fully tested) |
| `src/lib/email/` | IMAP poller + email → message conversion |
| `src/worker/email-worker.ts` | `npm run worker` / `npm run poll:once` |
| `src/app/(app)/` | Pages: Home, Activity, Add, Review, Insights, Settings |
| `src/app/api/` | `POST /api/ingest/sms`, `POST /api/ingest/email`, `POST /api/cron/poll-email`, `GET /api/health` |
| `src/db/schema.ts` | Drizzle schema (money in paise); migrations in `drizzle/` |
| `scripts/` | `migrate.ts`, `seed.ts`, `ingest-sample.ts` |
| `tests/` | Postgres + IMAP integration tests |

## Scripts

| Command | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | typecheck + lint + tests (run before every commit) |
| `npm test` | Vitest — unit tests always; DB/IMAP integration tests when Postgres is reachable at `TEST_DATABASE_URL` (default `postgres://expense:expense@localhost:5432/expense_test` — docker-compose creates it) |
| `npm run db:migrate` | Apply migrations + default categories (safe to re-run) |
| `npm run db:generate` | After editing `src/db/schema.ts`: write a new SQL migration |
| `npm run db:seed` / `db:reset` | Demo data (reset **wipes** transactions first) |
| `npm run worker` / `poll:once` | Email poller (exits cleanly if IMAP isn't configured) |
| `npm run ingest:sample [url] [fixture]` | POST a sample SMS to a server |

## Adding a bank format

1. Paste the real SMS/email into `src/lib/parser/fixtures.ts` with the expected fields.
2. `npm test` — if it fails, add a template in `src/lib/parser/formats.ts` (named groups `amount`,
   `acct`, `payee`, `date`, `ref`, `bal`).
3. Messages that couldn't be parsed are kept in the Review inbox, so you can re-check them after
   the fix.
