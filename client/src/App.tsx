import { type FormEvent, useEffect, useRef, useState } from 'react';
import { PlayerBar } from './components/PlayerBar';
import { href, navigate, type Route, useRoute } from './lib/router';
import { PlayerProvider } from './state/PlayerContext';
import { PrefsProvider, type Theme, usePrefs } from './state/PrefsContext';
import { CountriesView } from './views/CountriesView';
import { CountryView } from './views/CountryView';
import { LibraryView } from './views/LibraryView';
import { NowPlayingView } from './views/NowPlayingView';
import { SearchView } from './views/SearchView';

function ThemeSelect() {
  const { theme, setTheme } = usePrefs();
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">Theme</span>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
        className="rounded-lg border border-line bg-surface px-2 py-1.5"
      >
        <option value="system">System theme</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function SearchForm({ route }: { route: Route }) {
  const [q, setQ] = useState(route.name === 'search' ? route.q : '');
  useEffect(() => {
    if (route.name === 'search') setQ(route.q);
  }, [route]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate({ name: 'search', q: q.trim() });
  };
  return (
    <form role="search" onSubmit={submit} className="flex min-w-0 flex-1 gap-2">
      <label htmlFor="global-search" className="sr-only">
        Search stations in all countries
      </label>
      <input
        id="global-search"
        type="search"
        value={q}
        maxLength={100}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search all stations…"
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5"
      />
      <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
        Search
      </button>
    </form>
  );
}

function Header({ route }: { route: Route }) {
  const link = (to: Route, label: string) => (
    <a
      href={href(to)}
      aria-current={route.name === to.name ? 'page' : undefined}
      className={`rounded-lg px-2 py-1.5 text-sm font-medium ${route.name === to.name ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
    >
      {label}
    </a>
  );
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <a href={href({ name: 'home' })} className="flex items-center gap-2 text-lg font-bold">
          <img src="/favicon.svg" alt="" className="size-7" />
          WorldWave Radio
        </a>
        <nav aria-label="Main" className="flex items-center gap-1">
          {link({ name: 'home' }, 'Countries')}
          {link({ name: 'favourites' }, 'Favourites')}
          {link({ name: 'recent' }, 'Recent')}
        </nav>
        <div className="flex w-full min-w-0 items-center gap-2 md:ml-auto md:w-auto md:flex-1 md:max-w-md">
          <SearchForm route={route} />
        </div>
        <ThemeSelect />
      </div>
    </header>
  );
}

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'country':
      return <CountryView code={route.code} />;
    case 'search':
      return <SearchView q={route.q} />;
    case 'favourites':
    case 'recent':
      return <LibraryView kind={route.name} />;
    case 'nowPlaying':
      return <NowPlayingView />;
    default:
      return <CountriesView />;
  }
}

function Shell() {
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  // The now-playing page carries its own console, so the bottom bar would be a duplicate there.
  const showBar = route.name !== 'nowPlaying';
  return (
    <div className="flex min-h-dvh flex-col">
      <button
        type="button"
        onClick={() => mainRef.current?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-30 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </button>
      <Header route={route} />
      <main ref={mainRef} tabIndex={-1} className={`mx-auto w-full max-w-6xl flex-1 px-4 pt-6 outline-none ${showBar ? 'pb-44 sm:pb-32' : 'pb-12'}`}>
        <View route={route} />
      </main>
      {showBar && <PlayerBar />}
    </div>
  );
}

export function App() {
  return (
    <PrefsProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </PrefsProvider>
  );
}
