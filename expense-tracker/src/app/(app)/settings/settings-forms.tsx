'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import {
  addAccountAction,
  deleteAccountAction,
  deleteCommitmentAction,
  deleteRuleAction,
  logoutAction,
  pollEmailNowAction,
  saveCommitmentAction,
  saveSettingsAction,
  toggleCommitmentAction,
  type ActionState,
} from '@/app/actions';
import { CopyIcon, LogOutIcon, RefreshIcon, TrashIcon } from '@/components/icons';
import { Switch } from '@/components/switch';
import { toast } from '@/components/toaster';
import { buttonClass, inputClass, labelClass } from '@/components/ui';

function useToastOn(state: ActionState, after?: () => void) {
  useEffect(() => {
    if (state?.ok) {
      toast(state.message ?? 'Saved');
      after?.();
    } else if (state?.error) toast(state.error, 'error');
  }, [state, after]);
}

export function BudgetForm(p: { salary: number; salaryCreditDay: number; budgetCycle: 'calendar' | 'salary'; selfIdentifiers: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettingsAction, null);
  useToastOn(state);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className={labelClass} htmlFor="salary">
            Monthly salary (net, ₹)
          </label>
          <input id="salary" name="salary" inputMode="decimal" defaultValue={p.salary || ''} placeholder="85000" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="salaryCreditDay">
            Credited on day
          </label>
          <input id="salaryCreditDay" name="salaryCreditDay" type="number" min={1} max={31} defaultValue={p.salaryCreditDay} className={`${inputClass} w-24`} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="budgetCycle">
          Budget month
        </label>
        <select id="budgetCycle" name="budgetCycle" defaultValue={p.budgetCycle} className={inputClass}>
          <option value="calendar">Calendar month (1st → last day)</option>
          <option value="salary">Salary cycle (salary day → day before next)</option>
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="selfIdentifiers">
          That’s me — my names / UPI IDs (one per line)
        </label>
        <textarea id="selfIdentifiers" name="selfIdentifiers" rows={2} defaultValue={p.selfIdentifiers} placeholder={'Aarav Mehta\naarav@okhdfcbank'} className={inputClass} />
        <p className="mt-1 px-1 text-[12px] text-muted">Payments to these are treated as transfers between your own accounts.</p>
      </div>
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? 'Saving…' : 'Save budget settings'}
      </button>
    </form>
  );
}

export function CommitmentForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCommitmentAction, null);
  useToastOn(state, () => {
    formRef.current?.reset();
    setOpen(false);
  });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass.secondary} w-full`}>
        + Add commitment
      </button>
    );
  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-2xl bg-surface-2 p-3 ring-1 ring-line">
      <div className="grid grid-cols-2 gap-2">
        <input name="name" placeholder="Name (e.g. Rent)" required className={inputClass} />
        <input name="amount" placeholder="Amount ₹" inputMode="decimal" required className={inputClass} />
      </div>
      <select name="kind" defaultValue="other" className={inputClass}>
        <option value="rent">Rent</option>
        <option value="sip">SIP / investment</option>
        <option value="emi">EMI / loan</option>
        <option value="insurance">Insurance</option>
        <option value="subscription">Subscription</option>
        <option value="other">Other</option>
      </select>
      <input name="matchKeywords" placeholder="Keywords in the bank message, e.g. zerodha, landlord name" className={inputClass} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className={`${buttonClass.secondary} flex-1`}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={`${buttonClass.primary} flex-1`}>
          Add
        </button>
      </div>
    </form>
  );
}

export function AccountForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(addAccountAction, null);
  useToastOn(state, () => {
    formRef.current?.reset();
    setOpen(false);
  });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass.secondary} w-full`}>
        + Add account or card
      </button>
    );
  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-2xl bg-surface-2 p-3 ring-1 ring-line">
      <input name="label" placeholder="Label (e.g. HDFC savings)" required className={inputClass} />
      <div className="grid grid-cols-3 gap-2">
        <input name="bank" placeholder="Bank" className={inputClass} />
        <input name="last4" placeholder="Last 4" inputMode="numeric" maxLength={4} required className={inputClass} />
        <select name="type" defaultValue="bank" className={inputClass}>
          <option value="bank">Account</option>
          <option value="credit_card">Credit card</option>
          <option value="debit_card">Debit card</option>
          <option value="wallet">Wallet</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className={`${buttonClass.secondary} flex-1`}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={`${buttonClass.primary} flex-1`}>
          Add
        </button>
      </div>
    </form>
  );
}

export function ToggleCommitment({ id, active }: { id: number; active: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(active);
  return (
    <Switch
      checked={on}
      label="Active"
      disabled={pending}
      onChange={(next) => {
        setOn(next);
        start(() => toggleCommitmentAction(id, next));
      }}
    />
  );
}

export function DeleteButton({ kind, id }: { kind: 'commitment' | 'account' | 'rule'; id: number }) {
  const [pending, start] = useTransition();
  const run = { commitment: deleteCommitmentAction, account: deleteAccountAction, rule: deleteRuleAction }[kind];
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Delete"
      onClick={() => {
        if (!confirm('Delete?')) return;
        start(async () => {
          await run(id);
          toast('Deleted');
        });
      }}
      className="rounded-full p-1.5 text-muted hover:text-critical-ink"
    >
      <TrashIcon size={16} />
    </button>
  );
}

export function CopyField({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast('Copied');
        } catch {
          toast('Copy failed — long-press to select', 'error');
        }
      }}
      className="flex w-full items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-left ring-1 ring-line"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{value}</span>
      <CopyIcon size={16} className="shrink-0 text-muted" />
    </button>
  );
}

export function PollNowButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await pollEmailNowAction();
          toast(res?.ok ? (res.message ?? 'Checked') : (res?.error ?? 'Failed'), res?.ok ? 'ok' : 'error');
        })
      }
      className={`${buttonClass.secondary} mt-3 w-full`}
    >
      <RefreshIcon size={16} className={pending ? 'animate-spin' : ''} /> {pending ? 'Checking…' : 'Check email now'}
    </button>
  );
}

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className={`${buttonClass.secondary} w-full`}>
        <LogOutIcon size={18} /> Sign out
      </button>
    </form>
  );
}
