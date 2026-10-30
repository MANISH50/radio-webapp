import { FavouriteButton, PlayerStatus, TransportControls, VolumeControl } from '../components/PlayerBar';
import { EmptyState, StationLogo } from '../components/ui';
import { flagEmoji } from '../lib/geo';
import { href } from '../lib/router';
import { usePlayer } from '../state/PlayerContext';

/** Full-page player, opened from the logo in the bottom bar. */
export function NowPlayingView() {
  const s = usePlayer().station;

  if (!s) {
    return (
      <EmptyState title="Nothing playing yet">
        <a href={href({ name: 'home' })} className="font-semibold text-accent underline">
          Pick a country
        </a>{' '}
        to start listening.
      </EmptyState>
    );
  }

  const homepage = s.homepage && /^https?:\/\//i.test(s.homepage) ? s.homepage : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Now playing</p>
      <StationLogo src={s.logo} className="mt-4 size-56 shadow-xl sm:size-72" />
      <h1 className="mt-6 text-2xl font-bold break-words sm:text-3xl">{s.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {s.countryCode && <span aria-hidden="true">{flagEmoji(s.countryCode)} </span>}
        {[s.country, s.languages.join(', ')].filter(Boolean).join(' · ')}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-xs">
        {(s.codec || s.bitrate > 0) && (
          <span className="rounded bg-raised px-1.5 py-0.5 text-muted">
            {[s.codec, s.bitrate > 0 ? `${s.bitrate} kbps` : ''].filter(Boolean).join(' · ')}
          </span>
        )}
        {!s.https && <span className="rounded border border-warn px-1.5 py-0.5 font-medium text-warn">HTTP only</span>}
        {s.tags.slice(0, 6).map((t) => (
          <span key={t} className="rounded-full border border-line px-2 py-0.5 text-muted">
            {t}
          </span>
        ))}
      </div>
      {homepage && (
        <a href={homepage} target="_blank" rel="noopener noreferrer" className="mt-3 text-sm text-accent underline">
          Station website
        </a>
      )}

      <section aria-label="Player controls" className="mt-8 flex w-full flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex items-center gap-4">
          <TransportControls large />
          <FavouriteButton large />
        </div>
        <VolumeControl />
        <PlayerStatus className="min-h-4" />
      </section>
    </div>
  );
}
