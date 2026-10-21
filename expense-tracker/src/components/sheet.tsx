'use client';

import { useEffect, type ReactNode } from 'react';
import { XIcon } from './icons';

/** Bottom sheet modal. Closes on backdrop tap and Escape; locks page scroll while open. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="animate-fade absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="animate-sheet safe-bottom relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[28px] bg-surface ring-1 ring-line">
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <div className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-surface-3" />
          <div className="min-w-0 pt-2 text-lg font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="mt-2 rounded-full bg-surface-2 p-1.5 text-ink-2" aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}
