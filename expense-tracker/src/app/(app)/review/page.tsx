import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/db';
import { InboxIcon } from '@/components/icons';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import type { RawStatus } from '@/lib/domain';
import { appTimezone } from '@/lib/env';
import { cleanMerchant } from '@/lib/parser/merchant';
import { findAmounts, flatten } from '@/lib/parser/text';
import { getCategories, reviewItems } from '@/lib/queries';
import { toDateTimeLocalValue } from '@/lib/time';
import { ReviewList, type ReviewItem } from './review-list';

export const metadata: Metadata = { title: 'Review' };

const TABS: Array<{ id: string; label: string; statuses: RawStatus[] }> = [
  { id: 'review', label: 'Needs review', statuses: ['needs_review'] },
  { id: 'ignored', label: 'Ignored', statuses: ['ignored'] },
  { id: 'all', label: 'All messages', statuses: ['parsed', 'duplicate', 'ignored', 'needs_review', 'resolved', 'dismissed'] },
];

interface Partial {
  amountPaise?: number;
  direction?: 'debit' | 'credit';
  payee?: string | null;
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'review' } = await searchParams;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const db = getDb();
  const tz = appTimezone();
  const [rows, categories, pendingRows] = await Promise.all([reviewItems(db, current.statuses, current.id === 'all' ? 150 : 100), getCategories(db), reviewItems(db, ['needs_review'], 500)]);

  const items: ReviewItem[] = rows.map((r) => {
    const parsed = (r.parsed ?? {}) as { partial?: Partial; txn?: Partial };
    const partial = parsed.partial ?? parsed.txn ?? {};
    const amount = partial.amountPaise ?? findAmounts(flatten(r.body)).find((a) => !a.isBalanceLike)?.paise ?? null;
    const direction = partial.direction ?? (/\b(credited|received|deposited|refund)/i.test(r.body) ? 'credit' : 'debit');
    return {
      id: r.id,
      source: r.source,
      sender: r.sender,
      subject: r.subject,
      body: r.body,
      receivedAt: r.receivedAt.toISOString(),
      status: r.status,
      reason: r.statusReason,
      transactionId: r.transactionId,
      prefill: {
        amount: amount ? String(amount / 100) : '',
        direction,
        merchant: cleanMerchant(partial.payee) ?? '',
        occurredAt: toDateTimeLocalValue(r.receivedAt, tz),
      },
    };
  });

  return (
    <>
      <PageHeader title="Review" subtitle="Messages that need a human. Nothing is ever dropped silently." />
      <div className="mb-4 grid grid-cols-3 rounded-2xl bg-surface-2 p-1 ring-1 ring-line">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'review' ? '/review' : `/review?tab=${t.id}`}
            scroll={false}
            className={`rounded-xl py-2 text-center text-[13px] font-semibold ${t.id === current.id ? 'bg-surface text-ink shadow ring-1 ring-line' : 'text-muted'}`}
          >
            {t.label}
            {t.id === 'review' && pendingRows.length > 0 ? ` (${pendingRows.length})` : ''}
          </Link>
        ))}
      </div>
      <ReviewList
        items={items}
        categories={categories}
        tz={tz}
        mode={current.id as 'review' | 'ignored' | 'all'}
        empty={
          <Card>
            <EmptyState title={current.id === 'review' ? 'All clear' : 'Nothing here'} icon={<InboxIcon size={32} />}>
              {current.id === 'review'
                ? 'Bank messages that can’t be read automatically show up here, so you can turn them into transactions in one tap.'
                : current.id === 'ignored'
                  ? 'OTPs, promos and payment reminders are filed here instead of being thrown away.'
                  : 'Messages from your Shortcut and email will appear here.'}
            </EmptyState>
          </Card>
        }
      />
    </>
  );
}
