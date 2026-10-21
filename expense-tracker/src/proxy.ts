/**
 * Auth gate (Next.js 16 "proxy", formerly middleware). Every page and server action requires the
 * session cookie, except the login page, token-protected APIs and static PWA assets.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

const PUBLIC_PREFIXES = ['/login', '/api/ingest/', '/api/cron/', '/api/health', '/offline'];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except Next internals and static files (icons, manifest, service worker).
    '/((?!_next/static|_next/image|favicon.ico|icons/|apple-icon|icon|manifest.webmanifest|sw.js|robots.txt).*)',
  ],
};
