import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db';
import { categories, settings } from '@/db/schema';
import { DEFAULT_CATEGORIES } from './categories';

/** Idempotently creates built-in categories and the settings row. Safe to run on every deploy. */
export async function ensureDefaults(db: DbOrTx) {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: (i + 1) * 10 })))
    .onConflictDoUpdate({
      target: categories.id,
      // Keep any name/emoji/colour I customised; only fill in kind + order.
      set: { kind: sql`excluded.kind`, sortOrder: sql`excluded.sort_order` },
    });
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
}
