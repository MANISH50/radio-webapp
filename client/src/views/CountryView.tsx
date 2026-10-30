import { useEffect, useId, useState } from 'react';
import { api } from '../api/client';
import type { Facets, Sort, StationFilters } from '../api/types';
import { StationList } from '../components/StationList';
import { EmptyState, ErrorState, ListSkeleton, Pagination } from '../components/ui';
import { flagEmoji } from '../lib/geo';
import { href } from '../lib/router';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 30;
const SORTS: Array<[Sort, string]> = [
  ['popular', 'Most played'],
  ['votes', 'Most voted'],
  ['name', 'Name (A–Z)'],
  ['bitrate', 'Highest bitrate'],
];
const BITRATES = [0, 64, 128, 192, 320];

function defaultFilters(): StationFilters {
  // On an HTTPS page, HTTP-only streams are blocked as mixed content, so hide them by default.
  return { sort: 'popular', httpsOnly: window.location.protocol === 'https:' };
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-2 text-sm">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterBar({ filters, facets, onChange }: { filters: StationFilters; facets?: Facets; onChange: (f: StationFilters) => void }) {
  const httpsId = useId();
  const any = (list: string[] = []): Array<[string, string]> => [['', 'Any'], ...list.map((v): [string, string] => [v, v])];
  return (
    <fieldset className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6">
      <legend className="sr-only">Filter and sort stations</legend>
      <Select label="Sort by" value={filters.sort} onChange={(v) => onChange({ ...filters, sort: v as Sort })} options={SORTS} />
      <Select label="Genre" value={filters.tag ?? ''} onChange={(v) => onChange({ ...filters, tag: v || undefined })} options={any(facets?.tags)} />
      <Select label="Language" value={filters.lang ?? ''} onChange={(v) => onChange({ ...filters, lang: v || undefined })} options={any(facets?.languages)} />
      <Select label="Codec" value={filters.codec ?? ''} onChange={(v) => onChange({ ...filters, codec: v || undefined })} options={any(facets?.codecs)} />
      <Select
        label="Min bitrate"
        value={String(filters.minBitrate ?? 0)}
        onChange={(v) => onChange({ ...filters, minBitrate: Number(v) || undefined })}
        options={BITRATES.map((b): [string, string] => [String(b), b ? `${b} kbps` : 'Any'])}
      />
      <div className="flex items-end gap-2 pb-2">
        <input
          id={httpsId}
          type="checkbox"
          checked={Boolean(filters.httpsOnly)}
          onChange={(e) => onChange({ ...filters, httpsOnly: e.target.checked })}
          className="size-4 accent-[var(--ww-accent)]"
        />
        <label htmlFor={httpsId} className="text-sm">
          HTTPS only
        </label>
      </div>
    </fieldset>
  );
}

export function CountryView({ code }: { code: string }) {
  const [filters, setFilters] = useState<StationFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const countries = useAsync(() => api.countries(), []);
  const country = countries.data?.find((c) => c.code === code);

  useEffect(() => {
    setFilters(defaultFilters());
    setPage(1);
  }, [code]);

  const { data, error, loading, reload } = useAsync(
    (signal) => api.countryStations(code, filters, page, PAGE_SIZE, signal),
    [code, filters, page],
  );
  const stations = data?.data ?? [];
  const meta = data?.meta;
  const name = country?.name ?? code;

  return (
    <div>
      <a href={href({ name: 'home' })} className="text-sm font-medium text-accent underline-offset-4 hover:underline">
        ← All countries
      </a>
      <h1 className="mb-1 mt-2 text-2xl font-bold sm:text-3xl">
        <span aria-hidden="true">{flagEmoji(code)} </span>
        {name}
      </h1>
      <p className="mb-5 text-muted" aria-live="polite">
        {meta ? `${meta.total} station${meta.total === 1 ? '' : 's'} available` : ' '}
      </p>

      <FilterBar
        filters={filters}
        facets={meta?.facets}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      />

      {loading && !data ? (
        <ListSkeleton label="Loading stations" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : stations.length === 0 ? (
        <EmptyState title="No stations found">Try removing some filters.</EmptyState>
      ) : (
        <div aria-busy={loading}>
          <StationList stations={stations} label={`Stations in ${name}`} />
          <Pagination page={page} totalPages={meta?.totalPages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
