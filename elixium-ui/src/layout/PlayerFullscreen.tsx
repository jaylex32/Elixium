import {useState, type RefObject} from 'react';
import {motion} from 'framer-motion';
import {X, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music2, Mic2, Disc3, Shuffle, Repeat, Repeat1} from 'lucide-react';
import {usePlayerStore} from '@/store/player-store';
import {formatDuration} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {cn} from '@/shared/lib/utils';
import {LyricsView} from './LyricsView';
import {TrackByline} from '@/shared/components/RelationLinks';
import {relationsOf} from '@/shared/lib/relations';

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
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerStore();

  const [tab, setTab] = useState<'art' | 'lyrics'>('art');

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <motion.div
      initial={{opacity: 0, y: 40}}
      animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: 40}}
      transition={{duration: 0.25, ease: [0.4, 0, 0.2, 1]}}
      className="no-scrollbar fixed inset-0 z-modal flex flex-col items-center justify-center overflow-y-auto glass px-safe py-safe"
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
        {/* Artwork and lyrics share this slot: on a phone there is not enough
            height for both, and a toggle keeps either one full-size. */}
        <div className="flex w-full flex-col items-center gap-4">
          <div className="flex gap-1 rounded-md border border-border bg-secondary-bg p-1">
            {([
              {id: 'art', label: 'Now playing', icon: Disc3},
              {id: 'lyrics', label: 'Lyrics', icon: Mic2},
            ] as const).map(({id, label, icon: Icon}) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={cn(
                  'flex min-h-9 items-center gap-1.5 rounded-sm px-3 text-xs font-medium transition-colors',
                  tab === id ? 'bg-card-bg text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {tab === 'art' ? (
            currentTrack.cover ? (
              <img
                src={currentTrack.cover}
                alt=""
                className="aspect-square w-[min(72vw,16rem)] rounded-lg object-cover shadow-xl"
              />
            ) : (
              <div className="flex aspect-square w-[min(72vw,16rem)] items-center justify-center rounded-lg bg-surface-bg">
                <Music2 size={64} className="text-text-muted" />
              </div>
            )
          ) : (
            <div className="no-scrollbar max-h-[46dvh] w-full overflow-y-auto rounded-md border border-border bg-secondary-bg/60">
              <LyricsView />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="text-center w-full">
          <p className="text-xl font-bold text-text-primary truncate">{currentTrack.title}</p>
          {/* Both names lead somewhere. The player closes on the way out —
              the window it opens shares this one's layer. */}
          <TrackByline
            artist={currentTrack.artist}
            album={currentTrack.album}
            relations={relationsOf(currentTrack.rawData, currentTrack.service)}
            service={currentTrack.service}
            onNavigate={toggleFullscreen}
            className="mt-1 justify-center text-base text-text-secondary"
          />
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
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            className={shuffle ? 'text-accent' : 'text-text-muted'}
          >
            <Shuffle size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={prev}>
            <SkipBack size={22} />
          </Button>
          <Button variant="default" size="icon" onClick={isPlaying ? pause : resume} className="h-14 w-14 rounded-full">
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={next} aria-label="Next track">
            <SkipForward size={22} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
            className={repeat !== 'off' ? 'text-accent' : 'text-text-muted'}
          >
            {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
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
