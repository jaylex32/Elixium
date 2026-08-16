import {Download, Play, Music2, Eye} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {ExplicitBadge} from '@/shared/components/ExplicitBadge';
import {SelectCheckbox} from '@/shared/components/SelectCheckbox';
import {useSelectionStore, type SelectableItem} from '@/store/selection-store';

export interface AlbumCardData {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  year?: string | number;
  tracks?: number;
  type?: string;
  /** Shows the [E] marker beside the title. */
  explicit?: boolean;
}

interface AlbumCardProps {
  album: AlbumCardData;
  onDownload?: () => void;
  /** Playlist only: follow it for new tracks. Omitted for albums. */
  onWatch?: () => void;
  onPlay?: () => void;
  onClick?: () => void;
  className?: string;
  /** Makes the card selectable for bulk download; omit to opt out. */
  selectable?: SelectableItem;
}

export function AlbumCard({album, onDownload, onWatch, onPlay, onClick, className, selectable}: AlbumCardProps) {
  const selectionActive = useSelectionStore((s) => s.active);
  const isSelected = useSelectionStore((s) => (selectable ? Boolean(s.items[`${selectable.service}:${selectable.type}:${selectable.id}`]) : false));
  const toggle = useSelectionStore((s) => s.toggle);
  const beginWith = useSelectionStore((s) => s.beginWith);

  /* While selecting, the whole card toggles instead of opening — opening a
     modal mid-selection loses the run of choices the user was making. */
  const handleClick = () => {
    if (selectable && selectionActive) {
      toggle(selectable);
      return;
    }
    onClick?.();
  };
  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2.5 rounded-md border border-border bg-card-bg p-3',
        // Depth on hover: the card lifts and casts a real shadow rather than
        // only changing its border colour.
        'transition-all duration-base ease-out hover:-translate-y-1 hover:border-accent/40 hover:bg-surface-bg hover:shadow-lg',
        className,
      )}
      onClick={handleClick}
    >
      {/* Cover */}
      <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-surface-bg shadow-sm">
        {selectable && (
          <div className="absolute left-1.5 top-1.5 z-20">
            <SelectCheckbox
              selected={isSelected}
              alwaysVisible={selectionActive}
              label={`Select ${album.title}`}
              // First tick also turns selection mode on, so nothing has to be
              // switched on before picking the thing you already wanted.
              onToggle={() => (selectionActive ? toggle(selectable) : beginWith(selectable))}
            />
          </div>
        )}
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
        <p className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
          <span className="truncate">{album.title}</span>
          {album.explicit && <ExplicitBadge />}
        </p>
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
