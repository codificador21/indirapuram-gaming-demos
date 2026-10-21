import type { IgnoreReason } from './types';
import { CUR } from './text';

/**
 * Words that mean money actually moved. Evaluated after removing future-tense and "if paid" phrases
 * so reminders like "will be debited" or "ignore if already paid" do not count.
 */
const PAST_TXN_VERB =
  /\b(debited|credited|spent|withdrawn|deposited|deducted|sent|received|paid|transferred|has been used|used for|thank you for using|money sent|money received)\b/i;

const FUTURE_OR_CONDITIONAL =
  /\b(will be|shall be|to be|would be|may be|can be|get|getting)\s+(auto[- ]?)?(debited|credited|deducted|charged|paid|received|sent)\b|\bif\s+(already\s+)?(paid|done|received)\b|\bon approving\b[^.]*|\bonce\s+(paid|received)\b/gi;

/** Evidence that the message refers to a concrete account/card/UPI transaction. */
const ACCOUNT_EVIDENCE =
  /(?:a\/?c|acct|account|card|ac)\b[^\n]{0,25}?[x*#]{1,}\s?\d{3,6}|[x*]{2,}\d{3,6}|\bending\s+(?:with\s+|in\s+)?\d{4}|\b(?:ref(?:no)?|rrn|utr|upi)\s*(?:no\.?|ref)?\s*[:.\-]?\s*\d{9,}|[\w.\-]+@[a-z]{2,}\b/i;

const OTP = /\b(otp|one[\s-]?time[\s-]?password|verification code|security code|passcode)\b/i;

const REMINDER =
  /(payment\s+(is\s+)?(due|overdue)|due\s+(date|on|by)\b|\bis\s+due\b|minimum\s+(amount\s+)?due|total\s+(amount\s+)?due|\bamt\.?\s+due|\boverdue\b|bill\s+(is\s+|has\s+been\s+)?generated|statement\s+(is\s+|has\s+been\s+)?generated|will\s+be\s+(auto[- ]?)?(debited|deducted|charged|presented)|\bscheduled\s+(for|on)\b|upcoming\s+(payment|debit|emi|sip)|pre[- ]?debit|\breminder\b|\bpay\s+now\b|last\s+date\s+(to|for)\s+pay)/i;

const REQUEST =
  /(has\s+requested\s+(money|payment|rs|inr|₹)|collect\s+request|\brequested\s+(rs|inr|₹)|is\s+requesting|payment\s+request\s+(of|from))/i;

const FAILED =
  /\b(declined|failed|unsuccessful|could\s+not\s+be\s+(processed|completed)|was\s+not\s+successful|insufficient\s+(funds|balance)|has\s+been\s+rejected)\b/i;

const PROMO =
  /(\boffers?\b|cashback\s+(up\s*to|of\s+up\s*to|worth)|\bdiscount\b|%\s*off\b|pre[- ]?approved|apply\s+now|click\s+(here|now|on)|\bt\s?&\s?c\b|\btncs?\b|limited\s+period|\bhurry\b|\bwin\b|congratulations|you\s+are\s+eligible|upgrade\s+(your|now)|instant\s+loan|personal\s+loan|loan\s+(of|up\s*to)|limit\s+(increase|enhance)|download\s+(the\s+)?app|\bexclusive\b|\bvoucher\b|invest\s+now|\bbit\.ly\b|shop\s+now|\bsale\b|\bdeal\b)/i;

const BALANCE_ONLY = /(avl|available|avail)\.?\s*(bal|balance)[^\n]{0,60}(as\s+on|is)\b/i;

const MONEY = new RegExp(`${CUR}\\d`, 'i');

export function hasPastTxnVerb(flat: string): boolean {
  return PAST_TXN_VERB.test(flat.replace(FUTURE_OR_CONDITIONAL, ' '));
}

export function hasAccountEvidence(flat: string): boolean {
  return ACCOUNT_EVIDENCE.test(flat);
}

/**
 * Returns why a message should be ignored, or null if it may be a transaction.
 * Order matters: the most specific signals are checked first.
 */
export function classifyNoise(flat: string): IgnoreReason | null {
  const past = hasPastTxnVerb(flat);
  const evidence = hasAccountEvidence(flat);

  if (OTP.test(flat) && !past) return 'otp';
  if (REQUEST.test(flat) && !(past && evidence && !/will be debited/i.test(flat))) return 'request';
  if (FAILED.test(flat) && !/\b(debited|credited|spent|withdrawn)\b/i.test(flat)) return 'failed';
  if (REMINDER.test(flat) && !past) return 'reminder';
  if (PROMO.test(flat) && !(past && evidence)) return 'promo';
  if (!past && BALANCE_ONLY.test(flat)) return 'balance_info';
  if (!past && !MONEY.test(flat)) return 'non_financial';
  return null;
}
