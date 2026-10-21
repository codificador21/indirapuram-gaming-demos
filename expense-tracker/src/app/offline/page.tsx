import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 text-5xl">📶</div>
      <h1 className="text-xl font-bold">You’re offline</h1>
      <p className="mt-2 text-sm text-ink-2">Your transactions are safe on the server. Reconnect and pull down to refresh.</p>
    </main>
  );
}
