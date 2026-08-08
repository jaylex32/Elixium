import {useState} from 'react';
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
} from 'lucide-react';
import {useDiscovery} from '@/shared/lib/api';
import {cn} from '@/shared/lib/utils';
import {extractCover} from '@/shared/lib/cover';
import {useAppStore, type Page} from '@/store/app-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {Button} from '@/shared/components/ui/Button';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import {ErrorState} from '@/shared/components/States';
import type {RawDiscoveryItem, Service} from '@/types';

const SECTIONS = [
  {type: 'new-releases', title: 'New Releases', subtitle: 'Fresh this week', icon: Sparkles},
  {type: 'trending-albums', title: 'Trending', subtitle: 'What people are playing', icon: TrendingUp},
  {type: 'popular-playlists', title: 'Popular Playlists', subtitle: 'Curated collections', icon: ListMusic},
];

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
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Featured release</p>
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
  skip = 0,
  onSelect,
}: {
  type: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  service: Service;
  skip?: number;
  onSelect: (album: AlbumCardData) => void;
}) {
  const {data = [], isLoading, isError, refetch} = useDiscovery(service, type);
  const {download} = useDownload();
  const [expanded, setExpanded] = useState(false);

  const items = data.slice(skip).map((item) => toAlbum(item, service));

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
        <div className="scroll-row flex gap-4 pb-1">
          {Array.from({length: 8}).map((_, i) => (
            <div key={i} className="w-[46vw] shrink-0 sm:w-44">
              <CardSkeleton />
            </div>
          ))}
        </div>
      ) : expanded ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              onClick={() => onSelect(album)}
              onDownload={() =>
                download({id: album.id, type: 'album', title: album.title, artist: album.artist, cover: album.cover, service})
              }
            />
          ))}
        </div>
      ) : (
        // pb-2 leaves room for the cards' hover shadow, which would otherwise
        // be clipped by the scroll container. No negative-margin bleed: it
        // made the row wider than its container at every breakpoint.
        <div data-row className="scroll-row flex gap-3 pb-2 sm:gap-4">
          {items.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              className="w-[46vw] shrink-0 sm:w-44"
              onClick={() => onSelect(album)}
              onDownload={() =>
                download({id: album.id, type: 'album', title: album.title, artist: album.artist, cover: album.cover, service})
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomePage() {
  const service = useAppStore((s) => s.service);
  const setPage = useAppStore((s) => s.setPage);
  const [selected, setSelected] = useState<(AlbumCardData & {service: Service}) | null>(null);

  // The hero borrows the first new release, so the row below skips it rather
  // than showing the same album twice.
  const {data: newReleases = []} = useDiscovery(service, 'new-releases');
  const featured = newReleases.length > 0 ? toAlbum(newReleases[0], service) : null;

  return (
    <div className="animate-fade-in space-y-8 px-4 pb-8 pt-5 sm:space-y-10 sm:px-6 sm:pt-6">
      {featured && <Hero item={featured} service={service} onOpen={() => setSelected({...featured, service})} />}

      <div className="scroll-row flex gap-2 pb-1">
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

      {SECTIONS.map((section, index) => (
        <DiscoverySection
          key={`${section.type}-${service}`}
          {...section}
          service={service}
          skip={index === 0 && featured ? 1 : 0}
          onSelect={(album) => setSelected({...album, service})}
        />
      ))}

      {selected && <AlbumModal album={selected} open onClose={() => setSelected(null)} />}
    </div>
  );
}
