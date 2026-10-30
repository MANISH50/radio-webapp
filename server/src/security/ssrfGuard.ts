import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import zlib from 'node:zlib';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const BLOCKED_V6: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (can embed private IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
];

const blockList = new BlockList();
for (const [net, prefix] of BLOCKED_V4) blockList.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of BLOCKED_V6) blockList.addSubnet(net, prefix, 'ipv6');

/** Canonical IPv6 text (e.g. "::ffff:7f00:1"), or null if unparseable. */
function canonicalV6(addr: string): string | null {
  try {
    return new URL(`http://[${addr}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** True for anything that is not a public unicast address (unparseable input is blocked). */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = isIP(addr);
  if (family === 4) return blockList.check(addr, 'ipv4');
  if (family !== 6) return true;
  const canonical = canonicalV6(addr);
  if (!canonical) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d) addresses are
  // judged by their embedded IPv4 address. (BlockList itself maps IPv4 checks onto
  // ::ffff:0:0/96, so that range cannot simply be listed.)
  const mapped = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return blockList.check(canonical, 'ipv6');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
type BaseLookup = (hostname: string, options: dns.LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  /** Overall deadline for each hop, in ms. */
  timeoutMs?: number;
  /** Maximum decoded body size in bytes. */
  maxBytes?: number;
  maxRedirects?: number;
  /** Hostname allowlist, checked on the first request and on every redirect. */
  allowHost?: (hostname: string) => boolean;
  /** Disables the private-range check. Only for tests against loopback fixtures. */
  allowPrivate?: boolean;
  /** Injectable for tests. */
  isBlocked?: (ip: string) => boolean;
  /** Injectable DNS resolver for tests; defaults to dns.lookup. */
  lookup?: BaseLookup;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function blockedFn(opts: SafeFetchOptions): (ip: string) => boolean {
  if (opts.allowPrivate) return () => false;
  return opts.isBlocked ?? isBlockedIp;
}

/** Validates scheme, credentials, host allowlist and literal-IP targets. */
export function assertSafeUrl(raw: string, opts: SafeFetchOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('Scheme not allowed');
  if (url.username || url.password) throw new SsrfError('Credentials in URL not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new SsrfError('Missing host');
  if (opts.allowHost && !opts.allowHost(host)) throw new SsrfError('Host not allowed');
  // IP literals bypass DNS lookup entirely, so they must be checked here.
  if (isIP(host) && blockedFn(opts)(host)) throw new SsrfError('Address not allowed');
  return url;
}

/**
 * DNS lookup that rejects private addresses. Running the check inside the socket's own
 * lookup means the address that is validated is the address that is connected to,
 * which closes the DNS-rebinding window between "check" and "use".
 */
function guardedLookup(opts: SafeFetchOptions): LookupFunction {
  const base: BaseLookup = opts.lookup ?? (dns.lookup as unknown as BaseLookup);
  const blocked = blockedFn(opts);
  const lookup = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    base(hostname, { family: options.family ?? 0, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      if (!addresses?.length) return callback(new SsrfError('Host did not resolve'), []);
      if (addresses.some((a) => blocked(a.address))) {
        return callback(new SsrfError('Resolved address not allowed'), []);
      }
      if (options.all) return callback(null, addresses);
      const first = addresses[0]!;
      return callback(null, first.address, first.family);
    });
  };
  return lookup as unknown as LookupFunction;
}

function requestOnce(url: URL, opts: Required<Pick<SafeFetchOptions, 'timeoutMs' | 'maxBytes'>> & SafeFetchOptions): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { 'accept-encoding': 'gzip', ...opts.headers },
        lookup: guardedLookup(opts),
        agent: false,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECTS.has(status)) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0), url: url.toString() });
          return;
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          req.destroy(new SsrfError('Response too large'));
          return;
        }
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBytes) {
            req.destroy(new SsrfError('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: url.toString() }));
        stream.on('error', reject);
      },
    );
    const deadline = setTimeout(() => req.destroy(new SsrfError('Request timed out')), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new SsrfError('Request timed out')));
    req.on('error', reject);
    req.on('close', () => clearTimeout(deadline));
    req.end();
  });
}

/**
 * Outbound HTTP for the backend: http(s) only, no credentials, optional host allowlist,
 * private/loopback/link-local/metadata ranges blocked at connect time, every redirect
 * re-validated, per-hop timeout and a maximum response size.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const opts = { timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 3, ...options };
  let url = assertSafeUrl(rawUrl, opts);
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, opts);
    const location = res.headers.location;
    if (!REDIRECTS.has(res.status) || !location) return res;
    if (hop >= opts.maxRedirects) throw new SsrfError('Too many redirects');
    url = assertSafeUrl(new URL(location, url).toString(), opts);
  }
}
