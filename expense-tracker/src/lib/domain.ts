/** Shared domain enums. Kept as string unions (stored in `text` columns). */

export const DIRECTIONS = ['debit', 'credit'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CHANNELS = ['upi', 'card', 'netbanking', 'neft', 'imps', 'rtgs', 'atm', 'nach', 'wallet', 'cash', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const ACCOUNT_TYPES = ['bank', 'credit_card', 'debit_card', 'card', 'wallet', 'cash'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const MESSAGE_SOURCES = ['sms', 'email'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

export const TXN_SOURCES = ['sms', 'email', 'manual'] as const;
export type TxnSource = (typeof TXN_SOURCES)[number];

/**
 * - `parsed`: became a new transaction
 * - `duplicate`: same transaction already existed (linked via transactionId) or same message seen before
 * - `ignored`: OTP / promo / reminder / declined etc.
 * - `needs_review`: looked financial but could not be parsed — shown in the Review inbox
 * - `resolved`: reviewed by me and turned into a transaction
 * - `dismissed`: reviewed by me and thrown away
 */
export const RAW_STATUSES = ['parsed', 'duplicate', 'ignored', 'needs_review', 'resolved', 'dismissed'] as const;
export type RawStatus = (typeof RAW_STATUSES)[number];

/**
 * How a credit affects the budget (see DECISIONS.md → "Non-salary credits"):
 * - `salary`: income; the budget already comes from the salary setting, so it does not change spend.
 * - `refund`: refund / reversal / cashback — offsets spending (reduces net spend).
 * - `reimbursement`: money back from a person (split bills etc.) — offsets spending.
 * - `income`: other income (interest, dividends, gifts, freelance) — ignored by the daily budget.
 */
export const CREDIT_KINDS = ['salary', 'refund', 'reimbursement', 'income'] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export const EXCLUDE_REASONS = ['self_transfer', 'card_bill', 'commitment', 'manual'] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];

export const CATEGORY_SOURCES = ['auto', 'rule', 'manual'] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export const CATEGORY_KINDS = ['expense', 'income', 'transfer'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const COMMITMENT_KINDS = ['rent', 'sip', 'emi', 'insurance', 'subscription', 'other'] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  salary: 'Salary',
  refund: 'Refund / reversal',
  reimbursement: 'Paid back (offsets spend)',
  income: 'Other income (ignored)',
};

export const EXCLUDE_REASON_LABELS: Record<ExcludeReason, string> = {
  self_transfer: 'Self-transfer',
  card_bill: 'Credit card bill payment',
  commitment: 'Fixed commitment',
  manual: 'Excluded by me',
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  neft: 'NEFT',
  imps: 'IMPS',
  rtgs: 'RTGS',
  atm: 'ATM',
  nach: 'Auto-debit',
  wallet: 'Wallet',
  cash: 'Cash',
  other: 'Other',
};
