import {Download, Play, Music2, Eye} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {coverAtSize, CARD_COVER_PX} from '@/shared/lib/cover';
import {Button} from '@/shared/components/ui/Button';
import {ExplicitBadge} from '@/shared/components/ExplicitBadge';
import {SelectCheckbox} from '@/shared/components/SelectCheckbox';
import {useSelectionStore, type SelectableItem} from '@/store/selection-store';
import {ArtistLink, AlbumLink} from '@/shared/components/RelationLinks';
import type {Relations} from '@/shared/lib/relations';
import type {Service} from '@/types';
import {DownloadQualityContext} from '@/shared/components/DownloadQuality';

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
  /** Given a quality, download at that instead of the configured default. */
  onDownload?: (quality?: string) => void;
  /** Playlist only: follow it for new tracks. Omitted for albums. */
  onWatch?: () => void;
  onPlay?: () => void;
  onClick?: () => void;
  className?: string;
  /** Makes the card selectable for bulk download; omit to opt out. */
  selectable?: SelectableItem;
  /**
   * Where this card's artist and album live, so their names become links.
   *
   * Optional: a card whose payload carries no ids renders the same plain text
   * it always did, rather than offering a link that goes nowhere.
   */
  relations?: Relations;
  service?: Service;
}

export function AlbumCard({
  album,
  onDownload,
  onWatch,
  onPlay,
  onClick,
  className,
  selectable,
  relations,
  service,
}: AlbumCardProps) {
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
  const card = (
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
            /* A card draws this small; asking for a card-sized image keeps a
               long grid from requesting a hundred full-size covers at once. */
            src={coverAtSize(album.cover, CARD_COVER_PX)}
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
              aria-label={`Play ${album.title}`}
              title="Play"
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
              aria-label={`Download ${album.title}`}
              /* Says the choice exists without putting a control on the
                 artwork to advertise it. */
              title={service ? 'Download — right-click for other qualities' : 'Download'}
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
        {/* The artist is a way into their catalogue when the payload names
            them, and unchanged text when it does not. */}
        <p className="text-xs text-text-muted truncate mt-0.5">
          {relations && service ? (
            <ArtistLink name={album.artist} relations={relations} service={service} />
          ) : (
            album.artist
          )}
        </p>
        {/* Only when the card is a track: an album card naming its own album
            twice would be noise. */}
        {service && relations?.albumId && album.type === 'track' && relations.albumTitle && (
          <p className="mt-0.5 truncate text-xs text-text-muted">
            <AlbumLink title={relations.albumTitle} relations={relations} service={service} />
          </p>
        )}
        {(album.year || album.tracks) && (
          <p className="text-xs text-text-muted mt-1">
            {[album.year, album.tracks && `${album.tracks} tracks`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );

  /*
   * The qualities hang off a right-click rather than a fourth button.
   *
   * This grid is artwork first; play, download and sometimes watch already
   * share the hover overlay, and another control there would crowd the cover
   * it sits on. The download button's tooltip is what makes this findable.
   */
  if (!onDownload || !service) return card;
  return (
    <DownloadQualityContext service={service} onPick={(quality) => onDownload(quality)}>
      {card}
    </DownloadQualityContext>
  );
}
