import {Download, Music2, X, Play, Pause} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {formatDuration, toSeconds} from '@/shared/lib/utils';
import {useItemTracks, type ItemType} from '@/shared/lib/api';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {Button} from '@/shared/components/ui/Button';
import {TrackRowSkeleton} from '@/shared/components/ui/Skeleton';
import type {Service} from '@/types';
import type {AlbumCardData} from './AlbumCard';

interface AlbumModalProps {
  album: AlbumCardData & {service: Service};
  open: boolean;
  onClose: () => void;
}

/** Playlists expand through a different endpoint than albums; anything else reads as an album. */
const toItemType = (type: string | undefined): ItemType => (type === 'playlist' ? 'playlist' : 'album');

export function AlbumModal({album, open, onClose}: AlbumModalProps) {
  const itemType = toItemType(album.type);
  const {data, isLoading, isError} = useItemTracks(itemType, album.id, album.service, open);
  const {setTrack, currentTrack, isPlaying, pause, resume} = usePlayerStore();
  const {download} = useDownload();

  const tracks = data?.tracks ?? [];

  const handleDownloadAlbum = () => {
    download({
      id: album.id,
      // Sending 'album' for a playlist makes the backend resolve the wrong
      // upstream collection, so the type has to follow the item.
      type: itemType,
      title: album.title,
      artist: album.artist,
      cover: album.cover,
      service: album.service,
    });
    onClose();
  };

  const handlePlayTrack = (trackId: string, trackIndex: number) => {
    const allTracks = tracks.map((t) =>
      makeTrack({
        id: t.id,
        title: t.title,
        artist: t.artist ?? album.artist,
        album: album.title,
        cover: album.cover,
        duration: toSeconds(t.duration),
        trackNumber: t.track_number,
        service: album.service,
        previewUrl: t.rawData?.preview as string | undefined,
      }),
    );
    const track = allTracks[trackIndex];
    if (!track) return;

    if (currentTrack?.id === trackId) {
      if (isPlaying) pause();
      else resume();
    } else {
      setTrack(track, allTracks);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-black/60 backdrop-blur-sm animate-fade-in" />
        {/* Bottom sheet on phones, centred dialog from sm up. A centred box at
            360px leaves the header controls fighting the title for width. */}
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-modal flex max-h-[88dvh] flex-col rounded-t-xl border border-border bg-card-bg shadow-xl animate-slide-up pb-safe
                     sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:animate-fade-in sm:pb-0"
        >
          {/* Drag affordance — signals the sheet is dismissible on touch. */}
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden />

          {/* Header */}
          <div className="flex shrink-0 items-start gap-3 border-b border-border p-4 sm:gap-4 sm:p-5">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-sm bg-surface-bg sm:h-20 sm:w-20">
              {album.cover ? (
                <img src={album.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Music2 size={24} className="text-text-muted" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="mb-1 text-xs uppercase tracking-wide text-text-muted">
                {album.type ?? 'Album'} · {album.service === 'deezer' ? 'Deezer' : 'Qobuz'}
              </p>
              <h2 className="line-clamp-2 text-base font-bold leading-tight text-text-primary sm:text-lg">
                {album.title}
              </h2>
              <p className="mt-0.5 truncate text-sm text-text-secondary">{album.artist}</p>
              {album.year && <p className="mt-1 text-xs text-text-muted">{album.year}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {/* Labelled action collapses to an icon on phones; the footer
                  keeps a full-width equivalent so nothing is lost. */}
              <Button size="sm" onClick={handleDownloadAlbum} className="hidden sm:inline-flex">
                <Download size={14} />
                Download
              </Button>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <X size={16} />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Track list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="py-4 space-y-1">
                {Array.from({length: 8}).map((_, i) => (
                  <TrackRowSkeleton key={i} />
                ))}
              </div>
            )}
            {isError && (
              <div className="flex items-center justify-center py-16 text-text-muted text-sm">
                Could not load tracks — check your credentials in Settings
              </div>
            )}
            {!isLoading && !isError && tracks.length > 0 && (
              <div className="py-2">
                {tracks.map((t, i) => {
                  const isActive = currentTrack?.id === t.id;
                  const dur = toSeconds(t.duration);
                  return (
                    <div
                      key={t.id}
                      className="rows-track group flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-bg"
                      onClick={() => handlePlayTrack(t.id, i)}
                    >
                      {/* Track number / play indicator */}
                      <div className="w-5 flex items-center justify-center shrink-0">
                        {isActive && isPlaying ? (
                          <span className="flex gap-0.5 items-end h-4">
                            {[0, 1, 2].map((j) => (
                              <span
                                key={j}
                                className="w-0.5 bg-accent rounded-full animate-pulse"
                                style={{height: `${50 + j * 25}%`, animationDelay: `${j * 150}ms`}}
                              />
                            ))}
                          </span>
                        ) : (
                          <>
                            <span
                              className={`text-xs group-hover:hidden ${isActive ? 'text-accent' : 'text-text-muted'}`}
                            >
                              {t.track_number ?? i + 1}
                            </span>
                            <Play
                              size={13}
                              className={`hidden group-hover:block ${isActive ? 'text-accent' : 'text-text-primary'}`}
                            />
                          </>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                          {t.title}
                        </p>
                        {t.artist && t.artist !== album.artist && (
                          <p className="text-xs text-text-muted truncate">{t.artist}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {dur > 0 && (
                          <span className="text-xs text-text-muted tabular-nums hidden sm:block">
                            {formatDuration(dur)}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Download track"
                          onClick={(e) => {
                            e.stopPropagation();
                            download({
                              id: t.id,
                              type: 'track',
                              title: t.title,
                              artist: t.artist ?? album.artist,
                              cover: album.cover,
                              service: album.service,
                            });
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Download size={13} />
                        </Button>
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPlaying) pause();
                              else resume();
                            }}
                          >
                            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {!isLoading && tracks.length > 0 && (
            <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-xs text-text-muted">
                {tracks.length} track{tracks.length > 1 ? 's' : ''}
              </p>
              <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const allTracks = tracks.map((t, i) =>
                      makeTrack({
                        id: t.id,
                        title: t.title,
                        artist: t.artist ?? album.artist,
                        album: album.title,
                        cover: album.cover,
                        duration: toSeconds(t.duration),
                        trackNumber: t.track_number ?? i + 1,
                        service: album.service,
                      }),
                    );
                    if (allTracks[0]) {
                      setTrack(allTracks[0], allTracks);
                      onClose();
                    }
                  }}
                >
                  <Play size={14} />
                  Play all
                </Button>
                <Button size="sm" onClick={handleDownloadAlbum}>
                  <Download size={14} />
                  Download all
                </Button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
