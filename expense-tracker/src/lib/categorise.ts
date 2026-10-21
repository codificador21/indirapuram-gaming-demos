/**
 * Auto-categorisation.
 *
 * Order of precedence:
 *   1. hard rules from the parser (credit-card bill payment / self-transfer, ATM → Cash, salary, interest)
 *   2. learned merchant rules (created when I re-categorise a merchant in the UI)
 *   3. the built-in keyword map below (longest matching keyword wins: "swiggy instamart" → Groceries)
 *   4. person-to-person transfers → "People"
 *   5. fallback "Other"
 */
import type { Channel, CreditKind, Direction } from './domain';
import type { ParseHints } from './parser/types';

/** category id → keywords. Matched as whole words; keywords of 5+ chars also match inside squashed names. */
export const KEYWORD_MAP: Record<string, string[]> = {
  food: [
    'swiggy', 'zomato', 'dominos', 'domino', 'pizza hut', 'pizza', 'mcdonald', 'mcdonalds', 'kfc', 'burger king', 'subway',
    'starbucks', 'chaayos', 'chai point', 'chaipoint', 'third wave', 'blue tokai', 'haldiram', 'haldirams', 'barbeque nation',
    'eatsure', 'faasos', 'box8', 'behrouz', 'biryani', 'cafe', 'coffee', 'restaurant', 'dhaba', 'bakery', 'eatclub',
    'rebel foods', 'freshmenu', 'wow momo', 'theobroma', 'baskin', 'naturals ice cream', 'canteen', 'food', 'foods',
    'kitchen', 'bistro', 'tea', 'juice', 'sweets', 'dunkin', 'taco bell', 'magicpin',
  ],
  groceries: [
    'bigbasket', 'blinkit', 'grofers', 'zepto', 'instamart', 'swiggy instamart', 'dmart', 'jiomart', 'more retail',
    'reliance fresh', 'reliance smart', 'smart bazaar', 'spencers', 'natures basket', 'licious', 'country delight',
    'milkbasket', 'supermarket', 'kirana', 'grocery', 'groceries', 'provision', 'vegetables', 'fruits', 'dairy',
    'freshtohome', 'bb daily', 'ratnadeep', 'star bazaar', 'nilgiris',
  ],
  transport: [
    'uber', 'ola', 'olacabs', 'rapido', 'namma yatri', 'blusmart', 'metro', 'dmrc', 'bmrcl', 'mmrda', 'fastag',
    'parking', 'yulu', 'bounce', 'auto', 'cab', 'cabs', 'taxi', 'bmtc', 'best', 'toll', 'nhai', 'park plus', 'parkplus',
  ],
  fuel: [
    'indian oil', 'indianoil', 'iocl', 'hpcl', 'hp petrol', 'bharat petroleum', 'bpcl', 'shell', 'petrol', 'fuel',
    'nayara', 'petroleum', 'filling station', 'service station', 'fuels',
  ],
  shopping: [
    'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'tata cliq', 'tatacliq', 'croma', 'reliance digital',
    'decathlon', 'ikea', 'lifestyle', 'westside', 'h&m', 'zara', 'uniqlo', 'lenskart', 'firstcry', 'snapdeal',
    'shoppers stop', 'pantaloons', 'max fashion', 'apple', 'vijay sales', 'trends', 'bata', 'puma', 'nike', 'adidas',
    'boat', 'mall', 'store', 'retail', 'fashion',
  ],
  bills: [
    'airtel', 'jio', 'vodafone', 'vi', 'bsnl', 'act fibernet', 'hathway', 'tata play', 'tata sky', 'dish tv', 'bescom',
    'bses', 'tata power', 'adani electricity', 'msedcl', 'mahadiscom', 'tneb', 'electricity', 'water', 'indane',
    'bharat gas', 'hp gas', 'igl', 'mgl', 'mahanagar gas', 'postpaid', 'prepaid', 'recharge', 'broadband', 'dth',
    'municipal', 'property tax', 'lic', 'insurance', 'policybazaar', 'hdfc life', 'icici prudential', 'max life',
    'star health', 'acko', 'digit insurance', 'bill', 'billpay', 'utility', 'gas',
  ],
  entertainment: [
    'netflix', 'spotify', 'hotstar', 'disney', 'prime video', 'amazon prime', 'youtube', 'bookmyshow', 'pvr', 'inox',
    'cinepolis', 'sonyliv', 'zee5', 'jiocinema', 'jiohotstar', 'apple music', 'steam', 'playstation', 'xbox', 'gaana',
    'wynk', 'district', 'movies', 'cinema', 'concert', 'gaming', 'paytm insider', 'insider', 'audible',
  ],
  health: [
    'apollo', 'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'medplus', 'practo', 'hospital', 'clinic', 'pharmacy',
    'medical', 'medicals', 'chemist', 'diagnostics', 'lal path', 'thyrocare', 'cult', 'cultfit', 'cult fit',
    'healthifyme', 'gym', 'fitness', 'dental', 'doctor', 'health',
  ],
  travel: [
    'makemytrip', 'goibibo', 'cleartrip', 'yatra', 'ixigo', 'irctc', 'indigo', 'air india', 'vistara', 'akasa',
    'spicejet', 'redbus', 'abhibus', 'oyo', 'airbnb', 'booking com', 'agoda', 'treebo', 'fabhotels', 'zostel',
    'hotel', 'hotels', 'resort', 'airlines', 'airways', 'railway', 'travels', 'holidays',
  ],
  education: [
    'udemy', 'coursera', 'byju', 'byjus', 'unacademy', 'upgrad', 'school', 'college', 'university', 'tuition',
    'books', 'kindle', 'academy', 'institute', 'classes', 'learning', 'skillshare', 'linkedin learning',
  ],
  personal_care: [
    'urban company', 'urbanclap', 'salon', 'spa', 'lakme', 'naturals', 'barber', 'grooming', 'parlour', 'parlor',
    'beauty', 'cosmetics', 'enrich salon', 'jawed habib',
  ],
  home: [
    'rent', 'nobroker', 'nestaway', 'housing', 'maintenance', 'society', 'furlenco', 'rentomojo', 'pepperfry',
    'urban ladder', 'home centre', 'hardware', 'plumber', 'electrician', 'laundry', 'dry clean', 'housekeeping', 'maid',
  ],
  investments: [
    'zerodha', 'groww', 'upstox', 'kuvera', 'paytm money', 'mutual fund', 'sip', 'nps', 'ppf', 'indmoney',
    'smallcase', 'etmoney', 'angel one', 'angel broking', 'icici direct', 'hdfc securities', 'coin', 'fixed deposit',
    'recurring deposit', 'nach sip', 'amc', 'mf',
  ],
  emi_loans: [
    'emi', 'loan', 'bajaj finance', 'bajaj finserv', 'home credit', 'tata capital', 'hdfc ltd', 'idfc first', 'cred emi',
    'lazypay', 'simpl', 'slice', 'zestmoney', 'kreditbee', 'moneyview', 'navi', 'fibe',
  ],
  cash: ['atm', 'atm withdrawal', 'cash withdrawal', 'cash'],
  gifts: ['donation', 'charity', 'giveindia', 'temple', 'gift', 'gifts', 'ketto', 'milaap', 'ngo', 'trust', 'foundation'],
  fees: [
    'charges', 'charge', 'fee', 'fees', 'gst', 'annual fee', 'late fee', 'penalty', 'finance charge', 'cheque book',
    'sms charges', 'convenience fee', 'processing fee', 'markup',
  ],
};

interface KeywordEntry {
  categoryId: string;
  keyword: string;
  tokens: string;
  squashed: string;
}

const ENTRIES: KeywordEntry[] = Object.entries(KEYWORD_MAP).flatMap(([categoryId, kws]) =>
  kws.map((keyword) => ({
    categoryId,
    keyword,
    tokens: ` ${keyword.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()} `,
    squashed: keyword.toLowerCase().replace(/[^a-z0-9]/g, ''),
  })),
);

function haystacks(parts: Array<string | null | undefined>) {
  const raw = parts.filter(Boolean).join(' ').toLowerCase();
  // Use the local part of VPAs ("swiggy.upi@axisbank" → "swiggy upi").
  const withoutDomains = raw.replace(/@[a-z0-9.]+/g, ' ');
  const tokens = ` ${withoutDomains.replace(/[^a-z0-9&]+/g, ' ').trim()} `;
  return { tokens, squashed: tokens.replace(/\s+/g, '') };
}

/** Keyword-map category for a merchant/payee, or null. */
export function keywordCategory(...parts: Array<string | null | undefined>): string | null {
  const h = haystacks(parts);
  if (h.tokens.trim() === '') return null;
  let best: KeywordEntry | null = null;
  for (const e of ENTRIES) {
    const hit = h.tokens.includes(e.tokens) || (e.squashed.length >= 5 && h.squashed.includes(e.squashed));
    if (hit && (!best || e.squashed.length > best.squashed.length)) best = e;
  }
  return best?.categoryId ?? null;
}

export interface RuleLike {
  merchantKey: string;
  categoryId: string;
  excludeFromBudget?: boolean;
}

/** Suffixes that don't change which merchant it is ("amazonpay" + "india"). */
const GENERIC_SUFFIXES = new Set(['india', 'in', 'pay', 'payments', 'payment', 'online', 'store', 'stores', 'retail', 'services', 'technologies', 'tech', 'limited', 'ltd', 'pvtltd', 'co', 'upi', 'app', 'com']);

/**
 * Learned rule for a merchant key: exact match first; otherwise a rule key (≥4 chars) that the
 * transaction key starts with, but only if what's left is a generic suffix — so a rule for
 * "amazonpay" covers "amazonpayindia", while a rule for "swiggy" does NOT capture "swiggyinstamart".
 */
export function findRule<T extends RuleLike>(key: string | null | undefined, rules: T[]): T | null {
  if (!key) return null;
  let best: T | null = null;
  for (const r of rules) {
    if (r.merchantKey === key) return r;
    const rest = key.slice(r.merchantKey.length);
    if (r.merchantKey.length >= 4 && key.startsWith(r.merchantKey) && GENERIC_SUFFIXES.has(rest) && (!best || r.merchantKey.length > best.merchantKey.length)) best = r;
  }
  return best;
}

export interface CategoriseInput {
  direction: Direction;
  merchant: string | null;
  merchantKey: string | null;
  payee: string | null;
  channel: Channel;
  hints: ParseHints;
  creditKind: CreditKind | null;
}

export interface CategoriseResult {
  categoryId: string;
  source: 'auto' | 'rule';
  /** Set when a learned rule says this merchant is always excluded. */
  ruleExcludes?: boolean;
}

export function categorise(input: CategoriseInput, rules: RuleLike[]): CategoriseResult {
  const { hints, direction } = input;
  if (hints.cardBillPayment || hints.selfTransfer) return { categoryId: 'self_transfer', source: 'auto' };

  const rule = findRule(input.merchantKey, rules);
  if (rule) return { categoryId: rule.categoryId, source: 'rule', ruleExcludes: rule.excludeFromBudget || undefined };

  if (direction === 'debit' && (hints.atm || input.channel === 'atm')) return { categoryId: 'cash', source: 'auto' };
  if (direction === 'credit') {
    if (input.creditKind === 'salary') return { categoryId: 'salary', source: 'auto' };
    if (input.creditKind === 'income') return { categoryId: 'income', source: 'auto' };
    if (input.creditKind === 'reimbursement') return { categoryId: 'transfers', source: 'auto' };
  }
  const kw = keywordCategory(input.merchant, input.payee);
  if (kw) return { categoryId: kw, source: 'auto' };
  if (hints.p2p) return { categoryId: 'transfers', source: 'auto' };
  return { categoryId: 'other', source: 'auto' };
}
