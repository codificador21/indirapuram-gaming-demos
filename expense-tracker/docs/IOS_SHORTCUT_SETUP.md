# iPhone setup: send bank SMS to Kharcha automatically

iOS doesn't let apps read SMS, but the **Shortcuts** app can run an automation whenever a message
arrives and post it to your Kharcha server. You build it once; after that every bank SMS shows up in
the app within a few seconds, silently.

```
Bank SMS arrives ──► Shortcuts automation ("Message contains debited") ──► "Send to Kharcha" shortcut
                                                                        └─► POST https://<your-app>/api/ingest/sms
```

**You need:**
- The public URL of your deployment (see [DEPLOY.md](./DEPLOY.md)), e.g.
  `https://kharcha-production.up.railway.app`. The URL must be reachable from the internet —
  `localhost` won't work from the phone.
- Your `INGEST_TOKEN` value.
- iOS 17 or newer (for "Run Immediately"). Menu names below are from iOS 17/18; newer versions may
  word them slightly differently.

> Check the server before touching the phone:
> `INGEST_TOKEN=<token> npm run ingest:sample -- https://<your-app>` should print `200 … "created"`.

---

## Part A — build the "Send to Kharcha" shortcut (once)

This shortcut does the actual sending. Each automation in Part B just calls it, so you only type the
URL and token once.

1. Open **Shortcuts** → **Shortcuts** tab → **+** (top right).
2. Tap the title at the top → **Rename** → `Send to Kharcha`.
3. Tap **Add Action**, search for **Get Contents of URL**, add it.
4. Tap the blue **URL** placeholder and type:
   `https://<your-app>/api/ingest/sms`
5. Tap the **›** (Show More) arrow on the action:
   - **Method:** `POST`
   - **Headers → Add new header:**
     - Key: `Authorization`
     - Value: `Bearer <your INGEST_TOKEN>` — the word `Bearer`, one space, then the token.
   - **Request Body:** `JSON`
     - **Add new field → Text**, key `text`. Tap the value field → in the variable bar above the
       keyboard tap **Shortcut Input**. Then tap the inserted *Shortcut Input* token and, if it offers
       properties, choose **Content** (the message text).
     - **Add new field → Text**, key `sender`. Value: **Shortcut Input** → choose **Sender**.
       (Optional — it only helps detect the bank.)
6. Tap **Done**.

That's all the server needs. `receivedAt` is optional; the server uses the time it receives the
request, which is the moment the SMS arrived.

### Optional: keep personal chats on the phone

Keyword automations also fire for normal conversations ("I spent the evening…"). The server files
those under Review → Ignored, but you can stop them leaving the phone:

1. In `Send to Kharcha`, add **Match Text** *above* Get Contents of URL.
   - Pattern: `(?i)(a/c|acct|card|upi|vpa|neft|imps|atm|inr)`
   - Text: **Shortcut Input** (Content)
2. Add **If** → condition **Matches** *has any value*.
3. Drag **Get Contents of URL** inside the If block (between *If* and *Otherwise*).

Every bank alert format we've seen contains at least one of those words.

---

## Part B — the automations (one per keyword)

iOS lets each Message automation watch for **one** phrase, so create one automation per keyword.
Duplicates are harmless — if one SMS matches three keywords, the server stores it once and ignores
the copies (same text within an hour).

Recommended keywords: **`debited`**, **`credited`**, **`spent`**, **`UPI`**, **`INR`**, **`Rs.`**

(`Rs.` also matches ordinary words like "hours." — use the optional filter above if that bothers you.
These six cover every HDFC, ICICI, SBI, Axis, Kotak and Paytm format in the test fixtures; e.g. SBI's
UPI alert says "debited by 180.0" without "Rs", HDFC's says "Sent Rs.250 … BLOCK UPI".)

For each keyword:

1. **Shortcuts** → **Automation** tab → **+** (or **New Automation**).
2. Scroll to and choose **Message**.
3. **Message Contains** → type the keyword, e.g. `debited`. Leave **Sender** empty (bank sender IDs
   like `VM-HDFCBK` aren't contacts).
4. Choose **Run Immediately** and switch **Notify When Run** **off**. Tap **Next**.
5. Choose **New Blank Automation** (on some versions: *Create New Shortcut*).
6. **Add Action** → search **Run Shortcut** → add it → tap the shortcut placeholder → pick
   **Send to Kharcha**.
7. Tap the **›** arrow on Run Shortcut → **Input** → choose **Shortcut Input**.
8. **Done**.

Repeat for the other keywords. (If your iOS lets you tap **Next** with *both* Sender and Message
Contains left empty, a single automation for every message works too — then definitely add the
optional filter from Part A.)

---

## Part C — test it

1. Ask a friend (or use a second phone) to text you:
   `Rs.1.00 debited from A/c XX0000 on <today, e.g. 21-10-26> to TEST SHOP. UPI Ref 629400000001`
2. Within a few seconds it should appear in Kharcha → **Activity** as *Test Shop ₹1*. Tap it →
   **Delete**.
3. Every message the server receives — even ignored or unreadable ones — is listed under
   **Review → All messages**, which is the quickest way to see whether the Shortcut is firing.

---

## Fallback: forward the SMS by email instead

Use this if you'd rather not call the webhook from the phone (e.g. the server isn't public yet, or
your iOS version keeps asking for confirmation). It needs the email poller (DEPLOY.md, step 4).

In **Send to Kharcha**, replace *Get Contents of URL* with **Send Email**:

- **To:** the mailbox the poller reads (`IMAP_USER`, e.g. `you@gmail.com`)
- **Subject:** `[ET-SMS] ` followed by the **Shortcut Input → Sender** variable
  (`[ET-SMS]` must match `IMAP_SUBJECT_TAG`)
- **Body:** type `Sender: `, insert **Shortcut Input → Sender**, press return, then insert
  **Shortcut Input → Content**
- Tap the **›** arrow → switch **Show Compose Sheet** **off** (so it sends silently). The Mail app
  must have an account set up to send from.

The poller picks these up on its next run (default every 2 minutes), unwraps the SMS from the email
and processes it exactly like a webhook SMS. Tip for Gmail: add a filter `subject:"[ET-SMS]"` →
*Skip the Inbox* + label `Bank alerts`, and set `IMAP_MAILBOX=Bank alerts`.

You can even keep both on: the same SMS arriving by webhook and by email is stored once.

---

## Troubleshooting

| Problem | Try |
| --- | --- |
| Nothing arrives | Shortcuts → Automation: is each automation switched on? Is the keyword spelled exactly? Check Review → All messages on the server. |
| A notification or "Run" prompt appears | Edit the automation → **Run Immediately**, **Notify When Run** off. Some iOS releases still show a brief banner; that's iOS, not the app. |
| Doesn't run while the phone is locked | Some iOS 18+ builds only run automations after unlock. Look for **Allow Running When Locked** / Shortcuts permissions in Settings, or accept that alerts arrive when you next unlock (the time is still taken from the SMS). |
| Server returns 401 | The header must be `Authorization` with value `Bearer <token>` — no quotes, one space. |
| Server returns 400 "Missing text" | The `text` field is empty: re-insert **Shortcut Input** and pick **Content**. |
| Lots of personal messages under Review → Ignored | Add the optional filter in Part A, or drop the `Rs.` automation. |
| Phone lost | Change `INGEST_TOKEN` on the server (and `APP_PASSWORD`/`SESSION_SECRET` to sign out all devices). |

### What the request looks like

```http
POST /api/ingest/sms HTTP/1.1
Host: <your-app>
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{ "text": "Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 21/10/26\nRef 629412345678", "sender": "VM-HDFCBK-S" }
```

Response (the Shortcut ignores it, but it's handy when debugging):

```json
{ "ok": true, "status": "created", "transactionId": 42, "summary": "₹250 spent · Swiggy · food" }
```

`status` is one of `created`, `duplicate`, `ignored` (OTP/promo/reminder…), `needs_review`.
The endpoint also accepts `message`/`body` instead of `text`, `from` instead of `sender`, an optional
`receivedAt` (ISO 8601, epoch, or the default Shortcuts date format), and a plain-text body.
