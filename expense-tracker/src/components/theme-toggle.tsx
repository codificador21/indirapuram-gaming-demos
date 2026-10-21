'use client';

import { useState } from 'react';
import { MoonIcon, SunIcon } from './icons';
import { THEME_COLORS, THEME_COOKIE, type Theme } from '@/lib/theme';

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function ThemeToggle({ initial, withLabel = false }: { initial: Theme; withLabel?: boolean }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className="inline-flex items-center gap-2 rounded-full p-2 text-ink-2 hover:bg-surface-2 active:scale-95"
      aria-label={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <SunIcon size={20} /> : <MoonIcon size={20} />}
      {withLabel && <span className="text-sm">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
