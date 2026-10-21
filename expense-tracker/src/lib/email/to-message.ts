/**
 * Converts an email (from IMAP or an email webhook) into pipeline input:
 * - subject contains IMAP_SUBJECT_TAG → it is an SMS forwarded by the iOS Shortcut fallback
 * - From is a known bank / UPI-app alert address → bank alert email
 * - anything else → skipped (left untouched in the mailbox)
 */
import { isKnownAlertSender } from '@/lib/parser/banks';
import type { IngestInput } from '@/lib/ingest/pipeline';

export interface EmailLike {
  from: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  messageId?: string | null;
  date?: Date | null;
}

export interface EmailFilter {
  subjectTag: string;
  extraSenders: string[];
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", ndash: '–', mdash: '—', bull: '•', middot: '·', rupee: '₹' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extracts the bare address from `"HDFC Bank" <alerts@hdfcbank.net>`. */
export function emailAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1]! : from).trim().toLowerCase();
}

/**
 * Body of a forwarded SMS. The Shortcut sends:
 *   Subject: [ET-SMS] <sender>
 *   Body:    Sender: <sender>\n<message text>
 * Also tolerates a plain body, "From:" instead of "Sender:", and a "Sent from my iPhone" footer.
 */
export function unwrapForwardedSms(body: string, subject: string, tag: string): { sender: string | null; text: string } {
  let text = body.replace(/\r\n?/g, '\n');
  let sender: string | null = null;
  const line = /^\s*(?:sender|from)\s*:\s*(.+)$/im.exec(text);
  if (line && line.index < 200) {
    sender = line[1]!.trim();
    text = text.slice(0, line.index) + text.slice(line.index + line[0].length);
  }
  if (!sender) {
    const fromSubject = subject.replace(tag, '').trim();
    if (fromSubject && fromSubject.length <= 30) sender = fromSubject;
  }
  text = text
    .replace(/\n*(sent from my iphone|sent from my ipad|sent from mail for ios)\s*$/i, '')
    .replace(/^-+\s*forwarded message\s*-+$/im, '')
    .trim();
  return { sender, text };
}

export type EmailDecision = { kind: 'ingest'; input: IngestInput } | { kind: 'skip'; reason: 'unknown_sender' | 'empty' };

export function emailToIngestInput(mail: EmailLike, filter: EmailFilter, via = 'imap'): EmailDecision {
  const subject = mail.subject ?? '';
  const body = (mail.text && mail.text.trim()) || (mail.html ? htmlToText(mail.html) : '');
  const receivedAt = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : new Date();
  const externalId = mail.messageId?.trim() || null;

  if (filter.subjectTag && subject.toLowerCase().includes(filter.subjectTag.toLowerCase())) {
    const { sender, text } = unwrapForwardedSms(body, subject, filter.subjectTag);
    if (!text) return { kind: 'skip', reason: 'empty' };
    return { kind: 'ingest', input: { source: 'sms', via: `${via}-forwarded-sms`, sender, subject, body: text, receivedAt, externalId } };
  }

  const from = emailAddress(mail.from);
  if (!isKnownAlertSender(from, filter.extraSenders)) return { kind: 'skip', reason: 'unknown_sender' };
  if (!body) return { kind: 'skip', reason: 'empty' };
  return { kind: 'ingest', input: { source: 'email', via, sender: from, subject, body, receivedAt, externalId } };
}
