import type { BankCode } from './types';

/** SMS sender ids look like "VM-HDFCBK", "JD-ICICIT-S", "BZ-SBIUPI", "AX-KOTAKB"; emails like alerts@hdfcbank.net. */
const SENDER_PATTERNS: Array<[RegExp, BankCode]> = [
  [/HDFC/i, 'HDFC'],
  [/ICICI/i, 'ICICI'],
  [/SBI(UPI|INB|CRD|PSG|BNK|SMS)?\b|ATMSBI|CBSSBI|SBICARD|\bsbi\.co\.in|sbicard\.com|STATEBANK/i, 'SBI'],
  [/AXIS/i, 'AXIS'],
  [/KOTAK/i, 'KOTAK'],
  [/PAYTM|PYTM|PAYTMB/i, 'PAYTM'],
  [/PHONE?PE|PHONPE/i, 'PHONEPE'],
  [/GPAY|GOOGLEPAY|google\.com/i, 'GPAY'],
];

const CONTENT_PATTERNS: Array<[RegExp, BankCode]> = [
  [/hdfc\s*bank/i, 'HDFC'],
  [/icici\s*bank/i, 'ICICI'],
  [/\bsbi\b|state\s+bank/i, 'SBI'],
  [/axis\s*bank/i, 'AXIS'],
  [/kotak/i, 'KOTAK'],
  [/paytm/i, 'PAYTM'],
  [/phonepe/i, 'PHONEPE'],
  [/google\s*pay|\bgpay\b/i, 'GPAY'],
];

export function detectBank(sender: string | null | undefined, flat: string): BankCode | null {
  if (sender) {
    for (const [re, code] of SENDER_PATTERNS) if (re.test(sender)) return code;
  }
  let best: { code: BankCode; index: number } | null = null;
  for (const [re, code] of CONTENT_PATTERNS) {
    const m = re.exec(flat);
    if (m && (!best || m.index < best.index)) best = { code, index: m.index };
  }
  return best?.code ?? null;
}

/**
 * Email senders treated as bank/UPI alerts by the IMAP poller (matched against the From address).
 * Entries starting with "@" match a domain suffix. Extend with IMAP_EXTRA_SENDERS.
 */
export const KNOWN_ALERT_SENDERS = [
  '@hdfcbank.net',
  '@hdfcbank.com',
  '@hdfcbank.bank.in',
  '@icicibank.com',
  '@icicibank.bank.in',
  '@sbi.co.in',
  '@alerts.sbi.co.in',
  '@sbi.bank.in',
  '@sbicard.com',
  '@axisbank.com',
  '@axis.bank.in',
  '@kotak.com',
  '@kotak.bank.in',
  '@paytmbank.com',
  '@paytm.com',
  '@phonepe.com',
  'googlepay-noreply@google.com',
  'payments-noreply@google.com',
];

export function isKnownAlertSender(fromAddress: string, extra: string[] = []): boolean {
  const addr = fromAddress.trim().toLowerCase();
  return [...KNOWN_ALERT_SENDERS, ...extra.map((e) => e.trim().toLowerCase()).filter(Boolean)].some((s) =>
    s.startsWith('@') ? addr.endsWith(s) : addr === s,
  );
}
