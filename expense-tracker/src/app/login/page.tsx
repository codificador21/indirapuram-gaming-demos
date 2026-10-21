import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { APP_NAME } from '@/lib/theme';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await isLoggedIn()) redirect('/');
  const { next } = await searchParams;
  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] bg-accent text-3xl font-bold text-on-accent shadow-lg">₹</div>
        <h1 className="text-2xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-ink-2">Your money, one day at a time.</p>
      </div>
      <LoginForm next={next ?? '/'} />
    </main>
  );
}
