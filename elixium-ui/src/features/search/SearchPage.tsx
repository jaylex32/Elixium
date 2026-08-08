import {useState, useEffect, useMemo} from 'react';
import {Search, X, Clock, Trash2, Play, Pause, Music2, ArrowUpDown} from 'lucide-react';
import {useSearch} from '@/shared/lib/api';
import {cn, formatDuration, toSeconds} from '@/shared/lib/utils';
import {extractCover} from '@/shared/lib/cover';
import {useAppStore} from '@/store/app-store';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {useSearchHistoryStore} from '@/store/search-history-store';
import {TabsRoot, TabsList, TabsTrigger, TabsContent} from '@/shared/components/ui/Tabs';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {ArtistCard} from '@/shared/components/ArtistCard';
import {Input} from '@/shared/components/ui/Input';
import {Button} from '@/shared/components/ui/Button';
import {Spinner} from '@/shared/components/ui/Spinner';
import {GridSkeleton, ListSkeleton, EmptyState} from '@/shared/components/States';
import {TrackActions} from '@/shared/components/TrackActions';
import type {RawSearchResult, Service} from '@/types';

type SearchType = 'track' | 'album' | 'artist' | 'playlist';
type SortMode = 'relevance' | 'title' | 'duration';

const TYPE_TABS: {value: SearchType; label: string}[] = [
  {value: 'track', label: 'Tracks'},
  {value: 'album', label: 'Albums'},
  {value: 'artist', label: 'Artists'},
  {value: 'playlist', label: 'Playlists'},
];

const SORTS: {value: SortMode; label: string}[] = [
  {value: 'relevance', label: 'Relevance'},
  {value: 'title', label: 'A–Z'},
  {value: 'duration', label: 'Longest'},
];

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

function toAlbumCard(r: RawSearchResult, service: Service): AlbumCardData {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    cover: extractCover(r.rawData, service),
    year: r.year ?? undefined,
    type: r.type,
  };
}

/** Rich track row: art doubles as the play control, with album and duration columns. */
function ResultRow({
  result,
  index,
  service,
  onPlay,
  onDownload,
}: {
  result: RawSearchResult;
  index: number;
  service: Service;
  onPlay: () => void;
  onDownload: () => void;
}) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isActive = currentTrack?.id === result.id;

  const cover = extractCover(result.rawData, service);
  const seconds = toSeconds(result.duration);

  return (
    <div
      className={cn(
        'rows-track group flex items-center gap-3 rounded-md px-2 py-2 transition-colors sm:gap-4 sm:px-3',
        isActive ? 'bg-accent/10' : 'hover:bg-surface-bg',
      )}
    >
      <span className="hidden w-6 shrink-0 text-right text-xs tabular-nums text-text-muted sm:block">{index}</span>

      <button onClick={onPlay} className="relative h-12 w-12 shrink-0" aria-label={`Play ${result.title}`}>
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="h-12 w-12 rounded-sm object-cover shadow-sm" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-sm bg-surface-bg">
            <Music2 size={17} className="text-text-muted" />
          </span>
        )}
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-sm bg-black/55 transition-opacity',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isActive && isPlaying ? (
            <Pause size={16} className="text-white" />
          ) : (
            <Play size={16} className="text-white" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', isActive ? 'text-accent' : 'text-text-primary')}>
          {result.title}
        </p>
        <p className="truncate text-xs text-text-muted">{result.artist}</p>
      </div>

      {/* Album gets its own column on wide viewports — it was previously dead
          space between the title and the duration. */}
      {result.album && (
        <p className="hidden min-w-0 flex-1 truncate text-xs text-text-muted lg:block">{result.album}</p>
      )}

      {seconds > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-text-muted">{formatDuration(seconds)}</span>
      )}

      <TrackActions
        track={{
          id: result.id,
          title: result.title,
          artist: result.artist,
          album: result.album,
          cover,
          duration: seconds,
          service,
        }}
        onPlay={onPlay}
        onDownload={onDownload}
        className="lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
      />
    </div>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('track');
  const [sort, setSort] = useState<SortMode>('relevance');
  const [selectedAlbum, setSelectedAlbum] = useState<(AlbumCardData & {service: Service}) | null>(null);

  const service = useAppStore((s) => s.service);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const {download} = useDownload();

  const {data = [], isLoading, isFetching} = useSearch(query, service, type);
  const spinning = isLoading || isFetching;

  const {entries: recentSearches, record, remove, clear} = useSearchHistoryStore();

  useEffect(() => {
    if (!spinning && query.trim().length >= 2 && data.length > 0) record(query, type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, query, type, data.length]);

  /** Sorting is client-side: the catalog API has no sort parameter. */
  const results = useMemo(() => {
    if (sort === 'relevance') return data;
    const copy = [...data];
    if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title));
    return copy.sort((a, b) => toSeconds(b.duration) - toSeconds(a.duration));
  }, [data, sort]);

  const idle = query.trim().length < 2;
  const isEmpty = !idle && !spinning && data.length === 0;
  const showSort = type === 'track' && results.length > 1;

  const playAll = (startIndex: number) => {
    const tracks = results.map((r) =>
      makeTrack({
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        cover: extractCover(r.rawData, service),
        duration: toSeconds(r.duration),
        service,
        previewUrl: r.rawData?.preview as string | undefined,
      }),
    );
    if (tracks[startIndex]) setTrack(tracks[startIndex], tracks);
  };

  return (
    <div className="animate-fade-in px-4 pb-8 pt-6 sm:px-6">
      {/* Centred search column. The bar previously spanned the full content
          width with its type tabs pinned left, which read as unbalanced. */}
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div className="relative">
          <Input
            icon={spinning ? <Spinner size="sm" /> : <Search size={17} />}
            suffix={
              query ? (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="text-text-muted hover:text-text-primary">
                  <X size={15} />
                </button>
              ) : null
            }
            placeholder={`Search ${service === 'deezer' ? 'Deezer' : 'Qobuz'}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-14 rounded-lg pl-11 pr-11 text-base shadow-md"
            autoFocus
          />
        </div>

        <TabsRoot value={type} onValueChange={(v) => setType(v as SearchType)}>
          {/* w-fit + mx-auto centres the strip under the bar. */}
          <TabsList className="mx-auto w-fit">
            {TYPE_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {idle && recentSearches.length > 0 && (
            <section className="mt-6 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <Clock size={12} />
                  Recent
                </h2>
                <button onClick={clear} className="text-xs text-text-muted transition-colors hover:text-text-primary">
                  Clear all
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {recentSearches.map((entry) => (
                  <span
                    key={entry.query}
                    className="group flex items-center rounded-full border border-border bg-card-bg transition-colors hover:border-accent/40"
                  >
                    <button
                      onClick={() => {
                        setQuery(entry.query);
                        setType(entry.type as SearchType);
                      }}
                      className="min-h-9 rounded-l-full py-1 pl-3.5 pr-2 text-sm text-text-secondary transition-colors group-hover:text-text-primary"
                    >
                      {entry.query}
                    </button>
                    <button
                      onClick={() => remove(entry.query)}
                      aria-label={`Remove ${entry.query}`}
                      className="flex h-9 w-8 items-center justify-center rounded-r-full text-text-muted transition-colors hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Results widen past the search column — a 6-up grid needs the room. */}
          <div className="mx-auto mt-6 w-full max-w-content">
            {!idle && !spinning && results.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-text-muted">
                  {results.length} {type}
                  {results.length === 1 ? '' : 's'} for “{query.trim()}”
                </p>
                <div className="flex items-center gap-2">
                  {type === 'track' && (
                    <Button size="sm" variant="secondary" onClick={() => playAll(0)}>
                      <Play size={13} />
                      Play all
                    </Button>
                  )}
                  {showSort && (
                    <div className="flex items-center gap-1 rounded-sm border border-border bg-secondary-bg p-0.5">
                      <ArrowUpDown size={12} className="ml-1.5 text-text-muted" />
                      {SORTS.map((s) => (
                        <button
                          key={s.value}
                          onClick={() => setSort(s.value)}
                          aria-pressed={sort === s.value}
                          className={cn(
                            'rounded-xs px-2 py-1 text-xs font-medium transition-colors',
                            sort === s.value
                              ? 'bg-card-bg text-text-primary shadow-sm'
                              : 'text-text-muted hover:text-text-secondary',
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {spinning && (type === 'track' || type === 'playlist' ? <ListSkeleton count={10} /> : <GridSkeleton />)}

            {idle && !spinning && (
              <EmptyState
                icon={<Search size={24} />}
                title="Start typing to search"
                hint="Tracks, albums, artists and playlists across your selected service."
              />
            )}

            {isEmpty && (
              <EmptyState title={`No results for “${query.trim()}”`} hint="Try a different term, or switch service in the sidebar." />
            )}

            <TabsContent value="track">
              {!spinning && results.length > 0 && (
                <div className="space-y-0.5">
                  {results.map((r, i) => (
                    <ResultRow
                      key={r.id}
                      result={r}
                      index={i + 1}
                      service={service}
                      onPlay={() => playAll(i)}
                      onDownload={() =>
                        download({
                          id: r.id,
                          type: 'track',
                          title: r.title,
                          artist: r.artist,
                          cover: extractCover(r.rawData, service),
                          service,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="album">
              {!spinning && results.length > 0 && (
                <div className={GRID}>
                  {results.map((r) => {
                    const album = toAlbumCard(r, service);
                    return (
                      <AlbumCard
                        key={r.id}
                        album={album}
                        onClick={() => setSelectedAlbum({...album, service})}
                        onDownload={() =>
                          download({id: r.id, type: 'album', title: r.title, artist: r.artist, cover: album.cover, service})
                        }
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="artist">
              {!spinning && results.length > 0 && (
                <div className={GRID}>
                  {results.map((r) => (
                    <ArtistCard
                      key={r.id}
                      artist={{
                        id: r.id,
                        name: r.title,
                        picture: extractCover(r.rawData, service),
                        fans: (r.rawData?.nb_fan ?? r.rawData?.NB_FAN) as number | undefined,
                        service,
                      }}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="playlist">
              {!spinning && results.length > 0 && (
                <div className={GRID}>
                  {results.map((r) => {
                    const card = {...toAlbumCard(r, service), type: 'playlist'};
                    return (
                      <AlbumCard
                        key={r.id}
                        album={card}
                        onClick={() => setSelectedAlbum({...card, service})}
                        onDownload={() =>
                          download({id: r.id, type: 'playlist', title: r.title, artist: r.artist, cover: card.cover, service})
                        }
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </div>
        </TabsRoot>
      </div>

      {selectedAlbum && <AlbumModal album={selectedAlbum} open onClose={() => setSelectedAlbum(null)} />}
    </div>
  );
}
