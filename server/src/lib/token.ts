import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Session token lifetime (15 minutes). */
export const TOKEN_TTL_SEC = 15 * 60;
/** Tokens closer than this to expiry are silently re-issued on the next API call. */
export const ROTATE_BEFORE_SEC = 3 * 60;
/** Absolute session lifetime; after this a fresh session (new sid and CSRF token) is required. */
export const MAX_SESSION_SEC = 12 * 60 * 60;

export interface SessionToken {
  /** Random session id, also the per-token rate-limit key and CSRF binding. */
  sid: string;
  /** Session start (unix seconds); survives rotation. */
  sst: number;
  iat: number;
  exp: number;
}

const PayloadSchema = z.object({
  v: z.literal(1),
  sid: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  sst: z.number().int().nonnegative(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

const mac = (data: string, secret: Buffer) => createHmac('sha256', secret).update(data).digest();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function signToken(payload: SessionToken, secret: Buffer): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...payload })).toString('base64url');
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

/** Returns the payload of a well-formed, correctly signed, unexpired token; otherwise null. */
export function verifyToken(token: unknown, secret: Buffer, nowMs = Date.now()): SessionToken | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = mac(body, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) return null;

  const { sid, sst, iat, exp } = parsed.data;
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || iat > now + 60 || exp - iat > TOKEN_TTL_SEC) return null;
  return { sid, sst, iat, exp };
}

export interface IssuedSession {
  token: string;
  csrf: string;
  payload: SessionToken;
}

/** Issues a token; pass an existing sid/sst to rotate without changing the session identity. */
export function issueSession(
  secret: Buffer,
  existing?: Pick<SessionToken, 'sid' | 'sst'>,
  nowMs = Date.now(),
): IssuedSession {
  const now = Math.floor(nowMs / 1000);
  const payload: SessionToken = {
    sid: existing?.sid ?? randomBytes(24).toString('base64url'),
    sst: existing?.sst ?? now,
    iat: now,
    exp: now + TOKEN_TTL_SEC,
  };
  return { token: signToken(payload, secret), csrf: csrfFor(payload.sid, secret), payload };
}

/** CSRF token bound to the session id ("signed double-submit"). */
export function csrfFor(sid: string, secret: Buffer): string {
  return mac(`csrf:${sid}`, secret).toString('base64url');
}

/** Keyed hash so logs and rate-limit keys never contain raw IP addresses. */
export function hashIp(ip: string, secret: Buffer): string {
  return mac(`ip:${ip}`, secret).toString('base64url').slice(0, 16);
}
