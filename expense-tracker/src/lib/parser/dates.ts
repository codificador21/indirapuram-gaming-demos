import { DEFAULT_TIMEZONE, localParts, zonedTimeToUtc } from '@/lib/time';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*';
const TIME = String.raw`(?:[\s,:T]+(?:at\s+)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm)?(?:\s*(?:hrs|ist))?)?`;

interface DateMatch {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  index: number;
}

function year4(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

function withTime(base: Omit<DateMatch, 'hour' | 'minute' | 'second'>, h?: string, mi?: string, s?: string, ampm?: string): DateMatch {
  if (h === undefined || mi === undefined) return base;
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.toLowerCase() === 'pm';
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return { ...base, hour, minute: Number(mi), second: s ? Number(s) : 0 };
}

function valid(d: DateMatch): boolean {
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31 || d.year < 2000 || d.year > 2099) return false;
  if (d.hour !== undefined && (d.hour > 23 || (d.minute ?? 0) > 59 || (d.second ?? 0) > 59)) return false;
  return true;
}

/** Finds the first plausible date (optionally with time) in the text. */
export function findDate(text: string): DateMatch | null {
  const candidates: DateMatch[] = [];
  const push = (d: DateMatch) => valid(d) && candidates.push(d);

  // 2026-10-21:14:32:10 / 2026-10-21 14:32
  for (const m of text.matchAll(new RegExp(String.raw`\b(\d{4})-(\d{2})-(\d{2})${TIME}`, 'gi'))) {
    push(withTime({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), index: m.index }, m[4], m[5], m[6], m[7]));
  }
  // 21-10-26 / 21/10/2026 / 21.10.26 (day first — Indian banks never use month-first)
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\d/-])(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?![\d/-])${TIME}`, 'gi'))) {
    push(withTime({ day: Number(m[1]), month: Number(m[3]), year: year4(m[4]!), index: m.index }, m[5], m[6], m[7], m[8]));
  }
  // 21Oct26 / 21-Oct-26 / 21-OCT-2026 / 21 Oct 2026
  for (const m of text.matchAll(new RegExp(String.raw`(?<!\d)(\d{1,2})[-\s]?${MON}[-\s,]?\s?'?(\d{4}|\d{2})(?!\d)${TIME}`, 'gi'))) {
    push(withTime({ day: Number(m[1]), month: MONTHS[m[2]!.toLowerCase()]!, year: year4(m[3]!), index: m.index }, m[4], m[5], m[6], m[7]));
  }
  // Oct 21, 2026 / October 21 2026
  for (const m of text.matchAll(new RegExp(String.raw`\b${MON}\s+(\d{1,2}),?\s+(\d{4})${TIME}`, 'gi'))) {
    push(withTime({ month: MONTHS[m[1]!.toLowerCase()]!, day: Number(m[2]), year: Number(m[3]), index: m.index }, m[4], m[5], m[6], m[7]));
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0]!;
}

/** A bare time like 14:32:10 / 02:15 PM anywhere in the text (used when the date has no time). */
export function findTime(text: string): { hour: number; minute: number; second: number } | null {
  const m = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!m) return null;
  const d = withTime({ year: 2000, month: 1, day: 1, index: 0 }, m[1], m[2], m[3], m[4]);
  if (!valid(d) || d.hour === undefined) return null;
  return { hour: d.hour, minute: d.minute ?? 0, second: d.second ?? 0 };
}

export interface ResolvedDate {
  date: Date;
  source: 'message' | 'message_date' | 'received';
}

const DAY = 86_400_000;

/**
 * Resolves the transaction time:
 * - full date+time in the message → that time (in the app timezone)
 * - date only → the receive time if it is the same local day, otherwise noon on that day
 * - nothing usable, or a date that is implausible (in the future, or > 60 days before receipt) → receive time
 */
export function resolveOccurredAt(text: string, receivedAt: Date, tz: string = DEFAULT_TIMEZONE): ResolvedDate {
  const found = findDate(text);
  if (!found) return { date: receivedAt, source: 'received' };

  let { hour, minute, second } = found;
  if (hour === undefined) {
    const t = findTime(text.slice(found.index));
    if (t) ({ hour, minute, second } = t);
  }

  let date: Date;
  let source: ResolvedDate['source'];
  if (hour !== undefined) {
    date = zonedTimeToUtc(found.year, found.month, found.day, hour, minute ?? 0, second ?? 0, tz);
    source = 'message';
  } else {
    const r = localParts(receivedAt, tz);
    if (r.year === found.year && r.month === found.month && r.day === found.day) {
      return { date: receivedAt, source: 'message_date' };
    }
    date = zonedTimeToUtc(found.year, found.month, found.day, 12, 0, 0, tz);
    source = 'message_date';
  }

  const delta = date.getTime() - receivedAt.getTime();
  // Allow small clock skew into the future (the bank's clock vs the phone's), but not days.
  if (delta > 6 * 3600_000 || delta < -60 * DAY) return { date: receivedAt, source: 'received' };
  // A date-only match that lands after receipt (noon today but received in the morning) → receipt time.
  if (source === 'message_date' && delta > 0) return { date: receivedAt, source };
  return { date, source };
}
