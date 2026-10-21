import type { AccountType, Channel, Direction, MessageSource } from '@/lib/domain';

export type BankCode = 'HDFC' | 'ICICI' | 'SBI' | 'AXIS' | 'KOTAK' | 'PAYTM' | 'PHONEPE' | 'GPAY';

export interface MessageInput {
  /** Plain-text body (SMS text, or email body converted to text). */
  text: string;
  /** SMS sender id ("VM-HDFCBK") or email From address. */
  sender?: string | null;
  /** Email subject, if any. */
  subject?: string | null;
  receivedAt: Date;
  source: MessageSource;
}

export interface ParseHints {
  refund?: boolean;
  salary?: boolean;
  selfTransfer?: boolean;
  cardBillPayment?: boolean;
  interest?: boolean;
  atm?: boolean;
  /** Message looked like a person-to-person UPI transfer (P2A / VPA of a person). */
  p2p?: boolean;
}

export interface ParsedTransaction {
  amountPaise: number;
  direction: Direction;
  occurredAt: Date;
  /** Where occurredAt came from: full date+time in message, date only, or the receive time. */
  occurredAtSource: 'message' | 'message_date' | 'received';
  merchant: string | null;
  payee: string | null;
  payeeVpa: string | null;
  accountLast4: string | null;
  accountType: AccountType | null;
  bank: BankCode | null;
  channel: Channel;
  reference: string | null;
  balancePaise: number | null;
  hints: ParseHints;
}

export type IgnoreReason = 'otp' | 'promo' | 'reminder' | 'failed' | 'request' | 'balance_info' | 'non_financial';

export type ParseResult =
  | { status: 'transaction'; txn: ParsedTransaction; parser: string }
  | { status: 'ignored'; reason: IgnoreReason; bank: BankCode | null }
  | { status: 'unparsed'; reason: 'no_amount' | 'no_direction'; partial: Partial<ParsedTransaction>; bank: BankCode | null };

/** Partial fields produced by a bank template or the generic extractor. */
export type Extracted = Partial<Omit<ParsedTransaction, 'hints'>> & {
  /** Raw date text captured by a template, parsed with the shared date parser. */
  dateText?: string;
};
