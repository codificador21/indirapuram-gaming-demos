import { describe, expect, it } from 'vitest';
import { categoryTotals, computeBudget, getPeriod, netSpendEffect, shiftPeriod, type BudgetSettings, type BudgetTxn } from './budget';
import { zonedTimeToUtc } from './time';

const settings: BudgetSettings = {
  monthlySalaryPaise: 85_000_00,
  fixedCommitmentsPaise: 35_500_00, // rent 22,000 + SIP 10,000 + EMI 3,500
  budgetCycle: 'calendar',
  salaryCreditDay: 1,
};
const B = 49_500_00;
const ist = (day: number, hour = 13, month = 10) => zonedTimeToUtc(2026, month, day, hour, 0, 0);
const debit = (day: number, rupees: number, extra: Partial<BudgetTxn> = {}): BudgetTxn => ({
  occurredAt: ist(day),
  amountPaise: rupees * 100,
  direction: 'debit',
  creditKind: null,
  excludeFromBudget: false,
  ...extra,
});
const credit = (day: number, rupees: number, creditKind: BudgetTxn['creditKind']): BudgetTxn => ({ ...debit(day, rupees), direction: 'credit', creditKind });
const NOW = ist(21, 15); // Wed 21 Oct 2026, 3 pm IST

describe('netSpendEffect', () => {
  it('debits count, refunds/paybacks offset, income and excluded rows are ignored', () => {
    expect(netSpendEffect(debit(1, 100))).toBe(10000);
    expect(netSpendEffect(debit(1, 100, { excludeFromBudget: true }))).toBe(0);
    expect(netSpendEffect(credit(1, 100, 'refund'))).toBe(-10000);
    expect(netSpendEffect(credit(1, 100, 'reimbursement'))).toBe(-10000);
    expect(netSpendEffect(credit(1, 100, 'salary'))).toBe(0);
    expect(netSpendEffect(credit(1, 100, 'income'))).toBe(0);
  });
});

describe('computeBudget — rollover', () => {
  it('daily budget = (salary − commitments) ÷ days in month', () => {
    const b = computeBudget([], settings, NOW);
    expect(b.period).toMatchObject({ start: '2026-10-01', end: '2026-10-31', days: 31, label: 'October 2026' });
    expect(b.budgetTotal).toBe(B);
    expect(b.naiveDaily).toBe(Math.floor(B / 31)); // ₹1,596.77
    expect(b.dayNumber).toBe(21);
    expect(b.remainingDays).toBe(11);
  });

  it('with no spending so far, everything unspent rolls into the remaining days', () => {
    const b = computeBudget([], settings, NOW);
    expect(b.allowanceToday).toBe(Math.floor(B / 11)); // ₹4,500
    expect(b.leftToday).toBe(b.allowanceToday);
    expect(b.status).toBe('on_track');
  });

  it('spending exactly the naive figure every day keeps the allowance at the naive figure', () => {
    const naive = Math.floor(B / 31);
    const txns = Array.from({ length: 20 }, (_, i) => ({ ...debit(i + 1, 0), amountPaise: naive }));
    const b = computeBudget(txns, settings, NOW);
    expect(Math.abs(b.allowanceToday - naive)).toBeLessThanOrEqual(1);
  });

  it('safe to spend today = (budget − spent before today) ÷ days left including today', () => {
    const txns = [debit(1, 20_000), debit(10, 9_500)]; // ₹29,500 spent before today
    const b = computeBudget(txns, settings, NOW);
    expect(b.spentBeforeToday).toBe(29_500_00);
    expect(b.allowanceToday).toBe(Math.floor((B - 29_500_00) / 11)); // ₹20,000 / 11 = ₹1,818.18
  });

  it("today's spending is subtracted from today's allowance, not spread across the month", () => {
    const b = computeBudget([debit(21, 500)], settings, NOW);
    expect(b.spentToday).toBe(500_00);
    expect(b.allowanceToday).toBe(Math.floor(B / 11));
    expect(b.leftToday).toBe(Math.floor(B / 11) - 500_00);
    expect(b.remainingInPeriod).toBe(B - 500_00);
    expect(b.allowanceTomorrow).toBe(Math.floor((B - 500_00) / 10));
  });

  it('overspending yesterday lowers today; underspending raises it', () => {
    const even = computeBudget([], settings, ist(2));
    const over = computeBudget([debit(1, 10_000)], settings, ist(2));
    const under = computeBudget([debit(1, 100)], settings, ist(2));
    expect(over.allowanceToday).toBeLessThan(even.naiveDaily);
    expect(under.allowanceToday).toBeGreaterThan(even.naiveDaily);
    expect(over.allowanceToday).toBe(Math.floor((B - 10_000_00) / 30));
  });

  it('overspending today goes negative and is flagged', () => {
    const b = computeBudget([debit(21, 10_000)], settings, NOW);
    expect(b.leftToday).toBeLessThan(0);
    expect(b.status).toBe('over_today');
  });

  it('a blown monthly budget floors the allowance at zero', () => {
    const b = computeBudget([debit(5, 60_000)], settings, NOW);
    expect(b.allowanceToday).toBe(0);
    expect(b.remainingInPeriod).toBe(B - 60_000_00);
    expect(b.status).toBe('over_month');
    expect(b.allowanceTomorrow).toBe(0);
  });

  it('refunds and paybacks give money back; salary, income and excluded rows do not move it', () => {
    const txns = [
      debit(3, 5_000),
      credit(4, 1_000, 'refund'),
      credit(5, 500, 'reimbursement'),
      credit(1, 85_000, 'salary'),
      credit(6, 20_000, 'income'),
      debit(7, 22_000, { excludeFromBudget: true }),
    ];
    const b = computeBudget(txns, settings, NOW);
    expect(b.spentBeforeToday).toBe(3_500_00);
  });

  it('uses India time for day boundaries (00:30 IST belongs to the new day)', () => {
    const justAfterMidnight = { ...debit(21, 300), occurredAt: zonedTimeToUtc(2026, 10, 21, 0, 30) };
    const justBefore = { ...debit(20, 200), occurredAt: zonedTimeToUtc(2026, 10, 20, 23, 59) };
    const b = computeBudget([justAfterMidnight, justBefore], settings, NOW);
    expect(b.spentToday).toBe(300_00);
    expect(b.spentBeforeToday).toBe(200_00);
  });

  it('ignores transactions outside the period', () => {
    const b = computeBudget([debit(30, 1_000, { occurredAt: ist(30, 12, 9) })], settings, NOW);
    expect(b.spentTotal).toBe(0);
  });

  it('first and last day of the month', () => {
    const first = computeBudget([], settings, ist(1, 9));
    expect(first.allowanceToday).toBe(Math.floor(B / 31));
    expect(first.dayNumber).toBe(1);
    const last = computeBudget([debit(1, 40_000)], settings, ist(31, 20));
    expect(last.remainingDays).toBe(1);
    expect(last.allowanceToday).toBe(9_500_00);
    expect(last.allowanceTomorrow).toBeNull();
  });

  it('builds a daily series with rollover allowances, cumulative spend and an even-pace line', () => {
    const b = computeBudget([debit(1, 3_000), debit(2, 100)], settings, ist(3));
    expect(b.series).toHaveLength(31);
    expect(b.series[0]).toMatchObject({ day: '2026-10-01', spent: 3_000_00, allowance: Math.floor(B / 31), cumulativeSpent: 3_000_00 });
    expect(b.series[1]!.allowance).toBe(Math.floor((B - 3_000_00) / 30));
    expect(b.series[2]).toMatchObject({ isToday: true, isFuture: false });
    expect(b.series[3]).toMatchObject({ isFuture: true, allowance: null, cumulativeSpent: null });
    expect(b.series[30]!.cumulativeBudget).toBe(B);
    expect(b.expectedByToday).toBe(Math.round((B * 3) / 31));
    expect(b.projectedTotal).toBe(Math.round((3_100_00 / 3) * 31));
  });

  it('a past period is complete; a future one has not started', () => {
    const past = computeBudget([debit(31, 100)], settings, ist(5, 12, 11), undefined, getPeriod('2026-10-15', settings));
    expect(past.isCurrent).toBe(false);
    expect(past.spentTotal).toBe(100_00);
    expect(past.series.every((d) => !d.isFuture)).toBe(true);
    const future = computeBudget([], settings, NOW, undefined, getPeriod('2026-11-15', settings));
    expect(future.dayNumber).toBe(0);
    expect(future.series.every((d) => d.isFuture)).toBe(true);
  });

  it('reports not_configured without a salary', () => {
    const b = computeBudget([debit(1, 100)], { ...settings, monthlySalaryPaise: 0 }, NOW);
    expect(b.status).toBe('not_configured');
    expect(b.allowanceToday).toBe(0);
  });

  it('commitments larger than salary give a zero budget, not a negative one', () => {
    expect(computeBudget([], { ...settings, fixedCommitmentsPaise: 90_000_00 }, NOW).budgetTotal).toBe(0);
  });
});

describe('periods', () => {
  it('calendar months, including February', () => {
    expect(getPeriod('2026-02-14', settings)).toMatchObject({ start: '2026-02-01', end: '2026-02-28', days: 28 });
    expect(getPeriod('2028-02-14', settings)).toMatchObject({ days: 29 });
  });

  it('salary cycle: salary day → day before next salary day', () => {
    const s = { ...settings, budgetCycle: 'salary' as const, salaryCreditDay: 25 };
    expect(getPeriod('2026-10-21', s)).toMatchObject({ start: '2026-09-25', end: '2026-10-24', days: 30 });
    expect(getPeriod('2026-10-25', s)).toMatchObject({ start: '2026-10-25', end: '2026-11-24', days: 31 });
    expect(getPeriod('2026-01-10', s)).toMatchObject({ start: '2025-12-25', end: '2026-01-24' });
  });

  it('salary cycle clamps day 31 in short months', () => {
    const s = { ...settings, budgetCycle: 'salary' as const, salaryCreditDay: 31 };
    expect(getPeriod('2026-02-15', s)).toMatchObject({ start: '2026-01-31', end: '2026-02-27', days: 28 });
    expect(getPeriod('2026-02-28', s)).toMatchObject({ start: '2026-02-28', end: '2026-03-30', days: 31 });
  });

  it('shifts to the previous / next period', () => {
    const oct = getPeriod('2026-10-21', settings);
    expect(shiftPeriod(oct, settings, -1)).toMatchObject({ start: '2026-09-01', end: '2026-09-30' });
    expect(shiftPeriod(oct, settings, 1)).toMatchObject({ start: '2026-11-01' });
  });
});

describe('categoryTotals', () => {
  it('sums gross spend per category and keeps refunds as offsets', () => {
    const period = getPeriod('2026-10-21', settings);
    const t = categoryTotals(
      [
        { ...debit(2, 500), categoryId: 'food' },
        { ...debit(3, 300), categoryId: 'food' },
        { ...debit(3, 1_200), categoryId: 'shopping' },
        { ...credit(4, 200, 'refund'), categoryId: 'food' },
        { ...debit(5, 22_000, { excludeFromBudget: true }), categoryId: 'home' },
        { ...credit(1, 85_000, 'salary'), categoryId: 'salary' },
      ],
      period,
    );
    expect(t.rows.map((r) => [r.categoryId, r.spent, r.offsets])).toEqual([
      ['shopping', 1_200_00, 0],
      ['food', 800_00, 200_00],
    ]);
    expect(t).toMatchObject({ gross: 2_000_00, offsets: 200_00, net: 1_800_00 });
  });
});
