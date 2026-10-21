/**
 * Bank-agnostic field extractors. Used on their own for formats without a template, and to fill in
 * fields a template did not capture.
 */
import type { AccountType, Channel, Direction } from '@/lib/domain';
import { VPA_RE } from './merchant';

import { AMT, CUR, findAmounts, toPaise } from './text';
import type { Extracted, ParseHints } from './types';

// ── Amount ────────────────────────────────────────────────────────────────────

export function extractAmount(flat: string): number | null {
  const amounts = findAmounts(flat);
  const first = amounts.find((a) => !a.isBalanceLike);
  if (first) return first.paise;
  // SBI style: "debited by 250.0" (no currency marker)
  const m = new RegExp(String.raw`\b(?:debited|credited)\s+(?:by|for|with)\s+(?:${CUR})?${AMT}`, 'i').exec(flat);
  return m ? toPaise(m[1]) : null;
}

export function extractBalance(flat: string): number | null {
  const m = new RegExp(
    String.raw`\b(?:avl|avail|available|aval|a\/c|clear|closing)\.?\s*(?:bal|balance|bal\.)\b\s*(?:in\s+a\/c\s+\S+\s+)?(?:is|:|-|of)?\s*(?:${CUR})?:?\s*${AMT}`,
    'i',
  ).exec(flat);
  return m ? toPaise(m[1]) : null;
}

// ── Direction ─────────────────────────────────────────────────────────────────

const ACCT_WORD = String.raw`(?:a\/c|a\/c\.|ac|acct|account|card)`;
const TIED = new RegExp(
  String.raw`${ACCT_WORD}[^.;\n]{0,40}?\b(debited|credited|deposited)\b|\b(debited|credited|deposited)\s+(?:from|to|in|into|on)\s+(?:your\s+)?(?:[a-z]+\s+){0,4}?${ACCT_WORD}`,
  'i',
);
const START_DEBIT = /^(?:[a-z!]+[!:]?\s+)?(sent|paid|spent|money sent|you paid|debit alert|purchase)\b/i;
const START_CREDIT = /^(?:[a-z!]+[!:]?\s+)?(received|money received|credit alert|you received)\b/i;
const DEBIT_VERBS =
  /\b(debited|spent|sent|paid|withdrawn|withdrawal|deducted|purchase|has been used|used for|thank you for using|transferred to|charged)\b/i;
const CREDIT_VERBS = /\b(credited|received|deposited|refund(?:ed)?|reversed|reversal|cashback|added to)\b/i;

const asDirection = (verb: string): Direction => (/^(credited|deposited)$/i.test(verb) ? 'credit' : 'debit');

export function extractDirection(flat: string): Direction | null {
  const tied = TIED.exec(flat);
  if (tied) return asDirection((tied[1] ?? tied[2])!);
  if (START_DEBIT.test(flat)) return 'debit';
  if (START_CREDIT.test(flat)) return 'credit';
  const d = DEBIT_VERBS.exec(flat);
  const c = CREDIT_VERBS.exec(flat);
  if (d && c) return d.index <= c.index ? 'debit' : 'credit';
  if (d) return 'debit';
  if (c) return 'credit';
  return null;
}

// ── Account ───────────────────────────────────────────────────────────────────

/** "XX1234" / "*1234" / "91XX5050" / "1234" → "1234"; keeps 3 digits for ICICI-style "XX123". */
export function last4(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /(\d{3,})\D*$/.exec(raw.replace(/\s+/g, ''));
  if (!m) return null;
  const digits = m[1]!;
  return digits.length > 4 ? digits.slice(-4) : digits;
}

export function extractAccount(flat: string): { last4: string | null; type: AccountType | null } {
  const card = /\b(credit|debit)?\s*card\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?\s*)?[:.]?\s*([x*#•.]*\s?\d{4})\b/i.exec(flat);
  const acct = /\b(?:a\/c|a\/c\.|acct|account|ac)\s*(?:no\.?|number)?\s*[:.]?\s*((?:\d{0,4}[x*#]+\s?)?\d{3,6}|[x*#]*\s?\d{3,6})\b/i.exec(flat);
  const masked = /(?:^|\s)([x*]{2,}\d{3,4})\b/i.exec(flat);
  const pick = [card && { i: card.index, kind: 'card' as const, m: card }, acct && { i: acct.index, kind: 'acct' as const, m: acct }]
    .filter(Boolean)
    .sort((a, b) => a!.i - b!.i)[0];
  if (pick?.kind === 'card') return { last4: last4(pick.m[2]), type: cardType(flat, pick.m[1]) };
  if (pick?.kind === 'acct') return { last4: last4(pick.m[1]), type: 'bank' };
  if (masked) return { last4: last4(masked[1]), type: null };
  return { last4: null, type: null };
}

export function cardType(flat: string, word?: string): AccountType {
  if (word?.toLowerCase() === 'credit' || /credit\s+card/i.test(flat) || /\bavl\.?\s*(limit|lmt)|available\s+(credit\s+)?limit/i.test(flat))
    return 'credit_card';
  if (word?.toLowerCase() === 'debit' || /debit\s+card/i.test(flat)) return 'debit_card';
  return 'card';
}

// ── Reference ─────────────────────────────────────────────────────────────────

const REF_RE =
  /\b(?:upi\s*ref(?:erence)?(?:\s*no\.?)?|upi\s*txn\s*id|ref(?:erence)?\s*(?:no\.?|number|#|id)?|refno|rrn|utr(?:\s*no\.?)?|txn\s*(?:id|no\.?|ref)|transaction\s*(?:id|number|no\.?|reference(?:\s*number)?)|imps\s*ref\s*no\.?|upi)\s*(?:is\s*)?[:.\-]?\s*([a-z0-9]{6,30})\b/gi;

/** UPI RRN / UTR: exactly 12 digits. Prefer these — they are shared by SMS, bank email and app receipts. */
export const isRrn = (ref: string | null | undefined) => !!ref && /^\d{12}$/.test(ref);

export function extractReference(flat: string): string | null {
  const refs: string[] = [];
  for (const m of flat.matchAll(REF_RE)) {
    const r = m[1]!.toUpperCase();
    if (/\d/.test(r) && !/^\d{1,5}$/.test(r)) refs.push(r);
  }
  // Also UPI/P2M/629412345678/ style paths.
  const path = /\bupi\/(?:p2[am]\/|cr\/|dr\/)?(\d{12})\//i.exec(flat);
  if (path) refs.push(path[1]!);
  return refs.find(isRrn) ?? refs[0] ?? null;
}

// ── Counterparty ──────────────────────────────────────────────────────────────

const STOP = String.raw`(?=\s+(?:on|via|using|ref|refno|upi|avl|avail|available|info|from|for|dated|at\s+\d|txn|transaction|imps|neft)\b|[.,;(]|\s*$)`;

const NOT_A_PAYEE = /^(your|you|a\/c|ac|acct|account|hdfc bank|icici bank|axis bank|kotak|sbi|the|card|beneficiary)\b/i;

function firstMatch(flat: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(flat);
    const v = m?.[1]?.trim();
    if (v && !NOT_A_PAYEE.test(v)) return v;
  }
  return null;
}

/** NEFT/IMPS/RTGS credit descriptor: "NEFT Cr-ICIC0000001-ACME TECHNOLOGIES PVT LTD-ARPIT-ICICN52026093012345". */
export function parseNeftDescriptor(s: string): { name: string; ref: string | null } | null {
  const m = /\b(?:neft|imps|rtgs)\s*(?:cr|dr)?[-\s]+[a-z]{4}0[a-z0-9]{6}-(.+?)-(?:.+?-)?([a-z0-9]{10,})\s*$/i.exec(s.trim());
  return m ? { name: m[1]!.trim(), ref: m[2]!.toUpperCase() } : null;
}

export function extractPayee(flat: string, direction: Direction | null): string | null {
  const upiPath = /\bupi\/(?:p2[am]\/|cr\/|dr\/)?\d{9,14}\/([^/\n]+?)(?:\/|\s+not\b|$)/i.exec(flat);
  if (upiPath?.[1] && /[a-z]/i.test(upiPath[1])) return upiPath[1].trim();

  const at = new RegExp(String.raw`\bat\s+(?!\d{1,2}:)([a-z0-9][\w&'.*\- ]{1,48}?)${STOP}`, 'i');
  const toVpa = new RegExp(String.raw`\bto\s+(?:vpa\s+)?(${VPA_RE.source}(?:\s+[a-z][\w&' ]{1,30}?)?)${STOP}`, 'i');
  const toName = new RegExp(String.raw`\b(?:trf\s+to|transferred\s+to|to)\s+(?!your\b|a\/c|ac\b|account\b)([a-z][\w&'.\- ]{1,48}?)${STOP}`, 'i');
  const fromVpa = new RegExp(String.raw`\bfrom\s+(?:vpa\s+)?(${VPA_RE.source})`, 'i');
  const fromName = new RegExp(
    String.raw`\b(?:transfer\s+from|by\s+transfer\s+from|from)\s+(?!your\b|a\/c|ac\b|account\b|hdfc\b|icici\b|sbi\b|axis\b|kotak\b|paytm\b)([a-z][\w&'.\- ]{1,48}?)${STOP}`,
    'i',
  );
  const iciciCredited = /;\s*([a-z0-9][\w&'.\- ]{1,40}?)\s+credited\b/i;
  const towards = /\btowards\s+(?!your\b)(.+?)(?:\s+via\s+|\.\s|\.$|$)/i;
  const info = /\binfo\s*[:.-]?\s*([^.]{2,60})/i;
  const neft = /\b((?:neft|imps|rtgs)\s*(?:cr|dr)?-[a-z]{4}0[a-z0-9]{6}-[^.]+)/i;

  if (direction === 'credit') {
    return firstMatch(flat, [neft, fromVpa, fromName, info, toVpa, at]);
  }
  return firstMatch(flat, [iciciCredited, at, toVpa, toName, towards, info, neft]);
}

export function extractVpa(flat: string): string | null {
  // Ignore e-mail addresses that are obviously not VPAs (contain a TLD).
  for (const m of flat.matchAll(new RegExp(VPA_RE.source, 'gi'))) {
    const v = m[1]!;
    if (!/\.(com|in|net|org|co)$/i.test(v)) return v.toLowerCase();
  }
  return null;
}

// ── Channel & hints ───────────────────────────────────────────────────────────

export function extractChannel(flat: string, accountType: AccountType | null): Channel {
  if (/\batm\b|cash\s+withdrawal|\bwithdrawn\b/i.test(flat)) return 'atm';
  if (/\b(nach|ecs|e-?mandate|auto-?debit|standing\s+instruction|\bsi\b)\b/i.test(flat)) return 'nach';
  if (/\bimps\b/i.test(flat)) return 'imps';
  if (/\bneft\b/i.test(flat)) return 'neft';
  if (/\brtgs\b/i.test(flat)) return 'rtgs';
  if (/\bupi\b|\bvpa\b/i.test(flat) || extractVpa(flat)) return 'upi';
  if (accountType === 'credit_card' || accountType === 'debit_card' || accountType === 'card') return 'card';
  if (/wallet/i.test(flat)) return 'wallet';
  if (/net\s*banking|billdesk/i.test(flat)) return 'netbanking';
  return 'other';
}

export function extractHints(flat: string, direction: Direction, accountType: AccountType | null, payee: string | null): ParseHints {
  const hints: ParseHints = {};
  if (direction === 'credit' && /\b(refund(?:s|ed)?|reversal|reversed|cashback|chargeback)\b/i.test(flat)) hints.refund = true;
  if (direction === 'credit' && /\b(salary|sal|payroll|wages)\b/i.test(flat)) hints.salary = true;
  if (direction === 'credit' && /\b(interest|int\.?\s*(?:pd|cr|paid)|dividend)\b/i.test(flat)) hints.interest = true;
  if (direction === 'debit' && /\batm\b|cash\s+withdrawal|\bwithdrawn\b/i.test(flat)) hints.atm = true;
  if (/\b(self|own\s+a\/?c|own\s+account|to\s+self)\b/i.test(flat)) hints.selfTransfer = true;

  const cardBillDebit =
    /(credit\s*card|\bcc\b)\s*(bill|payment|pymt|dues)|(bill|payment|pymt)\s+(of|for|towards|to)\s+(?:[^.]|\.(?=\d)){0,40}credit\s*card|towards\s+[^.]{0,30}credit\s+card|\bcred\b|cred\s*club|billdesk[^.]{0,30}card/i;
  // "[^.]" but allowing decimal points inside amounts ("15,000.00").
  const cardBillCredit =
    /payment(?:[^.]|\.(?=\d)){0,60}(received|credited)|(received|credited)(?:[^.]|\.(?=\d)){0,40}payment|thank\s+you\s+for\s+(the|your)\s+payment/i;
  if (direction === 'debit' && cardBillDebit.test(flat)) hints.cardBillPayment = true;
  if (direction === 'credit' && !hints.refund && (accountType === 'credit_card' || /credit\s+card/i.test(flat)) && cardBillCredit.test(flat))
    hints.cardBillPayment = true;

  if (/\/p2a\//i.test(flat)) hints.p2p = true;
  else if (payee && /^(mr|mrs|ms|miss|dr|shri|smt)\.?\s/i.test(payee)) hints.p2p = true;
  else if (payee && /^a\/c\s/i.test(payee)) hints.p2p = true;
  return hints;
}

export function extractGeneric(flat: string): Omit<Extracted, 'direction'> & { direction: Direction | null } {
  const direction = extractDirection(flat);
  const account = extractAccount(flat);
  return {
    amountPaise: extractAmount(flat) ?? undefined,
    direction,
    accountLast4: account.last4,
    accountType: account.type,
    reference: extractReference(flat),
    balancePaise: extractBalance(flat),
    payee: extractPayee(flat, direction),
    payeeVpa: extractVpa(flat),
  };
}
