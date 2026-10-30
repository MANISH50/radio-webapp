import type Hls from 'hls.js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Station } from '../api/types';
import { readJson, writeJson } from '../lib/storage';
import { usePrefs } from './PrefsContext';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface Player {
  station: Station | null;
  status: PlayerStatus;
  error: string | null;
  volume: number;
  muted: boolean;
  queue: Station[];
  hasNext: boolean;
  hasPrev: boolean;
  play: (station: Station, queue?: Station[]) => void;
  toggle: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
}

const PlayerContext = createContext<Player | null>(null);

const STREAM_FAILED = "This station isn't responding right now.";
const MIXED_CONTENT = 'This station only streams over plain HTTP, which your browser blocks on secure pages.';

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const loadToken = useRef(0);
  const reported = useRef(new Set<string>());
  const { addRecent } = usePrefs();

  const [station, setStation] = useState<Station | null>(null);
  const [queue, setQueue] = useState<Station[]>([]);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(() => {
    const v = readJson<unknown>('ww.volume', 0.8);
    return typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.8;
  });
  const [muted, setMuted] = useState(false);

  const fail = useCallback((message = STREAM_FAILED) => {
    setStatus('error');
    setError(message);
  }, []);

  const teardown = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, []);

  const play = useCallback(
    (next: Station, nextQueue?: Station[]) => {
      const audio = audioRef.current;
      if (!audio) return;
      const token = ++loadToken.current;
      teardown();
      setStation(next);
      if (nextQueue) setQueue(nextQueue);
      setError(null);
      setStatus('loading');
      addRecent(next);

      if (!next.https && window.location.protocol === 'https:') {
        fail(MIXED_CONTENT);
        return;
      }

      const start = () => {
        audio.play().catch((err: unknown) => {
          if (token !== loadToken.current) return;
          // Autoplay policy: the user can press play themselves.
          if (err instanceof DOMException && err.name === 'NotAllowedError') setStatus('paused');
          else if (!(err instanceof DOMException && err.name === 'AbortError')) fail();
        });
      };

      const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (next.hls && !nativeHls) {
        void import('hls.js').then(({ default: HlsCtor }) => {
          if (token !== loadToken.current) return;
          if (!HlsCtor.isSupported()) return fail('Your browser cannot play this HLS stream.');
          // No worker: keeps the CSP free of blob: workers.
          const hls = new HlsCtor({ enableWorker: false, lowLatencyMode: false });
          hlsRef.current = hls;
          hls.on(HlsCtor.Events.ERROR, (_e, data) => {
            if (data.fatal && token === loadToken.current) {
              hls.destroy();
              hlsRef.current = null;
              fail();
            }
          });
          hls.loadSource(next.streamUrl);
          hls.attachMedia(audio);
          start();
        }, () => fail());
      } else {
        audio.src = next.streamUrl;
        start();
      }

      // Report the play once per station per page session, as Radio Browser asks.
      if (!reported.current.has(next.uuid)) {
        reported.current.add(next.uuid);
        api.reportClick(next.uuid).catch(() => undefined);
      }
    },
    [addRecent, fail, teardown],
  );

  const index = station ? queue.findIndex((s) => s.uuid === station.uuid) : -1;
  const hasNext = index >= 0 && index < queue.length - 1;
  const hasPrev = index > 0;

  const next = useCallback(() => {
    if (index >= 0 && index < queue.length - 1) play(queue[index + 1]!);
  }, [index, queue, play]);
  const prev = useCallback(() => {
    if (index > 0) play(queue[index - 1]!);
  }, [index, queue, play]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !station) return;
    if (status === 'error') return play(station);
    if (audio.paused) {
      setStatus('loading');
      audio.play().catch(() => fail());
    } else {
      audio.pause();
    }
  }, [station, status, play, fail]);

  const stop = useCallback(() => {
    loadToken.current++;
    teardown();
    setStatus('idle');
    setStation(null);
  }, [teardown]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    writeJson('ww.volume', clamped);
    if (clamped > 0) setMuted(false);
  }, []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  // Audio element events → status.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => setStatus('playing');
    const onPause = () => setStatus((s) => (s === 'error' || s === 'idle' ? s : 'paused'));
    const onWaiting = () => setStatus((s) => (s === 'error' ? s : 'loading'));
    const onError = () => {
      if (audio.getAttribute('src') || hlsRef.current) fail();
    };
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    // A live stream "ending" means the connection dropped.
    const onEnded = () => fail('The stream stopped.');
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('error', onError);
    };
  }, [fail]);

  // Media Session: lock screen, notification shade and hardware media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = station
      ? new MediaMetadata({
          title: station.name,
          artist: station.country || 'Live radio',
          album: 'WorldWave Radio',
          artwork: station.logo ? [{ src: station.logo, sizes: '512x512' }] : [],
        })
      : null;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', station ? () => toggle() : null],
      ['pause', station ? () => audioRef.current?.pause() : null],
      ['stop', station ? () => stop() : null],
      ['nexttrack', hasNext ? () => next() : null],
      ['previoustrack', hasPrev ? () => prev() : null],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported in this browser */
      }
    }
  }, [station, hasNext, hasPrev, toggle, stop, next, prev]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
    }
  }, [status]);

  useEffect(() => () => teardown(), [teardown]);

  const value = useMemo<Player>(
    () => ({ station, status, error, volume, muted, queue, hasNext, hasPrev, play, toggle, stop, next, prev, setVolume, toggleMute }),
    [station, status, error, volume, muted, queue, hasNext, hasPrev, play, toggle, stop, next, prev, setVolume, toggleMute],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="none" className="hidden" />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): Player {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
