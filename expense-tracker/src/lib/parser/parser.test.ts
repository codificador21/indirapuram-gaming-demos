import { describe, expect, it } from 'vitest';
import { FIXTURES, type TxnExpectation } from './fixtures';
import { parseMessage } from './index';
import { cleanMerchant, merchantKey, nameFromVpa } from './merchant';
import { findDate } from './dates';

const paise = (rupees: number) => Math.round(rupees * 100);

describe('fixtures', () => {
  it('has at least 30 samples across the five banks and UPI apps', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
    for (const bank of ['hdfc', 'icici', 'sbi', 'axis', 'kotak', 'paytm', 'phonepe', 'gpay']) {
      expect(FIXTURES.some((f) => f.id.startsWith(bank)), bank).toBe(true);
    }
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });
});

describe.each(FIXTURES)('parseMessage: $id', (fx) => {
  const result = parseMessage({
    text: fx.text,
    sender: fx.sender,
    subject: fx.subject,
    receivedAt: new Date(fx.receivedAt),
    source: fx.source,
  });

  it(`→ ${fx.expect.status}`, () => {
    expect(result.status).toBe(fx.expect.status);
    if (fx.expect.status === 'ignored' && result.status === 'ignored') {
      expect(result.reason).toBe(fx.expect.reason);
    }
    if (fx.expect.status === 'unparsed' && result.status === 'unparsed') {
      expect(result.reason).toBe(fx.expect.reason);
    }
    if (fx.expect.status !== 'transaction' || result.status !== 'transaction') return;

    const e: TxnExpectation = fx.expect;
    const t = result.txn;
    expect(t.amountPaise, 'amount').toBe(paise(e.amount));
    expect(t.direction, 'direction').toBe(e.direction);
    if (e.merchant !== undefined) expect(t.merchant, 'merchant').toBe(e.merchant);
    if (e.accountLast4 !== undefined) expect(t.accountLast4, 'account').toBe(e.accountLast4);
    if (e.accountType !== undefined) expect(t.accountType, 'accountType').toBe(e.accountType);
    if (e.reference !== undefined) expect(t.reference, 'reference').toBe(e.reference);
    if (e.balance !== undefined) expect(t.balancePaise, 'balance').toBe(e.balance === null ? null : paise(e.balance));
    if (e.occurredAt !== undefined) expect(t.occurredAt.toISOString(), 'occurredAt').toBe(e.occurredAt);
    if (e.bank !== undefined) expect(t.bank, 'bank').toBe(e.bank);
    if (e.channel !== undefined) expect(t.channel, 'channel').toBe(e.channel);
    if (e.payeeVpa !== undefined) expect(t.payeeVpa, 'payeeVpa').toBe(e.payeeVpa);
    if (e.hints) expect(t.hints, 'hints').toMatchObject(e.hints);
  });
});

describe('merchant helpers', () => {
  it.each([
    ['swiggy.upi@axisbank', 'Swiggy'],
    ['rahul.sharma@okicici', 'Rahul Sharma'],
    ['zomato-order@ptybl', 'Zomato'],
    ['9876543210@ybl', null],
    ['paytmqr281005050101@paytm', null],
  ])('nameFromVpa(%s) → %s', (vpa, expected) => {
    expect(nameFromVpa(vpa)).toBe(expected);
  });

  it.each([
    ['MR RAHUL SHARMA', 'Rahul Sharma'],
    ['ACME TECHNOLOGIES PVT LTD', 'Acme Technologies'],
    ['NEFT-SAL-ACME TECHNOLOGIES', 'Acme Technologies'],
    ['swiggy.upi@axisbank SWIGGY', 'Swiggy'],
    ['A/c XX5678', 'A/c XX5678'],
    ['UPI-629400009999-RAPIDO', 'Rapido'],
    ['  ', null],
    [null, null],
  ])('cleanMerchant(%j) → %j', (raw, expected) => {
    expect(cleanMerchant(raw)).toBe(expected);
  });

  it('builds stable merchant keys', () => {
    expect(merchantKey('Amazon Pay India')).toBe('amazonpayindia');
    expect(merchantKey('SWIGGY')).toBe('swiggy');
    expect(merchantKey('Acme Technologies Pvt Ltd')).toBe('acmetechnologies');
    expect(merchantKey('')).toBeNull();
  });
});

describe('date finder', () => {
  it.each([
    ['on 21/10/26', { year: 2026, month: 10, day: 21 }],
    ['on 21Oct26', { year: 2026, month: 10, day: 21 }],
    ['on 30-SEP-26', { year: 2026, month: 9, day: 30 }],
    ['On 2026-10-21:14:32:10.', { year: 2026, month: 10, day: 21, hour: 14, minute: 32, second: 10 }],
    ['on Oct 21, 2026 at 13:05:44', { year: 2026, month: 10, day: 21, hour: 13, minute: 5 }],
    ['21 Oct 2026, 08:15 PM', { year: 2026, month: 10, day: 21, hour: 20, minute: 15 }],
    ['21-10-26, 13:45:10', { hour: 13, minute: 45, second: 10 }],
  ])('%s', (text, expected) => {
    expect(findDate(text)).toMatchObject(expected);
  });

  it('ignores phone numbers and amounts', () => {
    expect(findDate('Call 18002586161 or 1800 2662. Rs.1,250.00 spent')).toBeNull();
  });
});

describe('robustness', () => {
  it('never throws on junk input', () => {
    for (const text of ['', '₹', 'Rs.', 'debited', '@@@', 'x'.repeat(5000)]) {
      expect(() => parseMessage({ text, receivedAt: new Date(), source: 'sms' })).not.toThrow();
    }
  });

  it('tolerates the same SMS with different line breaks', () => {
    const a = parseMessage({ text: 'Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 21/10/26\nRef 629412345678', receivedAt: new Date(), source: 'sms' });
    const b = parseMessage({ text: 'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 21/10/26 Ref 629412345678', receivedAt: new Date(), source: 'sms' });
    expect(a.status).toBe('transaction');
    expect(b).toEqual(a);
  });
});
