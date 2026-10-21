# Morning report

**Status: the MVP is built, tested and committed** on branch `mvp/expense-tracker` (PR open against
`main`). Everything is in the `expense-tracker/` folder; the existing gaming-demos site is untouched.
CI (typecheck, lint, 204 tests including Postgres and IMAP integration tests, production build) is
green on GitHub.
An independent code review of the branch found 10 issues; all are fixed, with tests added for the
behavioural ones. Nothing is deployed yet — that needs your accounts (about 20 minutes, below).

Screenshots (iPhone size): [home](docs/screenshots/home-dark.png) ·
[activity](docs/screenshots/activity-dark.png) · [edit sheet](docs/screenshots/edit-sheet-dark.png) ·
[insights](docs/screenshots/insights-dark.png) · [charts](docs/screenshots/insights-charts-dark.png) ·
[review inbox](docs/screenshots/review-dark.png) · [quick add](docs/screenshots/add-dark.png) ·
[light mode](docs/screenshots/home-light.png)

---

## What works

**Capture**
- `POST /api/ingest/sms`, bearer-token protected, built for the iOS Shortcut. Accepts JSON
  `{ text, sender?, receivedAt? }` or plain text.
- IMAP email poller (`npm run worker`, or `npm run poll:once` / `POST /api/cron/poll-email` for
  cron). It reads recent mail from known bank/UPI senders or with the `[ET-SMS]` subject tag, skips
  Message-IDs it has already ingested, and marks processed mail read. Without IMAP settings it exits cleanly. It was tested
  against a real IMAP server implementation; other mail is never downloaded or touched.
- The "forward SMS by email" fallback goes through the same pipeline.
- Optional `POST /api/ingest/email` for email-to-webhook services.

**Parsing**
- Per-format regex templates cover HDFC, ICICI, SBI, Axis, Kotak, Paytm Payments Bank, PhonePe and
  GPay, across SMS and email. A generic fallback handles unseen variants.
- It extracts amount, debit/credit, merchant (cleaned from VPAs like `swiggy.upi@axisbank` → Swiggy),
  account last-4, UPI ref/UTR, IST date-time and balance.
- 52 fixtures, one test each.
- OTPs, promos, payment-due/statement/"will be debited" reminders, declined transactions and collect
  requests are ignored but still stored under Review → Ignored. Anything unreadable goes to the
  **Review inbox**, where one tap turns it into a transaction. "Re-check with latest parser"
  reprocesses old messages after a parser fix.

**Dedupe:** UPI ref first; then amount + direction + account within ±10 minutes across sources (an
SMS and its email). Two different UPI refs never merge, and two different SMS for same-amount
payments stay separate. The same SMS posted twice, or the same email processed twice, is recorded once.
Concurrent SMS + email arrivals are serialised with a DB lock. It's tested in both arrival orders
and for a race.

**Classification**
- Categories come from a keyword map (Swiggy/Zomato → Food, Uber/Ola/Rapido → Transport, and so on).
- Recategorising in the UI remembers the merchant and re-files past auto-categorised transactions.
- Credits are classified as salary (by keyword, amount or salary day), refund, payback from a
  friend, or other income.
- Auto-excluded from the budget:
  - credit-card bill payments (no double counting)
  - self-transfers: your own names/VPAs/accounts, or a debit and credit of the same amount on two of
    your accounts within 30 minutes
  - fixed commitments (rent/SIP/EMI matched by keyword and amount)

**Budget**
- Monthly budget = salary − fixed commitments; the fixed daily figure = budget ÷ days in month.
- **Safe to spend today** = (budget − spent before today) ÷ days left including today, minus what
  you've spent today. So unspent money rolls forward and overspending shrinks future days.
- Also shown: tomorrow's figure if you stop now, the month bar with an even-pace marker, and a
  projection.
- The month is the calendar month by default; a salary cycle is optional.

**UI:** a mobile-first PWA, installable to the iPhone home screen, dark by default with a light
theme. Pages:
- **Home:** ring and big number.
- **Activity:** grouped by day, search, category chips, tap to edit, swipe left for
  category/exclude.
- **Quick add:** cash default, remembers merchant categories.
- **Review inbox.**
- **Insights:** category bars, daily spend vs the rollover budget line, cumulative vs pace, top
  merchants.
- **Settings:** salary, credit day, commitments, accounts, rules, capture status.

Amounts use Indian digit grouping (₹1,23,456). Login is a single password with a 30-day session
cookie.

**Ops:** Drizzle migrations, idempotent `db:migrate` (also the Railway pre-deploy step), a realistic
seed (~7 weeks of SMS/email pushed through the real pipeline), Railway config-as-code and a GitHub
Actions workflow.

## Run it locally (4 commands)

```bash
cd expense-tracker
cp .env.example .env && docker compose up -d --wait
npm install
npm run setup     # migrate + demo data
npm run dev       # http://localhost:3000 — password: change-me
```

`npm run check` runs typecheck + lint + tests. `npm run ingest:sample` fakes an incoming bank SMS.

## What you need to configure

1. **Deploy** (about 20 minutes): follow [docs/DEPLOY.md](docs/DEPLOY.md). It covers a Railway
   project, a Postgres plugin, and a web service with root `/expense-tracker` and config
   `/expense-tracker/railway.json`. Set `APP_PASSWORD`, `SESSION_SECRET`, `INGEST_TOKEN`,
   `APP_TIMEZONE=Asia/Kolkata` and `PUBLIC_BASE_URL`, then generate a domain. Expect about
   $5–10/month on the Hobby plan.
2. **iPhone Shortcut** (about 10 minutes): follow
   [docs/IOS_SHORTCUT_SETUP.md](docs/IOS_SHORTCUT_SETUP.md). Build one "Send to Kharcha" shortcut,
   plus one Message automation per keyword (`debited`, `credited`, `spent`, `UPI`, `INR`, `Rs.`), set
   to *Run Immediately* with *Notify When Run* off. Test the server first with
   `npm run ingest:sample -- https://<your-app>`.
3. **Email (optional):** create a Gmail app password (needs 2-Step Verification), add the
   `email-worker` service with the `IMAP_*` variables, and turn on email alerts in each bank's
   netbanking.
4. **In the app → Settings:** your net salary and credit day, fixed commitments *with keywords*
   (e.g. Rent → landlord's name, SIP → `zerodha`), your accounts/cards (last 4 digits) and your own
   names/UPI IDs. These drive salary detection, commitment exclusion and self-transfer detection.

## Known gaps / caveats

- **Not tested on a real iPhone or real bank messages.** The fixtures mirror real formats as I know
  them, but banks tweak wording. Expect a few messages in the Review inbox in week one; each one is
  a fixture plus template away from being fixed (see README → "Adding a bank format").
- **Shortcut UI wording** may differ slightly on your iOS version. Some iOS 18+ builds only run
  message automations after the phone is unlocked. The guide covers both.
- **Dedupe window:** a card-spend email arriving more than 10 minutes after its SMS, with no
  reference number, will double count. You can delete it, or widen `DEDUPE_WINDOW_MS`. The reverse
  case (two identical-looking payments merged) can be undone from Review → All messages → "Not a
  duplicate? Add it".
- **Email poller deviates from the brief on purpose:** it checks all recent mail (not only unread)
  and skips already-ingested Message-IDs, so alerts you open on your phone aren't lost. Set
  `IMAP_ONLY_UNSEEN=true` for strict unread-only (DECISIONS D25).
- **Bank emails are mostly HTML;** they're converted to text with a simple stripper. The email
  templates are based on typical wording and will likely need a tweak once real emails flow.
- INR only: foreign-currency card spends (USD/EUR) go to Review.
- Login throttling is in-memory (fine for one instance). No 2FA.
- No data export/backup UI yet (Railway Postgres has backups; `pg_dump` works).
- The service worker only provides an offline page; there's no offline data or queued adds.
- `npm audit` flags dev-only tooling (eslint plugin, drizzle-kit); nothing in the runtime path.
- I couldn't deploy (no credentials), so the Railway steps are written from the docs, not clicked
  through.
- **GitHub Pages:** if this repo's root is published with Pages, merging to `main` also makes the
  `expense-tracker/` files (source, docs, screenshots — no secrets) browsable under
  `/expense-tracker/`. If you'd rather not, move the folder to its own repo (it has no dependency on
  the rest of this one) before merging.

## Next steps (prioritised)

1. **Deploy and connect the phone** (steps above). Run it for a week and use Review → Ignored /
   Needs review to spot formats that need templates.
2. **Turn real unparsed messages into fixtures and templates.** This is the highest-leverage
   accuracy work.
3. **Email alerts on** for every bank/card, so SMS gaps (phone off, automation not firing) are
   covered by email with no double counting.
4. **CSV export + scheduled `pg_dump`.** It's your financial history; back it up.
5. **Per-category monthly limits** and a nudge when today's safe-to-spend hits zero (web push).
6. **Subscription/recurring detection** (Netflix, Spotify, SIPs) to suggest fixed commitments
   automatically.
7. **Split-bill tracking:** link a payback to the expense it repays, rather than offsetting the
   month as a whole.
8. **Foreign-currency parsing** (USD/EUR card spends with the INR amount from the statement).

## Where to look

- [PLAN.md](PLAN.md): milestones as planned.
- [DECISIONS.md](DECISIONS.md): 31 decisions, each with what I chose, why, and how to change it.
- [README.md](README.md): code map, scripts, how to add a bank format.
