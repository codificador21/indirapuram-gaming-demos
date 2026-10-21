/**
 * Integration-test database helper. Uses TEST_DATABASE_URL (default: the docker-compose Postgres,
 * database `expense_test`). If it is unreachable the DB test suites are skipped, not failed.
 */
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Client } from 'pg';
import { createDb, type Db } from '@/db';
import { ensureDefaults } from '@/lib/bootstrap';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://expense:expense@localhost:5432/expense_test';

export async function databaseAvailable(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    console.warn(`⚠ Skipping DB integration tests: cannot connect to ${TEST_DATABASE_URL}`);
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function setupTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await ensureDefaults(db);
  return { db, close: () => pool.end() };
}

export async function resetTestDb(db: Db) {
  await db.execute(sql`truncate raw_messages, transactions, merchant_rules, fixed_commitments, my_accounts, app_state restart identity cascade`);
  await db.execute(sql`update settings set monthly_salary_paise = 0, salary_credit_day = 1, budget_cycle = 'calendar', self_identifiers = '[]'::jsonb`);
}
