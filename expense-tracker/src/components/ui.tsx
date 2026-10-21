import Link from 'next/link';
import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-surface p-4 ring-1 ring-line ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, right, back }: { title: string; subtitle?: ReactNode; right?: ReactNode; back?: string }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-5 pb-4">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-block text-sm text-accent-ink">
            ‹ Back
          </Link>
        )}
        <h1 className="truncate text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </header>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {right}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export const buttonClass = {
  primary: 'inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 font-semibold text-on-accent transition active:scale-[0.98] disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 font-semibold text-ink ring-1 ring-line transition active:scale-[0.98] disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 font-medium text-accent-ink transition active:scale-[0.98]',
  danger: 'inline-flex items-center justify-center gap-2 rounded-2xl bg-critical-soft px-4 py-3 font-semibold text-critical-ink transition active:scale-[0.98]',
};

export const inputClass =
  'w-full rounded-2xl bg-surface-2 px-4 py-3 text-ink ring-1 ring-line placeholder:text-muted focus:ring-2 focus:ring-accent focus:outline-none';

export const labelClass = 'mb-1.5 block px-1 text-[13px] font-medium text-ink-2';

