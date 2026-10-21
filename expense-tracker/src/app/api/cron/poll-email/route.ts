/**
 * POST /api/cron/poll-email — runs one IMAP poll cycle. For hosts without an always-on worker:
 * point any cron service (Railway cron, cron-job.org, GitHub Actions schedule) at it with
 *   Authorization: Bearer <INGEST_TOKEN>
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { hasValidIngestToken } from '@/lib/auth';
import { imapConfigFromEnv, pollMailboxOnce, summaryText } from '@/lib/email/poller';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasValidIngestToken(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const cfg = imapConfigFromEnv();
  if (!cfg) return NextResponse.json({ ok: true, status: 'disabled', message: 'IMAP is not configured' });
  try {
    const summary = await pollMailboxOnce(getDb(), cfg);
    return NextResponse.json({ ok: true, status: 'done', summary, message: summaryText(summary) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
