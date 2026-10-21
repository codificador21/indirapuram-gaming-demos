'use client';

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { deleteTransactionAction, getSourceMessagesAction, updateTransactionAction } from '@/app/actions';
import type { Category, Transaction } from '@/db/schema';
import { netSpendEffect } from '@/lib/budget';
import { CHANNEL_LABELS, CREDIT_KIND_LABELS, EXCLUDE_REASON_LABELS, type CreditKind } from '@/lib/domain';
import { accountLabel, dayLabel, txnTitle } from '@/lib/format';
import { formatINR } from '@/lib/money';
import { formatTime, localDayKey, toDateTimeLocalValue } from '@/lib/time';
import { CategoryPicker } from './category-picker';
import { EyeOffIcon, MailIcon, MessageIcon, PencilIcon, TrashIcon } from './icons';
import { Sheet } from './sheet';
import { Switch } from './switch';
import { toast } from './toaster';
import { buttonClass, inputClass, labelClass } from './ui';

interface Props {
  txns: Transaction[];
  categories: Category[];
  tz: string;
  nowIso: string;
  groupByDay?: boolean;
  empty?: ReactNode;
}

export function TxnList({ txns, categories, tz, nowIso, groupByDay = true, empty }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const open = txns.find((t) => t.id === openId) ?? null;

  const groups = useMemo(() => {
    const out: Array<{ day: string; items: Transaction[]; net: number }> = [];
    for (const t of txns) {
      const day = groupByDay ? localDayKey(t.occurredAt, tz) : 'all';
      let g = out[out.length - 1];
      if (!g || g.day !== day) {
        g = { day, items: [], net: 0 };
        out.push(g);
      }
      g.items.push(t);
      g.net += netSpendEffect(t);
    }
    return out;
  }, [txns, tz, groupByDay]);

  if (txns.length === 0) return <>{empty}</>;

  return (
    <>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.day}>
            {groupByDay && (
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <h3 className="text-[13px] font-semibold text-ink-2">{dayLabel(g.day, now, tz)}</h3>
                {g.net !== 0 && <span className="tnum text-[12px] text-muted">{g.net > 0 ? `${formatINR(g.net, { decimals: 0 })} spent` : `${formatINR(-g.net, { decimals: 0 })} back`}</span>}
              </div>
            )}
            <ul className="overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
              {g.items.map((t, i) => (
                <li key={t.id} className={i > 0 ? 'border-t border-line' : ''}>
                  <SwipeRow
                    onTap={() => setOpenId(t.id)}
                    actions={[
                      { label: 'Category', className: 'bg-accent text-on-accent', onClick: () => setOpenId(t.id) },
                      {
                        label: t.excludeFromBudget ? 'Include' : 'Exclude',
                        className: 'bg-surface-3 text-ink',
                        onClick: async () => {
                          const res = await updateTransactionAction({ id: t.id, excludeFromBudget: !t.excludeFromBudget });
                          toast(res?.ok ? (t.excludeFromBudget ? 'Included in budget' : 'Excluded from budget') : (res?.error ?? 'Failed'), res?.ok ? 'ok' : 'error');
                        },
                      },
                    ]}
                  >
                    <TxnRow t={t} category={catMap.get(t.categoryId)} tz={tz} />
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {open && <TxnSheet key={open.id} txn={open} categories={categories} category={catMap.get(open.categoryId)} tz={tz} onClose={() => setOpenId(null)} />}
    </>
  );
}

function TxnRow({ t, category, tz }: { t: Transaction; category?: Category; tz: string }) {
  const acct = t.channel === 'cash' ? 'Cash' : t.accountLast4 ? `••${t.accountLast4}` : null;
  const sub = [category?.name ?? t.categoryId, formatTime(t.occurredAt, tz), acct].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-xl" aria-hidden="true">
        {category?.emoji ?? '🏷️'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{txnTitle(t)}</span>
          {t.excludeFromBudget && <EyeOffIcon size={14} className="shrink-0 text-muted" aria-label="Excluded from budget" />}
        </div>
        <div className="truncate text-[13px] text-muted">{sub}</div>
      </div>
      <div className="text-right">
        <div className={`tnum font-semibold ${t.excludeFromBudget ? 'text-muted' : t.direction === 'credit' ? 'text-good-ink' : 'text-ink'}`}>
          {t.direction === 'credit' ? '+' : ''}
          {formatINR(t.amountPaise)}
        </div>
        {t.excludeFromBudget ? (
          <div className="text-[11px] text-muted">{t.excludeReason ? EXCLUDE_REASON_LABELS[t.excludeReason] : 'Excluded'}</div>
        ) : t.direction === 'credit' && t.creditKind ? (
          <div className="text-[11px] text-muted">{CREDIT_KIND_LABELS[t.creditKind].replace(/ \(.*\)$/, '')}</div>
        ) : null}
      </div>
    </div>
  );
}

const ACTION_W = 84;

function SwipeRow({ children, actions, onTap }: { children: ReactNode; actions: Array<{ label: string; className: string; onClick: () => void }>; onTap: () => void }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef<{ x: number; y: number; dx0: number; lock: 'h' | 'v' | null; moved: boolean } | null>(null);
  const max = ACTION_W * actions.length;

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: max }} aria-hidden={dx === 0}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={dx === 0 ? -1 : 0}
            onClick={() => {
              setDx(0);
              a.onClick();
            }}
            className={`flex-1 text-[13px] font-semibold ${a.className}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div
        role="button"
        tabIndex={0}
        className="relative bg-surface transition-transform duration-200 ease-out select-none"
        style={{ transform: `translateX(${dx}px)`, touchAction: 'pan-y', transitionDuration: dragging ? '0ms' : undefined }}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTap())}
        onPointerDown={(e) => {
          g.current = { x: e.clientX, y: e.clientY, dx0: dx, lock: null, moved: false };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s) return;
          const ddx = e.clientX - s.x;
          const ddy = e.clientY - s.y;
          if (!s.lock && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) s.lock = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
          if (s.lock === 'h') {
            if (!s.moved) setDragging(true);
            s.moved = true;
            setDx(Math.max(-max, Math.min(0, s.dx0 + ddx)));
          } else if (s.lock === 'v') s.moved = true;
        }}
        onPointerUp={() => {
          const s = g.current;
          g.current = null;
          setDragging(false);
          if (!s) return;
          if (!s.moved) {
            if (dx !== 0) setDx(0);
            else onTap();
            return;
          }
          setDx((cur) => (cur < -max / 2 ? -max : 0));
        }}
        onPointerCancel={() => {
          g.current = null;
          setDragging(false);
          setDx((cur) => (cur < -max / 2 ? -max : 0));
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TxnSheet({ txn, categories, category, tz, onClose }: { txn: Transaction; categories: Category[]; category?: Category; tz: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [remember, setRemember] = useState(Boolean(txn.merchantKey));
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(txn.notes ?? '');
  const [merchant, setMerchant] = useState(txn.merchant ?? '');
  const [amount, setAmount] = useState(String(txn.amountPaise / 100));
  const [when, setWhen] = useState(toDateTimeLocalValue(txn.occurredAt, tz));
  const [sources, setSources] = useState<Awaited<ReturnType<typeof getSourceMessagesAction>> | null>(null);
  // Optimistic copies so toggles respond instantly; the server refresh confirms them.
  const [excluded, setExcluded] = useState(txn.excludeFromBudget);
  const [creditKind, setCreditKind] = useState(txn.creditKind);

  const save = (input: Parameters<typeof updateTransactionAction>[0], close = false) =>
    start(async () => {
      const res = await updateTransactionAction(input);
      toast(res?.ok ? (res.message ?? 'Saved') : (res?.error ?? 'Failed'), res?.ok ? 'ok' : 'error');
      if (res?.ok && close) onClose();
    });

  const title = txnTitle(txn);
  return (
    <Sheet open onClose={onClose} title={<span className="block truncate">{title}</span>}>
      <div className={pending ? 'pointer-events-none opacity-60' : ''}>
        <div className="flex items-end justify-between gap-3 pb-4">
          <div>
            <div className={`text-[34px] leading-none font-bold tracking-tight ${txn.direction === 'credit' ? 'text-good-ink' : ''}`}>
              {txn.direction === 'credit' ? '+' : ''}
              {formatINR(txn.amountPaise)}
            </div>
            <div className="mt-1.5 text-sm text-ink-2">
              {new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(txn.occurredAt)}
              {accountLabel(txn) ? ` · ${accountLabel(txn)}` : ''}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line">
            {txn.source === 'email' ? <MailIcon size={13} /> : txn.source === 'sms' ? <MessageIcon size={13} /> : <PencilIcon size={13} />}
            {txn.source === 'manual' ? 'Manual' : txn.source.toUpperCase()}
          </span>
        </div>

        <div className={labelClass}>Category</div>
        <CategoryPicker
          categories={categories}
          value={txn.categoryId}
          direction={txn.direction}
          onChange={(id) => save({ id: txn.id, categoryId: id, remember: remember && Boolean(txn.merchantKey) }, true)}
        />
        {txn.merchantKey && (
          <label className="mt-3 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm ring-1 ring-line">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
            <span>
              Always use this category for <b>{txn.merchant ?? txn.payee}</b>
            </span>
          </label>
        )}

        {txn.direction === 'credit' && (
          <>
            <div className={`${labelClass} mt-5`}>How should this credit count?</div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CREDIT_KIND_LABELS) as CreditKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setCreditKind(k);
                    save({ id: txn.id, creditKind: k });
                  }}
                  aria-pressed={creditKind === k}
                  className={`rounded-2xl px-3 py-2.5 text-left text-[13px] font-medium ring-1 ring-line ${creditKind === k ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2'}`}
                >
                  {CREDIT_KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-line">
          <span>
            <span className="block font-medium">Exclude from budget</span>
            <span className="block text-[13px] text-muted">
              {excluded && txn.excludeFromBudget && txn.excludeReason ? EXCLUDE_REASON_LABELS[txn.excludeReason] : 'Self-transfers, reimbursable expenses…'}
            </span>
          </span>
          <Switch
            checked={excluded}
            label="Exclude from budget"
            onChange={(next) => {
              setExcluded(next);
              save({ id: txn.id, excludeFromBudget: next });
            }}
          />
        </div>

        <div className={`${labelClass} mt-5`}>Notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Add a note" className={inputClass} />

        {editing ? (
          <div className="mt-4 space-y-3">
            <div>
              <div className={labelClass}>Merchant / payee</div>
              <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={labelClass}>Amount (₹)</div>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={inputClass} />
              </div>
              <div>
                <div className={labelClass}>When</div>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={`${buttonClass.ghost} mt-2 px-1`}>
            <PencilIcon size={16} /> Edit merchant, amount or date
          </button>
        )}

        <button
          type="button"
          className={`${buttonClass.primary} mt-4 w-full`}
          onClick={() =>
            save(
              editing
                ? { id: txn.id, notes, merchant, amount, occurredAt: when }
                : { id: txn.id, notes },
              true,
            )
          }
        >
          Save
        </button>

        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {txn.payee && txn.payee !== txn.merchant && (
            <>
              <dt className="text-muted">Payee</dt>
              <dd className="truncate text-right">{txn.payee}</dd>
            </>
          )}
          <dt className="text-muted">Method</dt>
          <dd className="text-right">{CHANNEL_LABELS[txn.channel]}</dd>
          {txn.reference && (
            <>
              <dt className="text-muted">Reference</dt>
              <dd className="tnum truncate text-right">{txn.reference}</dd>
            </>
          )}
          {txn.balancePaise !== null && (
            <>
              <dt className="text-muted">Balance after</dt>
              <dd className="tnum text-right">{formatINR(txn.balancePaise)}</dd>
            </>
          )}
          <dt className="text-muted">Category</dt>
          <dd className="text-right">
            {category?.emoji} {category?.name} <span className="text-muted">({txn.categorySource === 'manual' ? 'set by you' : txn.categorySource === 'rule' ? 'your rule' : 'auto'})</span>
          </dd>
        </dl>

        {txn.source !== 'manual' && (
          <div className="mt-4">
            {sources ? (
              <div className="space-y-2">
                {sources.map((s) => (
                  <div key={s.id} className="rounded-2xl bg-surface-2 p-3 text-[13px] ring-1 ring-line">
                    <div className="mb-1 flex justify-between text-muted">
                      <span>
                        {s.source.toUpperCase()} · {s.sender ?? 'unknown'}
                      </span>
                      <span>{s.status === 'duplicate' ? 'duplicate' : ''}</span>
                    </div>
                    <p className="break-words whitespace-pre-wrap text-ink-2">{s.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <button type="button" className={`${buttonClass.ghost} px-1`} onClick={() => start(async () => setSources(await getSourceMessagesAction(txn.id)))}>
                <MessageIcon size={16} /> Show original message
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className={`${buttonClass.danger} mt-6 w-full`}
          onClick={() => {
            if (!confirm('Delete this transaction?')) return;
            start(async () => {
              await deleteTransactionAction(txn.id);
              toast('Deleted');
              onClose();
            });
          }}
        >
          <TrashIcon size={18} /> Delete
        </button>
      </div>
    </Sheet>
  );
}
