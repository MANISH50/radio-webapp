import type { Station } from '../api/types';
import { flagEmoji } from '../lib/geo';
import { usePlayer } from '../state/PlayerContext';
import { usePrefs } from '../state/PrefsContext';
import { StationLogo } from './ui';

function StationRow({ station, queue }: { station: Station; queue: Station[] }) {
  const player = usePlayer();
  const { isFavourite, toggleFavourite } = usePrefs();
  const current = player.station?.uuid === station.uuid;
  const playing = current && (player.status === 'playing' || player.status === 'loading');
  const fav = isFavourite(station.uuid);

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border bg-surface p-3 ${current ? 'border-accent' : 'border-line'}`}
      aria-current={current ? 'true' : undefined}
    >
      <StationLogo src={station.logo} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold" title={station.name}>
          {station.name}
        </p>
        <p className="truncate text-sm text-muted">
          {station.countryCode && <span aria-hidden="true">{flagEmoji(station.countryCode)} </span>}
          {[station.country, station.languages.join(', ')].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {(station.codec || station.bitrate > 0) && (
            <span className="rounded bg-raised px-1.5 py-0.5 text-muted">
              {[station.codec, station.bitrate > 0 ? `${station.bitrate} kbps` : ''].filter(Boolean).join(' · ')}
            </span>
          )}
          {!station.https && <span className="rounded border border-warn px-1.5 py-0.5 font-medium text-warn">HTTP only</span>}
          {station.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full border border-line px-2 py-0.5 text-muted">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 sm:flex-row">
        <button
          type="button"
          onClick={() => toggleFavourite(station)}
          aria-pressed={fav}
          aria-label={fav ? `Remove ${station.name} from favourites` : `Add ${station.name} to favourites`}
          className="flex size-10 items-center justify-center rounded-full text-xl text-muted hover:bg-raised"
        >
          <span aria-hidden="true" className={fav ? 'text-accent' : ''}>
            {fav ? '★' : '☆'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => (current ? player.toggle() : player.play(station, queue))}
          aria-label={playing ? `Pause ${station.name}` : `Play ${station.name}`}
          className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg"
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </button>
      </div>
    </li>
  );
}

export function StationList({ stations, label }: { stations: Station[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-3 lg:grid-cols-2">
      {stations.map((s) => (
        <StationRow key={s.uuid} station={s} queue={stations} />
      ))}
    </ul>
  );
}
