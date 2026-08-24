import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {MoreVertical, ListPlus, ListEnd, Download, Play, Link2, Disc3, User} from 'lucide-react';
import {toast} from 'sonner';
import {cn, copyText} from '@/shared/lib/utils';
import {usePlayerStore} from '@/store/player-store';
import {useNavigationStore} from '@/store/navigation-store';
import {buildServiceUrl} from '@/shared/lib/events';
import type {Relations} from '@/shared/lib/relations';
import type {Track} from '@/types';

interface TrackActionsProps {
  track: Track;
  /**
   * Where this track sits in the catalogue.
   *
   * Supplied by rows that have the raw payload; without it the menu simply
   * omits the two jump entries rather than offering links that go nowhere.
   */
  relations?: Relations;
  onDownload?: () => void;
  onPlay?: () => void;
  className?: string;
}

const itemClass =
  'flex cursor-pointer select-none items-center gap-2.5 rounded-xs px-2.5 py-2 text-sm text-text-secondary outline-none ' +
  'data-[highlighted]:bg-surface-bg data-[highlighted]:text-text-primary';

/**
 * Per-track overflow menu.
 *
 * The player store has supported playNext and addToQueue since the queue panel
 * landed, but nothing in the UI ever called them — so a user could only ever
 * replace the queue by playing something, never build one up. A menu keeps
 * these available without adding a third and fourth icon to every row.
 */
export function TrackActions({track, relations, onDownload, onPlay, className}: TrackActionsProps) {
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const openArtist = useNavigationStore((s) => s.openArtist);

  const copyLink = async () => {
    try {
      /*
       * A YouTube Music track has no Deezer or Qobuz address to copy — it is
       * only resolved onto one at download time, and that match is not what
       * someone pasting a link means to share.
       */
      const url =
        track.service === 'ytmusic'
          ? `https://music.youtube.com/watch?v=${track.id}`
          : buildServiceUrl(track.id, 'track', track.service);
      const ok = await copyText(url);
      if (ok) toast.success('Link copied', {description: url, duration: 2200});
      else toast.error('Could not copy the link');
    } catch (error) {
      // buildServiceUrl refuses ids that belong to another service rather than
      // producing a URL that resolves to nothing.
      toast.error('No link for this item', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={`More actions for ${track.title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors',
            'hover:bg-surface-bg hover:text-text-primary data-[state=open]:bg-surface-bg data-[state=open]:text-text-primary',
            'lg:h-7 lg:w-7',
            className,
          )}
        >
          <MoreVertical size={15} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className="z-modal min-w-[190px] rounded-sm border border-border bg-card-bg p-1 shadow-lg animate-fade-in"
        >
          {onPlay && (
            <DropdownMenu.Item className={itemClass} onSelect={onPlay}>
              <Play size={14} />
              Play now
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => {
              playNext(track);
              toast.success('Playing next', {description: track.title, duration: 1800});
            }}
          >
            <ListPlus size={14} />
            Play next
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => {
              addToQueue(track);
              toast.success('Added to queue', {
                description: `${track.title} · position ${queueLength + 1}`,
                duration: 1800,
              });
            }}
          >
            <ListEnd size={14} />
            Add to queue
          </DropdownMenu.Item>

          {(relations?.albumId || relations?.artistId) && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              {relations?.albumId && (
                <DropdownMenu.Item
                  className={itemClass}
                  onSelect={() =>
                    openAlbum({
                      id: relations.albumId as string,
                      title: relations.albumTitle ?? track.album ?? 'Album',
                      artist: relations.artistName ?? track.artist,
                      cover: relations.albumCover ?? track.cover,
                      type: 'album',
                      service: track.service,
                    })
                  }
                >
                  <Disc3 size={14} />
                  Go to album
                </DropdownMenu.Item>
              )}
              {relations?.artistId && (
                <DropdownMenu.Item
                  className={itemClass}
                  onSelect={() =>
                    openArtist({
                      id: relations.artistId as string,
                      name: relations.artistName ?? track.artist,
                      picture: relations.artistPicture,
                      service: track.service,
                    })
                  }
                >
                  <User size={14} />
                  Go to artist
                </DropdownMenu.Item>
              )}
            </>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={itemClass} onSelect={copyLink}>
            <Link2 size={14} />
            Copy link
          </DropdownMenu.Item>

          {onDownload && (
            <DropdownMenu.Item className={itemClass} onSelect={onDownload}>
              <Download size={14} />
              Download
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
