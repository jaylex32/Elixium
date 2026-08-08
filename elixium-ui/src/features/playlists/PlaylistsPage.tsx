import {useState, useDeferredValue} from 'react';
import {ListMusic, Search, X, Eye} from 'lucide-react';
import {useSearch} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {useAppStore} from '@/store/app-store';
import {useWatchlistStore} from '@/store/watchlist-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import {Input} from '@/shared/components/ui/Input';
import type {Service} from '@/types';

type SelectedPlaylist = AlbumCardData & {service: Service};

/** Shared responsive grid so cards line up identically in both sections. */
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

export function PlaylistsPage() {
  const service = useAppStore((s) => s.service);
  const {download} = useDownload();
  const watchedPlaylists = useWatchlistStore((s) => s.watchedPlaylists);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedPlaylist | null>(null);

  // Keeps typing responsive: the input updates every keystroke while the
  // query that drives fetching lags behind under load.
  const deferredQuery = useDeferredValue(query);
  const {data = [], isLoading, isError} = useSearch(deferredQuery, service, 'playlist');

  const hasQuery = deferredQuery.trim().length >= 2;

  const openPlaylist = (playlist: AlbumCardData) => setSelected({...playlist, service, type: 'playlist'});

  return (
    <div className="animate-fade-in space-y-6 p-4 sm:space-y-8 sm:p-6">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Search playlists on {service === 'deezer' ? 'Deezer' : 'Qobuz'}, or open one you already follow.
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
              return (
                <AlbumCard
                  key={p.id}
                  album={card}
                  onClick={() => openPlaylist(card)}
                  onDownload={() =>
                    download({
                      id: p.id,
                      type: 'playlist',
                      title: p.name,
                      artist: p.owner ?? 'Playlist',
                      cover: p.image,
                      service,
                    })
                  }
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
            <EmptyState
              title="Could not search playlists"
              hint="Check your service credentials in Settings."
            />
          ) : data.length === 0 ? (
            <EmptyState title="No playlists matched" hint="Try a shorter or more general search term." />
          ) : (
            <div className={GRID}>
              {data.map((r) => {
                const card: AlbumCardData = {
                  id: r.id,
                  title: r.title,
                  artist: r.artist,
                  cover: extractCover(r.rawData, service),
                  type: 'playlist',
                };
                return (
                  <AlbumCard
                    key={r.id}
                    album={card}
                    onClick={() => openPlaylist(card)}
                    onDownload={() =>
                      download({
                        id: r.id,
                        type: 'playlist',
                        title: r.title,
                        artist: r.artist,
                        cover: card.cover,
                        service,
                      })
                    }
                  />
                );
              })}
            </div>
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

      {selected && <AlbumModal album={selected} open onClose={() => setSelected(null)} />}
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
