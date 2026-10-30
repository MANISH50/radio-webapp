import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { UpstreamError } from '../src/lib/errors.js';
import { MemoryRateStore } from '../src/security/rateLimit.js';
import type { Catalog } from '../src/services/catalog.js';
import type { Station } from '../src/services/normalize.js';

const ORIGIN = 'http://localhost:5173';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const UUID = '960e57c5-0601-11e8-ae97-52543be04c81';

const station: Station = {
  uuid: UUID,
  name: 'Test FM',
  streamUrl: 'https://s.example.com/live',
  homepage: null,
  logo: null,
  tags: ['news'],
  languages: ['hindi'],
  country: 'India',
  countryCode: 'IN',
  codec: 'MP3',
  bitrate: 128,
  hls: false,
  https: true,
  votes: 1,
  clicks: 2,
};

function fakeCatalog(over: Partial<Catalog> = {}): Catalog {
  return {
    countries: async () => [{ code: 'IN', name: 'India', continent: 'Asia', stationCount: 1 }],
    countryStations: async () => ({ items: [station], total: 1, facets: { tags: ['news'], languages: ['hindi'], codecs: ['MP3'] } }),
    search: async () => ({ items: [station], hasMore: false }),
    click: async () => true,
    ...over,
  };
}

function makeApp(env: Record<string, string> = {}, catalog = fakeCatalog()) {
  const cfg = loadConfig({ NODE_ENV: 'test', ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: 'silent', ...env });
  return createApp({ cfg, logger: pino({ level: 'silent' }), catalog, rateStore: new MemoryRateStore() });
}

/** Browser-like same-origin request headers. */
const browser = (r: request.Test) =>
  r.set('User-Agent', UA).set('Origin', ORIGIN).set('Sec-Fetch-Site', 'same-origin').set('Accept', 'application/json');

async function session(app: ReturnType<typeof makeApp>) {
  const res = await browser(request(app).get('/api/session'));
  expect(res.status).toBe(200);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  // Secure cookies are not replayed over plain http by superagent, so send them by hand.
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  return { cookie, csrf: res.body.data.csrfToken as string, setCookies: cookies };
}

describe('session issuance', () => {
  it('sets HttpOnly; Secure; SameSite=Strict session cookie', async () => {
    const { setCookies, csrf } = await session(makeApp());
    const sess = setCookies.find((c) => c.startsWith('ww_session='));
    expect(sess).toMatch(/HttpOnly/i);
    expect(sess).toMatch(/Secure/i);
    expect(sess).toMatch(/SameSite=Strict/i);
    expect(sess).toMatch(/Max-Age=900/);
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('authorisation', () => {
  it('returns 401 without a token', async () => {
    const res = await browser(request(makeApp()).get('/api/v1/countries'));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ data: null, meta: null, error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });

  it('returns 401 for a forged token', async () => {
    const res = await browser(request(makeApp()).get('/api/v1/countries')).set('Cookie', 'ww_session=eyJ2IjoxfQ.AAAA');
    expect(res.status).toBe(401);
  });

  it('serves data with a valid token', async () => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await browser(request(app).get('/api/v1/countries')).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [{ code: 'IN', name: 'India', continent: 'Asia', stationCount: 1 }],
      meta: { total: 1 },
      error: null,
    });
  });

  it('rejects a token from another server secret', async () => {
    const { cookie } = await session(makeApp({ SESSION_SECRET: 'a'.repeat(40) }));
    const res = await browser(request(makeApp({ SESSION_SECRET: 'b'.repeat(40) })).get('/api/v1/countries')).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

describe('origin enforcement', () => {
  it('returns 403 for a foreign Origin', async () => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await browser(request(app).get('/api/v1/countries')).set('Cookie', cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 403 for cross-site Sec-Fetch-Site', async () => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await request(app)
      .get('/api/v1/countries')
      .set('User-Agent', UA)
      .set('Cookie', cookie)
      .set('Referer', `${ORIGIN}/`)
      .set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(403);
  });

  it('returns 403 for a foreign Referer and for requests with no provenance at all', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/session').set('User-Agent', UA).set('Referer', 'https://evil.example/x')).status).toBe(403);
    expect((await request(app).get('/api/session').set('User-Agent', UA)).status).toBe(403);
  });

  it('refuses CORS preflights from foreign origins', async () => {
    const res = await request(makeApp()).options('/api/v1/countries').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('answers CORS preflights from allowlisted origins', async () => {
    const res = await request(makeApp()).options('/api/v1/countries').set('Origin', ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('blocks obvious automation user agents', async () => {
    const res = await browser(request(makeApp()).get('/api/session')).set('User-Agent', 'python-requests/2.32');
    expect(res.status).toBe(403);
  });
});

describe('CSRF', () => {
  it('rejects POST without the CSRF header', async () => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await browser(request(app).post(`/api/v1/stations/${UUID}/click`)).set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('rejects a CSRF header that does not match the cookie', async () => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await browser(request(app).post(`/api/v1/stations/${UUID}/click`))
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'x'.repeat(43));
    expect(res.status).toBe(403);
  });

  it('accepts POST with a matching CSRF token', async () => {
    const app = makeApp();
    const { cookie, csrf } = await session(app);
    const res = await browser(request(app).post(`/api/v1/stations/${UUID}/click`)).set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ counted: true });
  });
});

describe('input validation', () => {
  it.each([
    '/api/v1/countries/IND/stations',
    '/api/v1/countries/1n/stations',
    '/api/v1/countries/IN/stations?limit=500',
    '/api/v1/countries/IN/stations?sort=random',
    '/api/v1/countries/IN/stations?page=0',
    '/api/v1/countries/IN/stations?page=100&limit=100',
    '/api/v1/countries/IN/stations?evil=1',
    `/api/v1/stations/search?q=${'x'.repeat(101)}`,
    '/api/v1/stations/search?q=a',
    '/api/v1/stations/search',
  ])('returns 400 for %s', async (path) => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await browser(request(app).get(path)).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for a malformed station UUID', async () => {
    const app = makeApp();
    const { cookie, csrf } = await session(app);
    const res = await browser(request(app).post('/api/v1/stations/not-a-uuid/click')).set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
  });

  it('returns paginated stations for valid input', async () => {
    const app = makeApp();
    const { cookie } = await session(app);
    const res = await browser(request(app).get('/api/v1/countries/in/stations?sort=name&limit=10')).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(res.body.data[0].name).toBe('Test FM');
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the per-token read limit is exceeded', async () => {
    const app = makeApp({ RATE_READ_PER_MIN: '3' });
    const { cookie } = await session(app);
    for (let i = 0; i < 3; i++) {
      expect((await browser(request(app).get('/api/v1/countries')).set('Cookie', cookie)).status).toBe(200);
    }
    const res = await browser(request(app).get('/api/v1/countries')).set('Cookie', cookie);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('applies a tighter limit to click reports', async () => {
    const app = makeApp({ RATE_CLICK_PER_MIN: '2' });
    const { cookie, csrf } = await session(app);
    const click = () => browser(request(app).post(`/api/v1/stations/${UUID}/click`)).set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect((await click()).status).toBe(200);
    expect((await click()).status).toBe(200);
    expect((await click()).status).toBe(429);
  });

  it('limits per IP before authentication', async () => {
    const app = makeApp({ RATE_READ_IP_PER_MIN: '2' });
    await browser(request(app).get('/api/v1/countries'));
    await browser(request(app).get('/api/v1/countries'));
    expect((await browser(request(app).get('/api/v1/countries'))).status).toBe(429);
  });
});

describe('operational behaviour', () => {
  it('health leaks no internal details', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' }, meta: null, error: null });
  });

  it('hides upstream failure details', async () => {
    const app = makeApp({}, fakeCatalog({ countries: async () => { throw new UpstreamError('de1 refused at 10.0.0.3'); } }));
    const { cookie } = await session(app);
    const res = await browser(request(app).get('/api/v1/countries')).set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.3|de1/);
  });

  it('hides unexpected error details', async () => {
    const app = makeApp({}, fakeCatalog({ countries: async () => { throw new Error('secret stack info'); } }));
    const { cookie } = await session(app);
    const res = await browser(request(app).get('/api/v1/countries')).set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL', message: 'Something went wrong' });
  });

  it('sends strict security headers', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('redirects HTTP to the configured HTTPS origin in production', async () => {
    const app = makeApp({ NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(40), ALLOWED_ORIGINS: 'https://radio.example' });
    const res = await request(app).get('/some/page?x=1').set('Host', 'attacker.example');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://radio.example/some/page?x=1');
    const hsts = await request(app).get('/api/v1/health');
    expect(hsts.headers['strict-transport-security']).toContain('max-age=63072000');
  });
});
