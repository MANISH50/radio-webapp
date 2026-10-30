import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'country'; code: string }
  | { name: 'search'; q: string }
  | { name: 'favourites' }
  | { name: 'recent' }
  | { name: 'nowPlaying' };

/** Hash routes keep the server a static file host: #/country/IN, #/search/jazz, ... */
export function parseHash(hash: string): Route {
  const [, section = '', arg = ''] = hash.replace(/^#/, '').split('/');
  if (section === 'country' && /^[A-Za-z]{2}$/.test(arg)) return { name: 'country', code: arg.toUpperCase() };
  if (section === 'search') {
    let q = '';
    try {
      q = decodeURIComponent(arg).slice(0, 100);
    } catch {
      /* malformed escape */
    }
    return { name: 'search', q };
  }
  if (section === 'favourites') return { name: 'favourites' };
  if (section === 'recent') return { name: 'recent' };
  if (section === 'now-playing') return { name: 'nowPlaying' };
  return { name: 'home' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'country':
      return `#/country/${route.code}`;
    case 'search':
      return `#/search/${encodeURIComponent(route.q)}`;
    case 'favourites':
      return '#/favourites';
    case 'recent':
      return '#/recent';
    case 'nowPlaying':
      return '#/now-playing';
    default:
      return '#/';
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
