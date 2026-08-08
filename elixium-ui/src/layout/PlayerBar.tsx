import {useRef, useEffect, useCallback} from 'react';
import {Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, ChevronUp, Music2, Loader2} from 'lucide-react';
import {motion, AnimatePresence} from 'framer-motion';
import {cn, formatDuration} from '@/shared/lib/utils';
import {getStreamUrl} from '@/shared/lib/api';
import {usePlayerStore} from '@/store/player-store';
import {useSettingsStore} from '@/store/settings-store';
import {Progress} from '@/shared/components/ui/Progress';
import {Button} from '@/shared/components/ui/Button';
import {PlayerFullscreen} from './PlayerFullscreen';

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
  } = usePlayerStore();
  const {settings} = useSettingsStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadingRef = useRef(false);

  // Derive quality string for /api/stream
  const quality =
    currentTrack?.service === 'qobuz'
      ? settings.qobuzQuality === '27'
        ? '44khz'
        : settings.qobuzQuality === '7'
        ? '96khz'
        : '44khz'
      : settings.deezerQuality === 'FLAC'
      ? 'flac'
      : settings.deezerQuality === 'MP3_320'
      ? '320'
      : '128';

  // Load new track whenever the track id/service changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Prefer the backend stream; fall back to Deezer 30-sec preview if available
    const src = getStreamUrl(currentTrack.id, currentTrack.service, quality);
    loadingRef.current = true;
    audio.src = src;
    audio.load();
    audio.play().catch(() => {
      // If full quality stream fails and there's a preview, try that
      if (currentTrack.previewUrl && audio.src !== currentTrack.previewUrl) {
        audio.src = currentTrack.previewUrl;
        audio.play().catch(() => setPlaying(false));
      } else {
        setPlaying(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.service]);

  // Sync play/pause without reloading
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || loadingRef.current) return;
    if (isPlaying) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [isPlaying, setPlaying]);

  // Volume / mute
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * duration;
      seek(t);
      if (audioRef.current) audioRef.current.currentTime = t;
    },
    [duration, seek],
  );

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <audio
        ref={audioRef}
        onCanPlay={() => {
          loadingRef.current = false;
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={next}
        onError={() => setPlaying(false)}
      />

      <AnimatePresence>{isFullscreen && <PlayerFullscreen audioRef={audioRef} />}</AnimatePresence>

      <motion.div
        initial={{y: 80}}
        animate={{y: 0}}
        className="fixed bottom-0 left-0 right-0 z-40 h-player glass border-t border-border"
      >
        {/* Clickable seek bar at top edge */}
        <div className="absolute -top-2 left-0 right-0 h-4 cursor-pointer group" onClick={handleSeek}>
          <Progress
            value={progress}
            className="h-1 group-hover:h-1.5 transition-all rounded-none mt-1.5"
            indicatorClassName="transition-none"
          />
        </div>

        <div className="flex items-center h-full px-4 gap-4">
          {/* Track info → opens fullscreen */}
          <button onClick={toggleFullscreen} className="flex items-center gap-3 min-w-0 flex-1 text-left group">
            <div className="relative h-11 w-11 shrink-0">
              {currentTrack.cover ? (
                <img
                  src={currentTrack.cover}
                  alt={currentTrack.album ?? currentTrack.title}
                  className="h-11 w-11 rounded-lg object-cover shadow-md group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg bg-surface-bg flex items-center justify-center">
                  <Music2 size={18} className="text-text-muted" />
                </div>
              )}
              {loadingRef.current && (
                <div className="absolute inset-0 rounded-lg flex items-center justify-center bg-black/40">
                  <Loader2 size={14} className="animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{currentTrack.title}</p>
              <p className="text-xs text-text-muted truncate">{currentTrack.artist}</p>
            </div>
            <ChevronUp
              size={14}
              className="text-text-muted ml-1 shrink-0 group-hover:text-text-primary transition-colors"
            />
          </button>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={prev}>
              <SkipBack size={18} />
            </Button>
            <Button
              variant="default"
              size="icon"
              onClick={isPlaying ? pause : resume}
              className="rounded-full h-10 w-10"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </Button>
            <Button variant="ghost" size="icon" onClick={next}>
              <SkipForward size={18} />
            </Button>
          </div>

          {/* Time + volume */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span className="text-xs text-text-muted tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={toggleMute}>
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </Button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className={cn('w-20 h-1 rounded-full appearance-none cursor-pointer accent-[var(--primary-accent)]')}
            />
          </div>
        </div>
      </motion.div>
    </>
  );
}
