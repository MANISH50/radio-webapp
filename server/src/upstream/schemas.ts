import { z } from 'zod';

// Upstream data is untrusted: every field is type-checked, oversized values are rejected,
// and optional fields fall back to safe defaults instead of failing the whole response.
const text = (max: number) => z.string().max(max).catch('');
const num = z.coerce.number().int().min(0).max(1_000_000_000).catch(0);

export const RawCountry = z.object({
  name: z.string().min(1).max(200),
  iso_3166_1: z.string().regex(/^[A-Za-z]{2}$/),
  stationcount: num,
});
export type RawCountry = z.infer<typeof RawCountry>;

export const RawStation = z.object({
  stationuuid: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  name: z.string().max(400),
  url: text(4096),
  url_resolved: text(4096),
  homepage: text(4096),
  favicon: text(4096),
  tags: text(2000),
  country: text(200),
  countrycode: text(8),
  language: text(500),
  codec: text(40),
  bitrate: num,
  hls: num,
  lastcheckok: num,
  votes: num,
  clickcount: num,
});
export type RawStation = z.infer<typeof RawStation>;

export const RawClick = z.object({
  ok: z.union([z.boolean(), z.literal('true'), z.literal('false')]).transform((v) => v === true || v === 'true'),
});

/** Top-level array guard; elements are validated one by one so a single bad row is dropped. */
export const RawArray = z.array(z.unknown()).max(50_000);
