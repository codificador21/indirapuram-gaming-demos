/**
 * IMAP poller: looks at mail from the last IMAP_LOOKBACK_DAYS, keeps only bank/UPI alert senders and
 * subjects carrying IMAP_SUBJECT_TAG (SMS forwarded by the Shortcut fallback), skips Message-IDs that
 * were already ingested, and feeds the rest to the ingest pipeline.
 *
 * By default it does NOT rely on the \Seen flag (an alert I open on my phone before the next poll
 * would otherwise be lost); set IMAP_ONLY_UNSEEN=true to look at unread mail only.
 * Mail from anyone else is never downloaded or flagged — only its envelope is read.
 */
import { inArray } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Db } from '@/db';
import { appState, rawMessages } from '@/db/schema';
import { env, imapConfigured } from '@/lib/env';
import { ingestMessage } from '@/lib/ingest/pipeline';
import { isKnownAlertSender } from '@/lib/parser/banks';
import { emailToIngestInput, type EmailFilter } from './to-message';
import type { PollerState } from './poller-state';

export interface PollSummary {
  checked: number;
  /** Matched alerts skipped because their Message-ID was ingested before. */
  known: number;
  matched: number;
  created: number;
  duplicates: number;
  ignored: number;
  review: number;
  skipped: number;
  errors: number;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  lookbackDays: number;
  markSeen: boolean;
  onlyUnseen: boolean;
  filter: EmailFilter;
}

export function imapConfigFromEnv(): ImapConfig | null {
  if (!imapConfigured()) return null;
  const e = env();
  return {
    host: e.IMAP_HOST!,
    port: e.IMAP_PORT,
    secure: e.IMAP_SECURE,
    user: e.IMAP_USER!,
    password: e.IMAP_PASSWORD!,
    mailbox: e.IMAP_MAILBOX,
    lookbackDays: Math.max(1, e.IMAP_LOOKBACK_DAYS),
    markSeen: e.IMAP_MARK_SEEN,
    onlyUnseen: e.IMAP_ONLY_UNSEEN,
    filter: {
      subjectTag: e.IMAP_SUBJECT_TAG,
      extraSenders: (e.IMAP_EXTRA_SENDERS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

export function summaryText(s: PollSummary): string {
  if (s.matched === 0) return `checked ${s.checked} emails, nothing new from your banks`;
  return `${s.matched} alert${s.matched === 1 ? '' : 's'}: ${s.created} new, ${s.duplicates} duplicate, ${s.ignored} ignored, ${s.review} to review${s.errors ? `, ${s.errors} failed` : ''}`;
}

async function saveState(db: Db, patch: Partial<PollerState>) {
  const value: PollerState = { lastRunAt: null, lastResult: null, lastError: null, lastErrorAt: null, ...patch };
  await db
    .insert(appState)
    .values({ key: 'email_poller', value })
    .onConflictDoUpdate({ target: appState.key, set: { value: patch.lastError === undefined ? { ...value, lastError: null } : value } });
}

/** imapflow errors are terse ("Command failed"); turn the common ones into something actionable. */
export function describeImapError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  if (e?.authenticationFailed) return 'Login failed — check IMAP_USER / IMAP_PASSWORD (Gmail needs a 16-character app password, and IMAP enabled).';
  if (e?.code === 'ENOTFOUND') return `Can't find the IMAP server — check IMAP_HOST.`;
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT') return 'Could not connect — check IMAP_HOST / IMAP_PORT / IMAP_SECURE.';
  if (e?.responseText) return e.responseText;
  return e?.message ?? String(err);
}

function fallbackMessageId(cfg: ImapConfig, uid: number) {
  return `<imap-${cfg.user}-${cfg.mailbox}-${uid}>`;
}

let running = false;

/** One poll cycle. Safe to call concurrently (a second call while one runs is a no-op). */
export async function pollMailboxOnce(db: Db, cfg: ImapConfig, log: Pick<Console, 'log' | 'error'> = console): Promise<PollSummary> {
  const summary: PollSummary = { checked: 0, known: 0, matched: 0, created: 0, duplicates: 0, ignored: 0, review: 0, skipped: 0, errors: 0 };
  if (running) return summary;
  running = true;
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox);
    try {
      const since = new Date(Date.now() - cfg.lookbackDays * 86_400_000);
      const uids = (await client.search(cfg.onlyUnseen ? { seen: false, since } : { since }, { uid: true })) || [];
      summary.checked = uids.length;

      // 1. Envelopes only (cheap) — decide which messages are ours. No other IMAP command may run
      //    while iterating a fetch, so collect first.
      const matches: Array<{ uid: number; messageId: string }> = [];
      if (uids.length > 0) {
        for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0]?.address ?? '';
          const subject = msg.envelope?.subject ?? '';
          const tagged = cfg.filter.subjectTag && subject.toLowerCase().includes(cfg.filter.subjectTag.toLowerCase());
          if (tagged || isKnownAlertSender(from, cfg.filter.extraSenders)) {
            matches.push({ uid: msg.uid, messageId: msg.envelope?.messageId ?? fallbackMessageId(cfg, msg.uid) });
          } else summary.skipped += 1;
        }
      }
      const known = matches.length
        ? new Set(
            (await db.select({ id: rawMessages.externalId }).from(rawMessages).where(inArray(rawMessages.externalId, matches.map((m) => m.messageId)))).map((r) => r.id),
          )
        : new Set<string | null>();
      const candidates = matches.filter((m) => !known.has(m.messageId)).map((m) => m.uid);
      summary.known = matches.length - candidates.length;

      // 2. Download + ingest the matches, one at a time.
      for (const uid of candidates) {
        try {
          const msg = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true, internalDate: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mail = await simpleParser(msg.source);
          const fromAddr = mail.from?.value?.[0]?.address ?? msg.envelope?.from?.[0]?.address ?? '';
          const decision = emailToIngestInput(
            {
              from: fromAddr,
              subject: mail.subject ?? msg.envelope?.subject ?? '',
              text: mail.text ?? null,
              html: typeof mail.html === 'string' ? mail.html : null,
              messageId: mail.messageId ?? msg.envelope?.messageId ?? fallbackMessageId(cfg, uid),
              date: mail.date ?? (msg.internalDate ? new Date(msg.internalDate) : new Date()),
            },
            cfg.filter,
            'imap',
          );
          if (decision.kind === 'skip') {
            summary.skipped += 1;
            continue;
          }
          summary.matched += 1;
          const out = await ingestMessage(db, decision.input);
          if (out.status === 'created') summary.created += 1;
          else if (out.status === 'duplicate') summary.duplicates += 1;
          else if (out.status === 'ignored') summary.ignored += 1;
          else summary.review += 1;
          if (cfg.markSeen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        } catch (err) {
          summary.errors += 1;
          log.error(`[email] failed to process uid ${uid}:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      lock.release();
    }
    await saveState(db, { lastRunAt: new Date().toISOString(), lastResult: summaryText(summary) });
    return summary;
  } catch (err) {
    const message = describeImapError(err);
    await saveState(db, { lastRunAt: new Date().toISOString(), lastResult: 'failed', lastError: message, lastErrorAt: new Date().toISOString() }).catch(() => undefined);
    throw new Error(message, { cause: err });
  } finally {
    running = false;
    await client.logout().catch(() => undefined);
  }
}
