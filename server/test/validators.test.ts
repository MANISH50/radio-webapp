import { describe, expect, it } from 'vitest';
import { cleanList, cleanText, safeHttpUrl } from '../src/lib/sanitize.js';
import { CountryParams, SearchQuery, StationParams, StationQuery } from '../src/security/validate.js';
import { toCountries, toStation } from '../src/services/normalize.js';
import type { RawStation } from '../src/upstream/schemas.js';

describe('request validators', () => {
  it('accepts ISO 3166-1 alpha-2 codes and uppercases them', () => {
    expect(CountryParams.parse({ code: 'in' })).toEqual({ code: 'IN' });
  });

  it.each(['IND', 'I', '1N', '../', 'I N', ''])('rejects country code %j', (code) => {
    expect(CountryParams.safeParse({ code }).success).toBe(false);
  });

  it('accepts UUIDs and rejects anything else', () => {
    expect(StationParams.parse({ uuid: '960E57C5-0601-11E8-AE97-52543BE04C81' }).uuid).toBe(
      '960e57c5-0601-11e8-ae97-52543be04c81',
    );
    for (const uuid of ['123', '960e57c5-0601-11e8-ae97-52543be04c8', '../../etc/passwd', '960e57c5_0601_11e8_ae97_52543be04c81']) {
      expect(StationParams.safeParse({ uuid }).success).toBe(false);
    }
  });

  it('applies defaults to station queries', () => {
    expect(StationQuery.parse({})).toEqual({ sort: 'popular', page: 1, limit: 30 });
  });

  it('parses a full station query', () => {
    expect(
      StationQuery.parse({ tag: 'Jazz', lang: 'hindi', codec: 'mp3', minBitrate: '128', httpsOnly: 'true', sort: 'bitrate', page: '2', limit: '50' }),
    ).toEqual({ tag: 'jazz', lang: 'hindi', codec: 'MP3', minBitrate: 128, httpsOnly: true, sort: 'bitrate', page: 2, limit: 50 });
  });

  it.each([
    { limit: '101' },
    { limit: '0' },
    { page: '-1' },
    { page: '1.5' },
    { sort: 'random' },
    { codec: 'mp3;drop' },
    { tag: '<script>' },
    { minBitrate: 'abc' },
    { httpsOnly: 'yes' },
    { tag: ['a', 'b'] },
    { unknown: '1' },
    { page: '30', limit: '100' },
  ])('rejects bad station query %j', (query) => {
    expect(StationQuery.safeParse(query).success).toBe(false);
  });

  it('validates search queries', () => {
    expect(SearchQuery.parse({ q: '  bbc  ' })).toEqual({ q: 'bbc', page: 1, limit: 30 });
    expect(SearchQuery.safeParse({ q: 'a' }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(SearchQuery.safeParse({}).success).toBe(false);
  });
});

describe('sanitisers', () => {
  it('strips control, zero-width and bidi characters', () => {
    expect(cleanText('Radio\u0000 One\u202E\u200B\n  FM', 100)).toBe('Radio One FM');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(42, 10)).toBe('');
  });

  it('splits lists, lowercases and deduplicates', () => {
    expect(cleanList('Pop, ROCK,pop,,  jazz ', 5, 20)).toEqual(['pop', 'rock', 'jazz']);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.org/a', 'https://user:pw@x.org/', 'not a url', ''])(
    'rejects unsafe URL %j',
    (url) => {
      expect(safeHttpUrl(url)).toBeNull();
    },
  );

  it('accepts and normalises http(s) URLs', () => {
    expect(safeHttpUrl(' https://Stream.Example.com/live ')).toBe('https://stream.example.com/live');
  });
});

const raw = (over: Partial<RawStation> = {}): RawStation => ({
  stationuuid: '960e57c5-0601-11e8-ae97-52543be04c81',
  name: 'Test FM',
  url: 'https://s.example.com/live',
  url_resolved: '',
  homepage: 'https://example.com',
  favicon: 'http://example.com/logo.png',
  tags: 'news,talk',
  country: 'India',
  countrycode: 'IN',
  language: 'hindi',
  codec: 'mp3',
  bitrate: 128,
  hls: 0,
  lastcheckok: 1,
  votes: 3,
  clickcount: 9,
  ...over,
});

describe('upstream normalisation', () => {
  it('hides broken stations and unsafe stream URLs', () => {
    expect(toStation(raw({ lastcheckok: 0 }), true)).toBeNull();
    expect(toStation(raw({ url: 'javascript:alert(1)' }), true)).toBeNull();
    expect(toStation(raw({ name: '\u202E' }), true)).toBeNull();
  });

  it('drops HTTP streams and logos unless HTTP is enabled', () => {
    expect(toStation(raw({ url: 'http://s.example.com/live' }), false)).toBeNull();
    expect(toStation(raw(), false)?.logo).toBeNull();
    expect(toStation(raw(), true)?.logo).toBe('http://example.com/logo.png');
  });

  it('detects HLS and produces the client shape', () => {
    const s = toStation(raw({ url_resolved: 'https://s.example.com/x.m3u8?t=1' }), false);
    expect(s).toMatchObject({ hls: true, https: true, codec: 'MP3', tags: ['news', 'talk'], countryCode: 'IN' });
  });

  it('merges duplicate countries and assigns continents', () => {
    const countries = toCountries([
      { name: 'India', iso_3166_1: 'IN', stationcount: 2 },
      { name: 'India', iso_3166_1: 'in', stationcount: 3 },
      { name: 'Nowhere', iso_3166_1: 'ZZ', stationcount: 0 },
    ]);
    expect(countries).toEqual([{ code: 'IN', name: 'India', continent: 'Asia', stationCount: 5 }]);
  });
});
