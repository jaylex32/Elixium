import {useState} from 'react';
import {X, User, Music2, Play, Pause, Download, Eye, Disc3, ListMusic} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {toast} from 'sonner';
import {cn, formatDuration, toSeconds} from '@/shared/lib/utils';
import {useArtistContent, type ArtistContentKind} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {isExplicit} from '@/shared/lib/explicit';
import {ExplicitBadge} from '@/shared/components/ExplicitBadge';
import {useSelectionStore} from '@/store/selection-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {getSocket} from '@/shared/lib/socket';
import {Button} from '@/shared/components/ui/Button';
import {ListSkeleton, GridSkeleton, ErrorState, EmptyState} from '@/shared/components/States';
import {InfiniteSentinel} from '@/shared/components/InfiniteSentinel';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import type {Artist, Service, RawSearchResult} from '@/types';

interface ArtistModalProps {
  artist: Artist;
  open: boolean;
  onClose: () => void;
}

const TABS: {id: ArtistContentKind; label: string; icon: React.ElementType}[] = [
  {id: 'albums', label: 'Albums', icon: Disc3},
  {id: 'tracks', label: 'Tracks', icon: Music2},
  {id: 'playlists', label: 'Playlists', icon: ListMusic},
];

const GRID = 'grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5';

function toCard(result: RawSearchResult, service: Service): AlbumCardData {
  return {
    id: result.id,
    title: result.title,
    artist: result.artist,
    cover: extractCover(result.rawData, service),
    year: result.year ?? undefined,
    type: result.type,
    explicit: isExplicit(result.rawData),
  };
}

/**
 * Artist detail.
 *
 * Three tabs, because an artist is not just their top tracks: this used to
 * show that single list, so there was no way to reach a discography from a
 * search result even though the server could serve one. Albums and playlists
 * open into the album modal, so every item resolves to its real track list
 * rather than being a dead card.
 */
export function ArtistModal({artist, open, onClose}: ArtistModalProps) {
  const [tab, setTab] = useState<ArtistContentKind>('albums');
  const [selected, setSelected] = useState<(AlbumCardData & {service: Service}) | null>(null);

  const {download} = useDownload();
  const {setTrack, currentTrack, isPlaying, pause, resume} = usePlayerStore();
  const selectMany = useSelectionStore((s) => s.selectMany);

  const {data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage} = useArtistContent(
    tab,
    artist.id,
    artist.service,
    artist.name,
    open,
  );

  const items = data?.pages.flat() ?? [];

  /* Only the track tab feeds the player, and it queues the whole tab so
     playing the fourth track still gives you the rest after it. */
  const tracks =
    tab === 'tracks'
      ? items.map((t) =>
          makeTrack({
            id: t.id,
            title: t.title,
            artist: t.artist ?? artist.name,
            album: typeof t.album === 'string' ? t.album : undefined,
            cover: extractCover(t.rawData, artist.service),
            duration: toSeconds(t.duration),
            service: artist.service,
            previewUrl: t.rawData?.preview as string | undefined,
          }),
        )
      : [];

  const playFrom = (index: number) => {
    const track = tracks[index];
    if (!track) return;
    if (currentTrack?.id === track.id) {
      if (isPlaying) pause();
      else resume();
      return;
    }
    setTrack(track, tracks);
  };

  const watchArtist = () => {
    getSocket().emit('addWatchedArtist', {
      // Both spellings: the server reads artistId, older builds read id, and
      // sending one of them was how every artist ended up under the same key.
      artistId: artist.id,
      id: artist.id,
      name: artist.name,
      // Without these the watchlist showed a blank avatar and assumed Qobuz.
      image: artist.picture ?? '',
      service: artist.service,
    });
    toast.success(`Watching ${artist.name}`, {description: 'New releases will appear in your watchlist.'});
  };

  const empty = !isLoading && !isError && items.length === 0;

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-black/60 backdrop-blur-sm animate-fade-in" />
          <DialogPrimitive.Content
            className="fixed inset-x-0 bottom-0 z-modal flex max-h-[88dvh] flex-col rounded-t-xl border border-border bg-card-bg pb-safe shadow-xl animate-slide-up
                       sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:pb-0 sm:animate-fade-in"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden />

            <div className="flex shrink-0 items-center gap-3 border-b border-border p-4 sm:gap-4 sm:p-5">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-surface-bg sm:h-16 sm:w-16">
                {artist.picture ? (
                  <img src={artist.picture} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <User size={22} className="text-text-muted" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-text-muted">
                  Artist · {artist.service === 'deezer' ? 'Deezer' : 'Qobuz'}
                </p>
                <h2 className="truncate text-base font-bold text-text-primary sm:text-lg">{artist.name}</h2>
              </div>

              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <X size={16} />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
              <div className="flex gap-1 rounded-sm border border-border bg-secondary-bg p-1">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      aria-pressed={tab === t.id}
                      className={cn(
                        'flex min-h-9 items-center gap-1.5 rounded-xs px-3 text-xs font-medium transition-colors',
                        tab === t.id
                          ? 'bg-card-bg text-text-primary shadow-sm'
                          : 'text-text-muted hover:text-text-secondary',
                      )}
                    >
                      <Icon size={13} />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="ml-auto flex flex-wrap gap-2">
                {tab !== 'tracks' && items.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-text-muted"
                    onClick={() =>
                      selectMany(
                        items.map((item) => ({
                          id: item.id,
                          type: (tab === 'albums' ? 'album' : 'playlist') as 'album' | 'playlist',
                          service: artist.service,
                          title: item.title,
                          artist: item.artist,
                          cover: extractCover(item.rawData, artist.service),
                        })),
                      )
                    }
                  >
                    Select all
                  </Button>
                )}
                {tab === 'tracks' && (
                  <Button size="sm" onClick={() => playFrom(0)} disabled={tracks.length === 0}>
                    <Play size={14} />
                    Play
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  title="Download every album by this artist"
                  onClick={() => {
                    download({
                      id: artist.id,
                      type: 'artist',
                      title: artist.name,
                      cover: artist.picture,
                      service: artist.service,
                    });
                    toast.success(`Queued ${artist.name}'s discography`);
                  }}
                >
                  <Download size={14} />
                  Discography
                </Button>
                <Button variant="secondary" size="sm" onClick={watchArtist}>
                  <Eye size={14} />
                  Watch
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {isLoading && (
                <div className="p-4">{tab === 'tracks' ? <ListSkeleton count={8} /> : <GridSkeleton count={6} />}</div>
              )}

              {isError && <ErrorState title="Could not load this artist" onRetry={() => refetch()} />}

              {empty && (
                <EmptyState
                  title={`No ${tab} found`}
                  hint={
                    tab === 'playlists'
                      ? 'No playlists featuring this artist on the selected service.'
                      : `This artist has no ${tab} on the selected service.`
                  }
                />
              )}

              {!isLoading && !isError && items.length > 0 && tab !== 'tracks' && (
                <div className={GRID}>
                  {items.map((item) => {
                    const card = toCard(item, artist.service);
                    return (
                      <AlbumCard
                        key={`${item.id}-${item.title}`}
                        album={card}
                        onClick={() => setSelected({...card, service: artist.service})}
                        selectable={{
                          id: item.id,
                          type: tab === 'albums' ? 'album' : 'playlist',
                          service: artist.service,
                          title: item.title,
                          artist: item.artist,
                          cover: card.cover,
                        }}
                        onDownload={() =>
                          download({
                            id: item.id,
                            type: tab === 'albums' ? 'album' : 'playlist',
                            title: item.title,
                            artist: item.artist,
                            cover: card.cover,
                            service: artist.service,
                          })
                        }
                      />
                    );
                  })}
                </div>
              )}

              {!isLoading && !isError && tracks.length > 0 && (
                <ol className="py-2">
                  {tracks.map((track, index) => {
                    const isActive = currentTrack?.id === track.id;
                    return (
                      <li
                        key={`${track.id}-${index}`}
                        className={cn(
                          'rows-track group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-bg sm:px-5',
                          isActive && 'bg-accent/8',
                        )}
                      >
                        <button
                          onClick={() => playFrom(index)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-label={isActive ? (isPlaying ? 'Pause' : 'Resume') : `Play ${track.title}`}
                        >
                          <span className="relative h-10 w-10 shrink-0">
                            {track.cover ? (
                              <img
                                src={track.cover}
                                alt=""
                                loading="lazy"
                                className="h-10 w-10 rounded-xs object-cover"
                              />
                            ) : (
                              <span className="flex h-10 w-10 items-center justify-center rounded-xs bg-surface-bg">
                                <Music2 size={15} className="text-text-muted" />
                              </span>
                            )}
                            <span
                              className={cn(
                                'absolute inset-0 flex items-center justify-center rounded-xs bg-black/50 transition-opacity',
                                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                              )}
                            >
                              {isActive && isPlaying ? (
                                <Pause size={13} className="text-white" />
                              ) : (
                                <Play size={13} className="text-white" />
                              )}
                            </span>
                          </span>

                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'flex items-center gap-1.5 text-sm font-medium',
                                isActive ? 'text-accent' : 'text-text-primary',
                              )}
                            >
                              <span className="truncate">{track.title}</span>
                              {isExplicit(items[index]?.rawData) && <ExplicitBadge />}
                            </span>
                            {track.album && (
                              <span className="block truncate text-xs text-text-muted">{track.album}</span>
                            )}
                          </span>

                          {track.duration ? (
                            <span className="hidden shrink-0 text-xs tabular-nums text-text-muted sm:block">
                              {formatDuration(track.duration)}
                            </span>
                          ) : null}
                        </button>

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Download ${track.title}`}
                          className="shrink-0 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
                          onClick={() =>
                            download({
                              id: track.id,
                              type: 'track',
                              title: track.title,
                              artist: track.artist,
                              cover: track.cover,
                              service: artist.service,
                            })
                          }
                        >
                          <Download size={14} />
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              )}

              {!isLoading && !isError && items.length > 0 && (
                <InfiniteSentinel
                  hasMore={Boolean(hasNextPage)}
                  loading={isFetchingNextPage}
                  onLoadMore={fetchNextPage}
                />
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Nested so closing an album returns to the artist rather than to the
          page behind it. */}
      {selected && <AlbumModal album={selected} open onClose={() => setSelected(null)} />}
    </>
  );
}
