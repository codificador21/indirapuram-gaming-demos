'use client';

import { useActionState, useEffect, useState, useTransition, type ReactNode } from 'react';
import { dismissReviewAction, reprocessReviewAction, resolveReviewAction, type ActionState } from '@/app/actions';
import { CategoryPicker } from '@/components/category-picker';
import { MailIcon, MessageIcon } from '@/components/icons';
import { Sheet } from '@/components/sheet';
import { toast } from '@/components/toaster';
import { buttonClass, inputClass, labelClass } from '@/components/ui';
import type { Category } from '@/db/schema';
import { dayLabel } from '@/lib/format';
import { formatTime, localDayKey } from '@/lib/time';

export interface ReviewItem {
  id: number;
  source: 'sms' | 'email';
  sender: string | null;
  subject: string | null;
  body: string;
  receivedAt: string;
  status: string;
  reason: string | null;
  transactionId: number | null;
  prefill: { amount: string; direction: 'debit' | 'credit'; merchant: string; occurredAt: string };
}

const REASONS: Record<string, string> = {
  otp: 'OTP',
  promo: 'Promotion',
  reminder: 'Reminder / bill due',
  failed: 'Declined / failed',
  request: 'Collect request',
  balance_info: 'Balance update',
  non_financial: 'Not a transaction',
  no_amount: 'No amount found',
  no_direction: 'Debit or credit?',
  same_message: 'Same message again',
  duplicate_reference: 'Same UPI ref',
  duplicate_window: 'Same amount, same time',
  transaction_deleted: 'Transaction deleted',
};

const STATUS_STYLE: Record<string, string> = {
  needs_review: 'bg-critical-soft text-critical-ink',
  parsed: 'bg-accent-soft/40 text-accent-ink',
  duplicate: 'bg-surface-3 text-ink-2',
  ignored: 'bg-surface-3 text-muted',
  resolved: 'bg-accent-soft/40 text-accent-ink',
  dismissed: 'bg-surface-3 text-muted',
};

export function ReviewList({
  items,
  categories,
  tz,
  nowIso,
  mode,
  empty,
}: {
  items: ReviewItem[];
  categories: Category[];
  tz: string;
  nowIso: string;
  mode: 'review' | 'ignored' | 'all';
  empty: ReactNode;
}) {
  const [creating, setCreating] = useState<ReviewItem | null>(null);
  const [pending, start] = useTransition();
  const now = new Date(nowIso);

  if (items.length === 0) return <>{empty}</>;
  return (
    <>
      {mode !== 'all' && (
        <div className="mb-3 flex justify-end gap-1">
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await reprocessReviewAction();
                toast(res?.ok ? (res.message ?? 'Done') : (res?.error ?? 'Failed'), res?.ok ? 'ok' : 'error');
              })
            }
          >
            Re-check with latest parser
          </button>
          {mode === 'review' && items.length > 1 && (
            <button
              type="button"
              className={buttonClass.ghost}
              disabled={pending}
              onClick={() => {
                if (!confirm(`Dismiss all ${items.length} messages?`)) return;
                start(async () => {
                  await dismissReviewAction(items.map((i) => i.id));
                  toast('Dismissed');
                });
              }}
            >
              Dismiss all
            </button>
          )}
        </div>
      )}
      <ul className={`space-y-3 ${pending ? 'opacity-60' : ''}`}>
        {items.map((item) => {
          const at = new Date(item.receivedAt);
          return (
            <li key={item.id} className="rounded-3xl bg-surface p-4 ring-1 ring-line">
              <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                  {item.source === 'email' ? <MailIcon size={15} /> : <MessageIcon size={15} />}
                  <span className="truncate font-medium">{item.sender ?? 'Unknown sender'}</span>
                </span>
                <span className="shrink-0 text-muted">
                  {dayLabel(localDayKey(at, tz), now, tz)}, {formatTime(at, tz)}
                </span>
              </div>
              {item.subject && <p className="mb-1 truncate text-[13px] font-medium">{item.subject}</p>}
              <p className="line-clamp-6 text-[14px] leading-snug break-words whitespace-pre-wrap text-ink">{item.body}</p>
              <div className="mt-3">
                <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[item.status] ?? 'bg-surface-3'}`}>
                  {item.status.replace('_', ' ')}
                  {item.reason && REASONS[item.reason] ? ` · ${REASONS[item.reason]}` : item.status === 'parsed' && item.reason ? ` · ${item.reason}` : ''}
                </span>
              </div>
              {(item.status === 'needs_review' || item.status === 'ignored' || (item.status === 'dismissed' && !item.transactionId) || item.status === 'duplicate') && (
                <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                  {item.status === 'needs_review' && (
                    <button
                      type="button"
                      className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink-2 ring-1 ring-line"
                      onClick={() =>
                        start(async () => {
                          await dismissReviewAction([item.id]);
                          toast('Dismissed');
                        })
                      }
                    >
                      Dismiss
                    </button>
                  )}
                  <button
                    type="button"
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${item.status === 'duplicate' ? 'text-accent-ink ring-1 ring-line' : 'bg-accent text-on-accent'}`}
                    onClick={() => setCreating(item)}
                  >
                    {item.status === 'duplicate' ? 'Not a duplicate? Add it' : 'Create transaction'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {creating && <CreateSheet item={creating} categories={categories} onClose={() => setCreating(null)} />}
    </>
  );
}

function CreateSheet({ item, categories, onClose }: { item: ReviewItem; categories: Category[]; onClose: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveReviewAction, null);
  const [direction, setDirection] = useState(item.prefill.direction);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast('Transaction created');
      onClose();
    } else if (state?.error) toast(state.error, 'error');
  }, [state, onClose]);

  return (
    <Sheet open onClose={onClose} title="Create transaction">
      <p className="mb-4 rounded-2xl bg-surface-2 p-3 text-[13px] leading-snug break-words whitespace-pre-wrap text-ink-2 ring-1 ring-line">{item.body}</p>
      <form action={action} className="space-y-4">
        <input type="hidden" name="rawId" value={item.id} />
        <input type="hidden" name="direction" value={direction} />
        <input type="hidden" name="channel" value="other" />
        <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1 ring-1 ring-line">
          {(['debit', 'credit'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`rounded-xl py-2 text-sm font-semibold ${direction === d ? 'bg-surface text-ink shadow ring-1 ring-line' : 'text-muted'}`}
            >
              {d === 'debit' ? 'Money out' : 'Money in'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Amount (₹)</label>
            <input name="amount" defaultValue={item.prefill.amount} inputMode="decimal" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>When</label>
            <input name="occurredAt" type="datetime-local" defaultValue={item.prefill.occurredAt} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Merchant / payee</label>
          <input name="merchant" defaultValue={item.prefill.merchant} className={inputClass} />
        </div>
        <div>
          <div className={labelClass}>Category</div>
          <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} name="categoryId" direction={direction} />
        </div>
        <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
          {pending ? 'Saving…' : 'Create transaction'}
        </button>
      </form>
    </Sheet>
  );
}
