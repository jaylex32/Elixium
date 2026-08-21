import {useState} from 'react';
import {Music2, Disc3, ListMusic, Mic2, ArrowLeft} from 'lucide-react';
import {cn, toSeconds, formatDuration} from '@/shared/lib/utils';
import {useGenreContent, useGenres, type GenreKind} from '@/shared/lib/api';
import {InfiniteSentinel} from '@/shared/components/InfiniteSentinel';
import {extractCover} from '@/shared/lib/cover';
import {isExplicit} from '@/shared/lib/explicit';
import {relationsOf} from '@/shared/lib/relations';
import {useAppStore} from '@/store/app-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {ArtistCard} from '@/shared/components/ArtistCard';
import {ExplicitBadge} from '@/shared/components/ExplicitBadge';
import {ArtistLink} from '@/shared/components/RelationLinks';
import {TrackActions} from '@/shared/components/TrackActions';
import {SelectionToggle} from '@/shared/components/SelectionToggle';
import {GridSkeleton, ListSkeleton, EmptyState, ErrorState} from '@/shared/components/States';
import {TabsRoot, TabsList, TabsTrigger} from '@/shared/components/ui/Tabs';
import {useNavigationStore} from '@/store/navigation-store';
import type {SelectableItem, SelectableType} from '@/store/selection-store';
import type {Service} from '@/types';

/*
 * A rail of genres beside their content, rather than a wall of tiles above it.
 *
 * The first version filled the screen with twenty-seven square tiles and put
 * everything they opened underneath, so choosing a genre scrolled the choice
 * itself out of view and comparing two of them meant scrolling up and back
 * down. Keeping the list in a column leaves the current genre visible, makes
 * switching one click, and gives the content the whole width it deserves.
 *
 * On a phone the column becomes a single row of chips for the same reason: the
 * list stays on screen, and it costs one line instead of five rows of tiles.
 */

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5';

const TABS: {id: GenreKind; label: string; icon: React.ElementType}[] = [
  {id: 'albums', label: 'Albums', icon: Disc3},
  {id: 'tracks', label: 'Tracks', icon: Music2},
  {id: 'playlists', label: 'Playlists', icon: ListMusic},
  {id: 'artists', label: 'Artists', icon: Mic2},
];

function GenreContent({
  genreId,
  genreName,
  genrePicture,
  service,
  onBack,
}: {
  genreId: string;
  genreName: string;
  genrePicture?: string;
  service: Service;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<GenreKind>('albums');
  const {data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage} = useGenreContent(
    service,
    genreId,
    tab,
  );
  const {download} = useDownload();
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const items = data?.pages.flat() ?? [];

  const selectables = (): SelectableItem[] => {
    const type: SelectableType =
      tab === 'tracks' ? 'track' : tab === 'artists' ? 'artist' : tab === 'albums' ? 'album' : 'playlist';
    return items.map((r) => ({
      id: r.id,
      type,
      service,
      title: r.title,
      artist: r.artist,
      cover: extractCover(r.rawData, service),
    }));
  };

  const playFrom = (index: number) => {
    const queue = items.map((r) =>
      makeTrack({
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: typeof r.album === 'string' ? r.album : undefined,
        cover: extractCover(r.rawData, service),
        duration: toSeconds(r.duration),
        service,
        previewUrl: r.rawData?.preview as string | undefined,
      }),
    );
    if (queue[index]) setTrack(queue[index], queue);
  };

  return (
    <div className="min-w-0 flex-1 space-y-4">
      {/* Back first, then the genre this is: the same shape as an album or an
          artist view, so the way out is where it already is elsewhere. */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Back to genres"
          title="Back to genres"
          className="touch-target flex shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-bg hover:text-text-primary"
        >
          <ArrowLeft size={19} />
        </button>

        {genrePicture ? (
          <img src={genrePicture} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-sm object-cover" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-surface-bg">
            <Music2 size={17} className="text-text-muted" />
          </span>
        )}

        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-text-muted">Genre</p>
          <h2 className="truncate text-lg font-bold leading-tight text-text-primary">{genreName}</h2>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* min-w-0 so the strip inside can scroll instead of pushing this
            wrapper past the screen: four labelled tabs are two pixels wider
            than a 374px phone, and a flex child will not shrink without it. */}
        <TabsRoot value={tab} onValueChange={(v) => setTab(v as GenreKind)} className="min-w-0 max-w-full">
          <TabsList>
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.id} value={t.id}>
                  <Icon size={13} className="mr-1.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </TabsRoot>

        {items.length > 0 && (
          <div className="ml-auto">
            <SelectionToggle items={selectables} />
          </div>
        )}
      </div>

      {isLoading && (tab === 'tracks' ? <ListSkeleton count={10} /> : <GridSkeleton />)}
      {isError && <ErrorState title={`Could not load ${genreName}`} onRetry={() => refetch()} />}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          title={`No ${tab} for ${genreName}`}
          hint={
            service === 'qobuz'
              ? 'Qobuz publishes featured albums per genre only — try Albums, or switch to Deezer.'
              : 'Try another tab.'
          }
        />
      )}

      {!isLoading && !isError && items.length > 0 && tab === 'tracks' && (
        <div className="space-y-0.5">
          {items.map((r, i) => {
            const cover = extractCover(r.rawData, service);
            const relations = relationsOf(r.rawData, service);
            const isActive = currentTrack?.id === r.id;
            const seconds = toSeconds(r.duration);
            return (
              <div
                key={`${r.id}-${i}`}
                className={cn(
                  'rows-track group flex items-center gap-3 rounded-md px-2 py-2 transition-colors sm:px-3',
                  isActive ? 'bg-accent/10' : 'hover:bg-surface-bg',
                )}
              >
                <button onClick={() => playFrom(i)} className="h-11 w-11 shrink-0" aria-label={`Play ${r.title}`}>
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" className="h-11 w-11 rounded-sm object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-bg">
                      <Music2 size={16} className="text-text-muted" />
                    </span>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'flex items-center gap-1.5 text-sm font-medium',
                      isActive ? 'text-accent' : 'text-text-primary',
                    )}
                  >
                    <span className="truncate">{r.title}</span>
                    {isExplicit(r.rawData) && <ExplicitBadge />}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    <ArtistLink name={r.artist} relations={relations} service={service} />
                  </p>
                </div>

                {seconds > 0 && (
                  <span className="hidden shrink-0 text-xs tabular-nums text-text-muted sm:block">
                    {formatDuration(seconds)}
                  </span>
                )}

                <TrackActions
                  track={{
                    id: r.id,
                    title: r.title,
                    artist: r.artist,
                    album: typeof r.album === 'string' ? r.album : undefined,
                    cover,
                    duration: seconds,
                    service,
                  }}
                  relations={relations}
                  onPlay={() => playFrom(i)}
                  onDownload={() =>
                    download({id: r.id, type: 'track', title: r.title, artist: r.artist, cover, service})
                  }
                  className="lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && tab === 'artists' && (
        <div className={GRID}>
          {items.map((r) => (
            <ArtistCard
              key={r.id}
              artist={{id: r.id, name: r.title, picture: extractCover(r.rawData, service), service}}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (tab === 'albums' || tab === 'playlists') && (
        <div className={GRID}>
          {items.map((r) => {
            const card: AlbumCardData = {
              id: r.id,
              title: r.title,
              artist: r.artist,
              cover: extractCover(r.rawData, service),
              year: r.year ?? undefined,
              type: tab === 'albums' ? 'album' : 'playlist',
              explicit: isExplicit(r.rawData),
            };
            return (
              <AlbumCard
                key={r.id}
                album={card}
                onClick={() => openAlbum({...card, service})}
                relations={relationsOf(r.rawData, service)}
                service={service}
                selectable={{
                  id: r.id,
                  type: tab === 'albums' ? 'album' : 'playlist',
                  service,
                  title: r.title,
                  artist: r.artist,
                  cover: card.cover,
                }}
                onDownload={() =>
                  download({
                    id: r.id,
                    type: tab === 'albums' ? 'album' : 'playlist',
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

      {!isLoading && !isError && items.length > 0 && (
        <InfiniteSentinel hasMore={Boolean(hasNextPage)} loading={isFetchingNextPage} onLoadMore={fetchNextPage} />
      )}
    </div>
  );
}

export function GenresPage() {
  const service = useAppStore((s) => s.service);
  const [selected, setSelected] = useState<string | null>(null);
  const {data: genres = [], isLoading} = useGenres(service);

  // "All genres" is the whole catalogue, which is what Charts already shows.
  const list = genres.filter((g) => g.id !== '0');
  const current = list.find((g) => g.id === selected);

  /*
   * Two views, not one crowded one: pick a genre, then browse it.
   *
   * A rail down the side spent a fifth of the width on a list that is read
   * once and then ignored, and on a phone it pushed the content down behind a
   * row of chips. Picking is a moment; browsing is the rest of the visit, so
   * browsing gets the whole page and the picker is one Back away.
   */
  if (current) {
    return (
      <div data-genre-view={current.id} className="animate-fade-in px-4 pb-8 pt-5 sm:px-6">
        <GenreContent
          key={`${service}:${current.id}`}
          genreId={current.id}
          genreName={current.name}
          genrePicture={current.picture}
          service={service}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5 px-4 pb-8 pt-5 sm:px-6">
      <p className="text-sm text-text-muted">Pick a genre to browse its albums, tracks, playlists and artists</p>

      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({length: 18}).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-surface-bg" />
          ))}
        </div>
      )}

      {!isLoading && list.length === 0 && (
        <EmptyState title="No genres available" hint="Switch service, or check your credentials in Settings." />
      )}

      <div
        data-genre-picker
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      >
        {list.map((genre) => (
          <button
            key={genre.id}
            data-genre-tile={genre.id}
            onClick={() => setSelected(genre.id)}
            className={cn(
              'group relative flex aspect-square items-end overflow-hidden rounded-lg border border-border bg-card-bg p-3',
              'transition-all duration-base ease-out hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
          >
            {genre.picture ? (
              <img
                src={genre.picture}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-slow ease-out group-hover:scale-110"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center bg-surface-bg">
                <Music2 size={26} className="text-text-muted" />
              </span>
            )}

            {/* Dark enough at the foot for the name to stay legible over any
                artwork, and light enough at the top to leave the art visible. */}
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

            <span className="relative w-full truncate text-left text-sm font-semibold text-white drop-shadow-sm">
              {genre.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
