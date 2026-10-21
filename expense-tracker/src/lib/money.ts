/**
 * Money helpers. All amounts are integer paise. Formatting uses Indian digit grouping
 * (₹1,23,456) implemented by hand so it does not depend on the runtime's ICU data.
 */

/** "1,23,456.78" / "250" / "250.5" → paise. Returns null for anything that is not a plain amount. */
export function rupeesToPaise(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[,\s₹]/g, '').replace(/\/-$/, '');
  const m = /^(\d+)(?:\.(\d{0,2})\d*)?$/.exec(cleaned);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  const paise = whole * 100 + Number(frac);
  return Number.isSafeInteger(paise) ? paise : null;
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Indian grouping for a non-negative integer string: 1234567 → 12,34,567 */
export function groupIndian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  let rest = intDigits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${groups.join(',')},${last3}`;
}

export interface FormatOptions {
  /** 'auto' shows paise only when non-zero. Default 'auto'. */
  decimals?: 'auto' | 0 | 2;
  /** Prefix + for positive values (useful for credits). */
  signed?: boolean;
  /** Omit the ₹ symbol. */
  bare?: boolean;
}

/** formatINR(12345678) → "₹1,23,456.78"; formatINR(12345600, {decimals: 0}) → "₹1,23,456" */
export function formatINR(paise: number, opts: FormatOptions = {}): string {
  const { decimals = 'auto', signed = false, bare = false } = opts;
  const negative = paise < 0;
  let abs = Math.abs(Math.round(paise));
  let showDecimals = decimals === 2 || (decimals === 'auto' && abs % 100 !== 0);
  if (decimals === 0) {
    abs = Math.round(abs / 100) * 100;
    showDecimals = false;
  }
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = groupIndian(String(whole)) + (showDecimals ? `.${String(frac).padStart(2, '0')}` : '');
  const sign = negative ? '−' : signed && paise > 0 ? '+' : '';
  return `${sign}${bare ? '' : '₹'}${body}`;
}

/** Short form for chart axes / tight spaces: ₹950, ₹12.5K, ₹1.2L, ₹3.4Cr */
export function formatINRCompact(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? '−' : '';
  const trim = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, ''));
  if (rupees >= 1e7) return `${sign}₹${trim(rupees / 1e7)}Cr`;
  if (rupees >= 1e5) return `${sign}₹${trim(rupees / 1e5)}L`;
  if (rupees >= 1e3) return `${sign}₹${trim(rupees / 1e3)}K`;
  return `${sign}₹${Math.round(rupees)}`;
}
