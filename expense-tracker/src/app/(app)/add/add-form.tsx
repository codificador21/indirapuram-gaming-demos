'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { addTransactionAction, type ActionState } from '@/app/actions';
import { CategoryPicker } from '@/components/category-picker';
import { toast } from '@/components/toaster';
import { buttonClass, inputClass, labelClass } from '@/components/ui';
import type { Category } from '@/db/schema';
import { CREDIT_KIND_LABELS, type CreditKind } from '@/lib/domain';

const METHODS = [
  { id: 'cash', label: '💵 Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
] as const;

export function AddForm({ categories, merchants, nowLocal }: { categories: Category[]; merchants: Array<{ merchant: string; categoryId: string }>; nowLocal: string }) {
  const [formKey, setFormKey] = useState(0);
  return <AddFormInner key={formKey} categories={categories} merchants={merchants} nowLocal={nowLocal} onSaved={() => setFormKey((k) => k + 1)} />;
}

function AddFormInner({
  categories,
  merchants,
  nowLocal,
  onSaved,
}: {
  categories: Category[];
  merchants: Array<{ merchant: string; categoryId: string }>;
  nowLocal: string;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTransactionAction, null);
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pickedByHand, setPickedByHand] = useState(false);
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('cash');
  const [creditKind, setCreditKind] = useState<CreditKind>('reimbursement');
  const amountRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (state?.ok) {
      toast('Saved ✓');
      onSaved();
    } else if (state?.error) toast(state.error, 'error');
  }, [state, onSaved]);

  const onMerchant = (value: string) => {
    if (pickedByHand) return;
    const hit = merchants.find((m) => m.merchant.toLowerCase() === value.trim().toLowerCase());
    if (hit) setCategoryId(hit.categoryId);
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="channel" value={method} />
      {direction === 'credit' && <input type="hidden" name="creditKind" value={creditKind} />}

      <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1 ring-1 ring-line">
        {(['debit', 'credit'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`rounded-xl py-2 text-sm font-semibold transition ${direction === d ? 'bg-surface text-ink shadow ring-1 ring-line' : 'text-muted'}`}
          >
            {d === 'debit' ? 'Spent' : 'Received'}
          </button>
        ))}
      </div>

      <label className="flex items-baseline justify-center gap-1 py-2" onClick={() => amountRef.current?.focus()}>
        <span className="text-4xl font-semibold text-muted">₹</span>
        <input
          ref={amountRef}
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          required
          autoFocus
          pattern="[0-9,]*[.]?[0-9]{0,2}"
          aria-label="Amount in rupees"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
          className="bg-transparent text-left text-[56px] leading-none font-bold tracking-tight text-ink placeholder:text-surface-3 focus:outline-none"
          style={{ fontSize: 56, width: `${Math.max(1, amount.length) * 0.62 + 0.3}em` }}
        />
      </label>

      <div>
        <label className={labelClass} htmlFor="merchant">
          {direction === 'debit' ? 'What for?' : 'From whom?'}
        </label>
        <input id="merchant" name="merchant" list="merchant-list" placeholder={direction === 'debit' ? 'e.g. Chai tapri, auto, vegetables' : 'e.g. Rahul'} className={inputClass} autoComplete="off" onChange={(e) => onMerchant(e.target.value)} />
        <datalist id="merchant-list">
          {merchants.map((m) => (
            <option key={m.merchant} value={m.merchant} />
          ))}
        </datalist>
      </div>

      {direction === 'credit' && (
        <div>
          <div className={labelClass}>How should it count?</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CREDIT_KIND_LABELS) as CreditKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCreditKind(k)}
                className={`rounded-2xl px-3 py-2.5 text-left text-[13px] font-medium ring-1 ring-line ${creditKind === k ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2'}`}
              >
                {CREDIT_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className={labelClass}>Category {categoryId ? '' : <span className="text-muted">(optional — I’ll guess)</span>}</div>
        <CategoryPicker
          categories={categories}
          value={categoryId}
          name="categoryId"
          direction={direction}
          onChange={(id) => {
            setPickedByHand(true);
            setCategoryId((cur) => (cur === id ? null : id));
          }}
        />
      </div>

      <div>
        <div className={labelClass}>Paid with</div>
        <div className="flex gap-2">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold ring-1 ring-line ${method === m.id ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className={labelClass} htmlFor="occurredAt">
            When
          </label>
          <input id="occurredAt" name="occurredAt" type="datetime-local" defaultValue={nowLocal} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="notes">
            Note
          </label>
          <input id="notes" name="notes" placeholder="Optional" className={inputClass} />
        </div>
        <label className="flex items-center gap-3 px-1 text-sm text-ink-2">
          <input type="checkbox" name="exclude" className="h-5 w-5 accent-[var(--accent)]" />
          Don’t count this in my budget
        </label>
      </div>

      <div className="sticky bottom-[88px] z-10 -mx-4 flex gap-2 bg-gradient-to-t from-page via-page to-page/0 px-4 pt-6 pb-2">
        <Link href="/" className={`${buttonClass.secondary} w-24`}>
          Done
        </Link>
        <button type="submit" disabled={pending} className={`${buttonClass.primary} flex-1`}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
