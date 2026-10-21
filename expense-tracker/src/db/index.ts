import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { env, requireEnv } from '@/lib/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** A Db or an open transaction — both expose the same query API. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function poolConfig(connectionString: string, ssl = env().DATABASE_SSL): PoolConfig {
  const config: PoolConfig = { connectionString, max: 5, idleTimeoutMillis: 30_000 };
  if (ssl === 'require') config.ssl = { rejectUnauthorized: true };
  if (ssl === 'no-verify') config.ssl = { rejectUnauthorized: false };
  return config;
}

export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool(poolConfig(connectionString));
  return { db: drizzle(pool, { schema }), pool };
}

// One pool per process; survive Next dev-server hot reloads.
const globalForDb = globalThis as unknown as { __expenseDb?: { db: Db; pool: Pool } };

export function getDb(): Db {
  if (!globalForDb.__expenseDb) {
    globalForDb.__expenseDb = createDb(requireEnv('DATABASE_URL'));
  }
  return globalForDb.__expenseDb.db;
}

export async function closeDb() {
  if (globalForDb.__expenseDb) {
    await globalForDb.__expenseDb.pool.end();
    globalForDb.__expenseDb = undefined;
  }
}

export { schema };
