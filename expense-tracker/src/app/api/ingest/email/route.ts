/**
 * POST /api/ingest/email — optional alternative to the IMAP poller for services that can POST
 * incoming email as JSON (e.g. an email-to-webhook forwarder).
 *
 *   Authorization: Bearer <INGEST_TOKEN>
 *   { "from": "alerts@hdfcbank.net", "subject": "...", "text": "...", "html": "...",
 *     "messageId": "<...>", "receivedAt": "2026-10-21T09:05:00Z" }
 *
 * The same filter as IMAP applies: known bank senders, or subjects containing IMAP_SUBJECT_TAG.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { hasValidIngestToken } from '@/lib/auth';
import { appTimezone, env } from '@/lib/env';
import { emailToIngestInput } from '@/lib/email/to-message';
import { describeOutcome } from '@/lib/ingest/describe';
import { ingestMessage } from '@/lib/ingest/pipeline';
import { parseReceivedAt } from '@/lib/ingest/request';

export const dynamic = 'force-dynamic';

const schema = z.object({
  from: z.string().min(3).max(320),
  subject: z.string().max(1000).optional().nullable(),
  text: z.string().max(200_000).optional().nullable(),
  html: z.string().max(1_000_000).optional().nullable(),
  messageId: z.string().max(1000).optional().nullable(),
  receivedAt: z.union([z.string(), z.number()]).optional().nullable(),
});

export async function POST(request: Request) {
  if (!hasValidIngestToken(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Expected JSON { from, subject?, text?, html?, messageId?, receivedAt? }' }, { status: 400 });

  const e = env();
  const decision = emailToIngestInput(
    { ...parsed.data, date: parseReceivedAt(parsed.data.receivedAt, new Date(), appTimezone()) },
    { subjectTag: e.IMAP_SUBJECT_TAG, extraSenders: (e.IMAP_EXTRA_SENDERS ?? '').split(',') },
    'email-webhook',
  );
  if (decision.kind === 'skip') return NextResponse.json({ ok: true, status: 'skipped', reason: decision.reason });

  const outcome = await ingestMessage(getDb(), decision.input);
  return NextResponse.json({ ok: true, status: outcome.status, rawMessageId: outcome.rawMessageId, summary: describeOutcome(outcome) });
}
