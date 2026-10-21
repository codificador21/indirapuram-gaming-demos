/**
 * Duplicate detection: the same transaction often arrives as an SMS *and* an email (and sometimes an
 * app receipt). Rules, in order:
 *   1. Same reference (UPI RRN / UTR / txn id) + same amount + same direction → duplicate.
 *   2. Both sides carry a 12-digit UPI RRN and they differ → NOT a duplicate (two real payments).
 *   3. Same amount + direction + compatible account (last digits match, or one side unknown)
 *      + occurred within ±10 minutes + arrived through a *different* source (SMS vs email vs manual)
 *      → duplicate. A bank sends one SMS per payment, so two different SMS with the same amount a
 *      few minutes apart are two payments (two ₹20 chais), not one.
 */
import { isRrn } from './parser/generic';

export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export interface DedupeCandidate {
  amountPaise: number;
  direction: 'debit' | 'credit';
  occurredAt: Date;
  accountLast4: string | null;
  reference: string | null;
  /** 'sms' | 'email' | 'manual'. When both sides have one and they're equal, rule 3 doesn't apply. */
  source?: string | null;
}

export type DuplicateReason = 'reference' | 'window';

export function normaliseRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const r = ref.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return r.length >= 6 ? r : null;
}

/** "123" (ICICI shows 3 digits) is compatible with "0123"; "1234" is not compatible with "5678". */
export function accountsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return a.endsWith(b) || b.endsWith(a);
}

export function duplicateReason(candidate: DedupeCandidate, existing: DedupeCandidate): DuplicateReason | null {
  if (candidate.direction !== existing.direction || candidate.amountPaise !== existing.amountPaise) return null;
  const rc = normaliseRef(candidate.reference);
  const re = normaliseRef(existing.reference);
  if (rc && re) {
    if (rc === re) return 'reference';
    if (isRrn(rc) && isRrn(re)) return null;
  }
  if (candidate.source && existing.source && candidate.source === existing.source && candidate.source !== 'manual') return null;
  if (Math.abs(candidate.occurredAt.getTime() - existing.occurredAt.getTime()) > DEDUPE_WINDOW_MS) return null;
  if (!accountsCompatible(candidate.accountLast4, existing.accountLast4)) return null;
  return 'window';
}

/** Best duplicate among existing transactions: reference matches beat time-window matches; then closest in time. */
export function findDuplicate<T extends DedupeCandidate>(candidate: DedupeCandidate, existing: T[]): { match: T; reason: DuplicateReason } | null {
  let best: { match: T; reason: DuplicateReason; delta: number } | null = null;
  for (const e of existing) {
    const reason = duplicateReason(candidate, e);
    if (!reason) continue;
    const delta = Math.abs(candidate.occurredAt.getTime() - e.occurredAt.getTime());
    const better =
      !best || (reason === 'reference' && best.reason !== 'reference') || (reason === best.reason && delta < best.delta);
    if (better) best = { match: e, reason, delta };
  }
  return best ? { match: best.match, reason: best.reason } : null;
}
