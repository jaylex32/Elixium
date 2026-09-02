import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Sparkles, ChevronLeft, ChevronRight} from 'lucide-react';
import {http} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {isExplicit} from '@/shared/lib/explicit';
import {cn} from '@/shared/lib/utils';
import {useSearchHistoryStore} from '@/store/search-history-store';
import {useNavigationStore} from '@/store/navigation-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {usePlayItem} from '@/shared/hooks/usePlayItem';
import {relationsOf} from '@/shared/lib/relations';
import {Button} from '@/shared/components/ui/Button';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import type {RawSearchResult, Service} from '@/types';

/**
 * Albums picked from what this person has actually searched for.
 *
 * Not a recommender in any clever sense, and it does not pretend to be: it
 * takes the last few searches, asks each service for albums matching them, and
 * interleaves the answers so one heavily-searched artist cannot fill the row.
 * That is honest about where the signal comes from — the row says which search
 * it came from — and it needs no profile, no history upload and no third
 * service.
 *
 * Renders nothing at all until there are searches to work from, rather than
 * showing an empty shelf on a fresh install.
 */

/** Enough searches to feel varied, few enough to stay one screen of requests. */
const SOURCE_QUERIES = 3;
const PER_QUERY = 8;

interface Suggestion {
  album: AlbumCardData;
  /** The service payload, for the artist link and for playing. */
  rawData?: Record<string, unknown>;
  /** The search this came from, shown so the row is explicable. */
  from: string;
}

async function fetchAlbums(query: string, service: Service): Promise<RawSearchResult[]> {
  const res = await http.post('/search', {query, service, type: 'album', limit: PER_QUERY, offset: 0});
  return (Array.isArray(res.data) ? res.data : res.data?.results ?? []) as RawSearchResult[];
}

/** One from each query in turn, so the first search does not dominate. */
function interleave(groups: Suggestion[][]): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...groups.map((g) => g.length));

  for (let i = 0; i < longest; i++) {
    for (const group of groups) {
      const entry = group[i];
      if (!entry) continue;
      if (seen.has(entry.album.id)) continue;
      seen.add(entry.album.id);
      out.push(entry);
    }
  }
  return out;
}

export function Recommendations({service}: {service: Service}) {
  const entries = useSearchHistoryStore((s) => s.entries);
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const {download} = useDownload();
  const {playItem} = usePlayItem();

  // Stable across renders so the query key does not change on every paint.
  const queries = useMemo(
    () => entries.slice(0, SOURCE_QUERIES).map((e) => e.query),
    [entries],
  );

  const {data = [], isLoading} = useQuery<Suggestion[]>({
    queryKey: ['recommendations', service, queries.join('|')],
    enabled: queries.length > 0,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const groups = await Promise.all(
        queries.map(async (query) => {
          try {
            const results = await fetchAlbums(query, service);
            return results.map((r) => ({
              from: query,
              album: {
                id: r.id,
                title: r.title,
                artist: r.artist,
                cover: extractCover(r.rawData, service),
                year: r.year ?? undefined,
                type: 'album',
                explicit: isExplicit(r.rawData),
              } as AlbumCardData,
              rawData: r.rawData as Record<string, unknown> | undefined,
            }));
          } catch {
            // One failed search should not empty the whole row.
            return [] as Suggestion[];
          }
        }),
      );
      return interleave(groups).slice(0, 24);
    },
  });

  const scrollBy = (direction: 1 | -1) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const row = event.currentTarget.closest('section')?.querySelector('[data-row]');
    row?.scrollBy({left: direction * Math.max(320, row.clientWidth * 0.8), behavior: 'smooth'});
  };

  // Nothing searched yet, or nothing came back: say nothing rather than
  // occupying the page with an empty shelf.
  if (queries.length === 0) return null;
  if (!isLoading && data.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent/12">
            <Sparkles size={17} className="text-accent" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">Because you searched</h2>
            <p className="truncate text-xs text-text-muted">{queries.join(' · ')}</p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1 lg:flex">
          <Button variant="ghost" size="icon-sm" aria-label="Scroll left" onClick={scrollBy(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Scroll right" onClick={scrollBy(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div data-row className={cn('scroll-row flex gap-3 pb-2', 'sm:gap-4')}>
        {isLoading
          ? Array.from({length: 6}).map((_, i) => (
              <div key={i} className="w-[150px] shrink-0 sm:w-[170px]">
                <CardSkeleton />
              </div>
            ))
          : data.map(({album, from, rawData}) => (
              <div key={`${album.id}-${from}`} className="w-[150px] shrink-0 sm:w-[170px]">
                <AlbumCard
                  album={album}
                  onClick={() => openAlbum({...album, service})}
                  relations={relationsOf(rawData, service)}
                  service={service}
                  onPlay={() =>
                    playItem({
                      id: album.id,
                      type: 'album',
                      service,
                      title: album.title,
                      artist: album.artist,
                      cover: album.cover,
                    })
                  }
                  selectable={{
                    id: album.id,
                    type: 'album',
                    service,
                    title: album.title,
                    artist: album.artist,
                    cover: album.cover,
                  }}
                  onDownload={(quality) =>
                    download({
                      id: album.id,
                      type: 'album',
                      title: album.title,
                      artist: album.artist,
                      cover: album.cover,
                      service, quality})
                  }
                />
              </div>
            ))}
      </div>
    </section>
  );
}
