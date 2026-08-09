import {X, User, Music2, Play, Pause, Download, Eye} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {toast} from 'sonner';
import {cn, formatDuration, toSeconds} from '@/shared/lib/utils';
import {useArtistTopTracks} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {useDownload} from '@/shared/hooks/useDownload';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {getSocket} from '@/shared/lib/socket';
import {Button} from '@/shared/components/ui/Button';
import {ListSkeleton, ErrorState, EmptyState} from '@/shared/components/States';
import type {Artist} from '@/types';

interface ArtistModalProps {
  artist: Artist;
  open: boolean;
  onClose: () => void;
}

/**
 * Artist detail.
 *
 * Shows top tracks, which is what both services actually return for an artist
 * (Deezer /artist/:id/top, Qobuz artist/get?extra=tracks). This previously
 * rendered the same data as album cards, so every "album" was really a single
 * track with an album-shaped cover and a broken download.
 */
export function ArtistModal({artist, open, onClose}: ArtistModalProps) {
  const {data, isLoading, isError, refetch} = useArtistTopTracks(artist.id, artist.service, open);
  const {download} = useDownload();
  const {setTrack, currentTrack, isPlaying, pause, resume} = usePlayerStore();

  const raw = data?.tracks ?? [];

  const tracks = raw.map((t) =>
    makeTrack({
      id: t.id,
      title: t.title,
      artist: t.artist ?? artist.name,
      album: typeof t.album === 'string' ? t.album : undefined,
      cover: t.rawData ? extractCover(t.rawData, artist.service) : undefined,
      duration: toSeconds(t.duration),
      service: artist.service,
      previewUrl: t.rawData?.preview as string | undefined,
    }),
  );

  const playFrom = (index: number) => {
    const track = tracks[index];
    if (!track) return;
    if (currentTrack?.id === track.id) {
      if (isPlaying) pause();
      else resume();
      return;
    }
    setTrack(track, tracks);
  };

  const watchArtist = () => {
    getSocket().emit('addWatchedArtist', {artistId: artist.id, name: artist.name});
    toast.success(`Watching ${artist.name}`, {description: 'New releases will appear in your watchlist.'});
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-black/60 backdrop-blur-sm animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-modal flex max-h-[88dvh] flex-col rounded-t-xl border border-border bg-card-bg pb-safe shadow-xl animate-slide-up
                     sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:pb-0 sm:animate-fade-in"
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden />

          <div className="flex shrink-0 items-center gap-3 border-b border-border p-4 sm:gap-4 sm:p-5">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-surface-bg sm:h-16 sm:w-16">
              {artist.picture ? (
                <img src={artist.picture} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <User size={22} className="text-text-muted" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-text-muted">
                Artist · {artist.service === 'deezer' ? 'Deezer' : 'Qobuz'}
              </p>
              <h2 className="truncate text-base font-bold text-text-primary sm:text-lg">{artist.name}</h2>
              {tracks.length > 0 && <p className="mt-0.5 text-xs text-text-muted">{tracks.length} top tracks</p>}
            </div>

            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X size={16} />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex shrink-0 gap-2 border-b border-border px-4 py-3 sm:px-5">
            <Button size="sm" onClick={() => playFrom(0)} disabled={tracks.length === 0} className="flex-1 sm:flex-none">
              <Play size={14} />
              Play top tracks
            </Button>
            {/* The watchlist backend supports artists; surfacing it here is the
                natural place to start following someone. */}
            <Button variant="secondary" size="sm" onClick={watchArtist} className="flex-1 sm:flex-none">
              <Eye size={14} />
              Watch
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-4">
                <ListSkeleton count={8} />
              </div>
            )}

            {isError && <ErrorState title="Could not load this artist" onRetry={() => refetch()} />}

            {!isLoading && !isError && tracks.length === 0 && (
              <EmptyState title="No tracks found" hint="This artist has no top tracks on the selected service." />
            )}

            {!isLoading && !isError && tracks.length > 0 && (
              <ol className="py-2">
                {tracks.map((track, index) => {
                  const isActive = currentTrack?.id === track.id;
                  return (
                    <li
                      key={`${track.id}-${index}`}
                      className={cn(
                        'rows-track group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-bg sm:px-5',
                        isActive && 'bg-accent/8',
                      )}
                    >
                      <button
                        onClick={() => playFrom(index)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        aria-label={isActive ? (isPlaying ? 'Pause' : 'Resume') : `Play ${track.title}`}
                      >
                        <span className="relative h-10 w-10 shrink-0">
                          {track.cover ? (
                            <img src={track.cover} alt="" loading="lazy" className="h-10 w-10 rounded-xs object-cover" />
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-xs bg-surface-bg">
                              <Music2 size={15} className="text-text-muted" />
                            </span>
                          )}
                          <span
                            className={cn(
                              'absolute inset-0 flex items-center justify-center rounded-xs bg-black/50 transition-opacity',
                              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                            )}
                          >
                            {isActive && isPlaying ? (
                              <Pause size={13} className="text-white" />
                            ) : (
                              <Play size={13} className="text-white" />
                            )}
                          </span>
                        </span>

                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-sm font-medium',
                              isActive ? 'text-accent' : 'text-text-primary',
                            )}
                          >
                            {track.title}
                          </span>
                          {track.album && <span className="block truncate text-xs text-text-muted">{track.album}</span>}
                        </span>

                        {track.duration ? (
                          <span className="hidden shrink-0 text-xs tabular-nums text-text-muted sm:block">
                            {formatDuration(track.duration)}
                          </span>
                        ) : null}
                      </button>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Download ${track.title}`}
                        className="shrink-0 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
                        onClick={() =>
                          download({
                            id: track.id,
                            type: 'track',
                            title: track.title,
                            artist: track.artist,
                            cover: track.cover,
                            service: artist.service,
                          })
                        }
                      >
                        <Download size={14} />
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
