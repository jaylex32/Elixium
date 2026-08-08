import {useEffect} from 'react';
import {usePlayerStore} from '@/store/player-store';

/**
 * Exposes playback to the operating system via the Media Session API.
 *
 * This is what produces lock-screen artwork and transport controls, the
 * Android notification, media keys on a desktop keyboard, and headphone
 * play/pause. Without it, playing on a phone means the audio keeps going but
 * the user has no way to control it once the screen locks — the single biggest
 * gap between this and a native music app.
 *
 * Everything here is feature-detected: browsers without Media Session (or
 * without positionState, which is newer) just skip the parts they lack.
 */

type ActionHandler = (details: MediaSessionActionDetails) => void;

/** Registering an unsupported action throws in some browsers; swallow it. */
const setHandler = (action: MediaSessionAction, handler: ActionHandler | null) => {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Action not supported by this browser — nothing to do.
  }
};

/**
 * Artwork must be a list of sized entries. We usually hold one URL, so it is
 * declared at the sizes platforms actually request; the OS scales as needed.
 */
const buildArtwork = (cover?: string): MediaImage[] => {
  if (!cover) return [];
  return [
    {src: cover, sizes: '96x96', type: 'image/jpeg'},
    {src: cover, sizes: '256x256', type: 'image/jpeg'},
    {src: cover, sizes: '512x512', type: 'image/jpeg'},
  ];
};

export function useMediaSession(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);

  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);

  // Metadata — what the lock screen shows.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album ?? '',
      artwork: buildArtwork(currentTrack.cover),
    });
  }, [currentTrack]);

  // Play/pause indicator on the OS surface.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = currentTrack ? (isPlaying ? 'playing' : 'paused') : 'none';
  }, [isPlaying, currentTrack]);

  // Transport controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const seekTo = (time: number) => {
      const clamped = Math.min(Math.max(0, time), duration || 0);
      seek(clamped);
      if (audioRef.current) audioRef.current.currentTime = clamped;
    };

    setHandler('play', () => resume());
    setHandler('pause', () => pause());
    setHandler('previoustrack', () => prev());
    setHandler('nexttrack', () => next());
    setHandler('seekbackward', (d) => seekTo((audioRef.current?.currentTime ?? 0) - (d.seekOffset ?? 10)));
    setHandler('seekforward', (d) => seekTo((audioRef.current?.currentTime ?? 0) + (d.seekOffset ?? 10)));
    setHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') seekTo(d.seekTime);
    });
    setHandler('stop', () => pause());

    return () => {
      for (const action of [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekbackward',
        'seekforward',
        'seekto',
        'stop',
      ] as MediaSessionAction[]) {
        setHandler(action, null);
      }
    };
  }, [audioRef, duration, seek, resume, pause, prev, next]);

  /*
   * Position state drives the scrubber on the lock screen.
   *
   * Deliberately not updated on every timeupdate tick: the OS extrapolates
   * position from playbackRate between updates, so pushing it ~4x/second is
   * wasted work. Re-sync only when the track, duration, or play state
   * changes — the points where extrapolation would drift.
   */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    if (!currentTrack || !Number.isFinite(duration) || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audioRef.current?.playbackRate ?? 1,
        position: Math.min(Math.max(0, currentTime), duration),
      });
    } catch {
      // Position outside the valid range during a track switch — the next
      // effect run corrects it.
    }
    // currentTime is intentionally omitted: including it would re-run this on
    // every tick, which is exactly what the comment above avoids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack, duration, isPlaying, audioRef]);
}
