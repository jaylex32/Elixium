import {type RefObject} from 'react';
import {motion} from 'framer-motion';
import {X, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music2} from 'lucide-react';
import {usePlayerStore} from '@/store/player-store';
import {formatDuration} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';

interface PlayerFullscreenProps {
  audioRef: RefObject<HTMLAudioElement | null>;
}

export function PlayerFullscreen({audioRef}: PlayerFullscreenProps) {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleFullscreen,
  } = usePlayerStore();

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <motion.div
      initial={{opacity: 0, y: 40}}
      animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: 40}}
      transition={{duration: 0.25, ease: [0.4, 0, 0.2, 1]}}
      className="fixed inset-0 z-modal flex flex-col items-center justify-center overflow-y-auto glass px-safe py-safe"
    >
      {/* Blurred background art */}
      {currentTrack.cover && (
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${currentTrack.cover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(40px)',
            transform: 'scale(1.1)',
          }}
        />
      )}

      <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="absolute right-4 z-10 sm:right-6"
        style={{top: 'calc(var(--safe-top) + 1rem)'}}>
        <X size={20} />
      </Button>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6 px-6 py-16 sm:gap-8 sm:px-8">
        {/* Album art */}
        {currentTrack.cover ? (
          <img
            src={currentTrack.cover}
            alt={currentTrack.album ?? currentTrack.title}
            className="aspect-square w-[min(72vw,16rem)] rounded-lg object-cover shadow-xl"
          />
        ) : (
          <div className="aspect-square w-[min(72vw,16rem)] rounded-lg flex items-center justify-center bg-surface-bg">
            <Music2 size={64} className="text-text-muted" />
          </div>
        )}

        {/* Info */}
        <div className="text-center w-full">
          <p className="text-xl font-bold text-text-primary truncate">{currentTrack.title}</p>
          <p className="text-base text-text-secondary mt-1 truncate">{currentTrack.artist}</p>
          {currentTrack.album && <p className="text-sm text-text-muted mt-0.5 truncate">{currentTrack.album}</p>}
        </div>

        {/* Progress */}
        <div className="w-full space-y-2">
          <div
            className="w-full h-2 bg-surface-bg rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const t = ((e.clientX - rect.left) / rect.width) * duration;
              seek(t);
              if (audioRef.current) audioRef.current.currentTime = t;
            }}
          >
            <div className="h-full rounded-full bg-accent transition-all" style={{width: `${progress}%`}} />
          </div>
          <div className="flex justify-between text-xs text-text-muted tabular-nums">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={prev}>
            <SkipBack size={22} />
          </Button>
          <Button variant="default" size="icon" onClick={isPlaying ? pause : resume} className="h-14 w-14 rounded-full">
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={next}>
            <SkipForward size={22} />
          </Button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-3 w-full">
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
            className="flex-1 h-1 rounded-full appearance-none cursor-pointer accent-[var(--primary-accent)]"
          />
        </div>
      </div>
    </motion.div>
  );
}
