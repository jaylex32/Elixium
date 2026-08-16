import {useState, useMemo} from 'react';
import {TrendingUp, Play, Music2} from 'lucide-react';
import {useCharts, useChartGenres, useChartCountries, useCountryChart, type ChartKind} from '@/shared/lib/api';
import {cn, formatDuration, toSeconds} from '@/shared/lib/utils';
import {extractCover} from '@/shared/lib/cover';
import {isExplicit} from '@/shared/lib/explicit';
import {ExplicitBadge} from '@/shared/components/ExplicitBadge';
import {useAppStore} from '@/store/app-store';
import {getSocket} from '@/shared/lib/socket';
import {toast} from 'sonner';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {ArtistCard} from '@/shared/components/ArtistCard';
import {Button} from '@/shared/components/ui/Button';
import {Select} from '@/shared/components/ui/Select';
import {GridSkeleton, ListSkeleton, EmptyState, ErrorState} from '@/shared/components/States';
import {InfiniteSentinel} from '@/shared/components/InfiniteSentinel';
import {TrackActions} from '@/shared/components/TrackActions';
import {FavoriteButton} from '@/shared/components/FavoriteButton';
import type {Service} from '@/types';

const KINDS: {id: ChartKind; label: string}[] = [
  {id: 'tracks', label: 'Tracks'},
  {id: 'albums', label: 'Albums'},
  {id: 'artists', label: 'Artists'},
  {id: 'playlists', label: 'Playlists'},
];

/*
 * Radix rejects an empty-string option value outright — it reserves "" to mean
 * "cleared, show the placeholder". The genre/country switch needs a real value
 * for its default choice, so it carries a sentinel and is mapped back to the
 * empty countryId the rest of the page tests against.
 */
const GENRE_MODE = '__genres__';

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

/**
 * Ranked charts.
 *
 * Separate from Discover, which shows editorial selections — this is the
 * ordered "what is actually top right now" list, per genre, which is the thing
 * people go to a downloader for and had no home here.
 */
export function ChartsPage() {
  const service = useAppStore((s) => s.service);
  const [kind, setKind] = useState<ChartKind>('tracks');
  const [genreId, setGenreId] = useState('0');
  /* Country charts are a separate axis: Deezer publishes them as official
     "Top <Country>" playlists rather than through the /chart endpoint. */
  const [countryId, setCountryId] = useState('');
  const [selected, setSelected] = useState<(AlbumCardData & {service: Service}) | null>(null);

  const {download} = useDownload();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const {data: genres = []} = useChartGenres(service);
  const {data: countries = []} = useChartCountries(service === 'deezer');

  const genreQuery = useCharts(service, genreId, kind);
  const countryQuery = useCountryChart(countryId, Boolean(countryId));

  // One source or the other; a country chart is always a track list.
  const source = countryId ? countryQuery : genreQuery;
  const {isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage} = source;
  const items = useMemo(() => source.data?.pages.flat() ?? [], [source.data]);
  const effectiveKind: ChartKind = countryId ? 'tracks' : kind;

  /* Qobuz has no chart API; its stand-ins are album lists only, so the other
     tabs would silently return nothing. Saying so beats an empty grid. */
  const qobuzUnsupported = service === 'qobuz' && !countryId && kind !== 'albums';

  const watchPlaylist = (id: string, title: string) => {
    const url =
      service === 'deezer' ? `https://www.deezer.com/playlist/${id}` : `https://play.qobuz.com/playlist/${id}`;
    getSocket().emit('addWatchedPlaylist', {url});
    toast.success(`Watching ${title}`, {description: 'New tracks will appear in your watchlist.'});
  };

  const playAll = (startIndex: number) => {
    const tracks = items.map((r) =>
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
    <div className="mx-auto max-w-content animate-fade-in px-4 pb-8 pt-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold text-text-primary">
          <TrendingUp size={18} className="text-accent" />
          Charts
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {service === 'deezer' && countries.length > 0 && (
            <Select
              value={countryId || GENRE_MODE}
              onValueChange={(value) => setCountryId(value === GENRE_MODE ? '' : value)}
              options={[
                {value: GENRE_MODE, label: 'By genre'},
                ...countries.map((c) => ({value: c.id, label: c.name})),
              ]}
              placeholder="Country"
              className="h-9 w-44"
            />
          )}

          <Select
            value={genreId}
            onValueChange={setGenreId}
            options={genres.map((genre) => ({value: genre.id, label: genre.name}))}
            placeholder="Genre"
            className="h-9 w-44"
          />

          <div className={cn('scroll-row flex gap-1 rounded-sm border border-border bg-secondary-bg p-1', countryId && 'hidden')}>
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                className={cn(
                  'min-h-9 shrink-0 rounded-xs px-3 text-xs font-medium transition-colors',
                  kind === k.id ? 'bg-card-bg text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {qobuzUnsupported && (
        <EmptyState
          title="Qobuz publishes album charts only"
          hint="Switch to Deezer for track, artist and playlist charts, or pick Albums."
        />
      )}

      {!qobuzUnsupported && (
        <>
          {isLoading && (effectiveKind === 'tracks' ? <ListSkeleton count={12} /> : <GridSkeleton />)}
          {isError && <ErrorState title="Could not load charts" onRetry={() => refetch()} />}
          {!isLoading && !isError && items.length === 0 && (
            <EmptyState title="No chart entries" hint="Try a different genre." />
          )}

          {!isLoading && !isError && items.length > 0 && effectiveKind === 'tracks' && (
            <>
              <div className="mb-3">
                <Button size="sm" variant="secondary" onClick={() => playAll(0)}>
                  <Play size={13} />
                  Play chart
                </Button>
              </div>
              <div className="space-y-0.5">
                {items.map((r, i) => {
                  const cover = extractCover(r.rawData, service);
                  const isActive = currentTrack?.id === r.id;
                  return (
                    <div
                      key={`${r.id}-${i}`}
                      className={cn(
                        'rows-track group flex items-center gap-3 rounded-md px-2 py-2 transition-colors sm:px-3',
                        isActive ? 'bg-accent/10' : 'hover:bg-surface-bg',
                      )}
                    >
                      {/* Chart position is the point of a chart. */}
                      <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-text-muted">
                        {i + 1}
                      </span>

                      <button onClick={() => playAll(i)} className="relative h-11 w-11 shrink-0" aria-label={`Play ${r.title}`}>
                        {cover ? (
                          <img src={cover} alt="" loading="lazy" className="h-11 w-11 rounded-sm object-cover" />
                        ) : (
                          <span className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-bg">
                            <Music2 size={16} className="text-text-muted" />
                          </span>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p className={cn('flex items-center gap-1.5 text-sm font-medium', isActive ? 'text-accent' : 'text-text-primary')}>
                          <span className="truncate">{r.title}</span>
                          {isExplicit(r.rawData) && <ExplicitBadge />}
                        </p>
                        <p className="truncate text-xs text-text-muted">{r.artist}</p>
                      </div>

                      {toSeconds(r.duration) > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">
                          {formatDuration(toSeconds(r.duration))}
                        </span>
                      )}

                      <FavoriteButton
                        item={{id: r.id, type: 'track', service, title: r.title, artist: r.artist, cover}}
                      />

                      <TrackActions
                        track={{id: r.id, title: r.title, artist: r.artist, album: r.album, cover, duration: toSeconds(r.duration), service}}
                        onPlay={() => playAll(i)}
                        onDownload={() => download({id: r.id, type: 'track', title: r.title, artist: r.artist, cover, service})}
                        className="lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!isLoading && !isError && items.length > 0 && effectiveKind === 'artists' && (
            <div className={GRID}>
              {items.map((r) => (
                <ArtistCard
                  key={r.id}
                  artist={{id: r.id, name: r.title, picture: extractCover(r.rawData, service), service}}
                />
              ))}
            </div>
          )}

          {!isLoading && !isError && items.length > 0 && (effectiveKind === 'albums' || effectiveKind === 'playlists') && (
            <div className={GRID}>
              {items.map((r) => {
                const card: AlbumCardData = {
                  id: r.id,
                  title: r.title,
                  artist: r.artist,
                  cover: extractCover(r.rawData, service),
                  year: r.year ?? undefined,
                  type: effectiveKind === 'albums' ? 'album' : 'playlist',
                  explicit: isExplicit(r.rawData),
                };
                return (
                  <AlbumCard
                    key={r.id}
                    album={card}
                    onClick={() => setSelected({...card, service})}
                    onWatch={effectiveKind === 'playlists' ? () => watchPlaylist(r.id, r.title) : undefined}
                    selectable={{
                      id: r.id,
                      type: effectiveKind === 'albums' ? 'album' : 'playlist',
                      service,
                      title: r.title,
                      artist: r.artist,
                      cover: card.cover,
                    }}
                    onDownload={() =>
                      download({
                        id: r.id,
                        type: effectiveKind === 'albums' ? 'album' : 'playlist',
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
            <InfiniteSentinel
              hasMore={Boolean(hasNextPage)}
              loading={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              endLabel={`End of the chart — ${items.length} entries`}
            />
          )}
        </>
      )}

      {selected && <AlbumModal album={selected} open onClose={() => setSelected(null)} />}
    </div>
  );
}
