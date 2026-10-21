/**
 * Applies SQL migrations from ./drizzle and creates default rows.
 * Usage: npm run db:migrate   (also used as the pre-deploy command in production)
 */
import { loadEnvConfig } from '@next/env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';

loadEnvConfig(process.cwd());

async function main() {
  const { createDb } = await import('../src/db');
  const { ensureDefaults } = await import('../src/lib/bootstrap');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
    await ensureDefaults(db);
    console.log('✔ migrations applied, defaults ensured');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
