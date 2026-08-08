import {Download, Play, Music2} from 'lucide-react';
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
  onPlay?: () => void;
  onClick?: () => void;
  className?: string;
}

export function AlbumCard({album, onDownload, onPlay, onClick, className}: AlbumCardProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2.5 rounded-xl bg-card-bg border border-border p-3 cursor-pointer',
        'hover:border-accent/40 hover:bg-surface-bg transition-all duration-200',
        className,
      )}
      onClick={onClick}
    >
      {/* Cover */}
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface-bg">
        {album.cover ? (
          <img
            src={album.cover}
            alt={album.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music2 size={32} className="text-text-muted" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
