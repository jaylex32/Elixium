import {User, Download, Play} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {coverAtSize, CARD_COVER_PX} from '@/shared/lib/cover';
import {SelectCheckbox} from '@/shared/components/SelectCheckbox';
import {useSelectionStore} from '@/store/selection-store';
import {useNavigationStore} from '@/store/navigation-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {Button} from '@/shared/components/ui/Button';
import {usePlayItem} from '@/shared/hooks/usePlayItem';
import type {Artist} from '@/types';

interface ArtistCardProps {
  artist: Artist;
  className?: string;
}

export function ArtistCard({artist, className}: ArtistCardProps) {
  const {download} = useDownload();
  const {playItem} = usePlayItem();
  const openArtist = useNavigationStore((s) => s.openArtist);

  const selectable = {
    id: artist.id,
    type: 'artist' as const,
    service: artist.service,
    title: artist.name,
    cover: artist.picture,
  };

  const selectionActive = useSelectionStore((s) => s.active);
  const isSelected = useSelectionStore((s) =>
    Boolean(s.items[`${artist.service}:artist:${artist.id}`]),
  );
  const toggle = useSelectionStore((s) => s.toggle);
  const beginWith = useSelectionStore((s) => s.beginWith);

  /* Whole discography in one action. useDownload has handled type 'artist'
     all along; the control for it had simply gone missing from the card. */
  const downloadDiscography = () => {
    download({id: artist.id, type: 'artist', title: artist.name, cover: artist.picture, service: artist.service});
    toast.success(`Queued ${artist.name}'s discography`, {description: 'Every album, on the Downloads page.'});
  };

  return (
    <div className="group relative">
      <button
        onClick={() => (selectionActive ? toggle(selectable) : openArtist(artist))}
        className={cn(
          'group flex flex-col items-center gap-3 rounded-2xl p-4 border border-border bg-card-bg',
          'hover:border-accent/40 hover:bg-surface-bg transition-all duration-200 text-left w-full',
          className,
        )}
      >
        <div className="relative">
          <div className="h-20 w-20 rounded-full overflow-hidden bg-surface-bg shrink-0">
            {artist.picture ? (
              <img
                src={coverAtSize(artist.picture, CARD_COVER_PX)}
                alt={artist.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User size={28} className="text-text-muted" />
              </div>
            )}
          </div>
        </div>
        <div className="text-center min-w-0 w-full">
          <p className="text-sm font-semibold text-text-primary truncate">{artist.name}</p>
          {artist.fans != null && <p className="text-xs text-text-muted mt-0.5">{artist.fans.toLocaleString()} fans</p>}
        </div>
      </button>


      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-2 top-2 z-20">
          <SelectCheckbox
            selected={isSelected}
            alwaysVisible={selectionActive}
            label={`Select ${artist.name}`}
            onToggle={() => (selectionActive ? toggle(selectable) : beginWith(selectable))}
          />
        </div>

        {/*
          The same overlay every other card uses: both actions together, in the
          middle, appearing on hover.

          Corners were the wrong answer twice over — one control sat over the
          person's face and the other ended up split from it, so the pair read
          as two unrelated things rather than the card's actions.

          The scrim takes no pointer events. Unlike AlbumCard, whose overlay
          sits inside the clickable card and lets clicks bubble, this one is a
          sibling of the button — so anything it swallows goes nowhere, and the
          card stops opening at all. Only the two controls opt back in.
        */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-black/55 opacity-0 backdrop-blur-[2px] transition-opacity duration-base group-hover:opacity-100">
          <Button
            size="icon"
            variant="default"
            aria-label={`Play ${artist.name}`}
            title="Play top tracks"
            onClick={(e) => {
              e.stopPropagation();
              playItem({
                id: artist.id,
                type: 'artist',
                service: artist.service,
                title: artist.name,
                artist: artist.name,
                cover: artist.picture,
              });
            }}
            className="pointer-events-auto h-10 w-10 rounded-full shadow-lg"
          >
            <Play size={18} />
          </Button>

          <Button
            size="icon"
            variant="secondary"
            aria-label={`Download ${artist.name}'s discography`}
            title="Download full discography"
            onClick={(e) => {
              e.stopPropagation();
              downloadDiscography();
            }}
            className="pointer-events-auto h-10 w-10 rounded-full shadow-lg"
          >
            <Download size={18} />
          </Button>
        </div>
      </div>

    </div>
  );
}
