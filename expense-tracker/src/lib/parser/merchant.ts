import { titleCase } from './text';

export const VPA_RE = /\b([a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9.]{1,30})\b/i;

const VPA_STOP = new Set([
  'upi', 'pay', 'paytm', 'paytmqr', 'gpay', 'googlepay', 'phonepe', 'bharatpe', 'q', 'qr', 'merchant', 'ok', 'ybl',
  'ibl', 'axl', 'oksbi', 'okaxis', 'okhdfcbank', 'okicici', 'razorpay', 'rzp', 'pos', 'payu', 'cf', 'cashfree',
  'mab', 'bqr', 'yespay', 'blr', 'del', 'mum', 'hyd', 'che', 'in', 'india', 'online', 'order', 'orders', 'payments',
  'payment', 'store', 'shop', 'billdesk', 'icici', 'hdfc', 'sbi', 'axis', 'kotak', 'yesbank', 'pg', 'refund', 'refunds',
]);

/** Derives a readable name from a VPA: swiggy.upi@axisbank → Swiggy, rahul.sharma@okicici → Rahul Sharma. */
export function nameFromVpa(vpa: string): string | null {
  const local = vpa.split('@')[0]!.toLowerCase();
  if (/^\d{8,}$/.test(local.replace(/[^a-z0-9]/g, ''))) return null; // phone-number VPA
  const tokens = local
    .split(/[._-]+/)
    .map((t) => t.replace(/\d+$/, ''))
    .filter((t) => t.length >= 2 && /^[a-z]+$/.test(t) && !VPA_STOP.has(t));
  if (tokens.length === 0) return null;
  // Looks like "firstname.lastname" → keep both, otherwise the first meaningful token is the brand.
  const looksLikePerson = tokens.length >= 2 && tokens.every((t) => t.length <= 12) && !/[0-9]/.test(local);
  const picked = looksLikePerson ? tokens.slice(0, 2) : tokens.slice(0, 1);
  return titleCase(picked.join(' '));
}

const HONORIFICS = /^(mr|mrs|ms|miss|dr|shri|smt|m\/s)\.?\s+/i;
const LEGAL_SUFFIX =
  /[\s,.-]+(private limited|pvt\.? ?ltd\.?|pvt|limited|ltd\.?|llp|inc\.?|corporation|corp\.?|india private limited|india pvt ltd|technologies private limited|services private limited)$/i;

/**
 * Cleans a raw counterparty string from a message into a display name.
 * Returns null if nothing meaningful remains.
 */
export function cleanMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  const vpa = VPA_RE.exec(s);
  if (vpa && vpa[0].length >= s.length - 2) return nameFromVpa(vpa[1]!) ?? vpa[1]!;
  if (vpa) s = s.replace(vpa[0], ' ').trim(); // "swiggy.upi@axisbank SWIGGY" → "SWIGGY"
  // Beneficiary account instead of a name: "A/c XX5678"
  const acct = /^a\/?c\s*(?:no\.?\s*)?([x*]*\d{3,})$/i.exec(s);
  if (acct) return `A/c ${acct[1]!.toUpperCase()}`;

  s = s
    .replace(/^(vpa|upi|neft|imps|rtgs|ach|nach|pos|ecom|info)[\s:/-]+/i, '')
    .replace(/^(?:sal|salary)[\s:/-]+/i, '')
    .replace(/^\d{6,}[\s/-]+/, '') // leading reference number: "629400009999-RAPIDO"
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[*_]+/g, ' ')
    .replace(/[\s.,;:/-]+$/g, '')
    .replace(/^[\s.,;:/-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  s = s.replace(HONORIFICS, '');
  for (let i = 0; i < 2; i++) s = s.replace(LEGAL_SUFFIX, '').trim();
  if (!s || !/[a-z]/i.test(s) || s.length < 2) return null;
  if (s.length > 48) s = s.slice(0, 48).trim();
  return titleCase(s);
}

/**
 * Normalised key for learned category rules: lower case, alphanumerics only, common noise removed.
 * "Amazon Pay India" → "amazonpayindia", "SWIGGY" → "swiggy".
 */
export function merchantKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = name
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/\b(private|limited|pvt|ltd|llp|inc)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return k.length >= 2 ? k : null;
}
