'use client';

/** iOS-style switch. Uses role="switch" + aria-checked so it's announced correctly. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span
        className={`inline-block h-[27px] w-[27px] rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
      />
    </button>
  );
}
