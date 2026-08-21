import {useState, useMemo} from 'react';
import {
  TrendingUp,
  Sparkles,
  ListMusic,
  Play,
  Download,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Rows3,
  Music2,
  Eye,
  Link2,
  Users,
  Award,
  Flame,
  Headphones,
  Library,
} from 'lucide-react';
import {useDiscovery} from '@/shared/lib/api';
import {cn} from '@/shared/lib/utils';
import {relationsOf} from '@/shared/lib/relations';
import {usePlayItem} from '@/shared/hooks/usePlayItem';
import {extractCover} from '@/shared/lib/cover';
import {isExplicit} from '@/shared/lib/explicit';
import {useAppStore, type Page} from '@/store/app-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {SelectionToggle} from '@/shared/components/SelectionToggle';
import {ArtistCard} from '@/shared/components/ArtistCard';
import {useNavigationStore} from '@/store/navigation-store';
import {Recommendations} from './Recommendations';
import {Button} from '@/shared/components/ui/Button';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import {ErrorState} from '@/shared/components/States';
import type {RawDiscoveryItem, Service} from '@/types';

interface Section {
  type: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
}

/** Rows both services can serve. */
const COMMON_SECTIONS: Section[] = [
  {type: 'trending-albums', title: 'Trending', subtitle: 'What people are playing', icon: TrendingUp},
  {type: 'popular-playlists', title: 'Popular Playlists', subtitle: 'Curated collections', icon: ListMusic},
  {type: 'top-artists', title: 'Top Artists', subtitle: 'Names worth following', icon: Users},
];

/*
 * Service-specific rows. Qobuz and Deezer expose different editorial feeds,
 * and asking one for the other's feed returns an empty row — so the home page
 * only requests what the selected service can actually answer.
 */
const SERVICE_SECTIONS: Record<string, Section[]> = {
  qobuz: [
    // Qobuz publishes a real new-release feed (album/getFeatured,
    // type=new-releases-full). Deezer no longer does: its
    // editorial/0/releases endpoint returns an empty list, and the fallback
    // standing in for it was a text search for '2025' — so Deezer gets
    // Trending instead, which is real chart data.
  {type: 'new-releases', title: 'New Releases', subtitle: 'Fresh this week', icon: Sparkles},
    {type: 'qobuzissims', title: 'Qobuzissims', subtitle: "Qobuz's own selection", icon: Award},
    {type: 'best-sellers', title: 'Best Sellers', subtitle: 'Most bought on Qobuz', icon: Flame},
    {type: 'most-streamed', title: 'Most Streamed', subtitle: 'Played the most right now', icon: Headphones},
    {type: 'ideal-discography', title: 'Ideal Discography', subtitle: 'Essential albums to own', icon: Library},
    {type: 'latest-playlists', title: 'Newest Playlists', subtitle: 'Freshly curated', icon: ListMusic},
  ],
  deezer: [
    {type: 'top-tracks', title: 'Top Tracks', subtitle: 'The current chart', icon: Flame},
    {type: 'genre-pop', title: 'Pop', subtitle: 'Popular right now', icon: Headphones},
    {type: 'genre-rap', title: 'Hip-Hop & Rap', subtitle: 'Popular right now', icon: Headphones},
    {type: 'genre-jazz', title: 'Jazz', subtitle: 'Popular right now', icon: Library},
  ],
};

const QUICK_LINKS: {page: Page; label: string; icon: React.ElementType}[] = [
  {page: 'genres', label: 'Browse genres', icon: Music2},
  {page: 'playlists', label: 'Playlists', icon: ListMusic},
  {page: 'watchlist', label: 'Watchlist', icon: Eye},
  {page: 'url-download', label: 'Paste a link', icon: Link2},
];

function toAlbum(item: RawDiscoveryItem, service: Service): AlbumCardData {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    cover: extractCover(item.rawData, service),
    year: item.year ?? undefined,
    type: item.type,
    explicit: isExplicit(item.rawData),
  };
}

/** Large featured tile built from the first new release. */
function Hero({
  item,
  service,
  onOpen,
}: {
  item: AlbumCardData;
  service: Service;
  onOpen: () => void;
}) {
  const {download} = useDownload();

  return (
    <section className="relative overflow-hidden rounded-lg border border-border shadow-lg">
      {/* Blurred artwork bed — gives the band depth without a separate asset. */}
      {item.cover && (
        <div
          aria-hidden
          className="absolute inset-0 scale-110 bg-cover bg-center opacity-35 blur-2xl"
          style={{backgroundImage: `url(${item.cover})`}}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-primary-bg via-primary-bg/85 to-primary-bg/40" />

      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:gap-6 sm:p-7">
        <button
          onClick={onOpen}
          className="group relative mx-auto aspect-square w-40 shrink-0 overflow-hidden rounded-md shadow-xl sm:mx-0 sm:w-48"
          aria-label={`Open ${item.title}`}
        >
          {item.cover ? (
            <img src={item.cover} alt="" className="h-full w-full object-cover transition-transform duration-slow group-hover:scale-105" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-surface-bg">
              <Music2 size={40} className="text-text-muted" />
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            {/* Qobuz's feed really is a curated new release; Deezer's is chart
                data, and calling that "featured" was untrue on both words. */}
            {service === 'deezer' ? 'Trending now' : 'Featured release'}
          </p>
          <h2 className="mt-1.5 text-display-sm font-bold text-text-primary">{item.title}</h2>
          <p className="mt-1 truncate text-sm text-text-secondary">{item.artist}</p>
          {item.year && <p className="mt-0.5 text-xs text-text-muted">{item.year}</p>}

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button onClick={onOpen}>
              <Play size={15} />
              Open album
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                download({
                  id: item.id,
                  type: 'album',
                  title: item.title,
                  artist: item.artist,
                  cover: item.cover,
                  service,
                })
              }
            >
              <Download size={15} />
              Download
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A discovery row.
 *
 * Defaults to a horizontal carousel so several sections are visible at once
 * instead of one flat grid filling the viewport; "Show all" expands it into a
 * wrapping grid for browsing in bulk.
 */
function DiscoverySection({
  type,
  title,
  subtitle,
  icon: Icon,
  service,
  excludeId,
  onSelect,
}: {
  type: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  service: Service;
  /** Id already shown by the hero, so the row does not repeat it. */
  excludeId?: string;
  onSelect: (album: AlbumCardData) => void;
}) {
  const {data = [], isLoading, isError, refetch} = useDiscovery(service, type);
  const {download} = useDownload();
  const {playItem} = usePlayItem();
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const [expanded, setExpanded] = useState(false);

  const raw = data.filter((item) => item.id !== excludeId);
  const items = raw.map((item) => toAlbum(item, service));

  /*
   * Artist feeds return people, not releases. Rendering them as album cards
   * meant a click opened the album expander with an artist id, which resolves
   * to an unrelated album. ArtistCard opens the artist view instead.
   */
  const isArtistRow = items.length > 0 && items.every((item) => item.type === 'artist');

  /*
   * Track feeds are the same mistake with a different id.
   *
   * Top Tracks returns tracks, and every card treated one as an album: the
   * click opened the album view with a track id, which resolves to nothing and
   * reported "Could not load tracks", while the checkbox and the download
   * button both queued it as an album.
   */
  const isTrackRow = items.length > 0 && items.every((item) => item.type === 'track');

  /**
   * Open the album a charting track belongs to.
   *
   * Clicking one used to open the album view with the *track's* id, which
   * resolves to nothing and reported "Could not load tracks". The track's own
   * payload carries the album it came from, so the click opens that — the same
   * thing it always did, with the id it should have been using.
   */
  const onSelectTrack = (index: number) => {
    const item = raw[index];
    if (!item) return;
    const relations = relationsOf(item.rawData, service);
    if (!relations.albumId) return;

    openAlbum({
      id: relations.albumId,
      title: relations.albumTitle ?? item.title,
      artist: relations.artistName ?? item.artist,
      cover: relations.albumCover ?? extractCover(item.rawData, service),
      type: 'album',
      service,
    });
  };

  const renderCard = (album: AlbumCardData, index: number) =>
    isArtistRow ? (
      <ArtistCard
        key={album.id}
        artist={{id: album.id, name: album.title, picture: album.cover, service}}
        className={expanded ? undefined : 'w-[46vw] shrink-0 sm:w-44'}
      />
    ) : (
      <AlbumCard
        key={album.id}
        album={album}
        className={expanded ? undefined : 'w-[46vw] shrink-0 sm:w-44'}
        onClick={() => (isTrackRow ? onSelectTrack(index) : onSelect(album))}
        /* Play sits beside download on the hover overlay; the card itself still
           opens, so both ways in are available rather than one replacing the
           other. */
        onPlay={() =>
          playItem({
            id: album.id,
            type: isTrackRow ? 'track' : album.type === 'playlist' ? 'playlist' : 'album',
            service,
            title: album.title,
            artist: album.artist,
            cover: album.cover,
            rawData: raw[index]?.rawData,
          })
        }
        relations={relationsOf(raw[index]?.rawData, service)}
        service={service}
        selectable={{
          id: album.id,
          type: (isTrackRow ? 'track' : album.type === 'playlist' ? 'playlist' : 'album') as
            | 'track'
            | 'album'
            | 'playlist',
          service,
          title: album.title,
          artist: album.artist,
          cover: album.cover,
        }}
        onDownload={() =>
          download({
            id: album.id,
            type: isTrackRow ? 'track' : album.type === 'playlist' ? 'playlist' : 'album',
            title: album.title,
            artist: album.artist,
            cover: album.cover,
            service,
          })
        }
      />
    );

  // A feed that resolves to nothing should disappear entirely rather than
  // leave a heading with blank space under it. Errors still render, since a
  // failure is worth telling the user about.
  if (!isLoading && !isError && items.length === 0) return null;

  const scrollBy = (direction: 1 | -1) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const row = event.currentTarget.closest('section')?.querySelector('[data-row]');
    row?.scrollBy({left: direction * (row.clientWidth * 0.8), behavior: 'smooth'});
  };

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent/12">
            <Icon size={17} className="text-accent" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">{title}</h2>
            <p className="truncate text-xs text-text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? 'Show as row' : 'Show all'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Rows3 size={15} /> : <LayoutGrid size={15} />}
          </Button>
          {!expanded && (
            <div className="hidden items-center gap-1 lg:flex">
              <Button variant="ghost" size="icon-sm" aria-label="Scroll left" onClick={scrollBy(-1)}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Scroll right" onClick={scrollBy(1)}>
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>

      {isError ? (
        <ErrorState title={`Could not load ${title}`} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="scroll-row flex gap-4 pb-4 pt-3">
          {Array.from({length: 8}).map((_, i) => (
            <div key={i} className="w-[46vw] shrink-0 sm:w-44">
              <CardSkeleton />
            </div>
          ))}
        </div>
      ) : expanded ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map(renderCard)}
        </div>
      ) : (
        // Vertical padding is load-bearing: .scroll-row sets overflow-x:auto,
        // and CSS computes the other axis to auto too, so the row clips
        // vertically. Without this the cards' hover lift and shadow are cut
        // off at the top. No negative-margin bleed — it made the row wider
        // than its container at every breakpoint.
        <div data-row className="scroll-row flex gap-3 pb-4 pt-3 pr-6 sm:gap-4 sm:pr-10">
          {items.map(renderCard)}
        </div>
      )}
    </section>
  );
}

export function HomePage() {
  const service = useAppStore((s) => s.service);
  const setPage = useAppStore((s) => s.setPage);
  const openAlbum = useNavigationStore((s) => s.openAlbum);

  // The hero borrows the first new release, so the row below skips it rather
  // than showing the same album twice.
  /*
   * What the hero shows, per service.
   *
   * Qobuz has a genuine new-release feed. Deezer's went away — its endpoint
   * returns an empty list and the fallback behind it was a literal search for
   * "2025", so the hero was whatever matched that string, identically, every
   * time. Deezer gets its real chart data instead, labelled for what it is.
   */
  const heroType = service === 'deezer' ? 'trending-albums' : 'new-releases';
  const {data: heroPool = []} = useDiscovery(service, heroType);

  /*
   * Rotate rather than always taking index 0.
   *
   * Pinning the first item meant one album out of hundreds, unchanged for as
   * long as the service left it there. The seed is fixed per mount so the tile
   * does not shuffle under the cursor, and changes when the page is revisited.
   */
  /*
   * Rotates on a clock, not at random.
   *
   * A per-mount random seed only changed when the page remounted, which is
   * rare in normal use, so the tile still looked frozen. Bucketing the clock
   * moves the pick on its own every few minutes, holds it steady while
   * someone is looking, and can actually be checked rather than hoped for.
   */
  const heroIndex = useMemo(() => {
    const pool = Math.min(heroPool.length, 12);
    return pool > 0 ? Math.floor(Date.now() / (3 * 60 * 1000)) % pool : 0;
  }, [heroPool.length]);

  const featured = heroPool.length > 0 ? toAlbum(heroPool[heroIndex], service) : null;

  const sections = [...COMMON_SECTIONS, ...(SERVICE_SECTIONS[service] ?? [])];

  return (
    <div className="animate-fade-in space-y-8 px-4 pb-8 pt-5 sm:space-y-10 sm:px-6 sm:pt-6">
      {featured && <Hero item={featured} service={service} onOpen={() => openAlbum({...featured, service})} />}

      {/* Home is where a cold start lands, so the way into selection mode has
          to exist here too — every row below is selectable once it is on. */}
      <div className="flex items-center justify-end">
        <SelectionToggle />
      </div>

      <div className="scroll-row flex gap-2 pb-3 pt-2">
        {QUICK_LINKS.map(({page, label, icon: Icon}) => (
          <button
            key={page}
            onClick={() => setPage(page)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full border border-border bg-card-bg px-4 py-2.5 text-sm font-medium text-text-secondary',
              'transition-all duration-fast hover:-translate-y-0.5 hover:border-accent/40 hover:text-text-primary hover:shadow-md',
            )}
          >
            <Icon size={14} className="text-accent" />
            {label}
          </button>
        ))}
      </div>

      {/* Sits above the fixed shelves: what you looked for beats what is
          merely popular. Renders nothing until there is a search to go on. */}
      <Recommendations service={service} />

      {sections.map((section) => (
        <DiscoverySection
          key={`${section.type}-${service}`}
          {...section}
          service={service}
          excludeId={featured?.id}
          onSelect={(album) => openAlbum({...album, service})}
        />
      ))}

    </div>
  );
}
