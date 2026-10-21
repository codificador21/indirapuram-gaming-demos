/**
 * Bank SMS / email alert parser.
 *
 *   parseMessage({ text, sender, receivedAt, source })
 *     → { status: 'transaction', txn }         money moved; all fields we could extract
 *     → { status: 'ignored', reason }          OTP / promo / reminder / declined / collect request…
 *     → { status: 'unparsed', reason, partial} looked financial but amount/direction unknown → Review inbox
 *
 * Pipeline: normalise → noise filter → per-bank format templates (formats.ts) → generic extractors
 * (generic.ts) fill the gaps → merchant clean-up → hints (refund, salary, self-transfer, card bill…).
 */
import { DEFAULT_TIMEZONE } from '@/lib/time';
import { detectBank } from './banks';
import { resolveOccurredAt } from './dates';
import { TEMPLATES, type FormatTemplate } from './formats';
import {
  cardType,
  extractChannel,
  extractGeneric,
  extractHints,
  last4,
  parseNeftDescriptor,
} from './generic';
import { cleanMerchant, nameFromVpa, VPA_RE } from './merchant';
import { classifyNoise } from './noise';
import { flatten, normalizeText, toPaise } from './text';
import type { Extracted, MessageInput, ParseResult, ParsedTransaction } from './types';

export type { BankCode, MessageInput, ParseResult, ParsedTransaction, IgnoreReason } from './types';
export { cleanMerchant, merchantKey } from './merchant';
export { isRrn } from './generic';

interface TemplateHit {
  template: FormatTemplate;
  fields: Extracted;
}

function applyTemplates(flat: string): TemplateHit | null {
  for (const template of TEMPLATES) {
    const m = template.pattern.exec(flat);
    if (!m?.groups) continue;
    const g = m.groups;
    const amountPaise = toPaise(g.amount);
    if (!amountPaise) continue;
    const fields: Extracted = {
      amountPaise,
      accountLast4: last4(g.acct),
      payee: g.payee?.trim() || null,
      reference: g.ref ? g.ref.toUpperCase() : undefined,
      balancePaise: g.bal ? toPaise(g.bal) : undefined,
      dateText: g.date,
      accountType: template.accountType ?? (g.ctype ? cardType(flat, g.ctype) : undefined),
    };
    return { template, fields };
  }
  return null;
}

const pick = <T,>(...values: Array<T | null | undefined>): T | null => {
  for (const v of values) if (v !== undefined && v !== null && v !== '') return v;
  return null;
};

export function parseMessage(input: MessageInput, opts: { timezone?: string } = {}): ParseResult {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const text = normalizeText(input.text);
  const flat = flatten(text);
  const bank = detectBank(input.sender, flat);

  const noise = classifyNoise(flat);
  if (noise) return { status: 'ignored', reason: noise, bank };

  const hit = applyTemplates(flat);
  const gen = extractGeneric(flat);
  const f = hit?.fields ?? {};

  const amountPaise = pick(f.amountPaise, gen.amountPaise);
  const direction = hit?.template.direction ?? gen.direction;
  const accountType = pick(f.accountType, gen.accountType);
  let payee = pick(f.payee, gen.payee);
  let reference = pick(f.reference, gen.reference);

  // NEFT/IMPS credit descriptors carry the remitter name and UTR.
  const neft = payee ? parseNeftDescriptor(payee) : null;
  if (neft) {
    payee = neft.name;
    reference = reference ?? neft.ref;
  }

  const partial: Partial<ParsedTransaction> = {
    amountPaise: amountPaise ?? undefined,
    direction: direction ?? undefined,
    payee,
    accountLast4: pick(f.accountLast4, gen.accountLast4),
    reference,
    bank: hit?.template.bank ?? bank,
  };
  if (!amountPaise) return { status: 'unparsed', reason: 'no_amount', partial, bank };
  if (!direction) return { status: 'unparsed', reason: 'no_direction', partial, bank };

  const when = resolveOccurredAt(f.dateText ? `${f.dateText} ` : flat, input.receivedAt, tz);
  // A template's date group may lack the time that appears elsewhere in the message.
  const occurred = when.source === 'message' || !f.dateText ? when : resolveOccurredAt(flat, input.receivedAt, tz);

  const payeeVpa = pick(
    payee && VPA_RE.test(payee) ? VPA_RE.exec(payee)![1]!.toLowerCase() : null,
    gen.payeeVpa,
  );
  const channel = hit?.template.channel ?? extractChannel(flat, accountType);
  const hints = extractHints(flat, direction, accountType, payee);
  if (payeeVpa && direction && channel === 'upi' && !hints.p2p) {
    const name = nameFromVpa(payeeVpa);
    if (name && name.includes(' ') && !/[0-9]/.test(payeeVpa.split('@')[0]!)) hints.p2p = true;
  }

  let merchant = cleanMerchant(payee);
  if (channel === 'atm' || hints.atm) merchant = 'ATM withdrawal';
  if (!merchant && payeeVpa) merchant = nameFromVpa(payeeVpa) ?? payeeVpa;

  const txn: ParsedTransaction = {
    amountPaise,
    direction,
    occurredAt: occurred.date,
    occurredAtSource: occurred.source,
    merchant,
    payee,
    payeeVpa,
    accountLast4: partial.accountLast4 ?? null,
    accountType,
    bank: partial.bank ?? null,
    channel,
    reference,
    balancePaise: pick(f.balancePaise, gen.balancePaise),
    hints,
  };
  return { status: 'transaction', txn, parser: hit?.template.id ?? 'generic' };
}
