import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { fixedCommitments, merchantRules, rawMessages, settings, transactions } from '@/db/schema';
import { contentHash, ingestMessage, reprocessMessages, type IngestInput } from '@/lib/ingest/pipeline';
import { fixtureById } from '@/lib/parser/fixtures';
import { createTransaction, deleteTransaction, dismissReview, resolveReview, updateTransaction } from '@/lib/transactions';
import { databaseAvailable, resetTestDb, setupTestDb } from './helpers/db';

const available = await databaseAvailable();

function fromFixture(id: string, over: Partial<IngestInput> = {}): IngestInput {
  const f = fixtureById(id);
  return { source: f.source, via: 'test', sender: f.sender, subject: f.subject, body: f.text, receivedAt: new Date(f.receivedAt), ...over };
}

describe.skipIf(!available)('ingest pipeline (Postgres)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await setupTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => resetTestDb(db));

  const txnCount = async () => (await db.select().from(transactions)).length;

  it('creates a categorised transaction from an SMS', async () => {
    const out = await ingestMessage(db, fromFixture('hdfc-upi-sent-sms'));
    expect(out.status).toBe('created');
    if (out.status !== 'created') return;
    expect(out.transaction).toMatchObject({
      amountPaise: 25000,
      direction: 'debit',
      merchant: 'Swiggy',
      merchantKey: 'swiggy',
      categoryId: 'food',
      categorySource: 'auto',
      reference: '629412345678',
      accountLast4: '1234',
      source: 'sms',
      excludeFromBudget: false,
    });
    const [raw] = await db.select().from(rawMessages);
    expect(raw).toMatchObject({ status: 'parsed', statusReason: 'hdfc.upi.sent', transactionId: out.transaction.id });
  });

  it('dedupes the same SMS posted twice', async () => {
    await ingestMessage(db, fromFixture('hdfc-upi-sent-sms'));
    const again = await ingestMessage(db, fromFixture('hdfc-upi-sent-sms', { receivedAt: new Date('2026-10-21T09:05:20Z') }));
    expect(again).toMatchObject({ status: 'duplicate', reason: 'same_message' });
    expect(await txnCount()).toBe(1);
    expect((await db.select().from(rawMessages)).length).toBe(2); // still stored
  });

  it('dedupes SMS + bank email by UPI reference and links both raw messages', async () => {
    const sms = await ingestMessage(db, fromFixture('hdfc-upi-sent-sms'));
    const email = await ingestMessage(db, fromFixture('hdfc-upi-email', { externalId: '<abc@hdfcbank.net>' }));
    expect(email).toMatchObject({ status: 'duplicate', reason: 'reference' });
    expect(await txnCount()).toBe(1);
    const raws = await db.select().from(rawMessages);
    expect(new Set(raws.map((r) => r.transactionId))).toEqual(new Set([sms.status === 'created' ? sms.transaction.id : -1]));
  });

  it('dedupes card SMS + card email (no reference) by amount/account/±10 min, and enriches', async () => {
    await ingestMessage(db, fromFixture('hdfc-card-spent-sms'));
    const email = await ingestMessage(db, fromFixture('hdfc-cc-email'));
    expect(email).toMatchObject({ status: 'duplicate', reason: 'window' });
    const [t] = await db.select().from(transactions);
    expect(t!.categoryId).toBe('shopping');
    expect(await txnCount()).toBe(1);
  });

  it('dedupes in either arrival order (email first, then SMS)', async () => {
    await ingestMessage(db, fromFixture('axis-cc-email'));
    const sms = await ingestMessage(db, fromFixture('axis-cc-spent-sms'));
    expect(sms.status).toBe('duplicate');
    expect(await txnCount()).toBe(1);
  });

  it('serialises concurrent arrivals of the same transaction', async () => {
    const results = await Promise.all([
      ingestMessage(db, fromFixture('kotak-upi-received-sms')),
      ingestMessage(db, fromFixture('kotak-upi-received-sms', { source: 'email', body: fixtureById('kotak-upi-received-sms').text + '\n\n-- forwarded' })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'duplicate']);
    expect(await txnCount()).toBe(1);
  });

  it('never ingests the same email Message-ID twice', async () => {
    await ingestMessage(db, fromFixture('icici-cc-email', { externalId: '<m1@icicibank.com>' }));
    const again = await ingestMessage(db, fromFixture('icici-cc-email', { externalId: '<m1@icicibank.com>' }));
    expect(again).toMatchObject({ status: 'duplicate', reason: 'same_email' });
    expect((await db.select().from(rawMessages)).length).toBe(1);
  });

  it('keeps two genuine identical payments with different UPI refs', async () => {
    await ingestMessage(db, fromFixture('kotak-upi-sent-sms'));
    const second = fixtureById('kotak-upi-sent-sms').text.replace('629488889999', '629488880000');
    const out = await ingestMessage(db, fromFixture('kotak-upi-sent-sms', { body: second }));
    expect(out.status).toBe('created');
    expect(await txnCount()).toBe(2);
  });

  it('stores ignored messages and routes unparseable ones to review', async () => {
    expect(await ingestMessage(db, fromFixture('hdfc-otp-sms'))).toMatchObject({ status: 'ignored', reason: 'otp' });
    expect(await ingestMessage(db, fromFixture('hdfc-promo-sms'))).toMatchObject({ status: 'ignored', reason: 'promo' });
    const review = await ingestMessage(db, fromFixture('unparsed-no-direction-sms'));
    expect(review).toMatchObject({ status: 'needs_review', reason: 'no_direction' });
    expect(await txnCount()).toBe(0);
    const raws = await db.select().from(rawMessages);
    expect(raws.map((r) => r.status).sort()).toEqual(['ignored', 'ignored', 'needs_review']);
  });

  it('resolves a review item into a transaction', async () => {
    const review = await ingestMessage(db, fromFixture('unparsed-no-direction-sms'));
    const txn = await resolveReview(db, review.rawMessageId!, { amountPaise: 345000, direction: 'debit', occurredAt: new Date(), merchant: 'Croma', categoryId: 'shopping' });
    expect(txn).toMatchObject({ categoryId: 'shopping', categorySource: 'manual', source: 'sms' });
    const [raw] = await db.select().from(rawMessages).where(eq(rawMessages.id, review.rawMessageId!));
    expect(raw).toMatchObject({ status: 'resolved', transactionId: txn.id });

    const other = await ingestMessage(db, fromFixture('unparsed-no-amount-sms'));
    await dismissReview(db, [other.rawMessageId!]);
    const [dismissed] = await db.select().from(rawMessages).where(eq(rawMessages.id, other.rawMessageId!));
    expect(dismissed!.status).toBe('dismissed');
  });

  it('detects salary from settings and marks card bill payments / commitments as excluded', async () => {
    await db.update(settings).set({ monthlySalaryPaise: 8_500_000, salaryCreditDay: 30 });
    await db.insert(fixedCommitments).values({ name: 'Index fund SIP', kind: 'sip', amountPaise: 500_000, matchKeywords: 'zerodha' });

    const salary = await ingestMessage(db, fromFixture('hdfc-neft-salary-sms'));
    expect(salary.status === 'created' && salary.transaction).toMatchObject({ creditKind: 'salary', categoryId: 'salary', merchant: 'Acme Technologies' });

    const bill = await ingestMessage(db, fromFixture('hdfc-cc-bill-payment-debit-sms'));
    expect(bill.status === 'created' && bill.transaction).toMatchObject({ excludeFromBudget: true, excludeReason: 'card_bill', categoryId: 'self_transfer', merchant: 'Credit card bill payment' });

    const sip = await ingestMessage(db, fromFixture('hdfc-nach-sip-debit-sms'));
    expect(sip.status === 'created' && sip.transaction).toMatchObject({ excludeFromBudget: true, excludeReason: 'commitment', categoryId: 'investments' });

    const refund = await ingestMessage(db, fromFixture('icici-cc-reversal-sms'));
    expect(refund.status === 'created' && refund.transaction).toMatchObject({ creditKind: 'refund', categoryId: 'food' });

    const payback = await ingestMessage(db, fromFixture('kotak-upi-received-sms'));
    expect(payback.status === 'created' && payback.transaction).toMatchObject({ creditKind: 'reimbursement', categoryId: 'transfers' });
  });

  it('pairs a transfer between my own accounts and excludes both halves', async () => {
    const debit = await ingestMessage(db, {
      source: 'sms', via: 'test', sender: 'VM-HDFCBK-S', receivedAt: new Date('2026-10-21T09:00:00Z'),
      body: 'Money Sent - INR 10,000.00 From HDFC Bank A/c XX1234 on 21-10-26 To A/c XX4321 IMPS Ref No 629400001234 Avl bal: INR 5,000.00',
    });
    const credit = await ingestMessage(db, {
      source: 'sms', via: 'test', sender: 'CP-CBSSBI-S', receivedAt: new Date('2026-10-21T09:03:00Z'),
      body: 'Your A/C XXXXX4321 Credited INR 10,000.00 on 21/10/26 -Deposit by transfer from AARAV MEHTA. Avl Bal INR 20,000.00-SBI',
    });
    expect(debit.status).toBe('created');
    expect(credit.status).toBe('created');
    const rows = await db.select().from(transactions);
    expect(rows.every((r) => r.excludeFromBudget && r.excludeReason === 'self_transfer' && r.categoryId === 'self_transfer')).toBe(true);
    expect(rows[0]!.transferPairId).toBe(rows[1]!.id);

    // Un-excluding one half releases the pair.
    await updateTransaction(db, rows[0]!.id, { excludeFromBudget: false });
    const after = await db.select().from(transactions);
    expect(after.every((r) => !r.excludeFromBudget && r.transferPairId === null)).toBe(true);
  });

  it('remembers a re-categorised merchant for past and future transactions', async () => {
    const a = await ingestMessage(db, fromFixture('hdfc-upi-sent-sms'));
    const b = await ingestMessage(db, fromFixture('phonepe-paid-email'));
    if (a.status !== 'created' || b.status !== 'created') throw new Error('expected created');
    const res = await updateTransaction(db, a.transaction.id, { categoryId: 'groceries' }, { rememberCategory: true });
    expect(res.alsoUpdated).toBe(1);
    const [rule] = await db.select().from(merchantRules);
    expect(rule).toMatchObject({ merchantKey: 'swiggy', categoryId: 'groceries' });

    const next = await ingestMessage(db, fromFixture('hdfc-upi-refund-credit-sms'));
    expect(next.status === 'created' && next.transaction).toMatchObject({ categoryId: 'groceries', categorySource: 'rule' });
  });

  it('manual entries: cash by default, auto-categorised, and later bank alerts dedupe against them', async () => {
    const manual = await createTransaction(db, { amountPaise: 45000, direction: 'debit', occurredAt: new Date('2026-10-21T05:48:00Z'), merchant: 'DMart', accountLast4: '9911' });
    expect(manual).toMatchObject({ channel: 'cash', categoryId: 'groceries', categorySource: 'auto', source: 'manual' });
    const sms = await ingestMessage(db, fromFixture('kotak-debit-card-sms'));
    expect(sms.status).toBe('duplicate');

    await deleteTransaction(db, manual.id);
    expect(await txnCount()).toBe(0);
    const [raw] = await db.select().from(rawMessages);
    expect(raw!.status).toBe('dismissed');
  });

  it('re-checks review/ignored messages with the current parser', async () => {
    // Simulate messages stored by an older parser that couldn't read them.
    const readable = fixtureById('axis-upi-debit-sms');
    const [stale] = await db
      .insert(rawMessages)
      .values({ source: 'sms', via: 'test', sender: readable.sender, body: readable.text, receivedAt: new Date(readable.receivedAt), contentHash: contentHash(readable.text), status: 'needs_review', statusReason: 'no_amount' })
      .returning();
    const otp = await ingestMessage(db, fromFixture('hdfc-otp-sms'));
    const already = await ingestMessage(db, fromFixture('icici-upi-debit-sms'));
    const icici = fixtureById('icici-upi-debit-sms');
    const [dupe] = await db
      .insert(rawMessages)
      .values({ source: 'sms', via: 'test', sender: icici.sender, body: icici.text + ' ', receivedAt: new Date(icici.receivedAt), contentHash: 'x', status: 'needs_review' })
      .returning();

    const summary = await reprocessMessages(db, [stale!.id, otp.rawMessageId!, dupe!.id]);
    expect(summary).toEqual({ checked: 3, created: 1, duplicates: 1, unchanged: 1 });
    const [after] = await db.select().from(rawMessages).where(eq(rawMessages.id, stale!.id));
    expect(after).toMatchObject({ status: 'parsed', statusReason: 'axis.upi.debit' });
    const [dupAfter] = await db.select().from(rawMessages).where(eq(rawMessages.id, dupe!.id));
    expect(dupAfter!.transactionId).toBe(already.status === 'created' ? already.transaction.id : -1);
    expect(await txnCount()).toBe(2);
  });
});
