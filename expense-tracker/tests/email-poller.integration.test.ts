/**
 * Runs the real IMAP poller against an in-memory IMAP server (hoodiecrow) and the test Postgres.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ImapFlow } from 'imapflow';
import type { Db } from '@/db';
import { rawMessages, transactions } from '@/db/schema';
import { pollMailboxOnce, type ImapConfig } from '@/lib/email/poller';
import { fixtureById } from '@/lib/parser/fixtures';
import { databaseAvailable, resetTestDb, setupTestDb } from './helpers/db';

// hoodiecrow ships without types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hoodiecrow = require('hoodiecrow-imap') as (opts: unknown) => { listen: (port: number, cb?: () => void) => void; close: (cb?: () => void) => void; server?: { address(): AddressInfo } } & { address?: () => AddressInfo };

const available = await databaseAvailable();

function imapDate(d: Date) {
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${mon}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

function rawEmail(from: string, subject: string, body: string, messageId: string, date: Date) {
  return [
    `From: ${from}`,
    'To: me@example.com',
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body.replace(/\n/g, '\r\n'),
  ].join('\r\n');
}

function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const now = new Date();
  const hdfc = fixtureById('hdfc-upi-email');
  const axis = fixtureById('axis-upi-debit-sms');
  const server = hoodiecrow({
    plugins: ['ID', 'IDLE', 'ENABLE', 'UNSELECT', 'NAMESPACE', 'SPECIAL-USE', 'LITERALPLUS'],
    storage: {
      INBOX: {
        messages: [
          { raw: rawEmail('"HDFC Bank InstaAlerts" <alerts@hdfcbank.net>', hdfc.subject!, hdfc.text, '<hdfc-1@hdfcbank.net>', now), internaldate: imapDate(now), flags: [] },
          { raw: rawEmail('Deals <newsletter@shop.example>', 'Big sale — Rs 500 off!', 'Flat Rs 500 off. Shop now!', '<promo-1@shop.example>', now), internaldate: imapDate(now), flags: [] },
          { raw: rawEmail('Me <me@icloud.com>', '[ET-SMS] VM-AXISBK', `Sender: VM-AXISBK-S\n${axis.text}\n\nSent from my iPhone`, '<fwd-1@icloud.com>', now), internaldate: imapDate(now), flags: [] },
          { raw: rawEmail('alerts@hdfcbank.net', 'Old alert', 'Rs.99.00 has been debited from account **1234 to VPA x@ybl X on 01-01-26.', '<old-1@hdfcbank.net>', now), internaldate: imapDate(now), flags: ['\\Seen'] },
        ],
      },
    },
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = (server.server?.address?.() ?? server.address?.()) as AddressInfo;
      resolve({ port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

describe.skipIf(!available)('IMAP email poller', () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let imap: { port: number; close: () => Promise<void> };
  let cfg: ImapConfig;

  beforeAll(async () => {
    ({ db, close: closeDb } = await setupTestDb());
  });
  afterAll(async () => closeDb?.());
  beforeEach(async () => {
    await resetTestDb(db);
    imap = await startServer();
    cfg = {
      host: '127.0.0.1',
      port: imap.port,
      secure: false,
      user: 'testuser',
      password: 'testpass',
      mailbox: 'INBOX',
      lookbackDays: 3,
      markSeen: true,
      filter: { subjectTag: '[ET-SMS]', extraSenders: [] },
    };
    return () => imap.close();
  });

  it('ingests bank alerts and tagged forwarded SMS, leaves other mail alone, marks processed as read', async () => {
    const first = await pollMailboxOnce(db, cfg);
    expect(first).toMatchObject({ checked: 3, matched: 2, created: 2, skipped: 1, errors: 0 });

    const txns = await db.select().from(transactions);
    expect(txns.map((t) => t.merchant).sort()).toEqual(['Blinkit', 'Swiggy']);
    const raws = await db.select().from(rawMessages);
    expect(raws.map((r) => [r.via, r.externalId]).sort()).toEqual([
      ['imap', '<hdfc-1@hdfcbank.net>'],
      ['imap-forwarded-sms', '<fwd-1@icloud.com>'],
    ]);
    expect(raws.find((r) => r.via === 'imap-forwarded-sms')).toMatchObject({ source: 'sms', sender: 'VM-AXISBK-S' });

    // The two alerts are now \Seen; only the newsletter is still unread — and untouched.
    const second = await pollMailboxOnce(db, cfg);
    expect(second).toMatchObject({ checked: 1, matched: 0, skipped: 1 });

    const client = new ImapFlow({ host: '127.0.0.1', port: imap.port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const unseen = (await client.search({ seen: false })) || [];
    await client.logout();
    expect(unseen).toHaveLength(1);
  });

  it('never ingests the same email twice even when it stays unread', async () => {
    const noMark = { ...cfg, markSeen: false };
    await pollMailboxOnce(db, noMark);
    const again = await pollMailboxOnce(db, noMark);
    expect(again).toMatchObject({ matched: 2, created: 0, duplicates: 2 });
    expect(await db.select().from(transactions)).toHaveLength(2);
  });

  it('reports a login failure', async () => {
    await expect(pollMailboxOnce(db, { ...cfg, password: 'wrong' })).rejects.toThrow();
  });
});
