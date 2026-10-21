/**
 * Ingestion pipeline shared by the SMS webhook, the email webhook and the IMAP poller.
 *
 *   raw message ──► stored in raw_messages (always — nothing is silently dropped)
 *               ──► parse ──► ignored        (OTP / promo / reminder …)          status=ignored
 *                         ──► unparsed       (Review inbox)                     status=needs_review
 *                         ──► transaction ──► duplicate of an existing one?     status=duplicate (+ enrich)
 *                                         ──► new transaction                   status=parsed
 *                                             └► self-transfer pairing
 *
 * Runs in one DB transaction guarded by an advisory lock so an SMS and its email arriving at the
 * same moment cannot both create a transaction.
 */
import { createHash } from 'node:crypto';
import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db';
import { rawMessages, transactions, type Transaction } from '@/db/schema';
import { isSelfTransferPair, SELF_TRANSFER_WINDOW_MS } from '@/lib/classify';
import { DEDUPE_WINDOW_MS, findDuplicate, normaliseRef, type DuplicateReason } from '@/lib/dedupe';
import type { MessageSource } from '@/lib/domain';
import { appTimezone } from '@/lib/env';
import { parseMessage } from '@/lib/parser';
import { normalizeText } from '@/lib/parser/text';
import type { ParseResult, ParsedTransaction } from '@/lib/parser/types';
import { buildTransaction } from './build';
import { loadIngestContext } from './context';

const INGEST_LOCK_KEY = 727_274_001;
// Shortcut retries / several keyword automations / the email-forwarded copy all arrive within minutes.
const SAME_MESSAGE_WINDOW_MS = 15 * 60 * 1000;

export interface IngestInput {
  source: MessageSource;
  /** 'webhook' | 'imap' | 'imap-forwarded-sms' | 'email-webhook' | 'seed' */
  via: string;
  sender?: string | null;
  subject?: string | null;
  body: string;
  receivedAt: Date;
  /** Email Message-ID. */
  externalId?: string | null;
}

export type IngestOutcome =
  | { status: 'created'; rawMessageId: number; transaction: Transaction }
  | { status: 'duplicate'; rawMessageId: number | null; transactionId: number | null; reason: DuplicateReason | 'same_message' | 'same_email' }
  | { status: 'ignored'; rawMessageId: number; reason: string }
  | { status: 'needs_review'; rawMessageId: number; reason: string };

export function contentHash(body: string): string {
  return createHash('sha256').update(normalizeText(body).toLowerCase().replace(/\s+/g, ' ')).digest('hex');
}

/** JSON-safe snapshot of the parser output for raw_messages.parsed. */
function snapshot(result: ParseResult) {
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}

async function enrichExisting(db: DbOrTx, existing: Transaction, p: ParsedTransaction) {
  const patch: Partial<Transaction> = {};
  if (!existing.reference && p.reference) patch.reference = p.reference;
  if (!existing.accountLast4 && p.accountLast4) patch.accountLast4 = p.accountLast4;
  if (!existing.accountType && p.accountType) patch.accountType = p.accountType;
  if (existing.balancePaise === null && p.balancePaise !== null) patch.balancePaise = p.balancePaise;
  if (!existing.payee && (p.payeeVpa ?? p.payee)) patch.payee = p.payeeVpa ?? p.payee;
  if (!existing.merchant && p.merchant) patch.merchant = p.merchant;
  if (!existing.bank && p.bank) patch.bank = p.bank;
  if (Object.keys(patch).length > 0) await db.update(transactions).set(patch).where(eq(transactions.id, existing.id));
}

/** Pairs a new transaction with an opposite-direction one on another of my accounts (self-transfer). */
export async function pairSelfTransfer(db: DbOrTx, txn: Transaction): Promise<number | null> {
  if (txn.excludeFromBudget || txn.transferPairId) return null;
  const from = new Date(txn.occurredAt.getTime() - SELF_TRANSFER_WINDOW_MS);
  const to = new Date(txn.occurredAt.getTime() + SELF_TRANSFER_WINDOW_MS);
  const candidates = await db
    .select()
    .from(transactions)
    .where(
      and(
        ne(transactions.id, txn.id),
        ne(transactions.direction, txn.direction),
        eq(transactions.amountPaise, txn.amountPaise),
        eq(transactions.excludeFromBudget, false),
        isNull(transactions.transferPairId),
        gte(transactions.occurredAt, from),
        lte(transactions.occurredAt, to),
      ),
    );
  const match = candidates
    .filter((c) => isSelfTransferPair(txn, c))
    .sort((a, b) => Math.abs(a.occurredAt.getTime() - txn.occurredAt.getTime()) - Math.abs(b.occurredAt.getTime() - txn.occurredAt.getTime()))[0];
  if (!match) return null;
  const set = (pair: number) => ({ excludeFromBudget: true, excludeReason: 'self_transfer' as const, categoryId: 'self_transfer', transferPairId: pair });
  await db.update(transactions).set(set(match.id)).where(eq(transactions.id, txn.id));
  await db.update(transactions).set(set(txn.id)).where(eq(transactions.id, match.id));
  return match.id;
}

type Resolved = { kind: 'duplicate'; transaction: Transaction; reason: DuplicateReason } | { kind: 'created'; transaction: Transaction };

/** Dedupe a parsed transaction against existing ones; enrich the match, or insert a new row (+ self-transfer pairing). */
async function resolveTransaction(tx: DbOrTx, parsed: ParsedTransaction, source: MessageSource, body: string): Promise<Resolved> {
  const ref = normaliseRef(parsed.reference);
  const p = { ...parsed, reference: ref };
  const nearby = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.direction, p.direction),
        eq(transactions.amountPaise, p.amountPaise),
        or(
          ref ? eq(transactions.reference, ref) : sql`false`,
          and(
            gte(transactions.occurredAt, new Date(p.occurredAt.getTime() - DEDUPE_WINDOW_MS)),
            lte(transactions.occurredAt, new Date(p.occurredAt.getTime() + DEDUPE_WINDOW_MS)),
          ),
        ),
      ),
    );
  const dup = findDuplicate({ ...p, source }, nearby.map((t) => ({ ...t, reference: normaliseRef(t.reference) })));
  if (dup) {
    const existing = nearby.find((t) => t.id === (dup.match as Transaction).id)!;
    await enrichExisting(tx, existing, p);
    return { kind: 'duplicate', transaction: existing, reason: dup.reason };
  }
  const ctx = await loadIngestContext(tx);
  const [created] = await tx.insert(transactions).values(buildTransaction(p, ctx, source, body)).returning();
  const pairedWith = await pairSelfTransfer(tx, created!);
  const transaction = pairedWith ? (await tx.select().from(transactions).where(eq(transactions.id, created!.id)))[0]! : created!;
  return { kind: 'created', transaction };
}

export interface ReprocessSummary {
  checked: number;
  created: number;
  duplicates: number;
  unchanged: number;
}

/**
 * Re-runs the current parser over messages in the Review inbox / Ignored list (e.g. after adding a
 * bank format). Messages that now parse become transactions (or link to an existing duplicate).
 */
export async function reprocessMessages(db: Db, rawMessageIds: number[]): Promise<ReprocessSummary> {
  const summary: ReprocessSummary = { checked: 0, created: 0, duplicates: 0, unchanged: 0 };
  const tz = appTimezone();
  for (const id of rawMessageIds) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${INGEST_LOCK_KEY})`);
      const [raw] = await tx.select().from(rawMessages).where(eq(rawMessages.id, id));
      if (!raw || (raw.status !== 'needs_review' && raw.status !== 'ignored')) return;
      summary.checked += 1;
      const result = parseMessage({ text: raw.body, sender: raw.sender, subject: raw.subject, receivedAt: raw.receivedAt, source: raw.source }, { timezone: tz });
      if (result.status !== 'transaction') {
        const status = result.status === 'ignored' ? 'ignored' : 'needs_review';
        await tx.update(rawMessages).set({ status, statusReason: result.reason, parsed: snapshot(result) }).where(eq(rawMessages.id, id));
        summary.unchanged += 1;
        return;
      }
      const resolved = await resolveTransaction(tx, result.txn, raw.source, raw.body);
      await tx
        .update(rawMessages)
        .set({
          status: resolved.kind === 'created' ? 'parsed' : 'duplicate',
          statusReason: resolved.kind === 'created' ? result.parser : `duplicate_${resolved.reason}`,
          parsed: snapshot(result),
          transactionId: resolved.transaction.id,
        })
        .where(eq(rawMessages.id, id));
      if (resolved.kind === 'created') summary.created += 1;
      else summary.duplicates += 1;
    });
  }
  return summary;
}

export async function ingestMessage(db: Db, input: IngestInput): Promise<IngestOutcome> {
  const hash = contentHash(input.body);
  const tz = appTimezone();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INGEST_LOCK_KEY})`);

    // 1. The exact same email (Message-ID) is never processed twice.
    if (input.externalId) {
      const [seen] = await tx.select({ id: rawMessages.id, transactionId: rawMessages.transactionId }).from(rawMessages).where(eq(rawMessages.externalId, input.externalId));
      if (seen) return { status: 'duplicate', rawMessageId: seen.id, transactionId: seen.transactionId, reason: 'same_email' };
    }

    const base = {
      source: input.source,
      via: input.via,
      sender: input.sender ?? null,
      subject: input.subject ?? null,
      body: input.body,
      receivedAt: input.receivedAt,
      externalId: input.externalId ?? null,
      contentHash: hash,
    };

    // 2. The same text posted again (Shortcut retry, or the SMS also forwarded by email).
    const [same] = await tx
      .select({ id: rawMessages.id, transactionId: rawMessages.transactionId, status: rawMessages.status })
      .from(rawMessages)
      .where(
        and(
          eq(rawMessages.contentHash, hash),
          gte(rawMessages.receivedAt, new Date(input.receivedAt.getTime() - SAME_MESSAGE_WINDOW_MS)),
          lte(rawMessages.receivedAt, new Date(input.receivedAt.getTime() + SAME_MESSAGE_WINDOW_MS)),
        ),
      )
      .limit(1);
    if (same) {
      const [row] = await tx
        .insert(rawMessages)
        .values({ ...base, status: 'duplicate', statusReason: 'same_message', transactionId: same.transactionId })
        .returning({ id: rawMessages.id });
      return { status: 'duplicate', rawMessageId: row!.id, transactionId: same.transactionId, reason: 'same_message' };
    }

    // 3. Parse.
    const result = parseMessage(
      { text: input.body, sender: input.sender, subject: input.subject, receivedAt: input.receivedAt, source: input.source },
      { timezone: tz },
    );

    if (result.status !== 'transaction') {
      const status = result.status === 'ignored' ? 'ignored' : 'needs_review';
      const [row] = await tx
        .insert(rawMessages)
        .values({ ...base, status, statusReason: result.reason, parsed: snapshot(result) })
        .returning({ id: rawMessages.id });
      return { status, rawMessageId: row!.id, reason: result.reason };
    }

    const resolved = await resolveTransaction(tx, result.txn, input.source, input.body);
    if (resolved.kind === 'duplicate') {
      const [row] = await tx
        .insert(rawMessages)
        .values({ ...base, status: 'duplicate', statusReason: `duplicate_${resolved.reason}`, parsed: snapshot(result), transactionId: resolved.transaction.id })
        .returning({ id: rawMessages.id });
      return { status: 'duplicate', rawMessageId: row!.id, transactionId: resolved.transaction.id, reason: resolved.reason };
    }
    const [row] = await tx
      .insert(rawMessages)
      .values({ ...base, status: 'parsed', statusReason: result.parser, parsed: snapshot(result), transactionId: resolved.transaction.id })
      .returning({ id: rawMessages.id });
    const transaction = resolved.transaction;
    return { status: 'created', rawMessageId: row!.id, transaction };
  });
}
