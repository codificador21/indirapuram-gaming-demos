import type { ReactNode } from 'react';
import { BottomNav } from '@/components/bottom-nav';
import { getDb } from '@/db';
import { reviewCount } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const pending = await reviewCount(getDb());
  return (
    <>
      <div className="safe-top mx-auto min-h-dvh w-full max-w-md px-4 pb-32">{children}</div>
      <BottomNav reviewCount={pending} />
    </>
  );
}
