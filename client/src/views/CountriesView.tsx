import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Continent, Country } from '../api/types';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { flagEmoji, formatCount, localeCountry } from '../lib/geo';
import { href, navigate } from '../lib/router';
import { useAsync } from '../lib/useAsync';

const TABS: Continent[] = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Other'];

function guessTab(countries: Country[]): Continent {
  const code = localeCountry();
  return countries.find((c) => c.code === code)?.continent ?? 'Europe';
}

function CountryGrid({ countries }: { countries: Country[] }) {
  if (!countries.length) return <EmptyState title="No countries match">Try a different spelling.</EmptyState>;
  return (
    <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {countries.map((c) => (
        <li key={c.code}>
          <a
            href={href({ name: 'country', code: c.code })}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 hover:border-accent"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              {flagEmoji(c.code)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block text-xs text-muted">{formatCount(c.stationCount)} stations</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CountriesView() {
  const { data, error, loading, reload } = useAsync(() => api.countries(), []);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Continent | null>(null);
  const [nearMsg, setNearMsg] = useState('');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchId = useId();

  const countries = data ?? [];
  const activeTab = tab ?? (data ? guessTab(data) : 'Europe');
  const tabs = useMemo(() => TABS.filter((t) => countries.some((c) => c.continent === t)), [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (q) return countries.filter((c) => c.name.toLocaleLowerCase().includes(q) || c.code.toLowerCase() === q);
    return countries.filter((c) => c.continent === activeTab);
  }, [countries, query, activeTab]);

  const nearMe = () => {
    const code = localeCountry();
    const match = countries.find((c) => c.code === code);
    if (match) navigate({ name: 'country', code: match.code });
    else setNearMsg("We couldn't work out your country from your browser's language settings. Please pick one below.");
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const target = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : delta ? (i + delta + tabs.length) % tabs.length : -1;
    if (target < 0) return;
    e.preventDefault();
    setTab(tabs[target]!);
    tabRefs.current[target]?.focus();
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <h1 className="text-2xl font-bold sm:text-3xl">Radio from every country</h1>
          <p className="mt-1 text-muted">Choose a country to hear its live stations.</p>
        </div>
        <button
          type="button"
          onClick={nearMe}
          disabled={!data}
          className="rounded-lg border border-line bg-surface px-4 py-2 font-medium hover:border-accent disabled:opacity-50"
        >
          📍 Near me
        </button>
      </div>
      {nearMsg && (
        <p role="status" className="mb-4 text-sm text-muted">
          {nearMsg}
        </p>
      )}

      <label htmlFor={searchId} className="mb-1 block text-sm font-medium">
        Find a country
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value.slice(0, 60))}
        placeholder="e.g. India, Brazil, Japan"
        autoComplete="off"
        className="mb-5 w-full rounded-lg border border-line bg-surface px-3 py-2.5"
      />

      {loading && !data ? (
        <div role="status" aria-label="Loading countries" className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : query.trim() ? (
        <section aria-label="Matching countries">
          <CountryGrid countries={filtered} />
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="Continents" className="mb-4 flex gap-1 overflow-x-auto pb-1">
            {tabs.map((t, i) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${i}`}
                aria-selected={t === activeTab}
                aria-controls="continent-panel"
                tabIndex={t === activeTab ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                  t === activeTab ? 'bg-accent text-accent-fg' : 'border border-line bg-surface text-fg'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="continent-panel" aria-labelledby={`tab-${tabs.indexOf(activeTab)}`}>
            <CountryGrid countries={filtered} />
          </div>
        </>
      )}
    </div>
  );
}
