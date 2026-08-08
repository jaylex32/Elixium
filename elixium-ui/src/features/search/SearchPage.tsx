import {useState} from 'react';
import {Search, X, Users} from 'lucide-react';
import {useSearch} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {useAppStore} from '@/store/app-store';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {Input} from '@/shared/components/ui/Input';
import {Spinner} from '@/shared/components/ui/Spinner';
import {TabsRoot, TabsList, TabsTrigger, TabsContent} from '@/shared/components/ui/Tabs';
import {AlbumCard, type AlbumCardData} from '@/shared/components/AlbumCard';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {TrackRow} from '@/shared/components/TrackRow';
import {ArtistCard} from '@/shared/components/ArtistCard';
import {CardSkeleton, TrackRowSkeleton} from '@/shared/components/ui/Skeleton';
import type {RawSearchResult, Service} from '@/types';

type SearchType = 'track' | 'album' | 'artist' | 'playlist';

function parseDurationSecs(dur: string | undefined): number {
  if (!dur) return 0;
  const parts = dur.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  const n = parseInt(dur, 10);
  return isNaN(n) ? 0 : n;
}

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

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('track');
  const [selectedAlbum, setSelectedAlbum] = useState<(AlbumCardData & {service: Service}) | null>(null);

  const {service} = useAppStore();
  const {setTrack} = usePlayerStore();
  const {download} = useDownload();

  const {data = [], isLoading, isFetching} = useSearch(query, service, type);
  const spinning = isLoading || isFetching;

  const handleTypeChange = (t: string) => setType(t as SearchType);

  const isEmpty = query.trim().length >= 2 && !spinning && data.length === 0;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto animate-fade-in">
      {/* Search bar */}
      <Input
        icon={spinning ? <Spinner size="sm" /> : <Search size={16} />}
        suffix={
          query ? (
            <button onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          ) : null
        }
        placeholder={`Search ${service === 'deezer' ? 'Deezer' : 'Qobuz'}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-12 text-base pl-10 pr-10"
        autoFocus
      />

      <TabsRoot value={type} onValueChange={handleTypeChange}>
        <TabsList className="w-fit">
          <TabsTrigger value="track">Tracks</TabsTrigger>
          <TabsTrigger value="album">Albums</TabsTrigger>
          <TabsTrigger value="artist">Artists</TabsTrigger>
          <TabsTrigger value="playlist">Playlists</TabsTrigger>
        </TabsList>

        {/* Loading skeletons */}
        {spinning && (
          <div className="mt-6">
            {type === 'album' || type === 'artist' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Array.from({length: 10}).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {Array.from({length: 12}).map((_, i) => (
                  <TrackRowSkeleton key={i} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="mt-16 text-center text-text-muted">
            <Search size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium text-text-secondary">No results for "{query}"</p>
            <p className="text-sm mt-1">Try a different search or switch service</p>
          </div>
        )}

        {/* Prompt */}
        {!spinning && query.trim().length < 2 && (
          <div className="mt-16 text-center text-text-muted">
            <Search size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-lg font-semibold text-text-secondary">Start typing to search</p>
            <p className="text-sm mt-1">Tracks, albums, artists and playlists</p>
          </div>
        )}

        {/* Track results */}
        <TabsContent value="track" className="mt-4">
          {!spinning && data.length > 0 && (
            <div className="space-y-0.5">
              {data.map((r, i) => {
                const cover = extractCover(r.rawData, service);
                const track = makeTrack({
                  id: r.id,
                  title: r.title,
                  artist: r.artist,
                  album: r.album,
                  cover,
                  duration: parseDurationSecs(r.duration),
                  service,
                  previewUrl: r.rawData.preview as string | undefined,
                });
                return (
                  <TrackRow
                    key={r.id}
                    track={{...track}}
                    index={i + 1}
                    onPlay={() => setTrack(track)}
                    onDownload={() =>
                      download({id: r.id, type: 'track', title: r.title, artist: r.artist, cover, service})
                    }
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Album results */}
        <TabsContent value="album" className="mt-4">
          {!spinning && data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {data.map((r) => {
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

        {/* Artist results */}
        <TabsContent value="artist" className="mt-4">
          {!spinning && data.length === 0 && query.trim().length >= 2 && (
            <div className="mt-8 text-center text-text-muted">
              <Users size={36} className="mx-auto mb-3 opacity-40" />
              <p>No artists found for "{query}"</p>
            </div>
          )}
          {!spinning && data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {data.map((r) => (
                <ArtistCard
                  key={r.id}
                  artist={{
                    id: r.id,
                    name: r.title,
                    picture: extractCover(r.rawData, service),
                    fans: (r.rawData.nb_fan ?? r.rawData.NB_FAN) as number | undefined,
                    service,
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Playlist results */}
        <TabsContent value="playlist" className="mt-4">
          {!spinning && data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {data.map((r) => {
                const album = toAlbumCard(r, service);
                return (
                  <AlbumCard
                    key={r.id}
                    album={{...album, type: 'playlist'}}
                    onClick={() => setSelectedAlbum({...album, service})}
                    onDownload={() =>
                      download({
                        id: r.id,
                        type: 'playlist',
                        title: r.title,
                        artist: r.artist,
                        cover: album.cover,
                        service,
                      })
                    }
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </TabsRoot>

      {selectedAlbum && <AlbumModal album={selectedAlbum} open onClose={() => setSelectedAlbum(null)} />}
    </div>
  );
}
