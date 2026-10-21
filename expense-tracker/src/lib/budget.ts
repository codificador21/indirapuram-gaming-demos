/**
 * Budget engine — pure functions, no DB.
 *
 *   monthly budget   B = salary − fixed commitments
 *   naive daily        = B ÷ days in the period                         (the "fixed" figure)
 *   today's allowance  = (B − net spend before today) ÷ days left incl. today   (rollover)
 *   safe to spend now  = today's allowance − net spend today            (the big number)
 *
 * Net spend counts debits, minus refunds and reimbursements, and ignores anything excluded from the
 * budget (self-transfers, card bill payments, fixed commitments) as well as salary / other income.
 * All money is integer paise; all day logic is in the app timezone.
 */
import type { CreditKind, Direction } from './domain';
import { addDays, daysInMonth, diffDays, localDayKey, parseDayKey, toDayKey, DEFAULT_TIMEZONE, monthName } from './time';

export interface BudgetSettings {
  monthlySalaryPaise: number;
  fixedCommitmentsPaise: number;
  budgetCycle: 'calendar' | 'salary';
  salaryCreditDay: number;
}

export interface BudgetTxn {
  occurredAt: Date;
  amountPaise: number;
  direction: Direction;
  creditKind: CreditKind | null;
  excludeFromBudget: boolean;
  categoryId?: string;
}

export interface BudgetPeriod {
  start: string; // inclusive day key
  end: string; // inclusive day key
  days: number;
  label: string;
}

/** Effect of one transaction on spending: + spend, − offset (refund / payback), 0 otherwise. */
export function netSpendEffect(t: BudgetTxn): number {
  if (t.excludeFromBudget) return 0;
  if (t.direction === 'debit') return t.amountPaise;
  if (t.creditKind === 'refund' || t.creditKind === 'reimbursement') return -t.amountPaise;
  return 0;
}

function clampDay(year: number, month: number, day: number) {
  return Math.min(Math.max(1, day), daysInMonth(year, month));
}

/** The budget period containing `dayKey`: the calendar month, or salary-day → day before next salary day. */
export function getPeriod(dayKey: string, s: Pick<BudgetSettings, 'budgetCycle' | 'salaryCreditDay'>): BudgetPeriod {
  const { year, month, day } = parseDayKey(dayKey);
  if (s.budgetCycle !== 'salary' || s.salaryCreditDay <= 1) {
    const start = toDayKey(year, month, 1);
    const end = toDayKey(year, month, daysInMonth(year, month));
    return { start, end, days: daysInMonth(year, month), label: `${monthName(month, true)} ${year}` };
  }
  const startThis = clampDay(year, month, s.salaryCreditDay);
  let sy = year;
  let sm = month;
  if (day < startThis) {
    sm -= 1;
    if (sm === 0) {
      sm = 12;
      sy -= 1;
    }
  }
  const start = toDayKey(sy, sm, clampDay(sy, sm, s.salaryCreditDay));
  let ny = sy;
  let nm = sm + 1;
  if (nm === 13) {
    nm = 1;
    ny += 1;
  }
  const nextStart = toDayKey(ny, nm, clampDay(ny, nm, s.salaryCreditDay));
  const end = addDays(nextStart, -1);
  const days = diffDays(start, nextStart);
  const sp = parseDayKey(start);
  const ep = parseDayKey(end);
  return { start, end, days, label: `${sp.day} ${monthName(sp.month)} – ${ep.day} ${monthName(ep.month)}` };
}

export function shiftPeriod(period: BudgetPeriod, s: BudgetSettings, delta: -1 | 1): BudgetPeriod {
  return getPeriod(delta === 1 ? addDays(period.end, 1) : addDays(period.start, -1), s);
}

export interface DayPoint {
  day: string;
  /** Net spend that day. */
  spent: number;
  /** Rollover allowance available at the start of that day (only for days up to today). */
  allowance: number | null;
  /** The fixed daily figure. */
  naive: number;
  cumulativeSpent: number | null;
  /** Even-pace budget line: naive × day number. */
  cumulativeBudget: number;
  isToday: boolean;
  isFuture: boolean;
}

export type BudgetStatus = 'not_configured' | 'on_track' | 'tight' | 'over_today' | 'over_month';

export interface BudgetSummary {
  period: BudgetPeriod;
  today: string;
  dayNumber: number; // 1-based position of today in the period (clamped to the period)
  remainingDays: number; // incl. today
  isCurrent: boolean;
  budgetTotal: number;
  naiveDaily: number;
  spentBeforeToday: number;
  spentToday: number;
  spentTotal: number;
  /** Rollover allowance for today (≥ 0). */
  allowanceToday: number;
  /** allowanceToday − spentToday; negative when today is overspent. */
  leftToday: number;
  /** Budget left for the rest of the period, including what's left today (can be negative). */
  remainingInPeriod: number;
  /** If nothing more is spent today, tomorrow's allowance. Null on the last day. */
  allowanceTomorrow: number | null;
  /** Where spending "should" be by end of today at an even pace. */
  expectedByToday: number;
  /** Straight-line projection of total spend for the period. */
  projectedTotal: number;
  status: BudgetStatus;
  series: DayPoint[];
}

export function computeBudget(txns: BudgetTxn[], settings: BudgetSettings, asOf: Date, tz: string = DEFAULT_TIMEZONE, period?: BudgetPeriod): BudgetSummary {
  const realToday = localDayKey(asOf, tz);
  const p = period ?? getPeriod(realToday, settings);
  const budgetTotal = Math.max(0, settings.monthlySalaryPaise - settings.fixedCommitmentsPaise);
  const naiveDaily = Math.floor(budgetTotal / p.days);

  // Clamp "today" into the period (past periods are complete; future periods haven't started).
  const offset = diffDays(p.start, realToday);
  const isCurrent = offset >= 0 && offset < p.days;
  const dayIndex = Math.min(Math.max(offset, -1), p.days - 1); // -1 = period in the future
  const today = dayIndex >= 0 ? addDays(p.start, dayIndex) : p.start;
  const dayNumber = Math.max(dayIndex + 1, 0);

  const byDay = new Map<string, number>();
  for (const t of txns) {
    const effect = netSpendEffect(t);
    if (effect === 0) continue;
    const k = localDayKey(t.occurredAt, tz);
    if (k < p.start || k > p.end) continue;
    byDay.set(k, (byDay.get(k) ?? 0) + effect);
  }

  const series: DayPoint[] = [];
  let cumulative = 0;
  let spentBeforeToday = 0;
  let spentToday = 0;
  let allowanceToday = 0;
  for (let i = 0; i < p.days; i++) {
    const day = addDays(p.start, i);
    const spent = byDay.get(day) ?? 0;
    const future = isCurrent ? i > dayIndex : dayIndex < 0;
    const left = p.days - i;
    const allowance = future ? null : Math.max(0, Math.floor((budgetTotal - cumulative) / left));
    if (!future) {
      if (i < dayIndex) spentBeforeToday += spent;
      if (i === dayIndex) {
        spentToday = spent;
        allowanceToday = allowance ?? 0;
      }
      cumulative += spent;
    }
    series.push({
      day,
      spent: future ? 0 : spent,
      allowance,
      naive: naiveDaily,
      cumulativeSpent: future ? null : cumulative,
      cumulativeBudget: Math.round((budgetTotal * (i + 1)) / p.days),
      isToday: isCurrent && i === dayIndex,
      isFuture: future,
    });
  }

  const spentTotal = spentBeforeToday + spentToday;
  const remainingDays = dayIndex >= 0 ? p.days - dayIndex : p.days;
  const remainingInPeriod = budgetTotal - spentTotal;
  const leftToday = allowanceToday - spentToday;
  const allowanceTomorrow = remainingDays > 1 ? Math.max(0, Math.floor(remainingInPeriod / (remainingDays - 1))) : null;
  const expectedByToday = Math.round((budgetTotal * dayNumber) / p.days);
  const projectedTotal = dayNumber > 0 ? Math.round((spentTotal / dayNumber) * p.days) : 0;

  let status: BudgetStatus;
  if (budgetTotal === 0) status = 'not_configured';
  else if (remainingInPeriod < 0) status = 'over_month';
  else if (leftToday < 0) status = 'over_today';
  else if (allowanceToday < naiveDaily * 0.6) status = 'tight';
  else status = 'on_track';

  return {
    period: p,
    today,
    dayNumber,
    remainingDays,
    isCurrent,
    budgetTotal,
    naiveDaily,
    spentBeforeToday,
    spentToday,
    spentTotal,
    allowanceToday,
    leftToday,
    remainingInPeriod,
    allowanceTomorrow,
    expectedByToday,
    projectedTotal,
    status,
    series,
  };
}

export interface CategoryTotal {
  categoryId: string;
  /** Gross debits in this category (not excluded). */
  spent: number;
  /** Refunds/paybacks filed under this category. */
  offsets: number;
  count: number;
}

/** Spend per category for a period (excluded transactions and income ignored). */
export function categoryTotals(txns: Array<BudgetTxn & { categoryId: string }>, period: BudgetPeriod, tz: string = DEFAULT_TIMEZONE) {
  const map = new Map<string, CategoryTotal>();
  let gross = 0;
  let offsets = 0;
  for (const t of txns) {
    const effect = netSpendEffect(t);
    if (effect === 0) continue;
    const k = localDayKey(t.occurredAt, tz);
    if (k < period.start || k > period.end) continue;
    const row = map.get(t.categoryId) ?? { categoryId: t.categoryId, spent: 0, offsets: 0, count: 0 };
    if (effect > 0) {
      row.spent += effect;
      gross += effect;
    } else {
      row.offsets += -effect;
      offsets += -effect;
    }
    row.count += 1;
    map.set(t.categoryId, row);
  }
  const rows = [...map.values()].sort((a, b) => b.spent - a.spent);
  return { rows, gross, offsets, net: gross - offsets };
}
