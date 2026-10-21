/**
 * Sends a sample bank SMS to the webhook, exactly like the iOS Shortcut would. Use it to check a
 * deployment before setting up the phone.
 *
 *   npm run ingest:sample                                   # → http://localhost:3000, a random SMS fixture
 *   npm run ingest:sample -- https://your-app.up.railway.app
 *   npm run ingest:sample -- https://your-app.up.railway.app hdfc-upi-sent-sms
 *   npm run ingest:sample -- --list                         # list fixture ids
 *
 * Reads INGEST_TOKEN from the environment / .env.
 */
import { loadEnvConfig } from '@next/env';
import { FIXTURES } from '../src/lib/parser/fixtures';

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const f of FIXTURES) console.log(`${f.id.padEnd(34)} ${f.expect.status}`);
    return;
  }
  const url = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:3000').replace(/\/$/, '');
  const id = args.find((a) => !/^https?:\/\//.test(a));
  const smsFixtures = FIXTURES.filter((f) => f.source === 'sms');
  const fx = id ? FIXTURES.find((f) => f.id === id) : smsFixtures[Math.floor(Math.random() * smsFixtures.length)];
  if (!fx) throw new Error(`Unknown fixture "${id}". Use --list.`);
  const token = process.env.INGEST_TOKEN;
  if (!token) throw new Error('INGEST_TOKEN is not set (see .env.example)');

  // Make the text unique so repeated runs aren't treated as the same message.
  const text = fx.text.replace(/\b(\d{12})\b/, () => `6${String(Date.now()).slice(-11)}`);
  console.log(`POST ${url}/api/ingest/sms  (${fx.id})\n${text}\n`);
  const res = await fetch(`${url}/api/ingest/sms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sender: fx.sender }),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
