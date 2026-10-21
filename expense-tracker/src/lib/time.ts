/**
 * Timezone helpers. The server may run in UTC; every "which day is it" question is answered in
 * APP_TIMEZONE (default Asia/Kolkata) through Intl, never through the process TZ.
 *
 * Day keys are 'YYYY-MM-DD' strings in the app timezone; arithmetic on keys is done in UTC so it is
 * independent of DST/offsets.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(date: Date, tz: string = DEFAULT_TIMEZONE): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? 'Sun'),
  };
}

/** Offset of `tz` from UTC at the given instant, in minutes (IST → +330). */
export function tzOffsetMinutes(date: Date, tz: string = DEFAULT_TIMEZONE): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instant = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - instant) / 60000);
}

/** Converts a wall-clock time in `tz` to the UTC instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  tz: string = DEFAULT_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2 * 60000;
  return new Date(ts);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toDayKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 'YYYY-MM-DD' of the instant in the app timezone. */
export function localDayKey(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = localParts(date, tz);
  return toDayKey(p.year, p.month, p.day);
}

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return toDayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from a to b (b − a). */
export function diffDays(a: string, b: string): number {
  const pa = parseDayKey(a);
  const pb = parseDayKey(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000,
  );
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** UTC instant of local midnight at the start of the day key. */
export function startOfDay(key: string, tz: string = DEFAULT_TIMEZONE): Date {
  const { year, month, day } = parseDayKey(key);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, tz);
}

export function monthKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Oct" / "21 Oct 2025" style label for a day key. */
export function formatDayKey(key: string, opts: { withYear?: boolean; withWeekday?: boolean } = {}): string {
  const { year, month, day } = parseDayKey(key);
  const wd = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const base = `${day} ${MONTHS[month - 1]}${opts.withYear ? ` ${year}` : ''}`;
  return opts.withWeekday ? `${wd}, ${base}` : base;
}

export function monthName(month: number, long = false): string {
  const short = MONTHS[month - 1] ?? '';
  if (!long) return short;
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][
    month - 1
  ]!;
}

/** "2:32 pm" in the app timezone. */
export function formatTime(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = localParts(date, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)} ${p.hour < 12 ? 'am' : 'pm'}`;
}

/** Value for an <input type="datetime-local"> in the app timezone. */
export function toDateTimeLocalValue(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = localParts(date, tz);
  return `${toDayKey(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parses an <input type="datetime-local"> value as app-timezone wall time. */
export function fromDateTimeLocalValue(value: string, tz: string = DEFAULT_TIMEZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), tz);
}
