/**
 * Database schema (Drizzle ORM, Postgres).
 *
 * Conventions
 * - Money is stored as integer paise in `bigint` columns (mode: 'number' — safe up to ~₹90 trillion).
 * - Timestamps are `timestamptz`. Day-level logic (budgets, grouping) converts to APP_TIMEZONE in code.
 * - Small enums are `text` columns typed with `$type<>()` instead of Postgres enums, so adding a
 *   value never needs an `ALTER TYPE` migration. Allowed values live in `src/lib/domain.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  AccountType,
  CategoryKind,
  CategorySource,
  Channel,
  CommitmentKind,
  CreditKind,
  Direction,
  ExcludeReason,
  MessageSource,
  RawStatus,
  TxnSource,
} from '@/lib/domain';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const categories = pgTable('categories', {
  /** Slug, e.g. `food`. Stable identifier referenced by transactions and rules. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull().default('🏷️'),
  /** Hex colour used in charts. */
  color: text('color').notNull().default('#94a3b8'),
  kind: text('kind').$type<CategoryKind>().notNull().default('expense'),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: createdAt(),
});

export const fixedCommitments = pgTable('fixed_commitments', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  kind: text('kind').$type<CommitmentKind>().notNull().default('other'),
  amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  /**
   * Comma-separated keywords. A debit whose merchant/payee/text contains one of these and whose
   * amount is within ±10% of `amountPaise` is linked to this commitment and excluded from daily
   * spending (it is already deducted from the monthly budget).
   */
  matchKeywords: text('match_keywords').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    direction: text('direction').$type<Direction>().notNull(),
    /** Cleaned display name, e.g. "Swiggy". */
    merchant: text('merchant'),
    /** Normalised merchant key used for learned category rules, e.g. "swiggy". */
    merchantKey: text('merchant_key'),
    /** Counterparty exactly as it appeared in the message (VPA, name, "A/c XX5678"...). */
    payee: text('payee'),
    bank: text('bank'),
    accountLast4: text('account_last4'),
    accountType: text('account_type').$type<AccountType>(),
    channel: text('channel').$type<Channel>().notNull().default('other'),
    /** UPI RRN / UTR / bank transaction id (uppercased, no spaces). */
    reference: text('reference'),
    balancePaise: bigint('balance_paise', { mode: 'number' }),
    categoryId: text('category_id')
      .notNull()
      .default('other')
      .references(() => categories.id, { onUpdate: 'cascade', onDelete: 'set default' }),
    categorySource: text('category_source').$type<CategorySource>().notNull().default('auto'),
    /** Only for credits: how the credit affects the budget. See DECISIONS.md. */
    creditKind: text('credit_kind').$type<CreditKind>(),
    excludeFromBudget: boolean('exclude_from_budget').notNull().default(false),
    excludeReason: text('exclude_reason').$type<ExcludeReason>(),
    commitmentId: integer('commitment_id').references(() => fixedCommitments.id, { onDelete: 'set null' }),
    /** Other half of an auto-detected self-transfer (debit on one account ↔ credit on another). */
    transferPairId: integer('transfer_pair_id'),
    notes: text('notes'),
    source: text('source').$type<TxnSource>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transactions_occurred_at_idx').on(t.occurredAt),
    index('transactions_reference_idx').on(t.reference),
    index('transactions_merchant_key_idx').on(t.merchantKey),
    check('transactions_amount_positive', sql`${t.amountPaise} > 0`),
  ],
);

export const rawMessages = pgTable(
  'raw_messages',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    source: text('source').$type<MessageSource>().notNull(),
    /** How it reached us: 'webhook', 'imap', 'imap-forwarded-sms', 'seed', 'api'. */
    via: text('via').notNull().default('webhook'),
    sender: text('sender'),
    subject: text('subject'),
    body: text('body').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    /** Email Message-ID (unique) — guarantees an email is ingested once. */
    externalId: text('external_id'),
    /** sha256 of the whitespace-normalised body; catches the same SMS posted twice. */
    contentHash: text('content_hash').notNull(),
    status: text('status').$type<RawStatus>().notNull(),
    /** e.g. 'otp', 'promo', 'reminder', 'no_amount', 'duplicate_ref'... */
    statusReason: text('status_reason'),
    /** Parser output (or partial output) for debugging and pre-filling the review form. */
    parsed: jsonb('parsed'),
    transactionId: integer('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('raw_messages_external_id_uq').on(t.externalId).where(sql`${t.externalId} is not null`),
    index('raw_messages_content_hash_idx').on(t.contentHash),
    index('raw_messages_status_idx').on(t.status),
    index('raw_messages_transaction_idx').on(t.transactionId),
  ],
);

export const merchantRules = pgTable(
  'merchant_rules',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    /** Normalised merchant key (see `merchantKey()`); a rule also matches keys that start with it. */
    merchantKey: text('merchant_key').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Optional: also force exclude-from-budget for this merchant (e.g. my own other account). */
    excludeFromBudget: boolean('exclude_from_budget').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('merchant_rules_key_uq').on(t.merchantKey)],
);

export const myAccounts = pgTable(
  'my_accounts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    label: text('label').notNull(),
    bank: text('bank'),
    last4: text('last4').notNull(),
    type: text('type').$type<AccountType>().notNull().default('bank'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('my_accounts_last4_type_uq').on(t.last4, t.type)],
);

/** Single-row settings table (id is always 1). */
export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    monthlySalaryPaise: bigint('monthly_salary_paise', { mode: 'number' }).notNull().default(0),
    /** Day of month salary usually lands (1–31). Used for salary detection and the optional salary cycle. */
    salaryCreditDay: integer('salary_credit_day').notNull().default(1),
    /** 'calendar' = budget month is the calendar month. 'salary' = runs from salary day to the day before next. */
    budgetCycle: text('budget_cycle').$type<'calendar' | 'salary'>().notNull().default('calendar'),
    /** Names / VPAs that mean "me" — payments to these are treated as self-transfers. */
    selfIdentifiers: jsonb('self_identifiers').$type<string[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [check('settings_singleton', sql`${t.id} = 1`)],
);

/** Tiny key/value store for operational state (e.g. email poller heartbeat). */
export const appState = pgTable('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type RawMessage = typeof rawMessages.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type FixedCommitment = typeof fixedCommitments.$inferSelect;
export type MyAccount = typeof myAccounts.$inferSelect;
export type Settings = typeof settings.$inferSelect;
