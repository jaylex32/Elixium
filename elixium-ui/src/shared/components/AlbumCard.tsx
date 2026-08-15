import {Download, Play, Music2, Eye} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';

export interface AlbumCardData {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  year?: string | number;
  tracks?: number;
  type?: string;
}

interface AlbumCardProps {
  album: AlbumCardData;
  onDownload?: () => void;
  /** Playlist only: follow it for new tracks. Omitted for albums. */
  onWatch?: () => void;
  onPlay?: () => void;
  onClick?: () => void;
  className?: string;
}

export function AlbumCard({album, onDownload, onWatch, onPlay, onClick, className}: AlbumCardProps) {
  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2.5 rounded-md border border-border bg-card-bg p-3',
        // Depth on hover: the card lifts and casts a real shadow rather than
        // only changing its border colour.
        'transition-all duration-base ease-out hover:-translate-y-1 hover:border-accent/40 hover:bg-surface-bg hover:shadow-lg',
        className,
      )}
      onClick={onClick}
    >
      {/* Cover */}
      <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-surface-bg shadow-sm">
        {album.cover ? (
          <img
            src={album.cover}
            alt=""
            className="h-full w-full object-cover transition-transform duration-slow ease-out group-hover:scale-110"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2 size={32} className="text-text-muted" />
          </div>
        )}

        {/* Permanent bottom gradient: keeps art from bleeding into the label
            area and gives the tile a sense of depth even at rest. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity duration-base group-hover:opacity-100">
          {onPlay && (
            <Button
              size="icon"
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              className="h-10 w-10 rounded-full shadow-lg"
            >
              <Play size={18} />
            </Button>
          )}
          {onDownload && (
            <Button
              size="icon"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              className="h-10 w-10 rounded-full shadow-lg"
            >
              <Download size={18} />
            </Button>
          )}
          {onWatch && (
            <Button
              size="icon"
              variant="secondary"
              aria-label="Watch for new tracks"
              title="Watch for new tracks"
              onClick={(e) => {
                e.stopPropagation();
                onWatch();
              }}
              className="h-10 w-10 rounded-full shadow-lg"
            >
              <Eye size={18} />
            </Button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{album.title}</p>
        <p className="text-xs text-text-muted truncate mt-0.5">{album.artist}</p>
        {(album.year || album.tracks) && (
          <p className="text-xs text-text-muted mt-1">
            {[album.year, album.tracks && `${album.tracks} tracks`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}
