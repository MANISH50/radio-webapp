import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Station } from '../api/types';
import { readJson, sanitizeStoredStations, writeJson } from '../lib/storage';

export type Theme = 'system' | 'light' | 'dark';

const KEYS = { favourites: 'ww.favourites', recent: 'ww.recent', theme: 'ww.theme' } as const;
const MAX_FAVOURITES = 200;
const MAX_RECENT = 20;

interface Prefs {
  favourites: Station[];
  recent: Station[];
  theme: Theme;
  isFavourite: (uuid: string) => boolean;
  toggleFavourite: (station: Station) => void;
  addRecent: (station: Station) => void;
  clearRecent: () => void;
  setTheme: (theme: Theme) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

function readTheme(): Theme {
  const t = readJson<unknown>(KEYS.theme, 'system');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [favourites, setFavourites] = useState(() => sanitizeStoredStations(readJson(KEYS.favourites, []), MAX_FAVOURITES));
  const [recent, setRecent] = useState(() => sanitizeStoredStations(readJson(KEYS.recent, []), MAX_RECENT));
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => writeJson(KEYS.favourites, favourites), [favourites]);
  useEffect(() => writeJson(KEYS.recent, recent), [recent]);
  useEffect(() => {
    writeJson(KEYS.theme, theme);
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const favouriteIds = useMemo(() => new Set(favourites.map((s) => s.uuid)), [favourites]);
  const isFavourite = useCallback((uuid: string) => favouriteIds.has(uuid), [favouriteIds]);

  const toggleFavourite = useCallback((station: Station) => {
    setFavourites((list) =>
      list.some((s) => s.uuid === station.uuid)
        ? list.filter((s) => s.uuid !== station.uuid)
        : [station, ...list].slice(0, MAX_FAVOURITES),
    );
  }, []);

  const addRecent = useCallback((station: Station) => {
    setRecent((list) => [station, ...list.filter((s) => s.uuid !== station.uuid)].slice(0, MAX_RECENT));
  }, []);

  const value = useMemo<Prefs>(
    () => ({
      favourites,
      recent,
      theme,
      isFavourite,
      toggleFavourite,
      addRecent,
      clearRecent: () => setRecent([]),
      setTheme: setThemeState,
    }),
    [favourites, recent, theme, isFavourite, toggleFavourite, addRecent],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider');
  return ctx;
}
