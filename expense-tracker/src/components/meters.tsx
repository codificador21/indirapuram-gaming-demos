import { formatINR } from '@/lib/money';
import { AlertIcon } from './icons';

type Severity = 'ok' | 'warning' | 'critical';

const FILL: Record<Severity, string> = { ok: 'var(--accent)', warning: 'var(--warning)', critical: 'var(--critical)' };

export function severityFor(spent: number, limit: number): Severity {
  if (limit <= 0) return spent > 0 ? 'critical' : 'ok';
  const r = spent / limit;
  if (r > 1) return 'critical';
  if (r >= 0.85) return 'warning';
  return 'ok';
}

/**
 * Today's ring: how much of today's allowance is used. The big number in the middle is what's left.
 */
export function TodayRing({ allowance, spent, left, size = 248 }: { allowance: number; spent: number; left: number; size?: number }) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = allowance > 0 ? Math.min(spent / allowance, 1) : spent > 0 ? 1 : 0;
  const sev = severityFor(spent, allowance);
  const over = left < 0;
  const big = formatINR(Math.abs(left), { decimals: 0 });

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${formatINR(spent, { decimals: 0 })} of ${formatINR(allowance, { decimals: 0 })} used today`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-soft)" strokeWidth={stroke} opacity={0.55} />
        {ratio > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={FILL[sev]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * ratio} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(.2,.8,.2,1)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <span className="text-[13px] font-medium text-ink-2">{over ? 'Over today’s budget by' : 'Safe to spend today'}</span>
        <span className={`mt-1 text-[52px] leading-none font-bold tracking-tight ${over ? 'text-critical-ink' : 'text-ink'}`}>
          {over ? '−' : ''}
          {big}
        </span>
        <span className="mt-2 text-[13px] text-ink-2">
          {formatINR(spent, { decimals: 0 })} spent of {formatINR(allowance, { decimals: 0 })}
        </span>
        {sev !== 'ok' && (
          <span className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${sev === 'critical' ? 'text-critical-ink' : 'text-warning-ink'}`}>
            <AlertIcon size={14} />
            {sev === 'critical' ? 'Over budget' : 'Almost used up'}
          </span>
        )}
      </div>
    </div>
  );
}

/** Month progress: net spend vs budget, with a marker where an even pace would be today. */
export function MonthBar({ spent, budget, expected }: { spent: number; budget: number; expected: number }) {
  const pct = budget > 0 ? Math.min(spent / budget, 1) * 100 : 0;
  const pace = budget > 0 ? Math.min(expected / budget, 1) * 100 : 0;
  const sev = severityFor(spent, budget);
  return (
    <div>
      <div className="relative h-3 w-full rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-soft) 55%, transparent)' }}>
        <div
          className="h-3 rounded-full"
          style={{ width: `${Math.max(pct, spent > 0 ? 2 : 0)}%`, background: FILL[sev === 'warning' ? 'ok' : sev], transition: 'width 600ms cubic-bezier(.2,.8,.2,1)' }}
        />
        {expected > 0 && (
          <div className="absolute -top-1 h-5 w-0.5 rounded-full bg-ink-2" style={{ left: `calc(${pace}% - 1px)` }} aria-hidden="true" />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>₹0</span>
        <span>Even pace today: {formatINR(expected, { decimals: 0 })}</span>
        <span>{formatINR(budget, { decimals: 0 })}</span>
      </div>
    </div>
  );
}
