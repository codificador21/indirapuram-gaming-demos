/**
 * Realistic bank / UPI alert samples (SMS and email) with the expected parse result.
 * Account numbers, references and names are made up; layouts mirror real alerts.
 *
 * Used by parser.test.ts (one test per fixture), the dedupe/ingest tests and `npm run ingest:sample`.
 * Amounts in `expect` are rupees for readability; times are UTC ISO strings (IST − 5:30).
 */
import type { AccountType, Channel, Direction, MessageSource } from '@/lib/domain';
import type { BankCode, IgnoreReason, ParseHints } from './types';

export interface TxnExpectation {
  status: 'transaction';
  amount: number;
  direction: Direction;
  merchant?: string | null;
  accountLast4?: string | null;
  accountType?: AccountType | null;
  reference?: string | null;
  balance?: number | null;
  occurredAt?: string;
  bank?: BankCode | null;
  channel?: Channel;
  hints?: Partial<ParseHints>;
  payeeVpa?: string | null;
}

export interface Fixture {
  id: string;
  source: MessageSource;
  sender: string;
  subject?: string;
  receivedAt: string;
  text: string;
  expect: TxnExpectation | { status: 'ignored'; reason: IgnoreReason } | { status: 'unparsed'; reason: 'no_amount' | 'no_direction' };
}

const R = '2026-10-21T09:05:00.000Z'; // 14:35 IST on Wed 21 Oct 2026

export const FIXTURES: Fixture[] = [
  // ── HDFC ────────────────────────────────────────────────────────────────────
  {
    id: 'hdfc-upi-sent-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 21/10/26\nRef 629412345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    expect: { status: 'transaction', amount: 250, direction: 'debit', merchant: 'Swiggy', accountLast4: '1234', reference: '629412345678', occurredAt: R, bank: 'HDFC', channel: 'upi' },
  },
  {
    id: 'hdfc-upi-credit-sms',
    source: 'sms',
    sender: 'AX-HDFCBK-S',
    receivedAt: '2026-10-21T12:40:00.000Z',
    text: 'Credit Alert!\nRs.1,500.00 credited to HDFC Bank A/c XX1234 on 21-10-26 from VPA rahul.sharma@okicici (UPI 629498765432)',
    expect: { status: 'transaction', amount: 1500, direction: 'credit', merchant: 'Rahul Sharma', payeeVpa: 'rahul.sharma@okicici', accountLast4: '1234', reference: '629498765432', occurredAt: '2026-10-21T12:40:00.000Z', channel: 'upi', hints: { p2p: true } },
  },
  {
    id: 'hdfc-card-spent-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: '2026-10-21T09:02:30.000Z',
    text: 'Spent Rs.1,299 On HDFC Bank Card 1234 At AMAZON PAY INDIA On 2026-10-21:14:32:10.Not You? To Block+Reissue Call 18002323232/SMS BLOCK CC 1234 to 7308080808',
    expect: { status: 'transaction', amount: 1299, direction: 'debit', merchant: 'Amazon Pay India', accountLast4: '1234', accountType: 'card', reference: null, occurredAt: '2026-10-21T09:02:10.000Z', channel: 'card' },
  },
  {
    id: 'hdfc-neft-salary-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: '2026-09-30T06:15:00.000Z',
    text: 'Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on 30-SEP-26 for NEFT Cr-ICIC0000001-ACME TECHNOLOGIES PVT LTD-AARAV MEHTA-ICICN52026093012345.Avl bal INR 1,02,345.67. Cheque deposits in A/C are subject to clearing',
    expect: { status: 'transaction', amount: 85000, direction: 'credit', merchant: 'Acme Technologies', accountLast4: '1234', reference: 'ICICN52026093012345', balance: 102345.67, occurredAt: '2026-09-30T06:15:00.000Z', channel: 'neft' },
  },
  {
    id: 'hdfc-imps-sent-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'Money Sent - INR 2,000.00 From HDFC Bank A/c XX1234 on 21-10-26 To A/c XX5678 IMPS Ref No 629455551111 Avl bal: INR 12,345.00 Not you? Call 18002586161',
    expect: { status: 'transaction', amount: 2000, direction: 'debit', merchant: 'A/c XX5678', accountLast4: '1234', reference: '629455551111', balance: 12345, channel: 'imps', hints: { p2p: true } },
  },
  {
    id: 'hdfc-upi-email',
    source: 'email',
    sender: 'alerts@hdfcbank.net',
    subject: '❗ You have done a UPI txn. Check details!',
    receivedAt: '2026-10-21T09:06:10.000Z',
    text: 'Dear Customer,\n\nRs.250.00 has been debited from account **1234 to VPA swiggy.upi@axisbank SWIGGY on 21-10-26. Your UPI transaction reference number is 629412345678.\n\nIf you did not authorize this transaction, please report it immediately by calling 18002586161 Or SMS BLOCK UPI to 7308080808.\n\nWarm Regards,\nHDFC Bank',
    expect: { status: 'transaction', amount: 250, direction: 'debit', merchant: 'Swiggy', payeeVpa: 'swiggy.upi@axisbank', accountLast4: '1234', reference: '629412345678', occurredAt: '2026-10-21T09:06:10.000Z', bank: 'HDFC', channel: 'upi' },
  },
  {
    id: 'hdfc-upi-credit-email',
    source: 'email',
    sender: 'alerts@hdfcbank.net',
    subject: '❗ You have done a UPI txn. Check details!',
    receivedAt: '2026-10-21T12:41:30.000Z',
    text: 'Dear Customer,\n\nRs.1500.00 has been credited to your account **1234 by VPA rahul.sharma@okicici RAHUL SHARMA on 21-10-26. Your UPI transaction reference number is 629498765432.\n\nWarm Regards,\nHDFC Bank',
    expect: { status: 'transaction', amount: 1500, direction: 'credit', merchant: 'Rahul Sharma', payeeVpa: 'rahul.sharma@okicici', accountLast4: '1234', reference: '629498765432', channel: 'upi', hints: { p2p: true } },
  },
  {
    id: 'hdfc-cc-email',
    source: 'email',
    sender: 'alerts@hdfcbank.net',
    subject: 'Alert : Update on your HDFC Bank Credit Card',
    receivedAt: '2026-10-21T09:03:00.000Z',
    text: 'Dear Card Member,\n\nThank you for using your HDFC Bank Credit Card ending 1234 for Rs 1299.00 at AMAZON PAY INDIA on 21-10-2026 14:32:10.\n\nAuthorization code:- 004512\n\nPlease note that this transaction was conducted on a merchant website.\n\nFor any queries, write to us at customerservices.cards@hdfcbank.com',
    expect: { status: 'transaction', amount: 1299, direction: 'debit', merchant: 'Amazon Pay India', accountLast4: '1234', accountType: 'credit_card', reference: null, occurredAt: '2026-10-21T09:02:10.000Z', channel: 'card' },
  },
  {
    id: 'hdfc-cc-refund-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: '2026-10-21T04:00:00.000Z',
    text: 'Rs.1,299.00 refund from AMAZON PAY INDIA credited to your HDFC Bank Credit Card XX1234 on 20-10-26.',
    expect: { status: 'transaction', amount: 1299, direction: 'credit', merchant: 'Amazon Pay India', accountLast4: '1234', accountType: 'credit_card', occurredAt: '2026-10-20T06:30:00.000Z', hints: { refund: true } },
  },
  {
    id: 'hdfc-nach-sip-debit-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: '2026-10-05T04:00:00.000Z',
    text: 'Dear Customer, Rs.5,000.00 has been debited from your HDFC Bank A/c XX1234 on 05-10-26 towards ZERODHA BROKING LTD (NACH SIP). Avl Bal INR 34,000.00',
    expect: { status: 'transaction', amount: 5000, direction: 'debit', merchant: 'Zerodha Broking', accountLast4: '1234', balance: 34000, channel: 'nach' },
  },
  {
    id: 'hdfc-cc-bill-payment-debit-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: '2026-10-20T07:00:00.000Z',
    text: 'Rs.18,450.00 debited from HDFC Bank A/c XX1234 on 20-10-26 towards ICICI BANK CREDIT CARD payment via BillDesk. Avl bal INR 10,000.00',
    expect: { status: 'transaction', amount: 18450, direction: 'debit', accountLast4: '1234', balance: 10000, channel: 'netbanking', hints: { cardBillPayment: true } },
  },
  {
    id: 'hdfc-upi-info-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'UPDATE: INR 85.00 debited from HDFC Bank XX1234 on 21-OCT-26. Info: UPI-629400009999-RAPIDO. Avl bal:INR 9,000.00',
    expect: { status: 'transaction', amount: 85, direction: 'debit', merchant: 'Rapido', accountLast4: '1234', reference: '629400009999', balance: 9000, channel: 'upi', occurredAt: R },
  },
  {
    id: 'hdfc-upi-refund-credit-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: '2026-10-22T05:00:00.000Z',
    text: 'Credit Alert!\nRs.432.00 credited to HDFC Bank A/c XX1234 on 22-10-26 from VPA swiggy.refunds@axisbank (UPI 629400007777)',
    expect: { status: 'transaction', amount: 432, direction: 'credit', merchant: 'Swiggy', accountLast4: '1234', reference: '629400007777', hints: { refund: true } },
  },
  {
    id: 'hdfc-mandate-reminder-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'Dear Customer, Rs.649.00 will be debited from your HDFC Bank A/c XX1234 on 25-10-26 towards NETFLIX for e-mandate ID HDFC7000123. To stop, visit hdfcbank.com',
    expect: { status: 'ignored', reason: 'reminder' },
  },
  {
    id: 'hdfc-otp-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: '123456 is OTP for txn of INR 1,499.00 at AMAZON on HDFC Bank card ending 1234. Valid till 14:45. Do not share OTP for security reasons',
    expect: { status: 'ignored', reason: 'otp' },
  },
  {
    id: 'hdfc-promo-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-P',
    receivedAt: R,
    text: 'Dear Customer, enjoy 10% cashback up to Rs.1,000 on Swiggy with your HDFC Bank Credit Card. Offer valid till 31-Oct. T&C apply. hdfcbk.io/xyz',
    expect: { status: 'ignored', reason: 'promo' },
  },
  {
    id: 'hdfc-balance-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'Avl Bal in HDFC Bank A/c XX1234 as on 21-OCT-26 is INR 12,345.67. Cheque deposits in A/C are subject to clearing',
    expect: { status: 'ignored', reason: 'balance_info' },
  },

  // ── ICICI ───────────────────────────────────────────────────────────────────
  {
    id: 'icici-upi-debit-sms',
    source: 'sms',
    sender: 'JD-ICICIT-S',
    receivedAt: R,
    text: 'ICICI Bank Acct XX123 debited for Rs 250.00 on 21-Oct-26; ZOMATO credited. UPI:629412340000. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.',
    expect: { status: 'transaction', amount: 250, direction: 'debit', merchant: 'Zomato', accountLast4: '123', reference: '629412340000', occurredAt: R, bank: 'ICICI', channel: 'upi' },
  },
  {
    id: 'icici-cc-spent-sms',
    source: 'sms',
    sender: 'VK-ICICIB-S',
    receivedAt: R,
    text: 'INR 1,250.00 spent using ICICI Bank Card XX9876 on 21-Oct-26 on SWIGGY INSTAMART. Avl Limit: INR 1,23,456.78. If not you, call 1800 2662/SMS BLOCK 9876 to 9215676766',
    expect: { status: 'transaction', amount: 1250, direction: 'debit', merchant: 'Swiggy Instamart', accountLast4: '9876', accountType: 'credit_card', balance: null, channel: 'card' },
  },
  {
    id: 'icici-salary-sms',
    source: 'sms',
    sender: 'JD-ICICIB-S',
    receivedAt: '2026-09-30T05:00:00.000Z',
    text: 'ICICI Bank Account XX123 credited:Rs. 85,000.00 on 30-Sep-26. Info NEFT-SAL-ACME TECHNOLOGIES. Available Balance is Rs. 1,02,345.67.',
    expect: { status: 'transaction', amount: 85000, direction: 'credit', merchant: 'Acme Technologies', accountLast4: '123', balance: 102345.67, channel: 'neft', hints: { salary: true } },
  },
  {
    id: 'icici-cc-email',
    source: 'email',
    sender: 'credit_cards@icicibank.com',
    subject: 'Transaction alert for your ICICI Bank Credit Card',
    receivedAt: '2026-10-21T07:36:30.000Z',
    text: 'Dear Customer,\n\nYour ICICI Bank Credit Card XX9876 has been used for a transaction of INR 1,250.00 on Oct 21, 2026 at 13:05:44. Info: SWIGGY INSTAMART.\n\nThe Available Credit Limit on your card is INR 1,23,456.78 and Total Credit Limit is INR 2,00,000.00.',
    expect: { status: 'transaction', amount: 1250, direction: 'debit', merchant: 'Swiggy Instamart', accountLast4: '9876', accountType: 'credit_card', occurredAt: '2026-10-21T07:35:44.000Z', balance: null },
  },
  {
    id: 'icici-cc-reversal-sms',
    source: 'sms',
    sender: 'VK-ICICIB-S',
    receivedAt: R,
    text: 'Dear Customer, INR 299.00 has been credited to your ICICI Bank Credit Card XX9876 on 19-Oct-26 as reversal of transaction at ZOMATO.',
    expect: { status: 'transaction', amount: 299, direction: 'credit', merchant: 'Zomato', accountLast4: '9876', occurredAt: '2026-10-19T06:30:00.000Z', hints: { refund: true } },
  },
  {
    id: 'icici-cc-statement-sms',
    source: 'sms',
    sender: 'VK-ICICIB-S',
    receivedAt: R,
    text: 'Statement for ICICI Bank Credit Card XX9876 has been generated. Total Amount Due: INR 18,450.00. Minimum Amount Due: INR 920.00. Payment Due Date: 05-Nov-26. Ignore if already paid.',
    expect: { status: 'ignored', reason: 'reminder' },
  },
  {
    id: 'icici-collect-request-sms',
    source: 'sms',
    sender: 'JD-ICICIT-S',
    receivedAt: R,
    text: 'Rahul Sharma has requested money from you on ICICI Bank iMobile. Amount: Rs 500.00. On approving, money will be debited from your account. Ignore if not initiated by you.',
    expect: { status: 'ignored', reason: 'request' },
  },
  {
    id: 'icici-declined-sms',
    source: 'sms',
    sender: 'VK-ICICIB-S',
    receivedAt: R,
    text: 'Txn of INR 2,499.00 on ICICI Bank Card XX9876 at MYNTRA was declined due to incorrect PIN. Call 18002662 if not done by you.',
    expect: { status: 'ignored', reason: 'failed' },
  },

  {
    id: 'hdfc-upi-failed-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'Your UPI txn of Rs.500.00 to SWIGGY from HDFC Bank A/c XX1234 has failed. If amount is debited, it will be reversed within 48 hrs. Ref 629400001111',
    expect: { status: 'ignored', reason: 'failed' },
  },
  {
    id: 'sbi-upi-failed-reversal-sms',
    source: 'sms',
    sender: 'BZ-SBIUPI-S',
    receivedAt: R,
    text: 'Dear UPI user, your txn of Rs.250.00 to ZOMATO failed. Amount debited from A/c X4321 will be reversed in 2 working days. Ref 629400002222 -SBI',
    expect: { status: 'ignored', reason: 'failed' },
  },

  // ── SBI ─────────────────────────────────────────────────────────────────────
  {
    id: 'sbi-upi-debit-sms',
    source: 'sms',
    sender: 'BZ-SBIUPI-S',
    receivedAt: R,
    text: 'Dear UPI user A/C X4321 debited by 180.0 on date 21Oct26 trf to UBER INDIA Refno 629477778888. If not u? call 1800111109. -SBI',
    expect: { status: 'transaction', amount: 180, direction: 'debit', merchant: 'Uber India', accountLast4: '4321', reference: '629477778888', occurredAt: R, bank: 'SBI', channel: 'upi' },
  },
  {
    id: 'sbi-upi-credit-sms',
    source: 'sms',
    sender: 'BZ-SBIUPI-S',
    receivedAt: R,
    text: 'Dear SBI UPI User, ur A/cX4321 credited by Rs500 on 21Oct26 by  (Ref no 629466667777)',
    expect: { status: 'transaction', amount: 500, direction: 'credit', merchant: null, accountLast4: '4321', reference: '629466667777', occurredAt: R, channel: 'upi' },
  },
  {
    id: 'sbi-atm-sms',
    source: 'sms',
    sender: 'AD-ATMSBI-S',
    receivedAt: R,
    text: 'Dear Customer, Rs.2000 withdrawn at SBI ATM S1CN000123 from A/cX4321 on 21Oct26 Transaction Number 1234. Available Balance Rs.12345. If not withdrawn by you, forward this SMS to 7208933148 / call 1800111109 / 9449112211 to block card. GOI helpline for senior citizens:14567.',
    expect: { status: 'transaction', amount: 2000, direction: 'debit', merchant: 'ATM withdrawal', accountLast4: '4321', balance: 12345, channel: 'atm', hints: { atm: true } },
  },
  {
    id: 'sbi-transfer-debit-sms',
    source: 'sms',
    sender: 'CP-CBSSBI-S',
    receivedAt: R,
    text: 'Your A/C XXXXX4321 Debited INR 5,000.00 on 21/10/26 -Transferred to MR RAHUL SHARMA. Avl Balance INR 45,678.90-SBI',
    expect: { status: 'transaction', amount: 5000, direction: 'debit', merchant: 'Rahul Sharma', accountLast4: '4321', balance: 45678.9, hints: { p2p: true } },
  },
  {
    id: 'sbi-cc-spent-sms',
    source: 'sms',
    sender: 'VM-SBICRD-S',
    receivedAt: R,
    text: 'Rs.499.00 spent on your SBI Credit Card ending 5566 at NETFLIX on 21/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
    expect: { status: 'transaction', amount: 499, direction: 'debit', merchant: 'Netflix', accountLast4: '5566', accountType: 'credit_card', channel: 'card', bank: 'SBI' },
  },
  {
    id: 'sbi-salary-credit-sms',
    source: 'sms',
    sender: 'CP-CBSSBI-S',
    receivedAt: '2026-09-30T05:30:00.000Z',
    text: 'Your A/C XXXXX4321 Credited INR 85,000.00 on 30/09/26 -Deposit by transfer from ACME TECHNOLOGIES PVT LTD. Avl Bal INR 1,02,345.67-SBI',
    expect: { status: 'transaction', amount: 85000, direction: 'credit', merchant: 'Acme Technologies', accountLast4: '4321', balance: 102345.67, occurredAt: '2026-09-30T05:30:00.000Z' },
  },
  {
    id: 'sbi-loan-promo-sms',
    source: 'sms',
    sender: 'VM-SBIINB-P',
    receivedAt: R,
    text: 'Get a Pre-approved Personal Loan of up to Rs.20,00,000 in just 4 clicks on YONO SBI! Apply now: https://sbi.co/yono T&C apply.',
    expect: { status: 'ignored', reason: 'promo' },
  },
  {
    id: 'sbi-otp-sms',
    source: 'sms',
    sender: 'VM-SBIOTP-S',
    receivedAt: R,
    text: 'OTP for online purchase of Rs. 2,999.00 at FLIPKART thru State Bank Debit Card ending 4321 is 845123. Do not share with anyone.',
    expect: { status: 'ignored', reason: 'otp' },
  },

  // ── Axis ────────────────────────────────────────────────────────────────────
  {
    id: 'axis-upi-debit-sms',
    source: 'sms',
    sender: 'VM-AXISBK-S',
    receivedAt: '2026-10-21T08:15:30.000Z',
    text: 'INR 349.00 debited\nA/c no. XX7788\n21-10-26, 13:45:10\nUPI/P2M/629422223333/BLINKIT\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
    expect: { status: 'transaction', amount: 349, direction: 'debit', merchant: 'Blinkit', accountLast4: '7788', reference: '629422223333', occurredAt: '2026-10-21T08:15:10.000Z', bank: 'AXIS', channel: 'upi' },
  },
  {
    id: 'axis-upi-credit-sms',
    source: 'sms',
    sender: 'VM-AXISBK-S',
    receivedAt: '2026-10-21T12:32:40.000Z',
    text: 'INR 1,000.00 credited\nA/c no. XX7788\n21-10-26, 18:02:11 IST\nUPI/P2A/629433334444/PRIYA VERM/\nNot you? Call 18604195555 - Axis Bank',
    expect: { status: 'transaction', amount: 1000, direction: 'credit', merchant: 'Priya Verm', accountLast4: '7788', reference: '629433334444', occurredAt: '2026-10-21T12:32:11.000Z', hints: { p2p: true } },
  },
  {
    id: 'axis-cc-spent-sms',
    source: 'sms',
    sender: 'VM-AXISBK-S',
    receivedAt: '2026-10-21T09:02:30.000Z',
    text: 'Spent\nCard no. XX3344\nINR 799\n21-10-26 14:32:10\nZOMATO\nAvl Lmt INR 1,45,000\nSMS BLOCK 3344 to 919951860002, if not you - Axis Bank',
    expect: { status: 'transaction', amount: 799, direction: 'debit', merchant: 'Zomato', accountLast4: '3344', accountType: 'credit_card', occurredAt: '2026-10-21T09:02:10.000Z', channel: 'card' },
  },
  {
    id: 'axis-cc-email',
    source: 'email',
    sender: 'alerts@axisbank.com',
    subject: 'Transaction alert on Axis Bank Credit Card no. XX3344',
    receivedAt: '2026-10-21T09:04:00.000Z',
    text: 'Dear Customer,\n\nThank you for using your card no. XX3344 for INR 799.00 at ZOMATO on 21-10-2026 14:32:10 IST.\n\nAvailable Limit: INR 1,45,000.00\n\nIf this transaction was not initiated by you, please write to cards.services@axisbank.com',
    expect: { status: 'transaction', amount: 799, direction: 'debit', merchant: 'Zomato', accountLast4: '3344', accountType: 'credit_card', occurredAt: '2026-10-21T09:02:10.000Z', channel: 'card' },
  },
  {
    id: 'axis-cc-payment-received-sms',
    source: 'sms',
    sender: 'VM-AXISBK-S',
    receivedAt: '2026-10-20T10:00:00.000Z',
    text: 'Payment of INR 15,000.00 has been received on your Axis Bank Credit Card XX3344 on 20-10-26. Thank you.',
    expect: { status: 'transaction', amount: 15000, direction: 'credit', accountLast4: '3344', accountType: 'credit_card', hints: { cardBillPayment: true } },
  },

  // ── Kotak ───────────────────────────────────────────────────────────────────
  {
    id: 'kotak-upi-sent-sms',
    source: 'sms',
    sender: 'AX-KOTAKB-S',
    receivedAt: R,
    text: 'Sent Rs.120.00 from Kotak Bank AC X9911 to chaipoint.blr@kotak on 21-10-26.UPI Ref 629488889999. Not you, kotak.com/fraud',
    expect: { status: 'transaction', amount: 120, direction: 'debit', merchant: 'Chaipoint', payeeVpa: 'chaipoint.blr@kotak', accountLast4: '9911', reference: '629488889999', bank: 'KOTAK', channel: 'upi' },
  },
  {
    id: 'kotak-upi-received-sms',
    source: 'sms',
    sender: 'AX-KOTAKB-S',
    receivedAt: R,
    text: 'Received Rs.2,500.00 in your Kotak Bank AC X9911 from aman.gupta@ybl on 21-10-26.UPI Ref:629400002222.',
    expect: { status: 'transaction', amount: 2500, direction: 'credit', merchant: 'Aman Gupta', accountLast4: '9911', reference: '629400002222', hints: { p2p: true } },
  },
  {
    id: 'kotak-cc-spent-sms',
    source: 'sms',
    sender: 'VK-KOTAKB-S',
    receivedAt: R,
    text: 'Rs.1500.00 spent on Kotak Credit Card x2233 at UBER on 21/10/2026. Avl limit Rs.98500.00. Not you? Call 18602662666',
    expect: { status: 'transaction', amount: 1500, direction: 'debit', merchant: 'Uber', accountLast4: '2233', accountType: 'credit_card', balance: null },
  },
  {
    id: 'kotak-debit-card-sms',
    source: 'sms',
    sender: 'VK-KOTAKB-S',
    receivedAt: '2026-10-21T05:50:30.000Z',
    text: 'Your Kotak Debit Card x9911 has been used for Rs.450 at DMART on 21-10-26 at 11:20. Avl bal Rs 23,456.10',
    expect: { status: 'transaction', amount: 450, direction: 'debit', merchant: 'DMart', accountLast4: '9911', accountType: 'debit_card', balance: 23456.1, occurredAt: '2026-10-21T05:50:00.000Z', channel: 'card' },
  },
  {
    id: 'kotak-upi-email',
    source: 'email',
    sender: 'BankAlerts@kotak.com',
    subject: 'Transaction alert for your Kotak Mahindra Bank account',
    receivedAt: '2026-10-18T14:00:00.000Z',
    text: 'Dear Customer,\n\nYour account xx9911 is debited for INR 1,234.00 on 18-Oct-2026 towards UPI/629411112222/DMART AVENUE.\n\nRegards,\nKotak Mahindra Bank',
    expect: { status: 'transaction', amount: 1234, direction: 'debit', merchant: 'DMart Avenue', accountLast4: '9911', reference: '629411112222', occurredAt: '2026-10-18T14:00:00.000Z', channel: 'upi' },
  },
  {
    id: 'kotak-sip-reminder-sms',
    source: 'sms',
    sender: 'VK-KOTAKB-S',
    receivedAt: R,
    text: 'Reminder: Your SIP of Rs.5,000 for HDFC Mid Cap Fund will be debited from Kotak A/c X9911 on 25-Oct-26 via NACH. Please maintain sufficient balance.',
    expect: { status: 'ignored', reason: 'reminder' },
  },

  // ── UPI apps & payments banks ───────────────────────────────────────────────
  {
    id: 'paytm-bank-paid-sms',
    source: 'sms',
    sender: 'JM-PAYTMB-S',
    receivedAt: R,
    text: 'Paid Rs.60 to Chai Point from Paytm Payments Bank a/c 91XX5050. UPI Ref: 629400003333. Queries? Call 01204456456',
    expect: { status: 'transaction', amount: 60, direction: 'debit', merchant: 'Chai Point', accountLast4: '5050', reference: '629400003333', bank: 'PAYTM', channel: 'upi' },
  },
  {
    id: 'phonepe-paid-email',
    source: 'email',
    sender: 'noreply@phonepe.com',
    subject: 'Payment to Swiggy successful',
    receivedAt: '2026-10-21T14:46:00.000Z',
    text: 'Paid ₹432 to Swiggy\n21 Oct 2026, 08:15 PM\nTransaction ID T2610212015123456789\nUTR: 629455556666\nDebited from XXXXXXXX1234\nBank: HDFC Bank',
    expect: { status: 'transaction', amount: 432, direction: 'debit', merchant: 'Swiggy', accountLast4: '1234', reference: '629455556666', occurredAt: '2026-10-21T14:45:00.000Z', bank: 'PHONEPE', channel: 'upi' },
  },
  {
    id: 'phonepe-received-email',
    source: 'email',
    sender: 'noreply@phonepe.com',
    subject: 'Received ₹750 from Neha Kapoor',
    receivedAt: '2026-10-20T16:31:00.000Z',
    text: 'Received ₹750 from Neha Kapoor\n20 Oct 2026, 10:00 PM\nTransaction ID T2610202200987654321\nUTR: 629400008888\nCredited to XXXXXXXX1234',
    expect: { status: 'transaction', amount: 750, direction: 'credit', merchant: 'Neha Kapoor', accountLast4: '1234', reference: '629400008888', occurredAt: '2026-10-20T16:30:00.000Z' },
  },
  {
    id: 'gpay-paid-email',
    source: 'email',
    sender: 'googlepay-noreply@google.com',
    subject: 'You paid ₹149.00 to Rapido',
    receivedAt: '2026-10-21T04:13:00.000Z',
    text: 'You paid ₹149.00\nTo: Rapido\nUPI transaction ID: 629477770000\nFrom: HDFC Bank •••• 1234\nOct 21, 2026, 9:42 AM',
    expect: { status: 'transaction', amount: 149, direction: 'debit', merchant: 'Rapido', accountLast4: '1234', reference: '629477770000', occurredAt: '2026-10-21T04:12:00.000Z', bank: 'GPAY', channel: 'upi' },
  },

  // ── Needs review (financial-looking but not parseable) ──────────────────────
  {
    id: 'unparsed-no-direction-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'HDFC Bank: Txn of INR 3,450.00 on A/c XX1234 ref 998877665544 is under process.',
    expect: { status: 'unparsed', reason: 'no_direction' },
  },
  {
    id: 'unparsed-no-amount-sms',
    source: 'sms',
    sender: 'VM-HDFCBK-S',
    receivedAt: R,
    text: 'Your HDFC Bank A/c XX1234 has been debited towards your Netflix subscription. Check NetBanking for details.',
    expect: { status: 'unparsed', reason: 'no_amount' },
  },
];

export function fixtureById(id: string): Fixture {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture ${id}`);
  return f;
}
