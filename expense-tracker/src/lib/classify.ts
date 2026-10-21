/**
 * Budget-relevant classification of a parsed transaction:
 * - what kind of credit it is (salary / refund / reimbursement / other income)
 * - whether it should be excluded from daily spending (self-transfer, card bill, fixed commitment)
 *
 * Pure functions; the ingest pipeline feeds them settings loaded from the DB.
 */
import type { Channel, CreditKind, Direction, ExcludeReason } from './domain';
import { keywordCategory } from './categorise';
import type { ParseHints } from './parser/types';
import { localParts, daysInMonth, DEFAULT_TIMEZONE } from './time';

export interface ClassifyInput {
  direction: Direction;
  amountPaise: number;
  occurredAt: Date;
  merchant: string | null;
  payee: string | null;
  payeeVpa: string | null;
  channel: Channel;
  hints: ParseHints;
  /** Raw message text (used for commitment keyword matching). */
  text?: string;
}

export interface ClassifyContext {
  monthlySalaryPaise: number;
  salaryCreditDay: number;
  selfIdentifiers: string[];
  myAccountLast4s: string[];
  commitments: Array<{ id: number; name: string; amountPaise: number; matchKeywords: string; active: boolean }>;
  timezone?: string;
}

/** Days between two days-of-month, wrapping around month ends (30th vs 1st → 1 or 2). */
function dayOfMonthDistance(a: number, b: number, monthLength: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, monthLength - d);
}

export function looksLikeSalary(input: ClassifyInput, ctx: ClassifyContext): boolean {
  if (input.direction !== 'credit') return false;
  if (input.hints.salary) return true;
  const salary = ctx.monthlySalaryPaise;
  if (!salary || input.hints.refund || input.hints.p2p) return false;
  const ratio = input.amountPaise / salary;
  if (Math.abs(ratio - 1) <= 0.02) return true; // within 2% of the configured salary, any day
  const p = localParts(input.occurredAt, ctx.timezone ?? DEFAULT_TIMEZONE);
  const near = dayOfMonthDistance(p.day, Math.min(ctx.salaryCreditDay, daysInMonth(p.year, p.month)), daysInMonth(p.year, p.month)) <= 4;
  return near && ratio >= 0.6 && ratio <= 1.6 && ['neft', 'imps', 'rtgs', 'other', 'netbanking'].includes(input.channel);
}

/**
 * Credit kind (only for credits). See DECISIONS.md "Non-salary credits".
 *  salary → no effect on spend · refund/reimbursement → offsets spend · income → ignored
 */
export function classifyCredit(input: ClassifyInput, ctx: ClassifyContext): CreditKind | null {
  if (input.direction !== 'credit') return null;
  const h = input.hints;
  if (h.cardBillPayment) return 'income'; // excluded anyway
  if (h.refund) return 'refund';
  if (looksLikeSalary(input, ctx)) return 'salary';
  if (h.interest) return 'income';
  if (h.p2p) return 'reimbursement';
  // A credit from a known merchant (e.g. VPA swiggy.refunds@...) is a refund even without the word.
  if (keywordCategory(input.merchant, input.payee)) return 'refund';
  // UPI credits from unknown people are usually split-bill paybacks.
  if (input.channel === 'upi') return 'reimbursement';
  return 'income';
}

export interface ExclusionResult {
  exclude: boolean;
  reason: ExcludeReason | null;
  commitmentId: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.]/g, '');

export function matchesSelf(input: ClassifyInput, ctx: ClassifyContext): boolean {
  const ids = ctx.selfIdentifiers.map((s) => s.trim()).filter((s) => s.length >= 3);
  const hay = [input.payee, input.merchant, input.payeeVpa].filter(Boolean).map((s) => norm(s!));
  if (ids.some((id) => hay.some((h) => h === norm(id) || (norm(id).length >= 5 && h.includes(norm(id)))))) return true;
  // Paid to "A/c XX1234" where 1234 is one of my accounts.
  const benef = /^a\/c\s*[x*]*(\d{3,4})$/i.exec(input.payee ?? input.merchant ?? '');
  return !!benef && ctx.myAccountLast4s.some((l4) => l4.endsWith(benef[1]!) || benef[1]!.endsWith(l4));
}

export function matchCommitment(input: ClassifyInput, ctx: ClassifyContext): number | null {
  if (input.direction !== 'debit') return null;
  const hay = [input.merchant, input.payee, input.payeeVpa, input.text].filter(Boolean).join(' ').toLowerCase();
  for (const c of ctx.commitments) {
    if (!c.active || !c.amountPaise) continue;
    const keywords = c.matchKeywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length >= 2);
    if (keywords.length === 0) continue;
    const within = Math.abs(input.amountPaise - c.amountPaise) <= c.amountPaise * 0.1;
    if (within && keywords.some((k) => hay.includes(k))) return c.id;
  }
  return null;
}

export function detectExclusion(input: ClassifyInput, ctx: ClassifyContext): ExclusionResult {
  if (input.hints.cardBillPayment) return { exclude: true, reason: 'card_bill', commitmentId: null };
  if (input.hints.selfTransfer || matchesSelf(input, ctx)) return { exclude: true, reason: 'self_transfer', commitmentId: null };
  const commitmentId = matchCommitment(input, ctx);
  if (commitmentId) return { exclude: true, reason: 'commitment', commitmentId };
  return { exclude: false, reason: null, commitmentId: null };
}

export const SELF_TRANSFER_WINDOW_MS = 30 * 60 * 1000;

export interface PairCandidate {
  id: number;
  direction: Direction;
  amountPaise: number;
  occurredAt: Date;
  accountLast4: string | null;
  channel: Channel;
  categoryId: string;
  creditKind: CreditKind | null;
  excludeFromBudget: boolean;
  transferPairId: number | null;
}

/**
 * Debit on one of my accounts + credit of the same amount on a *different* account of mine within
 * 30 minutes → money moved between my own accounts. Card spends and merchant refunds never pair.
 */
export function isSelfTransferPair(a: PairCandidate, b: PairCandidate): boolean {
  if (a.direction === b.direction || a.amountPaise !== b.amountPaise) return false;
  if (a.transferPairId || b.transferPairId || a.excludeFromBudget || b.excludeFromBudget) return false;
  if (!a.accountLast4 || !b.accountLast4 || a.accountLast4.endsWith(b.accountLast4) || b.accountLast4.endsWith(a.accountLast4)) return false;
  if (Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) > SELF_TRANSFER_WINDOW_MS) return false;
  const debit = a.direction === 'debit' ? a : b;
  const credit = a.direction === 'credit' ? a : b;
  const transferChannels: Channel[] = ['upi', 'imps', 'neft', 'rtgs', 'netbanking', 'other'];
  if (!transferChannels.includes(debit.channel) || !transferChannels.includes(credit.channel)) return false;
  if (!['transfers', 'other', 'self_transfer'].includes(debit.categoryId)) return false;
  return credit.creditKind === 'reimbursement' || credit.creditKind === 'income';
}
