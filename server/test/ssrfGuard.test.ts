import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSafeUrl, isBlockedIp, safeFetch, SsrfError } from '../src/security/ssrfGuard.js';

describe('isBlockedIp', () => {
  it.each([
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe('assertSafeUrl', () => {
  it.each([
    'file:///etc/passwd',
    'gopher://x.org/',
    'ftp://x.org/',
    'http://user:pass@example.com/',
    'http://127.0.0.1/',
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f000001/', // hex 127.0.0.1
    'http://0177.0.0.1/', // octal 127.0.0.1
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertSafeUrl(url)).toThrow(SsrfError);
  });

  it('enforces the host allowlist', () => {
    const allowHost = (h: string) => h.endsWith('.api.radio-browser.info');
    expect(() => assertSafeUrl('https://de1.api.radio-browser.info/json', { allowHost })).not.toThrow();
    expect(() => assertSafeUrl('https://evil.example/json', { allowHost })).toThrow(SsrfError);
  });
});

describe('safeFetch', () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/ok') return res.end('hello');
      if (url === '/to-metadata') return res.writeHead(302, { location: 'http://metadata.internal/latest' }).end();
      if (url === '/to-private-literal') return res.writeHead(301, { location: 'http://10.0.0.5/' }).end();
      if (url === '/to-other-host') return res.writeHead(302, { location: `http://other.test:${port}/ok` }).end();
      if (url === '/to-ok') return res.writeHead(307, { location: '/ok' }).end();
      if (url === '/loop') return res.writeHead(302, { location: '/loop' }).end();
      if (url === '/big') return res.end(Buffer.alloc(4096, 1));
      if (url === '/slow') return setTimeout(() => res.end('late'), 2000);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  // Test DNS: "*.test" names resolve to the loopback fixture, metadata.internal to the
  // cloud metadata address. Loopback is treated as public here so the fixture is reachable.
  const lookup = (host: string, _o: unknown, cb: (e: NodeJS.ErrnoException | null, a: { address: string; family: number }[]) => void) => {
    if (host.endsWith('.test')) return cb(null, [{ address: '127.0.0.1', family: 4 }]);
    if (host === 'metadata.internal') return cb(null, [{ address: '169.254.169.254', family: 4 }]);
    return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  };
  const opts = () => ({ lookup, isBlocked: (ip: string) => ip !== '127.0.0.1' && isBlockedIp(ip), timeoutMs: 1000 });
  const base = () => `http://public.test:${port}`;

  it('fetches an allowed URL', async () => {
    const res = await safeFetch(`${base()}/ok`, opts());
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('hello');
  });

  it('blocks hostnames that resolve to private addresses (default policy)', async () => {
    await expect(safeFetch(`${base()}/ok`, { lookup })).rejects.toThrow(SsrfError);
  });

  it('re-checks the resolved IP on redirect (metadata endpoint)', async () => {
    await expect(safeFetch(`${base()}/to-metadata`, opts())).rejects.toThrow(/not allowed/);
  });

  it('re-checks literal IPs on redirect', async () => {
    await expect(safeFetch(`${base()}/to-private-literal`, opts())).rejects.toThrow(SsrfError);
  });

  it('re-checks the host allowlist on redirect', async () => {
    const allowHost = (h: string) => h === 'public.test';
    await expect(safeFetch(`${base()}/to-other-host`, { ...opts(), allowHost })).rejects.toThrow(/Host not allowed/);
  });

  it('follows safe relative redirects', async () => {
    const res = await safeFetch(`${base()}/to-ok`, opts());
    expect(res.body.toString()).toBe('hello');
  });

  it('caps the number of redirects', async () => {
    await expect(safeFetch(`${base()}/loop`, { ...opts(), maxRedirects: 2 })).rejects.toThrow(/Too many redirects/);
  });

  it('enforces the maximum response size', async () => {
    await expect(safeFetch(`${base()}/big`, { ...opts(), maxBytes: 1024 })).rejects.toThrow(/too large/);
  });

  it('enforces the timeout', async () => {
    await expect(safeFetch(`${base()}/slow`, { ...opts(), timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });
});
