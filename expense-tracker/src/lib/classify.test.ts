import { describe, expect, it } from 'vitest';
import { categorise, findRule, keywordCategory } from './categorise';
import { classifyCredit, detectExclusion, isSelfTransferPair, looksLikeSalary, type ClassifyContext, type ClassifyInput, type PairCandidate } from './classify';
import { accountsCompatible, duplicateReason, findDuplicate, type DedupeCandidate } from './dedupe';

const ctx: ClassifyContext = {
  monthlySalaryPaise: 8_500_000,
  salaryCreditDay: 30,
  selfIdentifiers: ['Aarav Mehta', 'aarav@okhdfcbank'],
  myAccountLast4s: ['1234', '4321'],
  commitments: [
    { id: 1, name: 'Rent', amountPaise: 2_200_000, matchKeywords: 'nobroker, landlord, ramesh kumar', active: true },
    { id: 2, name: 'SIP', amountPaise: 500_000, matchKeywords: 'zerodha,groww', active: true },
    { id: 3, name: 'Old EMI', amountPaise: 350_000, matchKeywords: 'bajaj', active: false },
  ],
};

const base: ClassifyInput = {
  direction: 'credit',
  amountPaise: 100_000,
  occurredAt: new Date('2026-10-21T09:00:00Z'),
  merchant: null,
  payee: null,
  payeeVpa: null,
  channel: 'upi',
  hints: {},
};

describe('keyword categoriser', () => {
  it.each([
    ['Swiggy', 'food'],
    ['Swiggy Instamart', 'groceries'],
    ['ZOMATO', 'food'],
    ['Uber India', 'transport'],
    ['Ola', 'transport'],
    ['Coca Cola Bottlers', null],
    ['Rapido', 'transport'],
    ['Amazon Pay India', 'shopping'],
    ['Amazon Prime', 'entertainment'],
    ['Flipkart', 'shopping'],
    ['Netflix', 'entertainment'],
    ['Blinkit', 'groceries'],
    ['DMart Avenue', 'groceries'],
    ['Chaipoint', 'food'],
    ['Indian Oil Petrol Pump', 'fuel'],
    ['Airtel Postpaid', 'bills'],
    ['Zerodha Broking', 'investments'],
    ['Apollo Pharmacy', 'health'],
    ['IRCTC', 'travel'],
    ['Rahul Sharma', null],
  ])('%s → %s', (merchant, expected) => {
    expect(keywordCategory(merchant)).toBe(expected);
  });

  it('uses the VPA local part', () => {
    expect(keywordCategory(null, 'zomato-order@ptybl')).toBe('food');
  });
});

describe('learned rules', () => {
  const rules = [
    { merchantKey: 'swiggy', categoryId: 'groceries' },
    { merchantKey: 'amazonpay', categoryId: 'bills' },
    { merchantKey: 'rahulsharma', categoryId: 'home', excludeFromBudget: false },
  ];

  it('matches exactly or by the longest prefix', () => {
    expect(findRule('swiggy', rules)?.categoryId).toBe('groceries');
    expect(findRule('amazonpayindia', rules)?.categoryId).toBe('bills');
    expect(findRule('amazon', rules)).toBeNull();
    expect(findRule(null, rules)).toBeNull();
  });

  it('rules beat the keyword map', () => {
    const r = categorise({ direction: 'debit', merchant: 'Swiggy', merchantKey: 'swiggy', payee: 'SWIGGY', channel: 'upi', hints: {}, creditKind: null }, rules);
    expect(r).toEqual({ categoryId: 'groceries', source: 'rule' });
  });

  it('card bill payments and self transfers are always self_transfer', () => {
    const r = categorise({ direction: 'debit', merchant: 'Swiggy', merchantKey: 'swiggy', payee: null, channel: 'netbanking', hints: { cardBillPayment: true }, creditKind: null }, rules);
    expect(r.categoryId).toBe('self_transfer');
  });

  it('ATM → cash, P2P → transfers, unknown → other', () => {
    const c = (over: Partial<Parameters<typeof categorise>[0]>) =>
      categorise({ direction: 'debit', merchant: null, merchantKey: null, payee: null, channel: 'other', hints: {}, creditKind: null, ...over }, []).categoryId;
    expect(c({ channel: 'atm', merchant: 'ATM withdrawal' })).toBe('cash');
    expect(c({ merchant: 'Rahul Sharma', hints: { p2p: true } })).toBe('transfers');
    expect(c({ merchant: 'Some Unknown Shop Pvt' })).toBe('other');
    expect(c({ direction: 'credit', creditKind: 'salary' })).toBe('salary');
    expect(c({ direction: 'credit', creditKind: 'refund', merchant: 'Zomato' })).toBe('food');
  });
});

describe('credit kind', () => {
  it('detects salary by keyword, by exact amount, or by amount near the salary day', () => {
    expect(looksLikeSalary({ ...base, hints: { salary: true } }, ctx)).toBe(true);
    expect(looksLikeSalary({ ...base, amountPaise: 8_500_000, occurredAt: new Date('2026-10-12T06:00:00Z') }, ctx)).toBe(true);
    // 92k on the 1st (2 days from the 30th, wrapping) via NEFT → salary with a raise/bonus
    expect(looksLikeSalary({ ...base, amountPaise: 9_200_000, channel: 'neft', occurredAt: new Date('2026-10-01T06:00:00Z') }, ctx)).toBe(true);
    // same amount mid-month → not salary
    expect(looksLikeSalary({ ...base, amountPaise: 9_200_000, channel: 'neft', occurredAt: new Date('2026-10-15T06:00:00Z') }, ctx)).toBe(false);
    // P2P UPI credit is never salary
    expect(looksLikeSalary({ ...base, amountPaise: 8_500_000, hints: { p2p: true } }, ctx)).toBe(false);
  });

  it('classifies other credits', () => {
    expect(classifyCredit({ ...base, hints: { refund: true } }, ctx)).toBe('refund');
    expect(classifyCredit({ ...base, hints: { p2p: true }, merchant: 'Rahul Sharma' }, ctx)).toBe('reimbursement');
    expect(classifyCredit({ ...base, merchant: 'Swiggy', payeeVpa: 'swiggy.refunds@axisbank' }, ctx)).toBe('refund');
    expect(classifyCredit({ ...base, hints: { interest: true }, channel: 'other' }, ctx)).toBe('income');
    expect(classifyCredit({ ...base, channel: 'upi' }, ctx)).toBe('reimbursement');
    expect(classifyCredit({ ...base, channel: 'neft', merchant: 'Freelance Client LLP' }, ctx)).toBe('income');
    expect(classifyCredit({ ...base, direction: 'debit' }, ctx)).toBeNull();
  });
});

describe('exclusions', () => {
  const debit: ClassifyInput = { ...base, direction: 'debit', channel: 'upi' };

  it('card bill payments and explicit self transfers', () => {
    expect(detectExclusion({ ...debit, hints: { cardBillPayment: true } }, ctx).reason).toBe('card_bill');
    expect(detectExclusion({ ...debit, hints: { selfTransfer: true } }, ctx).reason).toBe('self_transfer');
  });

  it('payments to my own name / VPA / account', () => {
    expect(detectExclusion({ ...debit, merchant: 'Aarav Mehta' }, ctx).reason).toBe('self_transfer');
    expect(detectExclusion({ ...debit, payeeVpa: 'aarav@okhdfcbank' }, ctx).reason).toBe('self_transfer');
    expect(detectExclusion({ ...debit, payee: 'A/c XX4321', merchant: 'A/c XX4321' }, ctx).reason).toBe('self_transfer');
    expect(detectExclusion({ ...debit, payee: 'A/c XX9999', merchant: 'A/c XX9999' }, ctx).exclude).toBe(false);
  });

  it('fixed commitments by keyword and amount (±10%)', () => {
    expect(detectExclusion({ ...debit, amountPaise: 2_200_000, merchant: 'NoBroker' }, ctx)).toEqual({ exclude: true, reason: 'commitment', commitmentId: 1 });
    expect(detectExclusion({ ...debit, amountPaise: 500_000, merchant: 'Zerodha Broking' }, ctx).commitmentId).toBe(2);
    expect(detectExclusion({ ...debit, amountPaise: 900_000, merchant: 'Zerodha Broking' }, ctx).exclude).toBe(false);
    expect(detectExclusion({ ...debit, amountPaise: 350_000, merchant: 'Bajaj Finance' }, ctx).exclude).toBe(false); // inactive
  });
});

describe('self-transfer pairing', () => {
  const t0 = new Date('2026-10-21T09:00:00Z');
  const debit: PairCandidate = { id: 1, direction: 'debit', amountPaise: 1_000_000, occurredAt: t0, accountLast4: '1234', channel: 'imps', categoryId: 'transfers', creditKind: null, excludeFromBudget: false, transferPairId: null };
  const credit: PairCandidate = { ...debit, id: 2, direction: 'credit', accountLast4: '4321', occurredAt: new Date(t0.getTime() + 5 * 60_000), creditKind: 'reimbursement', categoryId: 'transfers' };

  it('pairs a debit and credit of the same amount on different accounts within 30 minutes', () => {
    expect(isSelfTransferPair(debit, credit)).toBe(true);
  });
  it('does not pair same account, card spends, far-apart times or merchant refunds', () => {
    expect(isSelfTransferPair(debit, { ...credit, accountLast4: '1234' })).toBe(false);
    expect(isSelfTransferPair({ ...debit, channel: 'card' }, credit)).toBe(false);
    expect(isSelfTransferPair(debit, { ...credit, occurredAt: new Date(t0.getTime() + 2 * 3600_000) })).toBe(false);
    expect(isSelfTransferPair(debit, { ...credit, creditKind: 'refund' })).toBe(false);
    expect(isSelfTransferPair({ ...debit, categoryId: 'food' }, credit)).toBe(false);
  });
});

describe('dedupe', () => {
  const t0 = new Date('2026-10-21T09:00:00Z');
  const sms: DedupeCandidate = { amountPaise: 25_000, direction: 'debit', occurredAt: t0, accountLast4: '1234', reference: '629412345678' };

  it('same reference → duplicate, regardless of time', () => {
    expect(duplicateReason({ ...sms, occurredAt: new Date(t0.getTime() + 3 * 3600_000) }, sms)).toBe('reference');
  });
  it('two different UPI refs → two real payments even within the window', () => {
    expect(duplicateReason({ ...sms, reference: '629412345679' }, sms)).toBeNull();
  });
  it('no ref on one side → amount + direction + account + ±10 min', () => {
    const email = { ...sms, reference: null, occurredAt: new Date(t0.getTime() + 9 * 60_000) };
    expect(duplicateReason(email, sms)).toBe('window');
    expect(duplicateReason({ ...email, occurredAt: new Date(t0.getTime() + 11 * 60_000) }, sms)).toBeNull();
    expect(duplicateReason({ ...email, accountLast4: '9999' }, sms)).toBeNull();
    expect(duplicateReason({ ...email, accountLast4: null }, sms)).toBe('window');
    expect(duplicateReason({ ...email, direction: 'credit' }, sms)).toBeNull();
    expect(duplicateReason({ ...email, amountPaise: 25_100 }, sms)).toBeNull();
  });
  it('non-RRN references of different formats fall back to the window', () => {
    expect(duplicateReason({ ...sms, reference: 'T2610212015123456789' }, sms)).toBe('window');
  });
  it('3-digit ICICI accounts match 4-digit forms', () => {
    expect(accountsCompatible('123', '0123')).toBe(true);
    expect(accountsCompatible('1234', '5678')).toBe(false);
  });
  it('prefers reference matches, then the closest in time', () => {
    const a = { ...sms, reference: null, occurredAt: new Date(t0.getTime() + 60_000), id: 'a' };
    const b = { ...sms, id: 'b', occurredAt: new Date(t0.getTime() + 5 * 3600_000) };
    expect(findDuplicate(sms, [a, b])?.match.id).toBe('b');
    const c = { ...sms, reference: null, occurredAt: new Date(t0.getTime() + 8 * 60_000), id: 'c' };
    expect(findDuplicate({ ...sms, reference: null }, [c, a])?.match.id).toBe('a');
  });
});
