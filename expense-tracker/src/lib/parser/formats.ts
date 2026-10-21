/**
 * Per-bank / per-format regex templates.
 *
 * Each template is a full-message regex for one known alert layout, run against the flattened text
 * (newlines → spaces). Named groups:
 *   amount, acct, payee, date, ref, bal, ctype (credit|debit for card type)
 * A matching template fixes the direction/channel/account type with high confidence; any field it
 * does not capture is filled in by the generic extractors (`generic.ts`).
 *
 * To add a format: copy a sample alert into `fixtures.ts`, add a template here, run `npm test`.
 */
import type { AccountType, Channel, Direction } from '@/lib/domain';
import { AMT, CUR } from './text';
import type { BankCode } from './types';

export interface FormatTemplate {
  id: string;
  bank: BankCode;
  direction: Direction;
  channel?: Channel;
  accountType?: AccountType;
  pattern: RegExp;
}

const C = CUR;
const OPT_C = `(?:${CUR})?`;
const A = `(?<amount>${AMT.slice(1, -1)})`; // AMT without its own capture group
const BAL = `(?<bal>${AMT.slice(1, -1)})`;
const ACCT = String.raw`(?<acct>[x*#]*\s?\d{3,6})`;
const DDMMYY = String.raw`\d{1,2}[-/]\d{1,2}[-/]\d{2,4}`;

const t = (id: string, bank: BankCode, direction: Direction, pattern: string, extra: Partial<FormatTemplate> = {}): FormatTemplate => ({
  id,
  bank,
  direction,
  pattern: new RegExp(pattern, 'i'),
  ...extra,
});

export const TEMPLATES: FormatTemplate[] = [
  // ── HDFC ──────────────────────────────────────────────────────────────────
  t('hdfc.upi.sent', 'HDFC', 'debit',
    String.raw`\bsent\s+${C}${A}\s+from\s+hdfc\s+bank\s+a\/c\s+${ACCT}\s+to\s+(?<payee>.+?)\s+on\s+(?<date>${DDMMYY})(?:\s+ref\s+(?<ref>\d{6,}))?`,
    { channel: 'upi', accountType: 'bank' }),
  t('hdfc.upi.credit', 'HDFC', 'credit',
    String.raw`${C}${A}\s+credited\s+to\s+hdfc\s+bank\s+a\/c\s+${ACCT}\s+on\s+(?<date>${DDMMYY})\s+from\s+(?:vpa\s+)?(?<payee>\S+?)\s*\(upi\s+(?<ref>\d+)\)`,
    { channel: 'upi', accountType: 'bank' }),
  t('hdfc.card.spent', 'HDFC', 'debit',
    String.raw`\bspent\s+${C}${A}\s+on\s+hdfc\s+bank\s+card\s+${ACCT}\s+at\s+(?<payee>.+?)\s+on\s+(?<date>\d{4}-\d{2}-\d{2}(?::\d{2}:\d{2}:\d{2})?|${DDMMYY})`,
    { channel: 'card', accountType: 'card' }),
  t('hdfc.neft.deposit', 'HDFC', 'credit',
    String.raw`${C}${A}\s+deposited\s+in\s+hdfc\s+bank\s+a\/c\s+${ACCT}\s+on\s+(?<date>\S+?)\s+for\s+(?<payee>.+?)\.\s*avl\s+bal\s+${C}${BAL}`,
    { accountType: 'bank' }),
  t('hdfc.imps.sent', 'HDFC', 'debit',
    String.raw`money\s+sent\s*-?\s*${C}${A}\s+from\s+hdfc\s+bank\s+a\/c\s+${ACCT}\s+on\s+(?<date>${DDMMYY})\s+to\s+(?<payee>a\/c\s+[x*]*\d+|.+?)\s+imps\s+ref\s+no\.?\s*(?<ref>\d+)(?:\s+avl\s+bal:?\s+${C}${BAL})?`,
    { channel: 'imps', accountType: 'bank' }),
  t('hdfc.email.upi.debit', 'HDFC', 'debit',
    String.raw`${C}${A}\s+has\s+been\s+debited\s+from\s+account\s+${ACCT}\s+to\s+(?:vpa\s+)?(?<payee>.+?)\s+on\s+(?<date>${DDMMYY})\.?\s+your\s+upi\s+transaction\s+reference\s+number\s+is\s+(?<ref>\d+)`,
    { channel: 'upi', accountType: 'bank' }),
  t('hdfc.email.upi.credit', 'HDFC', 'credit',
    String.raw`${C}${A}\s+(?:has\s+been\s+)?credited\s+to\s+(?:your\s+)?(?:hdfc\s+bank\s+)?account\s+${ACCT}\s+by\s+(?:vpa\s+)?(?<payee>.+?)\s+on\s+(?<date>${DDMMYY})\.?\s+your\s+upi\s+transaction\s+reference\s+number\s+is\s+(?<ref>\d+)`,
    { channel: 'upi', accountType: 'bank' }),
  t('hdfc.email.card', 'HDFC', 'debit',
    String.raw`thank\s+you\s+for\s+using\s+your\s+hdfc\s+bank\s+(?<ctype>credit|debit)\s+card\s+ending\s+(?<acct>\d{4})\s+for\s+${C}${A}\s+at\s+(?<payee>.+?)\s+on\s+(?<date>${DDMMYY}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)`,
    { channel: 'card' }),
  t('hdfc.cc.refund', 'HDFC', 'credit',
    String.raw`${C}${A}\s+refund\s+from\s+(?<payee>.+?)\s+credited\s+to\s+your\s+hdfc\s+bank\s+credit\s+card\s+${ACCT}\s+on\s+(?<date>${DDMMYY})`,
    { channel: 'card', accountType: 'credit_card' }),

  // ── ICICI ─────────────────────────────────────────────────────────────────
  t('icici.acct.debit', 'ICICI', 'debit',
    String.raw`icici\s+bank\s+acc?(?:oun)?t\s+${ACCT}\s+(?:is\s+)?debited\s+(?:for|with)\s+${C}${A}\s+on\s+(?<date>\S+?)\s*;\s*(?<payee>.+?)\s+credited\.?(?:\s*upi:?\s*(?<ref>\d+))?`,
    { accountType: 'bank' }),
  t('icici.card.spent', 'ICICI', 'debit',
    String.raw`${C}${A}\s+spent\s+(?:using|on)\s+icici\s+bank\s+card\s+${ACCT}\s+on\s+(?<date>\S+?)\s+on\s+(?<payee>.+?)\.\s*avl\s+limit`,
    { channel: 'card', accountType: 'credit_card' }),
  t('icici.acct.credit', 'ICICI', 'credit',
    String.raw`icici\s+bank\s+account\s+${ACCT}\s+(?:is\s+)?credited(?:\s+with)?\s*:?\s*${C}${A}\s+on\s+(?<date>\S+?)\.?\s+info:?\s*(?<payee>.+?)\.\s*(?:available\s+balance\s+is\s+${C}${BAL})?`,
    { accountType: 'bank' }),
  t('icici.email.cc', 'ICICI', 'debit',
    String.raw`icici\s+bank\s+credit\s+card\s+${ACCT}\s+has\s+been\s+used\s+for\s+a\s+transaction\s+of\s+${C}${A}\s+on\s+(?<date>.+?\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?::\d{2})?)?)\.\s+info:?\s*(?<payee>[^.]+)`,
    { channel: 'card', accountType: 'credit_card' }),
  t('icici.cc.reversal', 'ICICI', 'credit',
    String.raw`${C}${A}\s+has\s+been\s+credited\s+to\s+your\s+icici\s+bank\s+credit\s+card\s+${ACCT}\s+on\s+(?<date>\S+)\s+as\s+reversal\s+of\s+transaction\s+at\s+(?<payee>[^.]+)`,
    { channel: 'card', accountType: 'credit_card' }),

  // ── SBI ───────────────────────────────────────────────────────────────────
  t('sbi.upi.debit', 'SBI', 'debit',
    String.raw`a\/c\s*${ACCT}\s+debited\s+by\s+${OPT_C}${A}\s+on\s+date\s+(?<date>\S+)\s+trf\s+to\s+(?<payee>.+?)\s+ref\s*no\.?\s*(?<ref>\d+)`,
    { channel: 'upi', accountType: 'bank' }),
  t('sbi.upi.credit', 'SBI', 'credit',
    String.raw`a\/c\s*${ACCT}\s+credited\s+by\s+${OPT_C}${A}\s+on\s+(?:date\s+)?(?<date>\S+)\s+by\s+(?<payee>[^()]*?)\s*\(\s*ref\s*no\.?\s*(?<ref>\d+)\s*\)`,
    { channel: 'upi', accountType: 'bank' }),
  t('sbi.atm', 'SBI', 'debit',
    String.raw`${C}${A}\s+withdrawn\s+at\s+(?<payee>.+?)\s+from\s+a\/c\s*${ACCT}\s+on\s+(?<date>\S+)\s+transaction\s+number\s+(?<ref>\d+)\.?\s+available\s+balance\s+${C}${BAL}`,
    { channel: 'atm', accountType: 'bank' }),
  t('sbi.acct.debit', 'SBI', 'debit',
    String.raw`a\/c\s+${ACCT}\s+debited\s+${C}${A}\s+on\s+(?<date>\S+)\s+-?\s*(?:transferred\s+to|trf\s+to)\s+(?<payee>.+?)\.\s*avl\s+bal(?:ance)?\s+${C}${BAL}`,
    { accountType: 'bank' }),
  t('sbi.acct.credit', 'SBI', 'credit',
    String.raw`a\/c\s+${ACCT}\s+credited\s+${C}${A}\s+on\s+(?<date>\S+)\s+-?\s*(?:deposit\s+by\s+transfer\s+from|by\s+transfer\s+from|transfer\s+from)\s+(?<payee>.+?)\.\s*avl\s+bal(?:ance)?\s+${C}${BAL}`,
    { accountType: 'bank' }),
  t('sbi.card.spent', 'SBI', 'debit',
    String.raw`${C}${A}\s+spent\s+on\s+your\s+sbi\s+credit\s+card\s+ending\s+(?:with\s+)?(?<acct>\d{4})\s+at\s+(?<payee>.+?)\s+on\s+(?<date>${DDMMYY})`,
    { channel: 'card', accountType: 'credit_card' }),

  // ── Axis (multi-line alerts, flattened) ───────────────────────────────────
  t('axis.upi.debit', 'AXIS', 'debit',
    String.raw`${C}${A}\s+debited\s+a\/c\s+no\.?\s+${ACCT}\s+(?<date>${DDMMYY},?\s+\d{1,2}:\d{2}(?::\d{2})?)(?:\s+ist)?\s+upi\/p2[am]\/(?<ref>\d+)\/(?<payee>[^/]+?)(?:\/|\s+not\s+you|\s+axis\s+bank|\s*$)`,
    { channel: 'upi', accountType: 'bank' }),
  t('axis.upi.credit', 'AXIS', 'credit',
    String.raw`${C}${A}\s+credited\s+a\/c\s+no\.?\s+${ACCT}\s+(?<date>${DDMMYY},?\s+\d{1,2}:\d{2}(?::\d{2})?)(?:\s+ist)?\s+upi\/p2[am]\/(?<ref>\d+)\/(?<payee>[^/]+?)(?:\/|\s+not\s+you|\s+axis\s+bank|\s*$)`,
    { channel: 'upi', accountType: 'bank' }),
  t('axis.card.spent', 'AXIS', 'debit',
    String.raw`\bspent\s+card\s+no\.?\s+${ACCT}\s+${C}${A}\s+(?<date>${DDMMYY}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(?<payee>.+?)\s+avl\s+lmt`,
    { channel: 'card', accountType: 'credit_card' }),
  t('axis.email.card', 'AXIS', 'debit',
    String.raw`thank\s+you\s+for\s+using\s+your\s+card\s+no\.?\s+${ACCT}\s+for\s+${C}${A}\s+at\s+(?<payee>.+?)\s+on\s+(?<date>${DDMMYY}\s+\d{1,2}:\d{2}(?::\d{2})?)`,
    { channel: 'card' }),

  // ── Kotak ─────────────────────────────────────────────────────────────────
  t('kotak.upi.sent', 'KOTAK', 'debit',
    String.raw`\bsent\s+${C}${A}\s+from\s+kotak\s+bank\s+a\/?c\s+${ACCT}\s+to\s+(?<payee>\S+)\s+on\s+(?<date>${DDMMYY})\.?\s*upi\s+ref:?\s*(?<ref>\d+)`,
    { channel: 'upi', accountType: 'bank' }),
  t('kotak.upi.received', 'KOTAK', 'credit',
    String.raw`\breceived\s+${C}${A}\s+in\s+your\s+kotak\s+bank\s+a\/?c\s+${ACCT}\s+from\s+(?<payee>\S+)\s+on\s+(?<date>${DDMMYY})\.?\s*upi\s+ref:?\s*(?<ref>\d+)`,
    { channel: 'upi', accountType: 'bank' }),
  t('kotak.cc.spent', 'KOTAK', 'debit',
    String.raw`${C}${A}\s+spent\s+on\s+kotak\s+credit\s+card\s+${ACCT}\s+at\s+(?<payee>.+?)\s+on\s+(?<date>${DDMMYY})\.?\s*avl\s+limit`,
    { channel: 'card', accountType: 'credit_card' }),
  t('kotak.debitcard', 'KOTAK', 'debit',
    String.raw`kotak\s+debit\s+card\s+${ACCT}\s+has\s+been\s+used\s+for\s+${C}${A}\s+at\s+(?<payee>.+?)\s+on\s+(?<date>${DDMMYY}(?:\s+at\s+\d{1,2}:\d{2})?)`,
    { channel: 'card', accountType: 'debit_card' }),
  t('kotak.email.debit', 'KOTAK', 'debit',
    String.raw`your\s+account\s+${ACCT}\s+is\s+debited\s+for\s+${C}${A}\s+on\s+(?<date>\S+)\s+towards\s+upi\/(?<ref>\d+)\/(?<payee>[^.]+)`,
    { channel: 'upi', accountType: 'bank' }),

  // ── UPI apps / payments bank ──────────────────────────────────────────────
  t('paytm.paid', 'PAYTM', 'debit',
    String.raw`\bpaid\s+${C}${A}\s+to\s+(?<payee>.+?)\s+from\s+paytm\s+payments\s+bank\s+a\/c\s+(?<acct>\w+?)\.?\s+upi\s+ref:?\s*(?<ref>\d+)`,
    { channel: 'upi', accountType: 'bank' }),
  t('phonepe.paid', 'PHONEPE', 'debit',
    String.raw`\bpaid\s+${C}${A}\s+to\s+(?<payee>.+?)\s+(?<date>\d{1,2}\s+[a-z]{3}\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:am|pm)?)\s+transaction\s+id:?\s*\w+\s+utr:?\s*(?<ref>\d+)\s+debited\s+from\s+${ACCT}`,
    { channel: 'upi', accountType: 'bank' }),
  t('phonepe.received', 'PHONEPE', 'credit',
    String.raw`\breceived\s+${C}${A}\s+from\s+(?<payee>.+?)\s+(?<date>\d{1,2}\s+[a-z]{3}\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:am|pm)?)\s+transaction\s+id:?\s*\w+\s+utr:?\s*(?<ref>\d+)\s+credited\s+to\s+${ACCT}`,
    { channel: 'upi', accountType: 'bank' }),
  t('gpay.paid', 'GPAY', 'debit',
    String.raw`you\s+paid\s+${C}${A}\s+to:?\s+(?<payee>.+?)\s+upi\s+transaction\s+id:?\s*(?<ref>\d+)\s+from:?\s+.+?\s+[•*x.]+\s*(?<acct>\d{4})\s+(?<date>[a-z]{3}\s+\d{1,2},\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:am|pm)?)`,
    { channel: 'upi', accountType: 'bank' }),
];
