import {useState} from 'react';
import {X, User, Music2} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {useArtistAlbums} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard, type AlbumCardData} from './AlbumCard';
import {AlbumModal} from './AlbumModal';
import {CardSkeleton} from '@/shared/components/ui/Skeleton';
import {Button} from '@/shared/components/ui/Button';
import type {Artist, Service} from '@/types';

interface ArtistModalProps {
  artist: Artist;
  open: boolean;
  onClose: () => void;
}

export function ArtistModal({artist, open, onClose}: ArtistModalProps) {
  const {data, isLoading, isError} = useArtistAlbums(artist.id, artist.service, open);
  const [selectedAlbum, setSelectedAlbum] = useState<(AlbumCardData & {service: Service}) | null>(null);
  const {download} = useDownload();

  const albums: AlbumCardData[] = (data?.tracks ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist ?? artist.name,
    cover: item.rawData ? extractCover(item.rawData, artist.service) : undefined,
    type: 'album',
  }));

  return (
    <>
      <DialogPrimitive.Root open={open && !selectedAlbum} onOpenChange={(v) => !v && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-3xl max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-border bg-card-bg shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="flex items-center gap-4 p-5 border-b border-border shrink-0">
              <div className="h-16 w-16 rounded-full overflow-hidden shrink-0 bg-surface-bg">
                {artist.picture ? (
                  <img src={artist.picture} alt={artist.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User size={24} className="text-text-muted" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-muted uppercase tracking-wide mb-0.5">Artist</p>
                <h2 className="text-xl font-bold text-text-primary">{artist.name}</h2>
                {artist.fans != null && (
                  <p className="text-sm text-text-muted mt-0.5">{artist.fans.toLocaleString()} fans</p>
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm">
                  <X size={16} />
                </Button>
              </DialogPrimitive.Close>
            </div>

            {/* Albums grid */}
            <div className="flex-1 overflow-y-auto p-5">
              {isLoading && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {Array.from({length: 8}).map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              )}

              {isError && (
                <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                  <Music2 size={32} className="opacity-30" />
                  <p className="text-sm">Could not load albums — check credentials in Settings</p>
                </div>
              )}

              {!isLoading && !isError && albums.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                  <Music2 size={32} className="opacity-30" />
                  <p className="text-sm">No albums found for this artist</p>
                </div>
              )}

              {!isLoading && albums.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {albums.map((album) => (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      onClick={() => setSelectedAlbum({...album, service: artist.service})}
                      onDownload={() =>
                        download({
                          id: album.id,
                          type: 'album',
                          title: album.title,
                          artist: album.artist,
                          cover: album.cover,
                          service: artist.service,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {selectedAlbum && <AlbumModal album={selectedAlbum} open onClose={() => setSelectedAlbum(null)} />}
    </>
  );
}
