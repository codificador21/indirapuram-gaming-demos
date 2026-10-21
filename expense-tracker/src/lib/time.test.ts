import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInMonth,
  diffDays,
  formatDayKey,
  formatTime,
  fromDateTimeLocalValue,
  localDayKey,
  startOfDay,
  toDateTimeLocalValue,
  tzOffsetMinutes,
  zonedTimeToUtc,
} from './time';

describe('time helpers (Asia/Kolkata)', () => {
  it('knows IST is UTC+5:30', () => {
    expect(tzOffsetMinutes(new Date('2026-10-21T00:00:00Z'))).toBe(330);
  });

  it('converts IST wall time to UTC', () => {
    expect(zonedTimeToUtc(2026, 10, 21, 14, 32, 10).toISOString()).toBe('2026-10-21T09:02:10.000Z');
    expect(zonedTimeToUtc(2026, 10, 1, 0, 0, 0).toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('computes the local day, not the UTC day', () => {
    // 20:00 UTC on the 21st is already the 22nd in India.
    expect(localDayKey(new Date('2026-10-21T20:00:00Z'))).toBe('2026-10-22');
    expect(localDayKey(new Date('2026-10-21T18:29:59Z'))).toBe('2026-10-21');
    expect(startOfDay('2026-10-22').toISOString()).toBe('2026-10-21T18:30:00.000Z');
  });

  it('does day arithmetic on keys', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-01', '2026-10-21')).toBe(20);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(31);
  });

  it('formats for display and inputs', () => {
    expect(formatDayKey('2026-10-21', { withWeekday: true })).toBe('Wed, 21 Oct');
    expect(formatTime(new Date('2026-10-21T09:02:10Z'))).toBe('2:32 pm');
    expect(toDateTimeLocalValue(new Date('2026-10-21T09:02:10Z'))).toBe('2026-10-21T14:32');
    expect(fromDateTimeLocalValue('2026-10-21T14:32')?.toISOString()).toBe('2026-10-21T09:02:00.000Z');
    expect(fromDateTimeLocalValue('garbage')).toBeNull();
  });

  it('works for other time zones too', () => {
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, 0, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });
});
