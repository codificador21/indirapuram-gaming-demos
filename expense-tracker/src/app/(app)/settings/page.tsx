import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDb } from '@/db';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { computeBudget } from '@/lib/budget';
import { env, imapConfigured } from '@/lib/env';
import { BANK_NAMES } from '@/lib/format';
import { formatINR } from '@/lib/money';
import { categoryLookup, getAppState, getCategories, getSettingsBundle, ingestStats } from '@/lib/queries';
import { AccountForm, BudgetForm, CommitmentForm, CopyField, DeleteButton, PollNowButton, SignOutButton, ToggleCommitment } from './settings-forms';
import type { PollerState } from '@/lib/email/poller-state';
import { currentTheme } from '@/lib/theme-server';

export const metadata: Metadata = { title: 'Settings' };

async function baseUrl() {
  const configured = env().PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function SettingsPage() {
  const db = getDb();
  const [bundle, categories, stats, poller, base] = await Promise.all([getSettingsBundle(db), getCategories(db), ingestStats(db), getAppState<PollerState>(db, 'email_poller'), baseUrl()]);
  const { settings: s, commitments, accounts, rules, budgetSettings } = bundle;
  const preview = computeBudget([], budgetSettings, new Date());
  const cat = categoryLookup(categories);
  const token = env().INGEST_TOKEN;
  const smsCount = stats.filter((r) => r.source === 'sms').reduce((a, r) => a + r.n, 0);
  const emailCount = stats.filter((r) => r.source === 'email').reduce((a, r) => a + r.n, 0);
  const lastSms = stats.filter((r) => r.via === 'webhook').map((r) => new Date(r.last))[0];

  return (
    <>
      <PageHeader title="Settings" back="/" />

      <SectionTitle>Budget</SectionTitle>
      <Card>
        <BudgetForm salary={s.monthlySalaryPaise / 100} salaryCreditDay={s.salaryCreditDay} budgetCycle={s.budgetCycle} selfIdentifiers={s.selfIdentifiers.join('\n')} />
        <div className="tnum mt-4 rounded-2xl bg-surface-2 p-3 text-[13px] ring-1 ring-line">
          <div className="flex justify-between">
            <span className="text-ink-2">Salary</span>
            <span>{formatINR(s.monthlySalaryPaise, { decimals: 0 })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-2">− Fixed commitments</span>
            <span>{formatINR(budgetSettings.fixedCommitmentsPaise, { decimals: 0 })}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
            <span>Monthly spending money</span>
            <span>{formatINR(preview.budgetTotal, { decimals: 0 })}</span>
          </div>
          <div className="flex justify-between text-ink-2">
            <span>Fixed daily ({preview.period.days} days)</span>
            <span>{formatINR(preview.naiveDaily, { decimals: 0 })}</span>
          </div>
        </div>
      </Card>

      <SectionTitle>Fixed commitments</SectionTitle>
      <Card>
        <p className="mb-3 text-[13px] text-ink-2">
          Taken out of your monthly budget up front. When the matching debit arrives (amount within 10% and a keyword in the message), it’s excluded so it isn’t counted twice.
        </p>
        <ul className="mb-3 divide-y divide-[var(--border)]">
          {commitments.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <ToggleCommitment id={c.id} active={c.active} />
              <div className="min-w-0 flex-1">
                <div className={`font-medium ${c.active ? '' : 'text-muted line-through'}`}>{c.name}</div>
                <div className="truncate text-[12px] text-muted">{c.matchKeywords ? `Matches: ${c.matchKeywords}` : 'No keywords — won’t auto-match'}</div>
              </div>
              <span className="tnum font-semibold">{formatINR(c.amountPaise, { decimals: 0 })}</span>
              <DeleteButton kind="commitment" id={c.id} />
            </li>
          ))}
        </ul>
        <CommitmentForm />
      </Card>

      <SectionTitle>My accounts & cards</SectionTitle>
      <Card>
        <p className="mb-3 text-[13px] text-ink-2">Transfers to these (e.g. “To A/c XX4321”) count as self-transfers and are excluded.</p>
        <ul className="mb-3 divide-y divide-[var(--border)]">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.label}</span>
                <span className="text-[12px] text-muted">
                  {(a.bank && BANK_NAMES[a.bank.toUpperCase()]) ?? a.bank ?? 'Bank'} · {a.type.replace('_', ' ')} · ••{a.last4}
                </span>
              </span>
              <DeleteButton kind="account" id={a.id} />
            </li>
          ))}
        </ul>
        <AccountForm />
      </Card>

      <SectionTitle>Learned category rules</SectionTitle>
      <Card className={rules.length ? '!p-0' : ''}>
        {rules.length === 0 ? (
          <p className="text-[13px] text-ink-2">When you change a transaction’s category with “Always use this category” on, the rule appears here.</p>
        ) : (
          <ul>
            {rules.map((r, i) => (
              <li key={r.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i ? 'border-t border-line' : ''}`}>
                <span className="truncate font-mono text-[13px]">{r.merchantKey}</span>
                <span className="flex items-center gap-2 text-[13px]">
                  {cat(r.categoryId).emoji} {cat(r.categoryId).name}
                  <DeleteButton kind="rule" id={r.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>Capture</SectionTitle>
      <Card>
        <h3 className="font-semibold">iPhone SMS → webhook</h3>
        <p className="mt-1 mb-2 text-[13px] text-ink-2">
          Build the Shortcuts automation from <code className="text-[12px]">docs/IOS_SHORTCUT_SETUP.md</code>. Use this URL and your <code className="text-[12px]">INGEST_TOKEN</code>:
        </p>
        <CopyField value={`${base}/api/ingest/sms`} />
        <div className="mt-2 text-[13px] text-ink-2">
          Token: {token ? <span className="text-good-ink">configured (…{token.slice(-4)})</span> : <span className="text-critical-ink">INGEST_TOKEN is not set</span>}
        </div>
        <div className="mt-1 text-[13px] text-ink-2">
          {smsCount} SMS received{lastSms ? `, last ${lastSms.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}` : ''}
        </div>

        <h3 className="mt-5 font-semibold">Bank alert emails (IMAP)</h3>
        {imapConfigured() ? (
          <div className="mt-1 text-[13px] text-ink-2">
            <p>
              Watching <b>{env().IMAP_USER}</b> / {env().IMAP_MAILBOX} every {env().IMAP_POLL_INTERVAL_SECONDS}s (run <code>npm run worker</code>).
            </p>
            <p className="mt-1">
              {poller?.lastRunAt
                ? `Last check ${new Date(poller.lastRunAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} — ${poller.lastResult ?? ''}`
                : 'Not run yet.'}
            </p>
            {poller?.lastError && <p className="mt-1 text-critical-ink">Last error: {poller.lastError}</p>}
            <p className="mt-1">{emailCount} emails ingested so far.</p>
            <PollNowButton />
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-ink-2">Off. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD (an app password) to turn it on — see .env.example.</p>
        )}
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Card className="!py-2">
        <ThemeToggle initial={await currentTheme()} withLabel />
      </Card>

      <div className="mt-6">
        <SignOutButton />
      </div>
    </>
  );
}
