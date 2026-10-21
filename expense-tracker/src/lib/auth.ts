import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';
import { SESSION_COOKIE, verifySessionToken } from './session';

/** Constant-time string comparison (hash first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Checks `Authorization: Bearer <INGEST_TOKEN>`. */
export function hasValidIngestToken(request: Request): boolean {
  const expected = env().INGEST_TOKEN;
  if (!expected || expected.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return !!m && safeEqual(m[1]!.trim(), expected);
}

export async function isLoggedIn(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Use at the top of every server action (proxy.ts also guards pages; this is defence in depth). */
export async function requireSession(): Promise<void> {
  if (!(await isLoggedIn())) redirect('/login');
}

// ── Login throttling (in-memory; single instance) ─────────────────────────────
const failures: number[] = [];
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function loginLocked(): boolean {
  const now = Date.now();
  while (failures.length && now - failures[0]! > WINDOW_MS) failures.shift();
  return failures.length >= MAX_FAILURES;
}

export function recordLoginFailure() {
  failures.push(Date.now());
}

export function checkPassword(candidate: string): boolean {
  const expected = env().APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}
