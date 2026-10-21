import 'server-only';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { appState, categories, fixedCommitments, merchantRules, myAccounts, rawMessages, settings, transactions, type Category, type Transaction } from '@/db/schema';
import { computeBudget, getPeriod, type BudgetPeriod, type BudgetSettings } from './budget';
import type { RawStatus } from './domain';
import { appTimezone } from './env';
import { addDays, localDayKey, startOfDay } from './time';

export async function getSettingsBundle(db: Db) {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  const commitments = await db.select().from(fixedCommitments).orderBy(asc(fixedCommitments.id));
  const accounts = await db.select().from(myAccounts).orderBy(asc(myAccounts.id));
  const rules = await db.select().from(merchantRules).orderBy(desc(merchantRules.updatedAt));
  const settingsRow = s ?? { id: 1, monthlySalaryPaise: 0, salaryCreditDay: 1, budgetCycle: 'calendar' as const, selfIdentifiers: [], updatedAt: new Date() };
  const budgetSettings: BudgetSettings = {
    monthlySalaryPaise: settingsRow.monthlySalaryPaise,
    fixedCommitmentsPaise: commitments.filter((c) => c.active).reduce((a, c) => a + c.amountPaise, 0),
    budgetCycle: settingsRow.budgetCycle,
    salaryCreditDay: settingsRow.salaryCreditDay,
  };
  return { settings: settingsRow, commitments, accounts, rules, budgetSettings };
}

export async function getCategories(db: Db): Promise<Category[]> {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
}

export function categoryLookup(list: Category[]) {
  const map = new Map(list.map((c) => [c.id, c]));
  return (id: string) => map.get(id) ?? { id, name: id, emoji: '🏷️', color: '#94a3b8', kind: 'expense' as const, sortOrder: 999, createdAt: new Date() };
}

export function periodRange(period: BudgetPeriod, tz = appTimezone()) {
  return { from: startOfDay(period.start, tz), to: startOfDay(addDays(period.end, 1), tz) };
}

export async function transactionsBetween(db: Db, from: Date, to: Date) {
  return db
    .select()
    .from(transactions)
    .where(and(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id));
}

/** Budget for the period containing `dayKey` (default: today). */
export async function getBudget(db: Db, opts: { dayKey?: string; now?: Date } = {}) {
  const tz = appTimezone();
  const now = opts.now ?? new Date();
  const bundle = await getSettingsBundle(db);
  const period = getPeriod(opts.dayKey ?? localDayKey(now, tz), bundle.budgetSettings);
  const { from, to } = periodRange(period, tz);
  const txns = await transactionsBetween(db, from, to);
  const summary = computeBudget(txns, bundle.budgetSettings, now, tz, period);
  return { summary, txns, bundle, period };
}

export interface TxnFilter {
  from?: Date;
  to?: Date;
  categoryId?: string | null;
  q?: string | null;
  kind?: 'all' | 'debit' | 'credit' | 'excluded';
  limit?: number;
}

export async function listTransactions(db: Db, f: TxnFilter = {}): Promise<Transaction[]> {
  const where = [];
  if (f.from) where.push(gte(transactions.occurredAt, f.from));
  if (f.to) where.push(lt(transactions.occurredAt, f.to));
  if (f.categoryId) where.push(eq(transactions.categoryId, f.categoryId));
  if (f.kind === 'debit' || f.kind === 'credit') where.push(eq(transactions.direction, f.kind));
  if (f.kind === 'excluded') where.push(eq(transactions.excludeFromBudget, true));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_]/g, '\\$&')}%`;
    where.push(or(ilike(transactions.merchant, like), ilike(transactions.payee, like), ilike(transactions.notes, like))!);
  }
  return db
    .select()
    .from(transactions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(f.limit ?? 500);
}

export async function recentTransactions(db: Db, n = 5) {
  return db.select().from(transactions).orderBy(desc(transactions.occurredAt), desc(transactions.id)).limit(n);
}

export async function reviewCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(rawMessages).where(eq(rawMessages.status, 'needs_review'));
  return row?.n ?? 0;
}

export async function reviewItems(db: Db, statuses: RawStatus[], limit = 100) {
  return db.select().from(rawMessages).where(inArray(rawMessages.status, statuses)).orderBy(desc(rawMessages.receivedAt)).limit(limit);
}

export async function sourceMessages(db: Db, transactionId: number) {
  return db.select().from(rawMessages).where(eq(rawMessages.transactionId, transactionId)).orderBy(asc(rawMessages.receivedAt));
}

export async function ingestStats(db: Db) {
  const rows = await db
    .select({ source: rawMessages.source, via: rawMessages.via, n: count(), last: sql<Date>`max(${rawMessages.receivedAt})` })
    .from(rawMessages)
    .groupBy(rawMessages.source, rawMessages.via);
  return rows;
}

export async function getAppState<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(appState).where(eq(appState.key, key));
  return (row?.value as T) ?? null;
}

/** Merchants I've used recently with their most common category — powers quick-add suggestions. */
export async function frequentMerchants(db: Db, limit = 40) {
  const rows = await db
    .select({ merchant: transactions.merchant, categoryId: transactions.categoryId, n: count() })
    .from(transactions)
    .where(and(sql`${transactions.merchant} is not null`, eq(transactions.direction, 'debit'), gte(transactions.occurredAt, sql`now() - interval '90 days'`)))
    .groupBy(transactions.merchant, transactions.categoryId)
    .orderBy(desc(count()))
    .limit(limit * 2);
  const seen = new Set<string>();
  const out: Array<{ merchant: string; categoryId: string }> = [];
  for (const r of rows) {
    const key = r.merchant!.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ merchant: r.merchant!, categoryId: r.categoryId });
  }
  return out.slice(0, limit);
}
