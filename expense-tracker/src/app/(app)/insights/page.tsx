import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/db';
import { CumulativeChart, DailyChart } from '@/components/charts';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { Card, EmptyState, PageHeader, SectionTitle } from '@/components/ui';
import { categoryTotals, netSpendEffect, shiftPeriod } from '@/lib/budget';
import { appTimezone } from '@/lib/env';
import { txnTitle } from '@/lib/format';
import { formatINR } from '@/lib/money';
import { categoryLookup, getBudget, getCategories } from '@/lib/queries';
import { localDayKey } from '@/lib/time';

export const metadata: Metadata = { title: 'Insights' };

const MAX_ROWS = 8;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const db = getDb();
  const tz = appTimezone();
  const now = new Date();
  const today = localDayKey(now, tz);
  const dayKey = sp.p && /^\d{4}-\d{2}-\d{2}$/.test(sp.p) ? sp.p : today;
  const [{ summary: b, txns, period, bundle }, categories] = await Promise.all([getBudget(db, { dayKey, now }), getCategories(db)]);
  const { budgetSettings } = bundle;
  const totals = categoryTotals(txns, period, tz);
  const cat = categoryLookup(categories);
  const isCurrent = period.start <= today && today <= period.end;
  const prev = shiftPeriod(period, budgetSettings, -1);
  const next = shiftPeriod(period, budgetSettings, 1);

  const days = Math.max(b.dayNumber, 1);
  const rows = totals.rows.filter((r) => r.spent > 0);
  const top = rows.slice(0, MAX_ROWS);
  const rest = rows.slice(MAX_ROWS);
  const restSpent = rest.reduce((a, r) => a + r.spent, 0);
  const maxSpent = Math.max(1, ...top.map((r) => r.spent), restSpent);

  const merchants = new Map<string, { name: string; spent: number; n: number }>();
  for (const t of txns) {
    const e = netSpendEffect(t);
    if (e <= 0) continue;
    const name = txnTitle(t);
    const m = merchants.get(name.toLowerCase()) ?? { name, spent: 0, n: 0 };
    m.spent += e;
    m.n += 1;
    merchants.set(name.toLowerCase(), m);
  }
  const topMerchants = [...merchants.values()].sort((a, c) => c.spent - a.spent).slice(0, 5);
  const usedPct = b.budgetTotal > 0 ? Math.round((b.spentTotal / b.budgetTotal) * 100) : null;

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle={period.label}
        right={
          <>
            <Link href={`/insights?p=${prev.start}`} className="rounded-full bg-surface p-2 text-ink-2 ring-1 ring-line" aria-label="Previous period">
              <ChevronLeft size={18} />
            </Link>
            {isCurrent ? (
              <span className="rounded-full p-2 text-surface-3" aria-hidden="true">
                <ChevronRight size={18} />
              </span>
            ) : (
              <Link href={next.start <= today && today <= next.end ? '/insights' : `/insights?p=${next.start}`} className="rounded-full bg-surface p-2 text-ink-2 ring-1 ring-line" aria-label="Next period">
                <ChevronRight size={18} />
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-3 gap-2">
        <Card className="!p-3">
          <div className="text-[12px] text-muted">Net spent</div>
          <div className="mt-0.5 text-lg font-bold">{formatINR(b.spentTotal, { decimals: 0 })}</div>
          {usedPct !== null && <div className="text-[11px] text-ink-2">{usedPct}% of budget</div>}
        </Card>
        <Card className="!p-3">
          <div className="text-[12px] text-muted">Per day</div>
          <div className="mt-0.5 text-lg font-bold">{formatINR(Math.round(b.spentTotal / days), { decimals: 0 })}</div>
          <div className="text-[11px] text-ink-2">vs {formatINR(b.naiveDaily, { decimals: 0 })} fixed</div>
        </Card>
        <Card className="!p-3">
          <div className="text-[12px] text-muted">Paid back</div>
          <div className="mt-0.5 text-lg font-bold">{formatINR(totals.offsets, { decimals: 0 })}</div>
          <div className="text-[11px] text-ink-2">refunds + friends</div>
        </Card>
      </div>

      <SectionTitle>Spending by category</SectionTitle>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No spending in this period" />
        ) : (
          <>
            <ul className="space-y-3">
              {top.map((r) => {
                const c = cat(r.categoryId);
                return (
                  <li key={r.categoryId}>
                    <Link href={`/transactions?cat=${r.categoryId}${isCurrent ? '' : `&p=${period.start}`}`} className="block">
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[14px]">
                        <span className="truncate">
                          <span aria-hidden="true">{c.emoji}</span> {c.name} <span className="text-[12px] text-muted">· {r.count}</span>
                        </span>
                        <span className="tnum shrink-0 font-semibold">{formatINR(r.spent, { decimals: 0 })}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1">
                          <div className="h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (r.spent / maxSpent) * 100)}%`, background: 'var(--series-1)' }} />
                        </div>
                        <span className="tnum w-9 text-right text-[11px] text-muted">{Math.round((r.spent / totals.gross) * 100)}%</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
              {rest.length > 0 && (
                <li>
                  <div className="mb-1 flex items-baseline justify-between text-[14px]">
                    <span className="text-ink-2">{rest.length} more categories</span>
                    <span className="tnum font-semibold">{formatINR(restSpent, { decimals: 0 })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1">
                      <div className="h-2.5 rounded-r-[4px]" style={{ width: `${(restSpent / maxSpent) * 100}%`, background: 'var(--series-1)', opacity: 0.55 }} />
                    </div>
                    <span className="tnum w-9 text-right text-[11px] text-muted">{Math.round((restSpent / totals.gross) * 100)}%</span>
                  </div>
                </li>
              )}
            </ul>
            <dl className="tnum mt-4 space-y-1 border-t border-line pt-3 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-2">Total spent</dt>
                <dd>{formatINR(totals.gross, { decimals: 0 })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-2">Refunds & paybacks</dt>
                <dd>−{formatINR(totals.offsets, { decimals: 0 })}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Net spend</dt>
                <dd>{formatINR(totals.net, { decimals: 0 })}</dd>
              </div>
            </dl>
          </>
        )}
      </Card>

      <SectionTitle>Daily spend vs budget</SectionTitle>
      <Card>
        <DailyChart series={b.series} />
        <p className="mt-2 text-[12px] text-muted">
          The budget line moves: spend less and tomorrow’s budget rises, overspend and it shrinks. Fixed daily figure: {formatINR(b.naiveDaily, { decimals: 0 })}.
        </p>
      </Card>

      <SectionTitle>Month so far vs even pace</SectionTitle>
      <Card>
        <CumulativeChart series={b.series} />
      </Card>

      {topMerchants.length > 0 && (
        <>
          <SectionTitle>Top merchants</SectionTitle>
          <Card className="!p-0">
            <ul>
              {topMerchants.map((m, i) => (
                <li key={m.name} className={`flex items-center justify-between px-4 py-3 ${i ? 'border-t border-line' : ''}`}>
                  <span className="truncate">
                    {m.name} <span className="text-[12px] text-muted">· {m.n}×</span>
                  </span>
                  <span className="tnum font-semibold">{formatINR(m.spent, { decimals: 0 })}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
