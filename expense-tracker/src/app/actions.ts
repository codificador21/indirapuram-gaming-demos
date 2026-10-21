'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/db';
import { fixedCommitments, merchantRules, myAccounts, settings } from '@/db/schema';
import { checkPassword, loginLocked, recordLoginFailure, requireSession } from '@/lib/auth';
import { ACCOUNT_TYPES, COMMITMENT_KINDS, CREDIT_KINDS, type CreditKind } from '@/lib/domain';
import { appTimezone } from '@/lib/env';
import { rupeesToPaise } from '@/lib/money';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { fromDateTimeLocalValue } from '@/lib/time';
import { createTransaction, deleteTransaction, dismissReview, resolveReview, updateTransaction } from '@/lib/transactions';

export type ActionState = { ok: boolean; message?: string; error?: string; id?: number } | null;

const refreshAll = () => revalidatePath('/', 'layout');

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (loginLocked()) return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' };
  if (!process.env.APP_PASSWORD) return { ok: false, error: 'APP_PASSWORD is not set on the server (see .env.example).' };
  const password = String(formData.get('password') ?? '');
  if (!checkPassword(password)) {
    recordLoginFailure();
    return { ok: false, error: 'Wrong password' };
  }
  const token = await createSessionToken();
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  const next = String(formData.get('next') ?? '/');
  // Only same-site paths: "/x" yes; "//evil.com", "/\\evil.com" and absolute URLs no.
  redirect(/^\/(?![/\\])/.test(next) ? next : '/');
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}

// ── Transactions ──────────────────────────────────────────────────────────────

const txnForm = z.object({
  amount: z.string().min(1, 'Enter an amount'),
  direction: z.enum(['debit', 'credit']).default('debit'),
  merchant: z.string().max(80).optional().default(''),
  categoryId: z.string().max(40).optional().default(''),
  occurredAt: z.string().optional().default(''),
  notes: z.string().max(500).optional().default(''),
  channel: z.enum(['cash', 'upi', 'card', 'netbanking', 'other']).default('cash'),
  creditKind: z.enum(CREDIT_KINDS).optional(),
  exclude: z.string().optional(),
});

function readTxnForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const parsed = txnForm.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' } as const;
  const v = parsed.data;
  const amountPaise = rupeesToPaise(v.amount);
  if (!amountPaise || amountPaise <= 0) return { error: 'Enter a valid amount' } as const;
  const occurredAt = v.occurredAt ? fromDateTimeLocalValue(v.occurredAt, appTimezone()) : new Date();
  if (!occurredAt) return { error: 'Invalid date' } as const;
  return {
    value: {
      amountPaise,
      direction: v.direction,
      occurredAt,
      merchant: v.merchant || null,
      categoryId: v.categoryId || null,
      notes: v.notes || null,
      channel: v.channel,
      creditKind: v.direction === 'credit' ? (v.creditKind ?? null) : null,
      excludeFromBudget: v.exclude === 'on' ? true : undefined,
    },
  } as const;
}

export async function addTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const r = readTxnForm(formData);
  if ('error' in r) return { ok: false, error: r.error };
  const txn = await createTransaction(getDb(), r.value);
  refreshAll();
  return { ok: true, id: txn.id, message: 'Saved' };
}

export async function resolveReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const rawId = Number(formData.get('rawId'));
  if (!Number.isInteger(rawId)) return { ok: false, error: 'Missing message id' };
  const r = readTxnForm(formData);
  if ('error' in r) return { ok: false, error: r.error };
  const txn = await resolveReview(getDb(), rawId, r.value);
  refreshAll();
  return { ok: true, id: txn.id, message: 'Transaction created' };
}

export async function dismissReviewAction(rawIds: number[]) {
  await requireSession();
  await dismissReview(getDb(), rawIds.filter(Number.isInteger));
  refreshAll();
}

const updateSchema = z.object({
  id: z.number().int().positive(),
  categoryId: z.string().max(40).optional(),
  notes: z.string().max(500).nullable().optional(),
  merchant: z.string().max(80).nullable().optional(),
  excludeFromBudget: z.boolean().optional(),
  creditKind: z.enum(CREDIT_KINDS).nullable().optional(),
  amount: z.string().optional(),
  occurredAt: z.string().optional(),
  remember: z.boolean().optional(),
});

export async function updateTransactionAction(input: z.input<typeof updateSchema>): Promise<ActionState> {
  await requireSession();
  const p = updateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: 'Invalid update' };
  const v = p.data;
  let amountPaise: number | undefined;
  if (v.amount !== undefined) {
    const a = rupeesToPaise(v.amount);
    if (!a) return { ok: false, error: 'Enter a valid amount' };
    amountPaise = a;
  }
  const occurredAt = v.occurredAt ? (fromDateTimeLocalValue(v.occurredAt, appTimezone()) ?? undefined) : undefined;
  const res = await updateTransaction(
    getDb(),
    v.id,
    { categoryId: v.categoryId, notes: v.notes, merchant: v.merchant, excludeFromBudget: v.excludeFromBudget, creditKind: v.creditKind as CreditKind | null | undefined, amountPaise, occurredAt },
    { rememberCategory: v.remember },
  );
  refreshAll();
  const extra = res.alsoUpdated ? ` · ${res.alsoUpdated} more updated` : '';
  return { ok: true, message: `Saved${extra}` };
}

export async function deleteTransactionAction(id: number): Promise<ActionState> {
  await requireSession();
  await deleteTransaction(getDb(), id);
  refreshAll();
  return { ok: true, message: 'Deleted' };
}

// ── Settings ──────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  salary: z.string(),
  salaryCreditDay: z.coerce.number().int().min(1).max(31),
  budgetCycle: z.enum(['calendar', 'salary']),
  selfIdentifiers: z.string().max(2000).optional().default(''),
});

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const p = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid settings' };
  const salary = p.data.salary.trim() === '' ? 0 : rupeesToPaise(p.data.salary);
  if (salary === null) return { ok: false, error: 'Enter salary as a number, e.g. 85000' };
  const selfIdentifiers = p.data.selfIdentifiers
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  await getDb()
    .insert(settings)
    .values({ id: 1, monthlySalaryPaise: salary, salaryCreditDay: p.data.salaryCreditDay, budgetCycle: p.data.budgetCycle, selfIdentifiers })
    .onConflictDoUpdate({
      target: settings.id,
      set: { monthlySalaryPaise: salary, salaryCreditDay: p.data.salaryCreditDay, budgetCycle: p.data.budgetCycle, selfIdentifiers },
    });
  refreshAll();
  return { ok: true, message: 'Settings saved' };
}

const commitmentSchema = z.object({
  id: z.coerce.number().int().optional(),
  name: z.string().trim().min(1, 'Name is required').max(60),
  kind: z.enum(COMMITMENT_KINDS).default('other'),
  amount: z.string(),
  matchKeywords: z.string().max(300).optional().default(''),
});

export async function saveCommitmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const raw = Object.fromEntries(formData.entries());
  const p = commitmentSchema.safeParse({ ...raw, id: raw.id ? raw.id : undefined });
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid commitment' };
  const amountPaise = rupeesToPaise(p.data.amount);
  if (!amountPaise) return { ok: false, error: 'Enter an amount' };
  const values = { name: p.data.name, kind: p.data.kind, amountPaise, matchKeywords: p.data.matchKeywords.trim() };
  const db = getDb();
  if (p.data.id) await db.update(fixedCommitments).set(values).where(eq(fixedCommitments.id, p.data.id));
  else await db.insert(fixedCommitments).values(values);
  refreshAll();
  return { ok: true, message: 'Saved' };
}

export async function toggleCommitmentAction(id: number, active: boolean) {
  await requireSession();
  await getDb().update(fixedCommitments).set({ active }).where(eq(fixedCommitments.id, id));
  refreshAll();
}

export async function deleteCommitmentAction(id: number) {
  await requireSession();
  await getDb().delete(fixedCommitments).where(eq(fixedCommitments.id, id));
  refreshAll();
}

const accountSchema = z.object({
  label: z.string().trim().min(1, 'Give it a name').max(40),
  bank: z.string().trim().max(20).optional().default(''),
  last4: z.string().trim().regex(/^\d{3,4}$/, 'Last 3–4 digits'),
  type: z.enum(ACCOUNT_TYPES).default('bank'),
});

export async function addAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const p = accountSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid account' };
  await getDb()
    .insert(myAccounts)
    .values({ ...p.data, bank: p.data.bank || null })
    .onConflictDoNothing();
  refreshAll();
  return { ok: true, message: 'Added' };
}

export async function deleteAccountAction(id: number) {
  await requireSession();
  await getDb().delete(myAccounts).where(eq(myAccounts.id, id));
  refreshAll();
}

export async function deleteRuleAction(id: number) {
  await requireSession();
  await getDb().delete(merchantRules).where(eq(merchantRules.id, id));
  refreshAll();
}

// ── Read helpers for client components ───────────────────────────────────────

export async function getSourceMessagesAction(transactionId: number) {
  await requireSession();
  const { sourceMessages } = await import('@/lib/queries');
  const rows = await sourceMessages(getDb(), transactionId);
  return rows.map((r) => ({ id: r.id, source: r.source, via: r.via, sender: r.sender, subject: r.subject, body: r.body, receivedAt: r.receivedAt.toISOString(), status: r.status }));
}

// ── Email ─────────────────────────────────────────────────────────────────────

export async function pollEmailNowAction(): Promise<ActionState> {
  await requireSession();
  const { imapConfigFromEnv, pollMailboxOnce, summaryText } = await import('@/lib/email/poller');
  const cfg = imapConfigFromEnv();
  if (!cfg) return { ok: false, error: 'IMAP is not configured' };
  try {
    const s = await pollMailboxOnce(getDb(), cfg);
    refreshAll();
    return { ok: true, message: summaryText(s) };
  } catch (err) {
    return { ok: false, error: `Email check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function reprocessReviewAction(): Promise<ActionState> {
  await requireSession();
  const { reprocessMessages } = await import('@/lib/ingest/pipeline');
  const { reviewItems } = await import('@/lib/queries');
  const db = getDb();
  const items = await reviewItems(db, ['needs_review', 'ignored'], 500);
  const s = await reprocessMessages(db, items.map((i) => i.id));
  refreshAll();
  const parts = [s.created && `${s.created} new`, s.duplicates && `${s.duplicates} already recorded`].filter(Boolean);
  return { ok: true, message: parts.length ? `Re-checked ${s.checked}: ${parts.join(', ')}` : `Re-checked ${s.checked} — no change` };
}
