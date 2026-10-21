import { describe, expect, it } from 'vitest';
import { parseReceivedAt, parseSmsPayload } from '@/lib/ingest/request';
import { emailAddress, emailToIngestInput, htmlToText, unwrapForwardedSms } from './to-message';

const filter = { subjectTag: '[ET-SMS]', extraSenders: ['@mybank.example'] };

describe('emailToIngestInput', () => {
  it('accepts known bank senders as email alerts', () => {
    const d = emailToIngestInput(
      { from: '"HDFC Bank InstaAlerts" <alerts@hdfcbank.net>', subject: 'UPI txn', text: 'Rs.250.00 has been debited…', messageId: '<a@b>', date: new Date('2026-10-21T09:00:00Z') },
      filter,
    );
    expect(d).toMatchObject({ kind: 'ingest', input: { source: 'email', sender: 'alerts@hdfcbank.net', externalId: '<a@b>', via: 'imap' } });
  });

  it('skips unknown senders (leaves my other mail alone)', () => {
    expect(emailToIngestInput({ from: 'newsletter@shop.example', subject: 'Sale!', text: 'Rs 500 off' }, filter)).toEqual({ kind: 'skip', reason: 'unknown_sender' });
    expect(emailToIngestInput({ from: 'alerts@mybank.example', text: 'INR 10 debited from A/c XX1' }, filter).kind).toBe('ingest');
  });

  it('treats tagged subjects as forwarded SMS, extracting the sender line', () => {
    const d = emailToIngestInput(
      { from: 'me@icloud.com', subject: '[ET-SMS] VM-HDFCBK', text: 'Sender: VM-HDFCBK\nSent Rs.85.00\nFrom HDFC Bank A/C *1234\nTo RAPIDO\n\nSent from my iPhone' },
      filter,
    );
    expect(d).toMatchObject({ kind: 'ingest', input: { source: 'sms', sender: 'VM-HDFCBK', via: 'imap-forwarded-sms', body: 'Sent Rs.85.00\nFrom HDFC Bank A/C *1234\nTo RAPIDO' } });
  });

  it('falls back to HTML when there is no text part', () => {
    const d = emailToIngestInput({ from: 'alerts@axisbank.com', html: '<p>Dear Customer,</p><p>INR&nbsp;799.00 at <b>ZOMATO</b> &#8377;</p>' }, filter);
    expect(d.kind === 'ingest' && d.input.body).toBe('Dear Customer,\nINR 799.00 at ZOMATO ₹');
  });

  it('helpers', () => {
    expect(emailAddress('Kotak <BankAlerts@kotak.com>')).toBe('bankalerts@kotak.com');
    expect(htmlToText('<style>x{}</style><table><tr><td>A</td><td>B</td></tr></table>')).toBe('A B');
    expect(unwrapForwardedSms('Rs 10 debited', '[ET-SMS] AD-SBIUPI', '[ET-SMS]')).toEqual({ sender: 'AD-SBIUPI', text: 'Rs 10 debited' });
  });
});

describe('SMS webhook payload', () => {
  const now = new Date('2026-10-21T09:05:00Z');

  it('accepts the documented JSON shape and field aliases', () => {
    expect(parseSmsPayload({ text: ' Sent Rs.5 ', sender: 'VM-HDFCBK', receivedAt: '2026-10-21T14:30:00+05:30' })).toEqual({
      ok: true,
      value: { text: 'Sent Rs.5', sender: 'VM-HDFCBK', receivedAt: new Date('2026-10-21T09:00:00Z') },
    });
    const alias = parseSmsPayload({ message: 'Sent Rs.5', from: 'X' });
    expect(alias.ok && alias.value.sender).toBe('X');
  });

  it('accepts a plain-text body', () => {
    const p = parseSmsPayload('Sent Rs.5 To X');
    expect(p.ok && p.value.text).toBe('Sent Rs.5 To X');
  });

  it('rejects empty or oversized text', () => {
    expect(parseSmsPayload({ text: '' }).ok).toBe(false);
    expect(parseSmsPayload({}).ok).toBe(false);
    expect(parseSmsPayload({ text: 'x'.repeat(6000) }).ok).toBe(false);
    expect(parseSmsPayload(42).ok).toBe(false);
  });

  it.each([
    ['2026-10-21T14:30:00+05:30', '2026-10-21T09:00:00.000Z'],
    ['2026-10-21T14:30:00', '2026-10-21T09:00:00.000Z'], // no offset → India time, not server time
    ['2026-10-21T08:30:00.000Z', '2026-10-21T08:30:00.000Z'],
    [1792575000, '2026-10-21T09:30:00.000Z'],
    ['1792575000000', '2026-10-21T09:30:00.000Z'],
    ['21 Oct 2026 at 2:30 PM', '2026-10-21T09:00:00.000Z'],
    ['21/10/26, 14:30', '2026-10-21T09:00:00.000Z'],
    ['October 21, 2026 at 2:30 PM', '2026-10-21T09:00:00.000Z'],
    ['garbage', now.toISOString()],
    [null, now.toISOString()],
    ['2027-01-01T00:00:00Z', now.toISOString()], // far future → now
  ])('receivedAt %j → %s', (input, expected) => {
    expect(parseReceivedAt(input, now).toISOString()).toBe(expected);
  });
});
