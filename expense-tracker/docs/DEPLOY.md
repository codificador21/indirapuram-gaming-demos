# Deploying Kharcha

**Recommended host: [Railway](https://railway.com)** — one project holds the web app, Postgres and
the email worker, deploys from GitHub on every push, and gives you a public HTTPS URL for the
iPhone Shortcut.

> Why not the others? Render's free web service sleeps after ~15 minutes idle (the first SMS of the
> morning would hit a cold start and the Shortcut may time out), its free Postgres expires after a
> month, and background workers are paid. Vercel has no long-running worker or bundled Postgres.
> Fly.io works too but needs more setup.

**Cost:** Railway has no permanent free tier. The Hobby plan is about **$5/month including $5 of
usage**; this app (small Next.js server + Postgres + an idle worker) should land around
$5–10/month. Check [railway.com/pricing](https://railway.com/pricing) for current numbers. You can
start on the trial credit.

---

## 0. Before you start

- The code is in the `expense-tracker/` folder of this repository (branch `mvp/expense-tracker`,
  or `main` once merged).
- Generate three secrets on your laptop:

  ```bash
  openssl rand -base64 24   # → APP_PASSWORD (or pick your own long password)
  openssl rand -base64 32   # → SESSION_SECRET
  openssl rand -hex 24      # → INGEST_TOKEN (hex: safe to paste into Shortcuts)
  ```

## 1. Create the project and database

1. Sign in at [railway.com](https://railway.com) with GitHub.
2. **New Project → Deploy from GitHub repo →** pick `indirapuram-gaming-demos`. Railway creates a
   service and starts a build — it will fail until step 2 is done; that's fine.
3. In the project canvas: **+ Create → Database → PostgreSQL**. Wait until it's running.

## 2. Configure the web service

Open the service created in step 1 → **Settings**:

| Setting | Value |
| --- | --- |
| **Source → Root Directory** | `/expense-tracker` |
| **Source → Branch** | `mvp/expense-tracker` (or `main` after merging) |
| **Config-as-code → Railway Config File** | `/expense-tracker/railway.json` (absolute path from the repo root — the config file does *not* follow Root Directory) |
| **Networking → Public Networking → Generate Domain** | click it; you get something like `kharcha-production.up.railway.app` |

`railway.json` already sets: build `npm run build`, pre-deploy `npm run db:migrate` (applies
migrations + default categories on every deploy), start `npm start`, health check `/api/health`.
Railway reads the Node version from `package.json` → `engines` (Node 22).

Then **Variables** (on the web service). Tip: put the shared ones in **Project Settings → Shared
Variables** and reference them from both services.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference — uses Railway's private network, no TLS needed) |
| `APP_PASSWORD` | your login password |
| `SESSION_SECRET` | 32+ random characters |
| `INGEST_TOKEN` | 24+ random characters (the Shortcut sends this) |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `PUBLIC_BASE_URL` | `https://<your-domain>.up.railway.app` (no trailing slash) |
| `IMAP_*` | optional — same values as the worker below, enables Settings → "Check email now" |

Click **Deploy**. When it's green:

```bash
curl https://<your-domain>.up.railway.app/api/health
# {"ok":true,"db":true}
```

Open the URL on your iPhone, sign in, and go to **Settings** to enter your salary, credit day,
fixed commitments (rent/SIP/EMI with keywords) and your own accounts.

> Want demo data to look at first? Copy the **Postgres** service's `DATABASE_PUBLIC_URL` variable
> (the private URL only works inside Railway), then on your laptop:
> `DATABASE_URL='<public url>' npm run db:seed` (add `DATABASE_SSL=no-verify` if it complains about
> TLS). Seed refuses to run if transactions exist; `npm run db:reset` **wipes** them first. Skip this
> for real use.

## 3. Point the iPhone Shortcut at it

Webhook URL: **`https://<your-domain>.up.railway.app/api/ingest/sms`**
Header: **`Authorization: Bearer <INGEST_TOKEN>`**

Follow [IOS_SHORTCUT_SETUP.md](./IOS_SHORTCUT_SETUP.md). Before touching the phone you can test
the live endpoint from your laptop:

```bash
cd expense-tracker
INGEST_TOKEN=<token> npm run ingest:sample -- https://<your-domain>.up.railway.app
# 200 {"ok":true,"status":"created",...,"summary":"₹250 spent · Swiggy · food"}
```

(Delete the test transaction in the app afterwards.)

## 4. Email alerts (optional): worker service

Only needed if you want bank alert emails (or the "forward SMS by email" fallback).

1. In the project: **+ Create → GitHub Repo →** the same repository again. Name it `email-worker`.
2. Settings:
   - **Root Directory:** `/expense-tracker`
   - **Branch:** same as the web service
   - **Railway Config File:** `/expense-tracker/railway.worker.json` (start command `npm run worker`)
   - No public domain needed.
3. Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_TIMEZONE=Asia/Kolkata`, and:

   | Variable | Gmail example |
   | --- | --- |
   | `IMAP_HOST` | `imap.gmail.com` |
   | `IMAP_PORT` | `993` |
   | `IMAP_SECURE` | `true` |
   | `IMAP_USER` | `you@gmail.com` |
   | `IMAP_PASSWORD` | 16-character **app password** (see below) |
   | `IMAP_MAILBOX` | `INBOX` (or a label, e.g. `Bank alerts`) |
   | `IMAP_POLL_INTERVAL_SECONDS` | `120` |
   | `IMAP_SUBJECT_TAG` | `[ET-SMS]` |

4. Deploy. Logs should show `[email] polling you@gmail.com / INBOX … every 120s`. Settings in the
   web app shows the last check time and any error.

**Gmail app password:** turn on 2-Step Verification for the Google account, then create one at
<https://myaccount.google.com/apppasswords> (name it "Kharcha"). Your normal password will not work
over IMAP. Outlook/Zoho/etc.: use that provider's IMAP host and app password.

**Bank emails:** enable email alerts for each account/card in net banking (HDFC "InstaAlerts", ICICI
"Transaction alerts", SBI, Axis, Kotak "Alerts") so the same transactions also arrive by email — the
app de-duplicates them against the SMS.

**Cheaper alternative to an always-on worker:** use `/expense-tracker/railway.cron.json` instead
(runs `npm run poll:once` every 5 minutes and exits), or call
`POST https://<domain>/api/cron/poll-email` with the `Authorization: Bearer <INGEST_TOKEN>` header from
any external cron service.

## 5. Updating

Push to the branch → Railway rebuilds, runs `npm run db:migrate`, then swaps traffic once
`/api/health` returns 200. Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`
locally, commit the new file in `drizzle/`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build says `config file /expense-tracker/railway.json does not exist` | Config path must start with `/expense-tracker/`, Root Directory must be `/expense-tracker`. |
| Deploys don't trigger on push | Clear the service's **Watch Paths** (they come from `railway.json` → `watchPatterns`). |
| `/api/health` returns `db:false` | `DATABASE_URL` missing or not a reference to the Postgres service. If you use an external Postgres with TLS, set `DATABASE_SSL=require` (or `no-verify`). |
| Shortcut gets 401 | Header must be exactly `Authorization` = `Bearer <INGEST_TOKEN>` (one space, no quotes). |
| Login says APP_PASSWORD is not set | Add the variable to the **web** service and redeploy. |
| Worker log: `Login failed — check IMAP_USER / IMAP_PASSWORD` | Use an app password; for Gmail 2-Step Verification must be on. |
| Times are 5½ hours off | Set `APP_TIMEZONE=Asia/Kolkata` on every service. |

## Running anywhere else

It's a standard Node app — any host with Node 22 and Postgres works:

```bash
npm ci && npm run build      # build
npm run db:migrate           # before each release
npm start                    # web (PORT env var respected)
npm run worker               # optional email worker (separate process)
```
