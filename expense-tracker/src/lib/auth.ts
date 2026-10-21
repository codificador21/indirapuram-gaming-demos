import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
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

// ── Login throttling (in-memory, per client IP; single instance) ──────────────
// Per IP so a stranger hammering /login can't lock me out from my own phone.
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

/**
 * Client IP as seen by the hosting proxy. Uses the right-most X-Forwarded-For entry (the one the
 * platform's proxy appended); left-most entries can be forged by the client.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? 'unknown';
  return h.get('x-real-ip') ?? 'unknown';
}

function recent(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

export function loginLocked(ip: string): boolean {
  return recent(ip).length >= MAX_FAILURES;
}

export function recordLoginFailure(ip: string) {
  if (failures.size > 10_000) failures.clear(); // bound memory under a spray from many IPs
  failures.set(ip, [...recent(ip), Date.now()]);
}

export function checkPassword(candidate: string): boolean {
  const expected = env().APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}
