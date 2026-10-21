/**
 * Email poller worker — a separate long-running process.
 *
 *   npm run worker        # poll every IMAP_POLL_INTERVAL_SECONDS until stopped
 *   npm run poll:once     # one cycle, then exit (for cron-style schedulers)
 *
 * Exits cleanly (code 0) when IMAP isn't configured, so a deployment without email still works.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const once = process.argv.includes('--once');
  const { getDb, closeDb } = await import('../db');
  const { env } = await import('../lib/env');
  const { imapConfigFromEnv, pollMailboxOnce, summaryText } = await import('../lib/email/poller');

  const cfg = imapConfigFromEnv();
  if (!cfg) {
    console.log('[email] IMAP_HOST / IMAP_USER / IMAP_PASSWORD not set — email polling is disabled. Exiting.');
    return;
  }
  const db = getDb();
  const interval = Math.max(30, env().IMAP_POLL_INTERVAL_SECONDS) * 1000;
  console.log(`[email] polling ${cfg.user} / ${cfg.mailbox} on ${cfg.host}${once ? ' once' : ` every ${interval / 1000}s`}`);

  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let failures = 0;
  do {
    const started = Date.now();
    try {
      const s = await pollMailboxOnce(db, cfg);
      failures = 0;
      console.log(`[email] ${new Date().toISOString()} ${summaryText(s)}`);
    } catch (err) {
      failures += 1;
      console.error(`[email] poll failed (${failures}):`, err instanceof Error ? err.message : err);
      if (once) process.exitCode = 1;
    }
    if (once || stopping) break;
    // Back off on repeated failures (wrong password, server down): up to 15 minutes.
    const wait = failures ? Math.min(interval * 2 ** failures, 15 * 60_000) : Math.max(5_000, interval - (Date.now() - started));
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, wait);
    });
  } while (!stopping);

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
