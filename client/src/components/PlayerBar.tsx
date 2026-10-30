import { flagEmoji } from '../lib/geo';
import { href } from '../lib/router';
import { usePlayer } from '../state/PlayerContext';
import { usePrefs } from '../state/PrefsContext';
import { StationLogo } from './ui';

const STATUS_TEXT = {
  idle: '',
  loading: 'Connecting…',
  playing: 'Live',
  paused: 'Paused',
  error: 'Stream error',
} as const;

const ctrl =
  'flex size-10 items-center justify-center rounded-full text-lg hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed';
const ctrlLarge =
  'flex size-14 items-center justify-center rounded-full text-2xl hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed';

/** Star toggle for the station that is currently loaded in the player. */
export function FavouriteButton({ large = false }: { large?: boolean }) {
  const { station } = usePlayer();
  const { isFavourite, toggleFavourite } = usePrefs();
  if (!station) return null;
  const fav = isFavourite(station.uuid);
  return (
    <button
      type="button"
      onClick={() => toggleFavourite(station)}
      aria-pressed={fav}
      aria-label={fav ? `Remove ${station.name} from favourites` : `Add ${station.name} to favourites`}
      className={`${large ? ctrlLarge : ctrl} text-muted`}
    >
      <span aria-hidden="true" className={fav ? 'text-accent' : ''}>
        {fav ? '★' : '☆'}
      </span>
    </button>
  );
}

export function TransportControls({ large = false }: { large?: boolean }) {
  const p = usePlayer();
  const isPlaying = p.status === 'playing' || p.status === 'loading';
  const side = large ? ctrlLarge : ctrl;
  return (
    <div className={`flex items-center ${large ? 'gap-4' : 'gap-1'}`}>
      <button type="button" className={side} onClick={p.prev} disabled={!p.hasPrev} aria-label="Previous station">
        <span aria-hidden="true">⏮</span>
      </button>
      <button
        type="button"
        onClick={p.toggle}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={`flex items-center justify-center rounded-full bg-accent text-accent-fg ${large ? 'size-20 text-3xl' : 'size-12 text-lg'}`}
      >
        <span aria-hidden="true">{isPlaying ? '❚❚' : '▶'}</span>
      </button>
      <button type="button" className={side} onClick={p.next} disabled={!p.hasNext} aria-label="Next station">
        <span aria-hidden="true">⏭</span>
      </button>
    </div>
  );
}

export function VolumeControl() {
  const p = usePlayer();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={ctrl}
        onClick={p.toggleMute}
        aria-pressed={p.muted}
        aria-label={p.muted ? 'Unmute' : 'Mute'}
      >
        <span aria-hidden="true">{p.muted || p.volume === 0 ? '🔇' : '🔊'}</span>
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={p.muted ? 0 : Math.round(p.volume * 100)}
        onChange={(e) => p.setVolume(Number(e.target.value) / 100)}
        aria-label="Volume"
        aria-valuetext={`${p.muted ? 0 : Math.round(p.volume * 100)} percent`}
        className="w-24 accent-[var(--ww-accent)] sm:w-32"
      />
    </div>
  );
}

export function PlayerStatus({ className = '' }: { className?: string }) {
  const p = usePlayer();
  return (
    <p className={`text-xs ${className}`} role="status" aria-live="polite">
      {p.status === 'error' ? (
        <span className="text-danger">
          {p.error}{' '}
          {p.hasNext && (
            <button type="button" onClick={p.next} className="font-semibold underline">
              Try the next station
            </button>
          )}
        </span>
      ) : (
        <span className="text-muted">{STATUS_TEXT[p.status]}</span>
      )}
    </p>
  );
}

/** Persistent bottom player. It lives outside the routed views so playback survives navigation. */
export function PlayerBar() {
  const s = usePlayer().station;
  const nowPlaying = href({ name: 'nowPlaying' });

  return (
    <section
      aria-label="Player"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        {!s ? (
          <p className="py-2 text-sm text-muted">Pick a station to start listening.</p>
        ) : (
          <>
            <a href={nowPlaying} aria-label="Open now playing" className="rounded-lg hover:ring-2 hover:ring-accent">
              <StationLogo src={s.logo} className="size-12" />
            </a>
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">Now playing</p>
              <a href={nowPlaying} tabIndex={-1} className="block truncate font-semibold hover:underline" title={s.name}>
                {s.name}
              </a>
              <p className="truncate text-xs text-muted">
                {s.countryCode && <span aria-hidden="true">{flagEmoji(s.countryCode)} </span>}
                {[s.country, s.codec && `${s.codec}${s.bitrate ? ` ${s.bitrate} kbps` : ''}`, s.tags.slice(0, 3).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            <FavouriteButton />
            <TransportControls />
            <VolumeControl />
            <PlayerStatus className="w-full sm:w-auto" />
          </>
        )}
      </div>
    </section>
  );
}
