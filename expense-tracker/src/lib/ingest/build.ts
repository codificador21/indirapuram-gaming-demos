/**
 * Turns a parsed message into a transaction row (category, credit kind, exclusions) — pure.
 */
import type { NewTransaction } from '@/db/schema';
import { categorise } from '@/lib/categorise';
import { classifyCredit, detectExclusion, type ClassifyInput } from '@/lib/classify';
import type { CommitmentKind, TxnSource } from '@/lib/domain';
import { merchantKey } from '@/lib/parser/merchant';
import type { ParsedTransaction } from '@/lib/parser/types';
import type { IngestContext } from './context';

const COMMITMENT_CATEGORY: Partial<Record<CommitmentKind, string>> = {
  rent: 'home',
  sip: 'investments',
  emi: 'emi_loans',
  insurance: 'bills',
  subscription: 'entertainment',
};

function fallbackMerchant(p: ParsedTransaction, creditKind: string | null): string | null {
  if (p.merchant) return p.merchant;
  if (p.hints.cardBillPayment) return p.direction === 'debit' ? 'Credit card bill payment' : 'Card payment received';
  if (creditKind === 'salary') return 'Salary';
  if (p.hints.interest) return 'Interest';
  return null;
}

export function buildTransaction(p: ParsedTransaction, ctx: IngestContext, source: TxnSource, text?: string): NewTransaction {
  const ci: ClassifyInput = {
    direction: p.direction,
    amountPaise: p.amountPaise,
    occurredAt: p.occurredAt,
    merchant: p.merchant,
    payee: p.payee,
    payeeVpa: p.payeeVpa,
    channel: p.channel,
    hints: p.hints,
    text,
  };
  const creditKind = classifyCredit(ci, ctx);
  const exclusion = detectExclusion(ci, ctx);
  const merchant = fallbackMerchant(p, creditKind);
  const key = merchantKey(p.merchant ?? p.payeeVpa);
  const cat = categorise(
    { direction: p.direction, merchant, merchantKey: key, payee: p.payeeVpa ?? p.payee, channel: p.channel, hints: p.hints, creditKind },
    ctx.rules,
  );

  let categoryId = cat.categoryId;
  if (exclusion.reason === 'self_transfer' || exclusion.reason === 'card_bill') categoryId = 'self_transfer';
  if (exclusion.reason === 'commitment' && cat.source !== 'rule') {
    const c = ctx.commitments.find((x) => x.id === exclusion.commitmentId) as { kind?: CommitmentKind } | undefined;
    categoryId = (c?.kind && COMMITMENT_CATEGORY[c.kind]) || categoryId;
  }

  const exclude = exclusion.exclude || !!cat.ruleExcludes;
  return {
    occurredAt: p.occurredAt,
    amountPaise: p.amountPaise,
    direction: p.direction,
    merchant,
    merchantKey: key,
    payee: p.payeeVpa ?? p.payee,
    bank: p.bank,
    accountLast4: p.accountLast4,
    accountType: p.accountType,
    channel: p.channel,
    reference: p.reference,
    balancePaise: p.balancePaise,
    categoryId,
    categorySource: cat.source,
    creditKind,
    excludeFromBudget: exclude,
    excludeReason: exclusion.reason ?? (cat.ruleExcludes ? 'manual' : null),
    commitmentId: exclusion.commitmentId,
    source,
  };
}
