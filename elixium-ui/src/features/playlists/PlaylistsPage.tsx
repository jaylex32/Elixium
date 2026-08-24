import {useState, useDeferredValue} from 'react';
import {ListMusic, Search, X, Eye} from 'lucide-react';
import {toast} from 'sonner';
import {usePlaylistSearch, type PlaylistSearchService} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {useAppStore} from '@/store/app-store';
import {useWatchlistStore} from '@/store/watchlist-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {useNavigationStore} from '@/store/navigation-store';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import {Input} from '@/shared/components/ui/Input';
import {InfiniteSentinel} from '@/shared/components/InfiniteSentinel';
import {SelectionToggle} from '@/shared/components/SelectionToggle';
import {getSocket} from '@/shared/lib/socket';
import {cn} from '@/shared/lib/utils';
import type {Service} from '@/types';


/** Shared responsive grid so cards line up identically in both sections. */
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

export function PlaylistsPage() {
  const service = useAppStore((s) => s.service);
  const {download} = useDownload();
  const watchedPlaylists = useWatchlistStore((s) => s.watchedPlaylists);

  const [query, setQuery] = useState('');
  /*
   * Which catalogue to search, independent of the download service.
   *
   * Spotify is here because its playlist curation is the reason people go
   * looking: nothing is fetched from Spotify, the converter resolves the
   * playlist to Deezer or Qobuz tracks. Tidal is absent because its search
   * needs an authenticated session — a Tidal link still works via URL download
   * and the playlist watcher.
   */
  /*
   * Playlist search has its own sources — Deezer, Qobuz, Spotify — and
   * YouTube Music is not among them: its playlists are browsed through its
   * own pages. Starting on Deezer beats starting on a value this control
   * cannot represent.
   */
  const [searchService, setSearchService] = useState<PlaylistSearchService>(
    service === 'deezer' || service === 'qobuz' ? service : 'deezer',
  );
  const openAlbum = useNavigationStore((s) => s.openAlbum);

  // Keeps typing responsive: the input updates every keystroke while the
  // query that drives fetching lags behind under load.
  const deferredQuery = useDeferredValue(query);
  const {
    data: pages,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePlaylistSearch(searchService, deferredQuery);
  const data = pages?.pages.flat() ?? [];

  const hasQuery = deferredQuery.trim().length >= 2;

  const openPlaylist = (playlist: AlbumCardData) => openAlbum({...playlist, service, type: 'playlist'});

  return (
    <div className="animate-fade-in space-y-6 p-4 sm:space-y-8 sm:p-6">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Search playlists on Deezer, Qobuz or Spotify, or open one you already follow. A Spotify playlist is
          converted to {service === 'deezer' ? 'Deezer' : 'Qobuz'} tracks when downloaded.
        </p>

        <div className="relative max-w-xl">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search playlists…"
            aria-label="Search playlists"
            className="pl-9 pr-9"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="scroll-row flex w-fit gap-1 rounded-sm border border-border bg-secondary-bg p-1">
          {(['deezer', 'qobuz', 'spotify'] as PlaylistSearchService[]).map((id) => (
            <button
              key={id}
              onClick={() => setSearchService(id)}
              aria-pressed={searchService === id}
              className={cn(
                'min-h-9 shrink-0 rounded-xs px-3 text-xs font-medium capitalize transition-colors',
                searchService === id
                  ? 'bg-card-bg text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {/* Followed playlists — only meaningful when the watchlist has some. */}
      {watchedPlaylists.length > 0 && !hasQuery && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Eye size={15} className="text-accent" />
            Followed playlists
            <span className="text-xs font-normal text-text-muted">({watchedPlaylists.length})</span>
          </h2>
          <div className={GRID}>
            {watchedPlaylists.map((p) => {
              const card: AlbumCardData = {
                id: p.id,
                title: p.name,
                artist: p.owner ?? 'Playlist',
                cover: p.image,
                tracks: p.trackCount,
                type: 'playlist',
              };

              /*
               * A watched playlist's id belongs to the service it came from.
               * Passing a Spotify id with service=qobuz built
               * open.qobuz.com/playlist/<spotify-id>, and Qobuz rejects it —
               * "Invalid argument: playlist_id (accepted type are number)".
               * Sending the original URL instead lets the parser convert.
               */
              const foreign = Boolean(p.service && p.service !== service);

              const startDownload = () =>
                download({
                  id: p.id,
                  url: p.url,
                  type: 'playlist',
                  title: p.name,
                  artist: p.owner ?? 'Playlist',
                  cover: p.image,
                  service,
                });

              return (
                <AlbumCard
                  key={p.id}
                  album={card}
                  // Expanding uses /item-tracks, which only understands ids
                  // belonging to the selected service — so a cross-service
                  // playlist downloads (and converts) rather than opening.
                  onClick={() => {
                    if (foreign) {
                      toast.info(`Converting from ${p.service} to ${service}…`, {description: p.name});
                      startDownload();
                    } else {
                      openPlaylist(card);
                    }
                  }}
                  onDownload={startDownload}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Search results */}
      {hasQuery && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Results for “{deferredQuery.trim()}”
            {!isLoading && data.length > 0 && (
              <span className="ml-2 text-xs font-normal text-text-muted">{data.length} found</span>
            )}
          </h2>

          {isLoading ? (
            <div className={GRID}>
              {Array.from({length: 12}).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : isError ? (
            /* The server explains *why*: Spotify search needs credentials,
               Qobuz needs a login. A fixed hint hid all of that. */
            <EmptyState
              title="Could not search playlists"
              hint={error instanceof Error ? error.message : 'Check your service credentials in Settings.'}
            />
          ) : data.length === 0 ? (
            <EmptyState title="No playlists matched" hint="Try a shorter or more general search term." />
          ) : (
            <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SelectionToggle
                items={() =>
                  data.map((r) => ({
                    id: r.id,
                    type: 'playlist' as const,
                    service: searchService as Service,
                    title: r.title,
                    artist: r.artist,
                    cover: extractCover(r.rawData, searchService as Service),
                    url: r.url,
                  }))
                }
              />
            </div>
            <div className={GRID}>
              {data.map((r) => {
                const card: AlbumCardData = {
                  id: r.id,
                  title: r.title,
                  artist: r.artist,
                  cover: extractCover(r.rawData, searchService as Service),
                  type: 'playlist',
                };

                /* Only a playlist from the active service can be expanded:
                 * /item-tracks resolves ids against that service. Anything
                 * else downloads by URL, which is what the converter takes. */
                const sameService = searchService === service;

                return (
                  <div key={`${r.sourceService ?? searchService}-${r.id}`} className="group relative">
                    <AlbumCard
                      album={card}
                      onClick={sameService ? () => openPlaylist(card) : undefined}
                      selectable={{
                        id: r.id,
                        type: 'playlist',
                        service,
                        title: r.title,
                        artist: r.artist,
                        cover: card.cover,
                        url: r.url,
                      }}
                      onDownload={() =>
                        download({
                          id: r.id,
                          url: r.url,
                          type: 'playlist',
                          title: r.title,
                          artist: r.artist,
                          cover: card.cover,
                          service,
                        })
                      }
                    />
                    {/* Watching takes the URL — the only identifier that
                        means anything across services. */}
                    {r.url && (
                      <button
                        onClick={() => {
                          getSocket().emit('addWatchedPlaylist', {url: r.url});
                          toast.info(`Watching ${r.title}`, {
                            description: 'New tracks will appear in your watchlist.',
                          });
                        }}
                        aria-label={`Watch ${r.title}`}
                        title="Watch for new tracks"
                        /* Always visible, and above the card. Hover-only put
                           it behind the card's own overlay on desktop and made
                           it unreachable on touch, so it read as missing. */
                        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white shadow-md transition-colors hover:bg-accent"
                      >
                        <Eye size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}

          {!isLoading && !isError && data.length > 0 && (
            <InfiniteSentinel
              hasMore={Boolean(hasNextPage)}
              loading={isFetchingNextPage}
              onLoadMore={fetchNextPage}
            />
          )}
        </section>
      )}

      {/* Nothing followed and nothing searched. */}
      {!hasQuery && watchedPlaylists.length === 0 && (
        <EmptyState
          icon={<ListMusic size={44} className="opacity-30" />}
          title="No playlists yet"
          hint="Search above to find a playlist, or follow one from the Watchlist to see it here."
        />
      )}

    </div>
  );
}

function EmptyState({icon, title, hint}: {icon?: React.ReactNode; title: string; hint: string}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-text-muted">
      {icon}
      <p className={`font-medium text-text-secondary ${icon ? 'mt-4' : ''}`}>{title}</p>
      <p className="mt-1 max-w-sm text-sm">{hint}</p>
    </div>
  );
}
