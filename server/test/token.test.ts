import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { csrfFor, issueSession, signToken, TOKEN_TTL_SEC, verifyToken } from '../src/lib/token.js';

const secret = randomBytes(32);
const now = Date.UTC(2026, 0, 1);

describe('session tokens', () => {
  it('round-trips a freshly issued token', () => {
    const { token, payload } = issueSession(secret, undefined, now);
    expect(verifyToken(token, secret, now)).toEqual(payload);
    expect(payload.exp - payload.iat).toBe(TOKEN_TTL_SEC);
  });

  it('rejects expired tokens', () => {
    const { token } = issueSession(secret, undefined, now);
    expect(verifyToken(token, secret, now + TOKEN_TTL_SEC * 1000)).toBeNull();
    expect(verifyToken(token, secret, now + TOKEN_TTL_SEC * 1000 - 1000)).not.toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const { token } = issueSession(randomBytes(32), undefined, now);
    expect(verifyToken(token, secret, now)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const { token, payload } = issueSession(secret, undefined, now);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, ...payload, exp: payload.exp + 3600 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, secret, now)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const { token } = issueSession(secret, undefined, now);
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyToken(flipped, secret, now)).toBeNull();
  });

  it('rejects correctly signed tokens with an over-long lifetime', () => {
    const t = Math.floor(now / 1000);
    const token = signToken({ sid: 'a'.repeat(32), sst: t, iat: t, exp: t + 86_400 }, secret);
    expect(verifyToken(token, secret, now)).toBeNull();
  });

  it.each([undefined, '', 'abc', 'a.b.c', 'x'.repeat(600), 42, '!!!.@@@'])('rejects malformed input %j', (bad) => {
    expect(verifyToken(bad, secret, now)).toBeNull();
  });

  it('keeps sid and session start on rotation', () => {
    const first = issueSession(secret, undefined, now);
    const rotated = issueSession(secret, first.payload, now + 600_000);
    expect(rotated.payload.sid).toBe(first.payload.sid);
    expect(rotated.payload.sst).toBe(first.payload.sst);
    expect(rotated.payload.exp).toBeGreaterThan(first.payload.exp);
    expect(rotated.csrf).toBe(first.csrf);
  });

  it('binds CSRF tokens to the session id', () => {
    expect(csrfFor('session-one-aaaaaaaaaaaa', secret)).not.toBe(csrfFor('session-two-aaaaaaaaaaaa', secret));
    expect(csrfFor('session-one-aaaaaaaaaaaa', secret)).toBe(csrfFor('session-one-aaaaaaaaaaaa', secret));
  });
});
