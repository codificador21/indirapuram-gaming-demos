/**
 * Environment access. Values are read lazily so that `next build` and unit tests do not need a
 * fully configured environment. See `.env.example` for documentation of every variable.
 */
import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './time';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: optionalString,
  /** 'require' (TLS, verify cert), 'no-verify' (TLS, accept any cert), or unset (no TLS). */
  DATABASE_SSL: optionalString,
  APP_PASSWORD: optionalString,
  SESSION_SECRET: optionalString,
  INGEST_TOKEN: optionalString,
  APP_TIMEZONE: z.string().optional().default(DEFAULT_TIMEZONE),
  PUBLIC_BASE_URL: optionalString,

  IMAP_HOST: optionalString,
  IMAP_PORT: int(993),
  IMAP_SECURE: bool(true),
  IMAP_USER: optionalString,
  IMAP_PASSWORD: optionalString,
  IMAP_MAILBOX: z.string().optional().default('INBOX'),
  IMAP_POLL_INTERVAL_SECONDS: int(120),
  IMAP_LOOKBACK_DAYS: int(3),
  IMAP_SUBJECT_TAG: z.string().optional().default('[ET-SMS]'),
  IMAP_EXTRA_SENDERS: optionalString,
  IMAP_MARK_SEEN: bool(true),
  IMAP_ONLY_UNSEEN: bool(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = null;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === null || v === '') {
    throw new Error(`Missing required environment variable ${String(key)} — see .env.example`);
  }
  return v as NonNullable<Env[K]>;
}

export function appTimezone(): string {
  return env().APP_TIMEZONE || DEFAULT_TIMEZONE;
}

export function imapConfigured(): boolean {
  const e = env();
  return Boolean(e.IMAP_HOST && e.IMAP_USER && e.IMAP_PASSWORD);
}
