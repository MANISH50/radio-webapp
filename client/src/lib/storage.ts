import type { Station } from '../api/types';

/** localStorage can be missing, full, or throw (private mode, blocked storage). */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: personalisation just won't persist */
  }
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const strings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, max).map((s) => s.slice(0, 40)) : [];

/** Re-validates stations read back from storage: it is user-editable, so treat it as untrusted. */
export function sanitizeStoredStations(value: unknown, max: number): Station[] {
  if (!Array.isArray(value)) return [];
  const out: Station[] = [];
  for (const v of value as Array<Record<string, unknown>>) {
    if (!v || typeof v !== 'object') continue;
    if (typeof v.uuid !== 'string' || !UUID.test(v.uuid) || typeof v.name !== 'string' || !isHttpUrl(v.streamUrl)) continue;
    out.push({
      uuid: v.uuid,
      name: v.name.slice(0, 120),
      streamUrl: v.streamUrl,
      homepage: isHttpUrl(v.homepage) ? v.homepage : null,
      logo: isHttpUrl(v.logo) ? v.logo : null,
      tags: strings(v.tags, 8),
      languages: strings(v.languages, 4),
      country: typeof v.country === 'string' ? v.country.slice(0, 80) : '',
      countryCode: typeof v.countryCode === 'string' && /^[A-Z]{2}$/.test(v.countryCode) ? v.countryCode : '',
      codec: typeof v.codec === 'string' ? v.codec.slice(0, 16) : '',
      bitrate: typeof v.bitrate === 'number' ? v.bitrate : 0,
      hls: v.hls === true,
      https: v.streamUrl.startsWith('https:'),
      votes: typeof v.votes === 'number' ? v.votes : 0,
      clicks: typeof v.clicks === 'number' ? v.clicks : 0,
    });
    if (out.length >= max) break;
  }
  return out;
}
