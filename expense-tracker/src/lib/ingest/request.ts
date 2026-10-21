/**
 * Lenient parsing of webhook payloads. iOS Shortcuts users will build these by hand, so accept a few
 * field-name variants and date formats rather than failing.
 */
import { z } from 'zod';
import { findDate, findTime } from '@/lib/parser/dates';
import { zonedTimeToUtc, DEFAULT_TIMEZONE } from '@/lib/time';

const MAX_TEXT = 5000;

/**
 * Accepts: ISO 8601, epoch seconds/milliseconds, or the formats Shortcuts produces by default
 * ("21 Oct 2026 at 2:35 PM", "21/10/26, 14:35", "October 21, 2026 at 2:35 PM").
 * Falls back to `now` for anything missing, unreadable or more than a day in the future.
 */
export function parseReceivedAt(value: unknown, now = new Date(), tz = DEFAULT_TIMEZONE): Date {
  let d: Date | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === 'string' && value.trim()) {
    const s = value.trim();
    if (/^\d{10,13}$/.test(s)) d = new Date(Number(s) < 1e12 ? Number(s) * 1000 : Number(s));
    else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      // No offset → wall time in the app timezone (new Date() would use the server's zone).
      const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s);
      d = local
        ? zonedTimeToUtc(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] ?? 0), tz)
        : new Date(s);
    }
    else {
      const found = findDate(s);
      if (found) {
        const t = found.hour !== undefined ? { hour: found.hour, minute: found.minute ?? 0, second: found.second ?? 0 } : findTime(s);
        d = zonedTimeToUtc(found.year, found.month, found.day, t?.hour ?? 12, t?.minute ?? 0, t?.second ?? 0, tz);
      }
    }
  }
  if (!d || Number.isNaN(d.getTime())) return now;
  if (d.getTime() - now.getTime() > 24 * 3600_000) return now;
  return d;
}

const smsSchema = z
  .object({
    text: z.string().optional(),
    message: z.string().optional(),
    body: z.string().optional(),
    content: z.string().optional(),
    sender: z.string().max(200).optional().nullable(),
    from: z.string().max(200).optional().nullable(),
    receivedAt: z.union([z.string(), z.number()]).optional().nullable(),
    received_at: z.union([z.string(), z.number()]).optional().nullable(),
    date: z.union([z.string(), z.number()]).optional().nullable(),
  })
  .passthrough();

export interface SmsPayload {
  text: string;
  sender: string | null;
  receivedAt: Date;
}

export function parseSmsPayload(raw: unknown, tz?: string): { ok: true; value: SmsPayload } | { ok: false; error: string } {
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return { ok: false, error: 'Empty body' };
    return { ok: true, value: { text: text.slice(0, MAX_TEXT), sender: null, receivedAt: new Date() } };
  }
  const parsed = smsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Body must be JSON: { "text": "...", "sender": "...", "receivedAt": "..." }' };
  const p = parsed.data;
  const text = (p.text ?? p.message ?? p.body ?? p.content ?? '').trim();
  if (!text) return { ok: false, error: 'Missing "text"' };
  if (text.length > MAX_TEXT) return { ok: false, error: `"text" is longer than ${MAX_TEXT} characters` };
  return {
    ok: true,
    value: {
      text,
      sender: (p.sender ?? p.from ?? null)?.trim() || null,
      receivedAt: parseReceivedAt(p.receivedAt ?? p.received_at ?? p.date, new Date(), tz),
    },
  };
}
