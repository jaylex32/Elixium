import {Play, Download, Music2, MoreHorizontal} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {formatDuration} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';

export interface TrackData {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  trackNumber?: number;
  isExplicit?: boolean;
}

interface TrackRowProps {
  track: TrackData;
  index?: number;
  onPlay?: () => void;
  onDownload?: () => void;
  isActive?: boolean;
  isPlaying?: boolean;
  className?: string;
}

export function TrackRow({track, index, onPlay, onDownload, isActive, isPlaying, className}: TrackRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all',
        'hover:bg-surface-bg cursor-pointer',
        isActive && 'bg-accent/10',
        className,
      )}
      onClick={onPlay}
    >
      {/* Index / play icon */}
      <div className="w-6 flex items-center justify-center shrink-0">
        {isPlaying ? (
          <span className="flex gap-0.5 items-end h-4">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-0.5 bg-accent rounded-full animate-pulse"
                style={{height: `${50 + i * 25}%`, animationDelay: `${i * 150}ms`}}
              />
            ))}
          </span>
        ) : (
          <>
            <span className={cn('text-xs text-text-muted group-hover:hidden', isActive && 'text-accent')}>
              {index ?? <Music2 size={12} />}
            </span>
            <Play size={14} className={cn('hidden group-hover:block text-text-primary', isActive && 'text-accent')} />
          </>
        )}
      </div>

      {/* Cover */}
      {track.cover && (
        <img
          src={track.cover}
          alt={track.album ?? track.title}
          className="h-9 w-9 rounded-lg object-cover shrink-0"
          loading="lazy"
        />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium truncate', isActive ? 'text-accent' : 'text-text-primary')}>
          {track.title}
        </p>
        <p className="text-xs text-text-muted truncate">{track.artist}</p>
      </div>

      {/* Duration + actions */}
      <div className="flex items-center gap-1 shrink-0">
        {track.duration && (
          <span className="text-xs text-text-muted tabular-nums hidden sm:block">{formatDuration(track.duration)}</span>
        )}
        {onDownload && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Download size={14} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MoreHorizontal size={14} />
        </Button>
      </div>
    </div>
  );
}
