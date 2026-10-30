import { StationList } from '../components/StationList';
import { EmptyState } from '../components/ui';
import { usePrefs } from '../state/PrefsContext';

export function LibraryView({ kind }: { kind: 'favourites' | 'recent' }) {
  const { favourites, recent, clearRecent } = usePrefs();
  const stations = kind === 'favourites' ? favourites : recent;
  const title = kind === 'favourites' ? 'Favourites' : 'Recently played';

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {kind === 'recent' && recent.length > 0 && (
          <button type="button" onClick={clearRecent} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
            Clear history
          </button>
        )}
      </div>
      {stations.length === 0 ? (
        <EmptyState title={kind === 'favourites' ? 'No favourites yet' : 'Nothing played yet'}>
          {kind === 'favourites' ? 'Tap the ☆ next to a station to save it here.' : 'Stations you play will show up here.'}
        </EmptyState>
      ) : (
        <StationList stations={stations} label={title} />
      )}
      <p className="mt-6 text-xs text-muted">Saved only in this browser. Nothing is sent to our servers.</p>
    </div>
  );
}
