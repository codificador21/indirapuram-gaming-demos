import type { IngestOutcome } from './pipeline';
import { formatINR } from '@/lib/money';

/** One-line human summary for webhook responses / logs (shown by the Shortcut if notifications are on). */
export function describeOutcome(out: IngestOutcome): string {
  switch (out.status) {
    case 'created': {
      const t = out.transaction;
      const what = `${formatINR(t.amountPaise)} ${t.direction === 'debit' ? 'spent' : 'received'}`;
      return `${what}${t.merchant ? ` · ${t.merchant}` : ''} · ${t.categoryId}${t.excludeFromBudget ? ' (excluded)' : ''}`;
    }
    case 'duplicate':
      return `Already recorded (${out.reason.replace('_', ' ')})`;
    case 'ignored':
      return `Ignored (${out.reason.replace('_', ' ')})`;
    case 'needs_review':
      return 'Saved to Review inbox';
  }
}
