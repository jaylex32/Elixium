import {useState} from 'react';
import {TrendingUp, Sparkles, ListMusic, WifiOff} from 'lucide-react';
import {useDiscovery} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {useAppStore} from '@/store/app-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import type {RawDiscoveryItem, Service} from '@/types';

const SECTIONS = [
  {type: 'new-releases', title: 'New Releases', icon: Sparkles},
  {type: 'trending-albums', title: 'Trending', icon: TrendingUp},
  {type: 'popular-playlists', title: 'Popular Playlists', icon: ListMusic},
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

function DiscoverySection({
  type,
  title,
  icon: Icon,
  service,
}: {
  type: string;
  title: string;
  icon: React.ElementType;
  service: Service;
}) {
  const {data = [], isLoading, isError} = useDiscovery(service, type);
  const {download} = useDownload();
  const [selectedAlbum, setSelectedAlbum] = useState<(AlbumCardData & {service: Service}) | null>(null);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-accent" />
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      </div>

      {isError && (
        <div className="flex items-center gap-2 text-sm text-text-muted py-4">
          <WifiOff size={16} />
          <span>Could not load — check credentials in Settings</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {isLoading
          ? Array.from({length: 6}).map((_, i) => <CardSkeleton key={i} />)
          : data.map((item) => {
              const album = toAlbum(item, service);
              return (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onClick={() => setSelectedAlbum({...album, service})}
                  onDownload={() =>
                    download({
                      id: album.id,
                      type: 'album',
                      title: album.title,
                      artist: album.artist,
                      cover: album.cover,
                      service,
                    })
                  }
                />
              );
            })}
      </div>

      {selectedAlbum && <AlbumModal album={selectedAlbum} open onClose={() => setSelectedAlbum(null)} />}
    </section>
  );
}

export function HomePage() {
  const {service} = useAppStore();

  return (
    <div className="p-6 space-y-10 animate-fade-in">
      {SECTIONS.map((s) => (
        <DiscoverySection key={`${s.type}-${service}`} {...s} service={service} />
      ))}
    </div>
  );
}
