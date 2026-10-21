/**
 * Session cookie: a short HS256 JWT signed with SESSION_SECRET. Kept dependency-light so it can run
 * in `proxy.ts` as well as in server code.
 */
import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'et_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array | null {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) return null;
  return new TextEncoder().encode(s);
}

export async function createSessionToken(): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error('SESSION_SECRET must be set (32+ characters) — see .env.example');
  return new SignJWT({ sub: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  const key = secretKey();
  if (!token || !key) return false;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload.sub === 'owner';
  } catch {
    return false;
  }
}
