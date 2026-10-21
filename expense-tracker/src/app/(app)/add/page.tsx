import type { Metadata } from 'next';
import { getDb } from '@/db';
import { PageHeader } from '@/components/ui';
import { appTimezone } from '@/lib/env';
import { frequentMerchants, getCategories } from '@/lib/queries';
import { toDateTimeLocalValue } from '@/lib/time';
import { AddForm } from './add-form';

export const metadata: Metadata = { title: 'Add' };

export default async function AddPage() {
  const db = getDb();
  const [categories, merchants] = await Promise.all([getCategories(db), frequentMerchants(db)]);
  return (
    <>
      <PageHeader title="Add transaction" subtitle="Cash, or anything that didn’t come in automatically" />
      <AddForm categories={categories} merchants={merchants} nowLocal={toDateTimeLocalValue(new Date(), appTimezone())} />
    </>
  );
}
