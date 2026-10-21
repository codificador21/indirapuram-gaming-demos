/**
 * Transaction service: manual entry, edits, re-categorisation (learned rules) and Review inbox actions.
 * Server actions call these; they take a Db so they are testable against a test database.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db';
import { merchantRules, rawMessages, transactions, type Transaction } from '@/db/schema';
import { categorise } from './categorise';
import { classifyCredit, detectExclusion } from './classify';
import type { Channel, CreditKind, Direction, TxnSource } from './domain';
import { loadIngestContext } from './ingest/context';
import { cleanMerchant, merchantKey } from './parser/merchant';

/** When an auto-detected self-transfer is released, file it with people payments instead (unless I set it). */
const releasedCategory = sql`case when ${transactions.categorySource} = 'manual' then ${transactions.categoryId} else 'transfers' end`;

export interface ManualTransactionInput {
  amountPaise: number;
  direction: Direction;
  occurredAt: Date;
  merchant?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  channel?: Channel;
  creditKind?: CreditKind | null;
  excludeFromBudget?: boolean;
  accountLast4?: string | null;
}

export async function createTransaction(db: DbOrTx, input: ManualTransactionInput, source: TxnSource = 'manual'): Promise<Transaction> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error('Amount must be positive');
  const ctx = await loadIngestContext(db);
  // Keep what I typed for manual entries; only tidy names that came from a message.
  const merchant = source === 'manual' ? input.merchant?.trim() || null : (cleanMerchant(input.merchant) ?? (input.merchant?.trim() || null));
  const key = merchantKey(merchant);
  const channel = input.channel ?? 'cash';
  const hints = {};
  const ci = { direction: input.direction, amountPaise: input.amountPaise, occurredAt: input.occurredAt, merchant, payee: null, payeeVpa: null, channel, hints };
  const creditKind = input.direction === 'credit' ? (input.creditKind ?? classifyCredit(ci, ctx) ?? 'income') : null;
  const auto = categorise({ direction: input.direction, merchant, merchantKey: key, payee: null, channel, hints, creditKind }, ctx.rules);
  const exclusion = input.excludeFromBudget === undefined ? detectExclusion(ci, ctx) : null;
  const exclude = input.excludeFromBudget ?? exclusion?.exclude ?? false;

  const [row] = await db
    .insert(transactions)
    .values({
      occurredAt: input.occurredAt,
      amountPaise: input.amountPaise,
      direction: input.direction,
      merchant,
      merchantKey: key,
      channel,
      accountType: channel === 'cash' ? 'cash' : null,
      accountLast4: input.accountLast4 ?? null,
      categoryId: input.categoryId || auto.categoryId,
      categorySource: input.categoryId ? 'manual' : auto.source,
      creditKind,
      excludeFromBudget: exclude,
      excludeReason: exclude ? (exclusion?.reason ?? 'manual') : null,
      commitmentId: exclusion?.commitmentId ?? null,
      notes: input.notes?.trim() || null,
      source,
    })
    .returning();
  return row!;
}

export interface TransactionPatch {
  categoryId?: string;
  notes?: string | null;
  merchant?: string | null;
  excludeFromBudget?: boolean;
  creditKind?: CreditKind | null;
  amountPaise?: number;
  direction?: Direction;
  occurredAt?: Date;
}

export interface UpdateOptions {
  /** When the category changes: remember it for this merchant and re-file past auto-categorised ones. */
  rememberCategory?: boolean;
}

export async function updateTransaction(db: Db, id: number, patch: TransactionPatch, opts: UpdateOptions = {}): Promise<{ transaction: Transaction; alsoUpdated: number }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(transactions).where(eq(transactions.id, id));
    if (!current) throw new Error(`Transaction ${id} not found`);

    const set: Partial<Transaction> = {};
    if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
    if (patch.merchant !== undefined) {
      set.merchant = patch.merchant?.trim() || null;
      set.merchantKey = merchantKey(set.merchant) ?? current.merchantKey;
    }
    if (patch.amountPaise !== undefined) {
      if (!Number.isSafeInteger(patch.amountPaise) || patch.amountPaise <= 0) throw new Error('Amount must be positive');
      set.amountPaise = patch.amountPaise;
    }
    if (patch.direction !== undefined) {
      set.direction = patch.direction;
      if (patch.direction === 'debit') set.creditKind = null;
      else if (!current.creditKind) set.creditKind = 'income';
    }
    if (patch.occurredAt !== undefined) set.occurredAt = patch.occurredAt;
    if (patch.creditKind !== undefined && (patch.direction ?? current.direction) === 'credit') set.creditKind = patch.creditKind;
    if (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) {
      set.categoryId = patch.categoryId;
      set.categorySource = 'manual';
    }
    if (patch.excludeFromBudget !== undefined && patch.excludeFromBudget !== current.excludeFromBudget) {
      set.excludeFromBudget = patch.excludeFromBudget;
      set.excludeReason = patch.excludeFromBudget ? 'manual' : null;
      if (!patch.excludeFromBudget && current.excludeReason === 'self_transfer' && current.categoryId === 'self_transfer' && patch.categoryId === undefined && current.categorySource !== 'manual') {
        set.categoryId = 'transfers';
      }
      if (!patch.excludeFromBudget && current.transferPairId) {
        // Breaking an auto-detected self-transfer: release the other half too.
        set.transferPairId = null;
        await tx
          .update(transactions)
          .set({ transferPairId: null, excludeFromBudget: false, excludeReason: null, categoryId: releasedCategory })
          .where(and(eq(transactions.id, current.transferPairId), eq(transactions.excludeReason, 'self_transfer')));
      }
    }

    const [updated] = Object.keys(set).length
      ? await tx.update(transactions).set(set).where(eq(transactions.id, id)).returning()
      : [current];

    let alsoUpdated = 0;
    const key = updated!.merchantKey;
    if (opts.rememberCategory && patch.categoryId && key) {
      await tx
        .insert(merchantRules)
        .values({ merchantKey: key, categoryId: patch.categoryId })
        .onConflictDoUpdate({ target: merchantRules.merchantKey, set: { categoryId: patch.categoryId } });
      const res = await tx
        .update(transactions)
        .set({ categoryId: patch.categoryId, categorySource: 'rule' })
        .where(and(eq(transactions.merchantKey, key), ne(transactions.id, id), ne(transactions.categorySource, 'manual'), eq(transactions.excludeFromBudget, false)))
        .returning({ id: transactions.id });
      alsoUpdated = res.length;
    }
    return { transaction: updated!, alsoUpdated };
  });
}

export async function deleteTransaction(db: Db, id: number) {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(transactions).where(eq(transactions.id, id));
    if (!current) return;
    if (current.transferPairId) {
      await tx
        .update(transactions)
        .set({ transferPairId: null, excludeFromBudget: false, excludeReason: null, categoryId: releasedCategory })
        .where(eq(transactions.id, current.transferPairId));
    }
    await tx.update(rawMessages).set({ status: 'dismissed', statusReason: 'transaction_deleted' }).where(eq(rawMessages.transactionId, id));
    await tx.delete(transactions).where(eq(transactions.id, id));
  });
}

export class ReviewConflictError extends Error {}

/**
 * Review inbox: create a transaction from an unparsed / ignored message, or from one wrongly treated
 * as a duplicate ("not a duplicate"). Refuses messages that already produced a transaction.
 */
export async function resolveReview(db: Db, rawMessageId: number, input: ManualTransactionInput): Promise<Transaction> {
  return db.transaction(async (tx) => {
    // Lock the row so a double-tap can't create two transactions from one message.
    const [raw] = await tx.select().from(rawMessages).where(eq(rawMessages.id, rawMessageId)).for('update');
    if (!raw) throw new Error(`Message ${rawMessageId} not found`);
    const allowed = raw.status === 'needs_review' || raw.status === 'ignored' || raw.status === 'duplicate' || (raw.status === 'dismissed' && !raw.transactionId);
    if (!allowed) throw new ReviewConflictError('This message already has a transaction');
    const txn = await createTransaction(tx, { ...input, channel: input.channel ?? 'other' }, raw.source);
    await tx.update(rawMessages).set({ status: 'resolved', transactionId: txn.id }).where(eq(rawMessages.id, rawMessageId));
    return txn;
  });
}

export async function dismissReview(db: DbOrTx, rawMessageIds: number[]) {
  if (rawMessageIds.length === 0) return;
  await db.update(rawMessages).set({ status: 'dismissed' }).where(inArray(rawMessages.id, rawMessageIds));
}
