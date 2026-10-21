'use client';

/**
 * Charts (Recharts). Colours come from CSS variables so light/dark mode swap in one place:
 *   --series-1 (blue): spend   ·   --series-2 (orange): budget
 * Both pairs validated for colour-vision deficiency in light and dark (see DECISIONS.md).
 */
import { useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DayPoint } from '@/lib/budget';
import { formatINR, formatINRCompact } from '@/lib/money';
import { formatDayKey, parseDayKey } from '@/lib/time';

const axisTick = { fill: 'var(--muted)', fontSize: 11 };

function Legend({ items }: { items: Array<{ label: string; kind: 'bar' | 'line'; color: string }> }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === 'bar' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          ) : (
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

interface TipRow {
  label: string;
  value: number | null | undefined;
  color: string;
}

function TooltipCard({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2 text-[12px] shadow-lg ring-1 ring-line">
      <div className="mb-1 font-medium text-ink-2">{title}</div>
      {rows
        .filter((r) => r.value !== null && r.value !== undefined)
        .map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: r.color }} />
            <span className="tnum font-semibold text-ink">{formatINR(r.value!, { decimals: 0 })}</span>
            <span className="text-muted">{r.label}</span>
          </div>
        ))}
    </div>
  );
}

type Point = DayPoint & { dayNum: number; bar: number };

// Bars never go below zero: a day where refunds exceed spending shows as ₹0 (the tooltip and table keep the real net figure).
const withDayNum = (series: DayPoint[]): Point[] => series.map((d) => ({ ...d, dayNum: parseDayKey(d.day).day, bar: Math.max(0, d.spent) }));

export function DailyChart({ series }: { series: DayPoint[] }) {
  const [table, setTable] = useState(false);
  const data = withDayNum(series);
  const visible = data.filter((d) => !d.isFuture);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <Legend
          items={[
            { label: 'Spent that day', kind: 'bar', color: 'var(--series-1)' },
            { label: 'Daily budget (with rollover)', kind: 'line', color: 'var(--series-2)' },
          ]}
        />
        <button type="button" onClick={() => setTable((t) => !t)} className="shrink-0 text-[12px] font-medium text-accent-ink">
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <DayTable rows={visible} cols={[['Spent', (d) => d.spent], ['Budget', (d) => d.allowance ?? 0]]} />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
              <XAxis dataKey="dayNum" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINRCompact(v)} width={52} domain={[0, 'auto']} />
              <Tooltip
                cursor={{ fill: 'var(--series-1-wash)' }}
                content={({ active, payload }) => {
                  const d = payload?.[0]?.payload as Point | undefined;
                  if (!active || !d) return null;
                  return (
                    <TooltipCard
                      title={formatDayKey(d.day, { withWeekday: true })}
                      rows={[
                        { label: d.spent < 0 ? 'net (refunds > spend)' : 'spent', value: d.isFuture ? null : d.spent, color: 'var(--series-1)' },
                        { label: 'budget that day', value: d.allowance, color: 'var(--series-2)' },
                        { label: 'fixed daily', value: d.naive, color: 'var(--axis)' },
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="bar" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Line dataKey="allowance" stroke="var(--series-2)" strokeWidth={2} dot={false} type="stepAfter" connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function CumulativeChart({ series }: { series: DayPoint[] }) {
  const [table, setTable] = useState(false);
  const data = withDayNum(series);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <Legend
          items={[
            { label: 'Spent so far', kind: 'line', color: 'var(--series-1)' },
            { label: 'Even pace', kind: 'line', color: 'var(--series-2)' },
          ]}
        />
        <button type="button" onClick={() => setTable((t) => !t)} className="shrink-0 text-[12px] font-medium text-accent-ink">
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <DayTable rows={data.filter((d) => !d.isFuture)} cols={[['Spent so far', (d) => d.cumulativeSpent ?? 0], ['Even pace', (d) => d.cumulativeBudget]]} />
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
              <XAxis dataKey="dayNum" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINRCompact(v)} width={52} />
              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const d = payload?.[0]?.payload as Point | undefined;
                  if (!active || !d) return null;
                  return (
                    <TooltipCard
                      title={formatDayKey(d.day, { withWeekday: true })}
                      rows={[
                        { label: 'spent so far', value: d.cumulativeSpent, color: 'var(--series-1)' },
                        { label: 'even pace', value: d.cumulativeBudget, color: 'var(--series-2)' },
                      ]}
                    />
                  );
                }}
              />
              <Area dataKey="cumulativeSpent" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1-wash)" fillOpacity={1} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
              <Line dataKey="cumulativeBudget" stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function DayTable({ rows, cols }: { rows: Point[]; cols: Array<[string, (d: Point) => number]> }) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-2xl ring-1 ring-line">
      <table className="tnum w-full text-[13px]">
        <thead className="sticky top-0 bg-surface-2 text-left text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Day</th>
            {cols.map(([label]) => (
              <th key={label} className="px-3 py-2 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.day} className="border-t border-line">
              <td className="px-3 py-1.5 text-ink-2">{formatDayKey(d.day, { withWeekday: true })}</td>
              {cols.map(([label, get]) => (
                <td key={label} className="px-3 py-1.5 text-right">
                  {formatINR(get(d), { decimals: 0 })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
