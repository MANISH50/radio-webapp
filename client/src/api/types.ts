export type Continent = 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Other';

export interface Country {
  code: string;
  name: string;
  continent: Continent;
  stationCount: number;
}

export interface Station {
  uuid: string;
  name: string;
  streamUrl: string;
  homepage: string | null;
  logo: string | null;
  tags: string[];
  languages: string[];
  country: string;
  countryCode: string;
  codec: string;
  bitrate: number;
  hls: boolean;
  https: boolean;
  votes: number;
  clicks: number;
}

export interface Facets {
  tags: string[];
  languages: string[];
  codecs: string[];
}

export interface StationsMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  facets: Facets;
}

export interface SearchMeta {
  page: number;
  limit: number;
  hasMore: boolean;
}

export type Sort = 'popular' | 'votes' | 'name' | 'bitrate';

export interface StationFilters {
  tag?: string;
  lang?: string;
  codec?: string;
  minBitrate?: number;
  httpsOnly?: boolean;
  sort: Sort;
}

export interface Envelope<T, M = Record<string, unknown> | null> {
  data: T | null;
  meta: M;
  error: { code: string; message: string } | null;
}
