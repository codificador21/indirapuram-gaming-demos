import type { Transaction } from '@/db/schema';
import { CHANNEL_LABELS } from './domain';
import { addDays, formatDayKey, localDayKey, DEFAULT_TIMEZONE } from './time';

export const BANK_NAMES: Record<string, string> = {
  HDFC: 'HDFC',
  ICICI: 'ICICI',
  SBI: 'SBI',
  AXIS: 'Axis',
  KOTAK: 'Kotak',
  PAYTM: 'Paytm',
  PHONEPE: 'PhonePe',
  GPAY: 'GPay',
};

/** "Swiggy" / "rahul@okicici" / "UPI payment" — never empty. */
export function txnTitle(t: Pick<Transaction, 'merchant' | 'payee' | 'channel' | 'direction'>): string {
  if (t.merchant) return t.merchant;
  if (t.payee) return t.payee;
  const ch = CHANNEL_LABELS[t.channel] ?? 'Bank';
  return `${ch} ${t.direction === 'debit' ? 'payment' : 'credit'}`;
}

/** "Today" / "Yesterday" / "Mon, 19 Oct" (adds the year when it isn't the current one). */
export function dayLabel(dayKey: string, now = new Date(), tz = DEFAULT_TIMEZONE): string {
  const today = localDayKey(now, tz);
  if (dayKey === today) return 'Today';
  if (dayKey === addDays(today, -1)) return 'Yesterday';
  return formatDayKey(dayKey, { withWeekday: true, withYear: dayKey.slice(0, 4) !== today.slice(0, 4) });
}

export function accountLabel(t: Pick<Transaction, 'bank' | 'accountLast4' | 'accountType' | 'channel'>): string | null {
  const parts: string[] = [];
  if (t.bank) parts.push(BANK_NAMES[t.bank] ?? t.bank);
  if (t.accountType === 'credit_card') parts.push('Credit card');
  else if (t.accountType === 'debit_card') parts.push('Debit card');
  else if (t.accountType === 'card') parts.push('Card');
  if (t.accountLast4) parts.push(`••${t.accountLast4}`);
  if (t.channel === 'cash' || t.accountType === 'cash') return 'Cash';
  return parts.length ? parts.join(' ') : null;
}
