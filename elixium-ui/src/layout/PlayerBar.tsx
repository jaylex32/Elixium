import {useRef, useEffect, useCallback, useState} from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ChevronUp,
  Music2,
  Loader2,
  ListMusic,
  Shuffle,
  Repeat,
  Repeat1,
} from 'lucide-react';
import {motion, AnimatePresence} from 'framer-motion';
import {toast} from 'sonner';
import {cn, formatDuration} from '@/shared/lib/utils';
import {getStreamUrl, probeStreamKind} from '@/shared/lib/api';
import {usePlayerStore} from '@/store/player-store';
import {useSettingsStore} from '@/store/settings-store';
import {useIsMobile} from '@/shared/hooks/useMediaQuery';
import {useMediaSession} from '@/shared/hooks/useMediaSession';
import {Progress} from '@/shared/components/ui/Progress';
import {Button} from '@/shared/components/ui/Button';
import {PlayerFullscreen} from './PlayerFullscreen';
import {QueuePanel} from './QueuePanel';

/** Map stored quality preferences onto the ids the stream endpoint expects. */
const resolveQuality = (service: string | undefined, deezerQuality: string, qobuzQuality: string): string => {
  if (service === 'qobuz') return qobuzQuality === '7' ? '96khz' : '44khz';
  if (deezerQuality === 'FLAC') return 'flac';
  return deezerQuality === 'MP3_320' ? '320' : '128';
};

export function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isFullscreen,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleFullscreen,
    setCurrentTime,
    setDuration,
    setPlaying,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    queue,
  } = usePlayerStore();
  const {settings} = useSettingsStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isMobile = useIsMobile();
  const warnedPreviewFor = useRef<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  // Lock-screen / notification / media-key controls.
  useMediaSession(audioRef);

  // State, not a ref: the buffering spinner is rendered output, and a ref
  // mutation never triggers the re-render that would reveal it.
  const [isBuffering, setIsBuffering] = useState(false);

  const quality = resolveQuality(currentTrack?.service, settings.deezerQuality, settings.qobuzQuality);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    setIsBuffering(true);
    audio.src = getStreamUrl(currentTrack.id, currentTrack.service, quality);
    audio.load();
    audio.play().catch(() => {
      if (currentTrack.previewUrl && audio.src !== currentTrack.previewUrl) {
        audio.src = currentTrack.previewUrl;
        audio.play().catch(() => setPlaying(false));
      } else {
        setPlaying(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.service]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isBuffering) return;
    if (isPlaying) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [isPlaying, isBuffering, setPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  /*
   * Tell the user when they are hearing a 30-second preview.
   *
   * Deezer falls back to one silently when auth is unavailable (usually an
   * expired ARL), so the track just stops at 0:30 with no explanation. Warned
   * once per track id, since the fallback reason does not change mid-track.
   */
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;

    probeStreamKind(currentTrack.id, currentTrack.service, quality).then((kind) => {
      if (cancelled || kind !== 'preview') return;
      if (warnedPreviewFor.current === currentTrack.id) return;
      warnedPreviewFor.current = currentTrack.id;
      toast.warning('Preview only (30s)', {
        description: `${currentTrack.service === 'deezer' ? 'Deezer' : 'Qobuz'} credentials unavailable — check Settings.`,
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.service, quality]);

  /** Seek from either a click or a touch, so the bar is draggable on a phone. */
  const seekFromPointer = useCallback(
    (clientX: number, element: HTMLElement) => {
      if (!duration) return;
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const time = ratio * duration;
      seek(time);
      if (audioRef.current) audioRef.current.currentTime = time;
    },
    [duration, seek],
  );

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <audio
        ref={audioRef}
        onCanPlay={() => setIsBuffering(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => {
          if (repeat === 'one' && audioRef.current) {
            audioRef.current.currentTime = 0;
            void audioRef.current.play().catch(() => setPlaying(false));
            return;
          }
          next();
        }}
        onError={() => {
          setIsBuffering(false);
          setPlaying(false);
        }}
      />

      <AnimatePresence>{isFullscreen && <PlayerFullscreen audioRef={audioRef} />}</AnimatePresence>
      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />

      <motion.div
        initial={{y: 100}}
        animate={{y: 0}}
        transition={{type: 'spring', stiffness: 320, damping: 34}}
        // Sits directly above the mobile bottom nav. --bottom-nav-height is 0
        // on desktop, so the same expression parks it flush to the viewport
        // floor there without a breakpoint.
        style={{bottom: 'calc(var(--bottom-nav-height) + var(--safe-bottom))'}}
        className="fixed left-0 right-0 z-player h-player border-t border-border glass px-safe"
      >
        {/* Seek strip. Inside the bar rather than overhanging it, so it cannot
            intercept taps meant for the content scrolling behind. */}
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(currentTime) || 0}
          tabIndex={0}
          className="group absolute inset-x-0 top-0 h-3 cursor-pointer"
          onClick={(e) => seekFromPointer(e.clientX, e.currentTarget)}
          onTouchStart={(e) => seekFromPointer(e.touches[0].clientX, e.currentTarget)}
          onTouchMove={(e) => seekFromPointer(e.touches[0].clientX, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seek(Math.min(duration, currentTime + 5));
            if (e.key === 'ArrowLeft') seek(Math.max(0, currentTime - 5));
          }}
        >
          <Progress
            value={progress}
            className="mt-0.5 h-1 rounded-none transition-all group-hover:h-1.5"
            indicatorClassName="transition-none"
          />
        </div>

        <div className="flex h-full items-center gap-2 px-3 pt-1 sm:gap-4 sm:px-4">
          <button
            onClick={toggleFullscreen}
            aria-label="Open full player"
            className="group flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <div className="relative h-11 w-11 shrink-0">
              {currentTrack.cover ? (
                <img
                  src={currentTrack.cover}
                  alt=""
                  loading="lazy"
                  className="h-11 w-11 rounded-sm object-cover shadow-md transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-bg">
                  <Music2 size={18} className="text-text-muted" />
                </div>
              )}
              {isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/50">
                  <Loader2 size={14} className="animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-primary">{currentTrack.title}</p>
              <p className="truncate text-xs text-text-muted">{currentTrack.artist}</p>
            </div>
            <ChevronUp size={14} className="ml-1 hidden shrink-0 text-text-muted group-hover:text-text-primary sm:block" />
          </button>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            {/* Previous/next are desktop-only on the bar: at phone widths the
                three-button cluster crowds the title into ellipsis. Both remain
                available in the fullscreen player. */}
            <Button variant="ghost" size="icon" onClick={prev} aria-label="Previous track" className="hidden sm:flex">
              <SkipBack size={18} />
            </Button>
            <Button
              variant="default"
              size="icon"
              onClick={isPlaying ? pause : resume}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="h-11 w-11 rounded-full sm:h-10 sm:w-10"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </Button>
            <Button variant="ghost" size="icon" onClick={next} aria-label="Next track" className="hidden sm:flex">
              <SkipForward size={18} />
            </Button>
          </div>

          {/* Queue is reachable at every width — it is the only way to see or
              change what plays next. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setQueueOpen(true)}
            aria-label={`Open queue (${queue.length} tracks)`}
            className="relative shrink-0"
          >
            <ListMusic size={18} />
            {queue.length > 1 && (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            )}
          </Button>

          {!isMobile && (
            <div className="hidden shrink-0 items-center gap-1 md:flex">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                className={shuffle ? 'text-accent' : undefined}
              >
                <Shuffle size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={cycleRepeat}
                aria-label={`Repeat: ${repeat}`}
                className={repeat !== 'off' ? 'text-accent' : undefined}
              >
                {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </Button>
            </div>
          )}

          {!isMobile && (
            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <span className="text-xs tabular-nums text-text-muted">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
                {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                aria-label="Volume"
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className={cn('h-1 w-20 cursor-pointer appearance-none rounded-full accent-[var(--primary-accent)]')}
              />
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
