'use client';

import { useState } from 'react';
import type { Category } from '@/db/schema';

/** Grid of category chips. `kind` limits which categories show (expense for debits, all for credits). */
export function CategoryPicker({
  categories,
  value,
  onChange,
  name,
  showAll = false,
  direction = 'debit',
}: {
  categories: Category[];
  value: string | null;
  onChange?: (id: string) => void;
  name?: string;
  showAll?: boolean;
  direction?: 'debit' | 'credit';
}) {
  const [expanded, setExpanded] = useState(showAll);
  const relevant = categories.filter((c) => (direction === 'debit' ? c.kind !== 'income' : true));
  const primary = relevant.slice(0, 11);
  const visible = expanded ? relevant : primary.some((c) => c.id === value) || !value ? primary : [...primary, relevant.find((c) => c.id === value)!];
  return (
    <div>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <div className="grid grid-cols-4 gap-2">
        {visible.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange?.(c.id)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-center text-[11px] leading-tight font-medium transition active:scale-95 ${
                active ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2 ring-1 ring-line'
              }`}
            >
              <span className="text-xl leading-none">{c.emoji}</span>
              <span className="line-clamp-2">{c.name}</span>
            </button>
          );
        })}
        {!expanded && relevant.length > visible.length && (
          <button type="button" onClick={() => setExpanded(true)} className="rounded-2xl bg-surface-2 px-1 py-2.5 text-[11px] font-medium text-accent-ink ring-1 ring-line">
            <span className="block text-xl leading-none">⋯</span>More
          </button>
        )}
      </div>
    </div>
  );
}
