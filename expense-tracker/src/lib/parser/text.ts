import { rupeesToPaise } from '@/lib/money';

/** Normalises whitespace and odd characters; keeps newlines (some banks use one field per line). */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[   \t]/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Single-line version for regexes that should not care about line breaks. */
export function flatten(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Currency marker: Rs, Rs., INR, ₹ (with optional dot/colon/space after). */
export const CUR = String.raw`(?:rs\.?|inr|₹)\s*[.:]?\s*`;
/** An amount: 1,23,456.78 / 250 / 250.5 / 180.0 */
export const AMT = String.raw`(\d[\d,]*(?:\.\d+)?)`;

export function toPaise(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const p = rupeesToPaise(raw.replace(/\.$/, ''));
  return p !== null && p > 0 ? p : null;
}

const BALANCE_CONTEXT = /(?:avl|avail|available|aval|bal|balance|limit|lmt|due|outstanding|o\/s)[^\d]{0,25}$/i;

export interface FoundAmount {
  paise: number;
  index: number;
  isBalanceLike: boolean;
}

/** All currency-prefixed amounts in the text, flagged when they look like balances/limits/dues. */
export function findAmounts(flat: string): FoundAmount[] {
  const re = new RegExp(`${CUR}${AMT}`, 'gi');
  const out: FoundAmount[] = [];
  for (const m of flat.matchAll(re)) {
    const paise = toPaise(m[1]);
    if (paise === null) continue;
    const before = flat.slice(Math.max(0, m.index - 30), m.index);
    out.push({ paise, index: m.index, isBalanceLike: BALANCE_CONTEXT.test(before) });
  }
  return out;
}

/** Title-cases a name, keeping well-known acronyms upper case. */
const ACRONYMS = new Set([
  'ATM', 'KFC', 'PVR', 'IRCTC', 'BSES', 'SBI', 'HDFC', 'ICICI', 'LIC', 'ACT', 'UPI', 'NEFT', 'IMPS', 'HP',
  'BPCL', 'IOCL', 'HPCL', 'BSNL', 'MTNL', 'IKEA', 'H&M', 'ITC', 'NPS', 'EMI', 'BBMP', 'MSEB', 'TNEB', 'OYO',
  'BMTC', 'DTC', 'RBL', 'IDFC', 'PNB', 'BOB', 'IOB', 'UCO', 'TCS', 'HCL', 'IBM',
]);
const SPECIAL_CASE: Record<string, string> = { DMART: 'DMart', MCDONALDS: "McDonald's", IPHONE: 'iPhone', BIGBASKET: 'BigBasket', MAKEMYTRIP: 'MakeMyTrip', PHONEPE: 'PhonePe', BOOKMYSHOW: 'BookMyShow', JIOMART: 'JioMart' };

export function titleCase(input: string): string {
  return input
    .split(/(\s+|-|\/)/)
    .map((w) => {
      if (!/[a-z]/i.test(w)) return w;
      const up = w.toUpperCase();
      if (SPECIAL_CASE[up]) return SPECIAL_CASE[up];
      if (ACRONYMS.has(up)) return up;
      if (/\d/.test(w) && w.length > 3) return up; // ids like S1CN000123
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join('');
}
