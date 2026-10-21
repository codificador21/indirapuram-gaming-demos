import type { DbOrTx } from '@/db';
import { fixedCommitments, merchantRules, myAccounts, settings } from '@/db/schema';
import type { ClassifyContext } from '@/lib/classify';
import type { RuleLike } from '@/lib/categorise';
import { appTimezone } from '@/lib/env';

export interface IngestContext extends ClassifyContext {
  rules: RuleLike[];
}

/** Loads everything the classifiers need. All tables are tiny (single user). */
export async function loadIngestContext(db: DbOrTx): Promise<IngestContext> {
  // Sequential on purpose: `db` may be a transaction (one connection), which can't run queries in parallel.
  const [s] = await db.select().from(settings).limit(1);
  const rules = await db.select().from(merchantRules);
  const commitments = await db.select().from(fixedCommitments);
  const accounts = await db.select().from(myAccounts);
  return {
    monthlySalaryPaise: s?.monthlySalaryPaise ?? 0,
    salaryCreditDay: s?.salaryCreditDay ?? 1,
    selfIdentifiers: s?.selfIdentifiers ?? [],
    myAccountLast4s: accounts.map((a) => a.last4),
    commitments,
    rules,
    timezone: appTimezone(),
  };
}
