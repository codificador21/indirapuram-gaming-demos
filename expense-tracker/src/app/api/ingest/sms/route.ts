/**
 * POST /api/ingest/sms — called by the iOS Shortcuts automation for every bank SMS.
 *
 *   Authorization: Bearer <INGEST_TOKEN>
 *   Content-Type: application/json
 *   { "text": "<SMS body>", "sender": "VM-HDFCBK", "receivedAt": "2026-10-21T14:35:00+05:30" }
 *
 * `sender` and `receivedAt` are optional. A plain-text body (just the SMS) is also accepted.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { hasValidIngestToken } from '@/lib/auth';
import { appTimezone } from '@/lib/env';
import { describeOutcome } from '@/lib/ingest/describe';
import { ingestMessage } from '@/lib/ingest/pipeline';
import { parseSmsPayload } from '@/lib/ingest/request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!hasValidIngestToken(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  let raw: unknown;
  try {
    raw = contentType.includes('application/json') ? await request.json() : await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  // Some Shortcut setups send JSON with a text/plain content type.
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      raw = JSON.parse(raw);
    } catch {
      /* treat as plain SMS text */
    }
  }

  const payload = parseSmsPayload(raw, appTimezone());
  if (!payload.ok) return NextResponse.json({ ok: false, error: payload.error }, { status: 400 });

  const outcome = await ingestMessage(getDb(), {
    source: 'sms',
    via: 'webhook',
    sender: payload.value.sender,
    body: payload.value.text,
    receivedAt: payload.value.receivedAt,
  });
  const summary = describeOutcome(outcome);
  console.log(`[ingest/sms] ${outcome.status} raw=${outcome.rawMessageId ?? '-'} ${outcome.status === 'created' ? `txn=${outcome.transaction.id}` : ''}`);
  return NextResponse.json({
    ok: true,
    status: outcome.status,
    rawMessageId: outcome.rawMessageId,
    transactionId: outcome.status === 'created' ? outcome.transaction.id : outcome.status === 'duplicate' ? outcome.transactionId : null,
    summary,
  });
}
