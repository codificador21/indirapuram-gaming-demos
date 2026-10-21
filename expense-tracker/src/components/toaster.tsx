'use client';

import { useEffect, useState } from 'react';

type Toast = { id: number; text: string; tone: 'ok' | 'error' };

/** Fire-and-forget toasts: toast('Saved') from any client component. */
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  window.dispatchEvent(new CustomEvent<Omit<Toast, 'id'>>('app-toast', { detail: { text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<Omit<Toast, 'id'>>).detail;
      const id = ++n;
      setItems((cur) => [...cur.slice(-2), { id, ...detail }]);
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 2600);
    };
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),12px)]">
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-fade pointer-events-auto max-w-sm rounded-full px-4 py-2 text-sm font-medium shadow-lg ring-1 ring-line ${
            t.tone === 'error' ? 'bg-critical-soft text-critical-ink' : 'bg-surface-3 text-ink'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
