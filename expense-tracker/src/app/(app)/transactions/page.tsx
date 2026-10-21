import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/db';
import { ChevronLeft, ChevronRight, SearchIcon } from '@/components/icons';
import { TxnList } from '@/components/txn-list';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { categoryTotals, getPeriod, shiftPeriod } from '@/lib/budget';
import { appTimezone } from '@/lib/env';
import { formatINR } from '@/lib/money';
import { categoryLookup, getCategories, getSettingsBundle, listTransactions, periodRange } from '@/lib/queries';
import { localDayKey } from '@/lib/time';

export const metadata: Metadata = { title: 'Activity' };

type Search = { p?: string; cat?: string; q?: string; kind?: string };

function href(base: Search, patch: Partial<Search>) {
  const merged = { ...base, ...patch };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as Array<[string, string]>).toString();
  return `/transactions${qs ? `?${qs}` : ''}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const db = getDb();
  const tz = appTimezone();
  const now = new Date();
  const { budgetSettings } = await getSettingsBundle(db);
  const anchor = sp.p && /^\d{4}-\d{2}-\d{2}$/.test(sp.p) ? sp.p : localDayKey(now, tz);
  const period = getPeriod(anchor, budgetSettings);
  const { from, to } = periodRange(period, tz);
  const kind = sp.kind === 'credit' || sp.kind === 'excluded' || sp.kind === 'debit' ? sp.kind : 'all';

  const [all, categories] = await Promise.all([listTransactions(db, { from, to, limit: 5000 }), getCategories(db)]);
  // One query for the period; filters are applied in memory (a month is a few hundred rows).
  const q = sp.q?.trim().toLowerCase();
  const filtered = all.filter(
    (t) =>
      (!sp.cat || t.categoryId === sp.cat) &&
      (kind === 'all' || (kind === 'excluded' ? t.excludeFromBudget : t.direction === kind)) &&
      (!q || [t.merchant, t.payee, t.notes].some((v) => v?.toLowerCase().includes(q))),
  );

  const cat = categoryLookup(categories);
  const totals = categoryTotals(all, period, tz);
  const chipCats = totals.rows.filter((r) => r.spent > 0).map((r) => r.categoryId);
  const prev = shiftPeriod(period, budgetSettings, -1);
  const next = shiftPeriod(period, budgetSettings, 1);
  const isCurrent = period.start <= localDayKey(now, tz) && localDayKey(now, tz) <= period.end;
  const base: Search = { p: isCurrent ? undefined : period.start, cat: sp.cat, q: sp.q, kind: kind === 'all' ? undefined : kind };

  const spent = filtered.filter((t) => t.direction === 'debit' && !t.excludeFromBudget).reduce((a, t) => a + t.amountPaise, 0);
  const received = filtered.filter((t) => t.direction === 'credit' && !t.excludeFromBudget).reduce((a, t) => a + t.amountPaise, 0);

  const chip = (label: string, active: boolean, to: string, key: string) => (
    <Link
      key={key}
      href={to}
      scroll={false}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap ring-1 transition ${
        active ? 'bg-accent text-on-accent ring-accent' : 'bg-surface text-ink-2 ring-line'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle={period.label}
        right={
          <>
            <Link href={href(base, { p: prev.start })} className="rounded-full bg-surface p-2 text-ink-2 ring-1 ring-line" aria-label="Previous period">
              <ChevronLeft size={18} />
            </Link>
            {isCurrent ? (
              <span className="rounded-full p-2 text-surface-3" aria-hidden="true">
                <ChevronRight size={18} />
              </span>
            ) : (
              <Link href={href(base, { p: next.start > localDayKey(now, tz) ? undefined : next.start })} className="rounded-full bg-surface p-2 text-ink-2 ring-1 ring-line" aria-label="Next period">
                <ChevronRight size={18} />
              </Link>
            )}
          </>
        }
      />

      <form action="/transactions" className="relative mb-3">
        {base.p && <input type="hidden" name="p" value={base.p} />}
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        {kind !== 'all' && <input type="hidden" name="kind" value={kind} />}
        <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search merchant, payee or note"
          className="w-full rounded-2xl bg-surface py-3 pr-4 pl-11 text-ink ring-1 ring-line placeholder:text-muted focus:ring-2 focus:ring-accent focus:outline-none"
          enterKeyHint="search"
        />
      </form>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {chip('All', !sp.cat && kind === 'all', href(base, { cat: undefined, kind: undefined }), 'all')}
        {chipCats.map((id) => chip(`${cat(id).emoji} ${cat(id).name}`, sp.cat === id, href(base, { cat: sp.cat === id ? undefined : id, kind: undefined }), id))}
        {chip('↓ Money in', kind === 'credit', href(base, { kind: kind === 'credit' ? undefined : 'credit', cat: undefined }), 'credit')}
        {chip('Excluded', kind === 'excluded', href(base, { kind: kind === 'excluded' ? undefined : 'excluded', cat: undefined }), 'excluded')}
      </div>

      <p className="tnum mt-3 mb-3 px-1 text-[13px] text-ink-2">
        {filtered.length} transaction{filtered.length === 1 ? '' : 's'} · {formatINR(spent, { decimals: 0 })} out
        {received > 0 ? ` · ${formatINR(received, { decimals: 0 })} in` : ''}
      </p>

      <TxnList
        txns={filtered}
        categories={categories}
        tz={tz}
        nowIso={now.toISOString()}
        empty={
          <Card>
            <EmptyState title={sp.q || sp.cat || kind !== 'all' ? 'Nothing matches' : 'No transactions in this period'}>
              {sp.q || sp.cat || kind !== 'all' ? (
                <Link href={href({ p: base.p }, {})} className="text-accent-ink">
                  Clear filters
                </Link>
              ) : (
                'Swipe a row left for quick actions, or tap it to edit.'
              )}
            </EmptyState>
          </Card>
        }
      />
      {filtered.length > 0 && <p className="mt-4 text-center text-[12px] text-muted">Tip: swipe a row left to exclude it or change its category.</p>}
    </>
  );
}
