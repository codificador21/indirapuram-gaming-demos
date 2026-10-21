import 'server-only';
import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme } from './theme';

export async function currentTheme(): Promise<Theme> {
  const store = await cookies();
  return store.get(THEME_COOKIE)?.value === 'light' ? 'light' : 'dark';
}
