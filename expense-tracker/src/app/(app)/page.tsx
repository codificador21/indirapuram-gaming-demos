import Link from 'next/link';
import { getDb } from '@/db';
import { AlertIcon, CheckCircleIcon, ChevronRight, InboxIcon, SettingsIcon } from '@/components/icons';
import { MonthBar, TodayRing } from '@/components/meters';
import { ThemeToggle } from '@/components/theme-toggle';
import { TxnList } from '@/components/txn-list';
import { buttonClass, Card, EmptyState, SectionTitle } from '@/components/ui';
import { appTimezone } from '@/lib/env';
import { formatINR } from '@/lib/money';
import { getBudget, getCategories, recentTransactions, reviewCount } from '@/lib/queries';
import { localParts, monthName } from '@/lib/time';

export default async function HomePage() {
  const db = getDb();
  const tz = appTimezone();
  const now = new Date();
  const [{ summary: b }, recent, categories, pending] = await Promise.all([getBudget(db, { now }), recentTransactions(db, 6), getCategories(db), reviewCount(db)]);

  const p = localParts(now, tz);
  const greeting = p.hour < 5 ? 'Up late' : p.hour < 12 ? 'Good morning' : p.hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const configured = b.status !== 'not_configured';
  const overPace = b.projectedTotal > b.budgetTotal;

  return (
    <>
      <header className="flex items-center justify-between pt-5 pb-2">
        <div>
          <p className="text-sm text-ink-2">{dateLine}</p>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">{greeting}</h1>
        </div>
        <div className="flex items-center">
          <ThemeToggle />
          <Link href="/settings" className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="Settings">
            <SettingsIcon size={21} />
          </Link>
        </div>
      </header>

      {!configured ? (
        <Card className="mt-3">
          <EmptyState title="Set your monthly salary" icon={<SettingsIcon size={32} />}>
            Your daily safe-to-spend number is worked out from your net salary minus fixed commitments (rent, SIPs, EMIs).
            <div className="mt-4">
              <Link href="/settings" className={buttonClass.primary}>
                Open settings
              </Link>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mt-3 pt-6">
            <TodayRing allowance={b.allowanceToday} spent={b.spentToday} left={b.leftToday} />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-surface-2 px-3.5 py-3">
                <div className="text-[12px] text-muted">Tomorrow, if you stop now</div>
                <div className="mt-0.5 text-lg font-semibold">{b.allowanceTomorrow === null ? '—' : formatINR(b.allowanceTomorrow, { decimals: 0 })}</div>
              </div>
              <div className="rounded-2xl bg-surface-2 px-3.5 py-3">
                <div className="text-[12px] text-muted">Fixed daily budget</div>
                <div className="mt-0.5 text-lg font-semibold">{formatINR(b.naiveDaily, { decimals: 0 })}</div>
              </div>
            </div>
          </Card>

          <Card className="mt-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{b.period.label.startsWith(monthName(p.month, true)) ? monthName(p.month, true) : b.period.label}</h2>
              <span className="text-[13px] text-muted">
                Day {b.dayNumber} of {b.period.days}
              </span>
            </div>
            <div className="mt-2 mb-3 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tracking-tight">{formatINR(b.spentTotal, { decimals: 0 })}</span>
              <span className="text-sm text-ink-2">spent of {formatINR(b.budgetTotal, { decimals: 0 })}</span>
            </div>
            <MonthBar spent={b.spentTotal} budget={b.budgetTotal} expected={b.expectedByToday} />
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className={b.remainingInPeriod < 0 ? 'font-semibold text-critical-ink' : 'text-ink-2'}>
                {b.remainingInPeriod < 0
                  ? `Over by ${formatINR(-b.remainingInPeriod, { decimals: 0 })}`
                  : `${formatINR(b.remainingInPeriod, { decimals: 0 })} left · ${b.remainingDays} day${b.remainingDays === 1 ? '' : 's'} to go`}
              </span>
              <span className={`inline-flex items-center gap-1 ${overPace ? 'text-critical-ink' : 'text-good-ink'}`}>
                {overPace ? <AlertIcon size={13} /> : <CheckCircleIcon size={13} />}
                On pace for {formatINR(b.projectedTotal, { decimals: 0 })}
              </span>
            </div>
          </Card>
        </>
      )}

      {pending > 0 && (
        <Link href="/review" className="mt-3 flex items-center gap-3 rounded-3xl bg-surface px-4 py-3.5 ring-1 ring-line active:scale-[0.99]">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-critical-soft text-critical-ink">
            <InboxIcon size={19} />
          </span>
          <span className="flex-1">
            <span className="block font-medium">
              {pending} message{pending === 1 ? '' : 's'} need{pending === 1 ? 's' : ''} review
            </span>
            <span className="block text-[13px] text-muted">Couldn’t read them automatically</span>
          </span>
          <ChevronRight size={18} className="text-muted" />
        </Link>
      )}

      <SectionTitle
        right={
          <Link href="/transactions" className="text-sm font-medium text-accent-ink">
            See all
          </Link>
        }
      >
        Recent
      </SectionTitle>
      <TxnList
        txns={recent}
        categories={categories}
        tz={tz}
        nowIso={now.toISOString()}
        empty={
          <Card>
            <EmptyState title="No transactions yet">
              Set up the iPhone Shortcut (Settings → Capture) or tap + to add one.
            </EmptyState>
          </Card>
        }
      />
    </>
  );
}
