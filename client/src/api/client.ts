import type { Country, Envelope, SearchMeta, Station, StationFilters, StationsMeta } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ROTATE_EARLY_MS = 2 * 60 * 1000;

let csrfToken: string | null = null;
let bootstrapping: Promise<void> | null = null;
let refreshTimer: number | undefined;

function scheduleRefresh(expiresAt: number): void {
  window.clearTimeout(refreshTimer);
  const delay = Math.max(5_000, expiresAt - Date.now() - ROTATE_EARLY_MS);
  refreshTimer = window.setTimeout(() => {
    void startSession().catch(() => undefined);
  }, delay);
}

function friendlyMessage(status: number, body: Envelope<unknown, unknown> | null, retryAfter: string | null): string {
  if (status === 429) return `You're going a bit fast. Please try again in ${retryAfter ?? 'a few'} seconds.`;
  if (status >= 500) return 'The station directory is having trouble right now. Please try again shortly.';
  return body?.error?.message ?? 'Something went wrong.';
}

async function readEnvelope<T, M>(res: Response): Promise<Envelope<T, M> | null> {
  try {
    return (await res.json()) as Envelope<T, M>;
  } catch {
    return null;
  }
}

/**
 * Fetches (or rotates) the session. The server sets the HttpOnly session cookie; we only
 * keep the CSRF token, which is useless without that cookie.
 */
export function startSession(): Promise<void> {
  bootstrapping ??= (async () => {
    const res = await fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const body = await readEnvelope<{ csrfToken: string; expiresAt: number }, null>(res);
    if (!res.ok || !body?.data) {
      throw new ApiError(res.status, body?.error?.code ?? 'SESSION', friendlyMessage(res.status, body, res.headers.get('Retry-After')));
    }
    csrfToken = body.data.csrfToken;
    scheduleRefresh(body.data.expiresAt);
  })().finally(() => {
    bootstrapping = null;
  });
  return bootstrapping;
}

async function request<T, M>(path: string, init: { method?: 'GET' | 'POST'; signal?: AbortSignal } = {}, retried = false): Promise<{ data: T; meta: M }> {
  if (!csrfToken) await startSession();
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', signal: init.signal });
  const rotated = Number(res.headers.get('X-Session-Expires'));
  if (rotated > Date.now()) scheduleRefresh(rotated);

  // Expired or missing session (e.g. tab slept past expiry): get a new one and retry once.
  if ((res.status === 401 || (res.status === 403 && method !== 'GET')) && !retried) {
    csrfToken = null;
    await startSession();
    return request<T, M>(path, init, true);
  }

  const body = await readEnvelope<T, M>(res);
  if (!res.ok || !body || body.data === null) {
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', friendlyMessage(res.status, body, res.headers.get('Retry-After')));
  }
  return { data: body.data, meta: body.meta };
}

let countriesPromise: Promise<Country[]> | null = null;

export const api = {
  /** Cached for the page's lifetime; the server and browser cache it too. */
  countries(): Promise<Country[]> {
    countriesPromise ??= request<Country[], unknown>('/countries').then(
      (r) => r.data,
      (err: unknown) => {
        countriesPromise = null;
        throw err;
      },
    );
    return countriesPromise;
  },

  countryStations(code: string, filters: StationFilters, page: number, limit: number, signal?: AbortSignal) {
    const qs = new URLSearchParams({ sort: filters.sort, page: String(page), limit: String(limit) });
    if (filters.tag) qs.set('tag', filters.tag);
    if (filters.lang) qs.set('lang', filters.lang);
    if (filters.codec) qs.set('codec', filters.codec);
    if (filters.minBitrate) qs.set('minBitrate', String(filters.minBitrate));
    if (filters.httpsOnly) qs.set('httpsOnly', 'true');
    return request<Station[], StationsMeta>(`/countries/${encodeURIComponent(code)}/stations?${qs}`, { signal });
  },

  search(q: string, page: number, limit: number, signal?: AbortSignal) {
    const qs = new URLSearchParams({ q, page: String(page), limit: String(limit) });
    return request<Station[], SearchMeta>(`/stations/search?${qs}`, { signal });
  },

  reportClick(uuid: string): Promise<void> {
    return request<{ counted: boolean }, null>(`/stations/${encodeURIComponent(uuid)}/click`, { method: 'POST' }).then(
      () => undefined,
    );
  },
};
