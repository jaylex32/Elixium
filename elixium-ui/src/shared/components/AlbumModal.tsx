import {Download, Music2, X, Play, Pause, Eye, CheckSquare, ArrowLeft} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {formatDuration, toSeconds} from '@/shared/lib/utils';
import {useItemTracks, type ItemType} from '@/shared/lib/api';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {Button} from '@/shared/components/ui/Button';
import {keepOpenForSelection} from '@/shared/lib/keep-open-for-selection';
import {FavoriteButton} from '@/shared/components/FavoriteButton';
import {getSocket} from '@/shared/lib/socket';
import {toast} from 'sonner';
import {TrackRowSkeleton} from '@/shared/components/ui/Skeleton';
import {TrackActions} from '@/shared/components/TrackActions';
import {SelectCheckbox} from '@/shared/components/SelectCheckbox';
import {ExplicitBadge} from '@/shared/components/ExplicitBadge';
import {isExplicit} from '@/shared/lib/explicit';
import {relationsOf} from '@/shared/lib/relations';
import {ArtistLink, TrackByline} from '@/shared/components/RelationLinks';
import {useSelectionStore} from '@/store/selection-store';
import type {Service} from '@/types';
import {extractCover} from '@/shared/lib/cover';
import type {AlbumCardData} from './AlbumCard';
import {serviceLabel} from '@/shared/lib/desktop';

interface AlbumModalProps {
  album: AlbumCardData & {service: Service};
  open: boolean;
  onClose: () => void;
  /** Shows a back arrow instead of implying this is the first thing opened. */
  canGoBack?: boolean;
}

/**
 * Album, artist and playlist each expand through a different upstream call.
 *
 * This previously mapped everything that was not a playlist to "album", so an
 * artist id was fetched as an album id — which silently returns whichever
 * unrelated album happens to share that number. A "Bad Bunny" card listed
 * three tracks by a different artist entirely.
 */
const toItemType = (type: string | undefined): ItemType => {
  if (type === 'playlist') return 'playlist';
  if (type === 'artist') return 'artist';
  return 'album';
};

export function AlbumModal({album, open, onClose, canGoBack}: AlbumModalProps) {
  const itemType = toItemType(album.type);
  const {data, isLoading, isError} = useItemTracks(itemType, album.id, album.service, open);
  const {setTrack, currentTrack, isPlaying, pause, resume} = usePlayerStore();
  const {download} = useDownload();

  /*
   * Watching is a playlist-only action, and this modal is where every playlist
   * in the app opens — from Search, Charts, Favorites and the Playlists page.
   * The button previously existed only on the Playlists page's own search
   * results, so opening a playlist anywhere else offered no way to follow it.
   *
   * The server's addWatchedPlaylist takes a URL, not an id, because it also
   * accepts Spotify and Tidal links. For a playlist we already have open the
   * canonical URL is derivable from its id and service.
   */
  const isPlaylist = album.type === 'playlist';
  const playlistUrl = isPlaylist
    ? album.service === 'deezer'
      ? `https://www.deezer.com/playlist/${album.id}`
      : `https://play.qobuz.com/playlist/${album.id}`
    : undefined;

  const watchPlaylist = () => {
    if (!playlistUrl) return;
    getSocket().emit('addWatchedPlaylist', {url: playlistUrl});
    toast.success(`Watching ${album.title}`, {description: 'New tracks will appear in your watchlist.'});
  };

  const tracks = data?.tracks ?? [];

  /*
   * Individual tracks inside an album or playlist can be selected too.
   *
   * Wanting three songs off a record rather than the whole thing is ordinary,
   * and until now the only options here were one track at a time or all of it.
   * The bar floats above this window, so the selection can be acted on without
   * closing it first.
   */
  const selectionActive = useSelectionStore((s) => s.active);
  const selectionItems = useSelectionStore((s) => s.items);
  const toggleSelect = useSelectionStore((s) => s.toggle);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const setSelectionActive = useSelectionStore((s) => s.setActive);

  const asSelectable = (t: any) => ({
    id: String(t.id),
    type: 'track' as const,
    service: album.service,
    title: String(t.title ?? 'Unknown Track'),
    artist: String(t.artist ?? album.artist ?? ''),
    cover: album.cover,
  });

  /*
   * Artwork for one row.
   *
   * Every track used to be given `album.cover`, which is right for an album —
   * its tracks genuinely share one sleeve — but wrong for a playlist, where it
   * stamped the playlist's image onto fifty unrelated songs. Each track
   * carries its own album art in rawData, so prefer that and fall back to the
   * container only when a track has none.
   */
  const coverFor = (track: (typeof tracks)[number]) =>
    extractCover(track.rawData, album.service) ?? album.cover;

  /** Same reasoning for the album name: a playlist is not the track's album. */
  const albumTitleFor = (track: (typeof tracks)[number]) =>
    itemType === 'album' ? album.title : (track.album ?? album.title);

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
        album: albumTitleFor(t),
        cover: coverFor(t),
        duration: toSeconds(t.duration),
        trackNumber: t.track_number,
        service: album.service,
        previewUrl: t.rawData?.preview as string | undefined,
        rawData: t.rawData as Record<string, unknown> | undefined,
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
          {...keepOpenForSelection}
          className="fixed inset-x-0 bottom-0 z-modal flex max-h-[88dvh] flex-col rounded-t-xl border border-border bg-card-bg shadow-xl animate-slide-up pb-safe
                     sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:animate-fade-in sm:pb-0"
        >
          {/* Drag affordance — signals the sheet is dismissible on touch. */}
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden />

          {/* Header */}
          <div className="flex shrink-0 items-start gap-3 border-b border-border p-4 sm:gap-4 sm:p-5">
            {canGoBack && (
              <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back" onClick={onClose} className="mt-0.5">
                <ArrowLeft size={17} />
              </Button>
            )}
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
                {album.type ?? 'Album'} · {serviceLabel(album.service)}
              </p>
              <h2 className="line-clamp-2 text-base font-bold leading-tight text-text-primary sm:text-lg">
                {album.title}
              </h2>
              <p className="mt-0.5 truncate text-sm text-text-secondary">
                {/* The first track carries the artist id for this release. */}
                <ArtistLink
                  name={album.artist}
                  relations={relationsOf(tracks[0]?.rawData as Record<string, unknown>, album.service)}
                  service={album.service}
                />
              </p>
              {album.year && <p className="mt-1 text-xs text-text-muted">{album.year}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {/* Labelled action collapses to an icon on phones; the footer
                  keeps a full-width equivalent so nothing is lost. */}
              <FavoriteButton
                item={{
                  id: album.id,
                  type: (album.type as 'album' | 'playlist') ?? 'album',
                  service: album.service,
                  title: album.title,
                  artist: album.artist,
                  cover: album.cover,
                  // Starred now, opened later: the artist travels with it.
                  artistId: relationsOf(tracks[0]?.rawData as Record<string, unknown>, album.service).artistId,
                  albumId: album.id,
                }}
              />

              {isPlaylist && (
                <Button variant="secondary" size="sm" onClick={watchPlaylist}>
                  <Eye size={14} />
                  Watch
                </Button>
              )}

              {/* Pick individual tracks without leaving this window. */}
              {tracks.length > 0 && (
                <Button
                  size="sm"
                  variant={selectionActive ? 'default' : 'ghost'}
                  className={selectionActive ? undefined : 'text-text-muted'}
                  title={selectionActive ? 'Leave selection mode' : 'Select individual tracks'}
                  // Same as the artist window: turning selection on should not
                  // choose the first track for you.
                  onClick={() => setSelectionActive(!selectionActive)}
                >
                  <CheckSquare size={14} />
                  {selectionActive ? 'Done' : 'Select'}
                </Button>
              )}

              {selectionActive && tracks.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-text-muted"
                  onClick={() => selectMany(tracks.map(asSelectable))}
                >
                  Select all
                </Button>
              )}

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

                      {selectionActive && (
                        <SelectCheckbox
                          selected={Boolean(selectionItems[`${album.service}:track:${t.id}`])}
                          alwaysVisible
                          label={`Select ${t.title}`}
                          onToggle={() => toggleSelect(asSelectable(t))}
                          className="mr-1"
                        />
                      )}

                      <div className="flex-1 min-w-0">
                        <p
                          className={`flex items-center gap-1.5 text-sm font-medium ${isActive ? 'text-accent' : 'text-text-primary'}`}
                        >
                          <span className="truncate">{t.title}</span>
                          {isExplicit(t.rawData as Record<string, unknown>) && <ExplicitBadge />}
                        </p>
                        {/* Always named, even when it matches the header: a
                            row that shows no artist reads as having none, and
                            the link is the way to their page from here. */}
                        <TrackByline
                          artist={t.artist || album.artist}
                          /* A playlist's rows come from all over, so each one
                             names its own album; an album's rows would only
                             repeat the title above them. */
                          album={isPlaylist ? t.album : undefined}
                          relations={relationsOf(t.rawData as Record<string, unknown>, album.service)}
                          service={album.service}
                        />
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {dur > 0 && (
                          <span className="text-xs text-text-muted tabular-nums hidden sm:block">
                            {formatDuration(dur)}
                          </span>
                        )}
                        <TrackActions
                          track={{
                            id: t.id,
                            title: t.title,
                            artist: t.artist ?? album.artist,
                            album: albumTitleFor(t),
                            cover: coverFor(t),
                            duration: dur,
                            service: album.service,
                          }}
                          onPlay={() => handlePlayTrack(t.id, i)}
                          onDownload={() =>
                            download({
                              id: t.id,
                              type: 'track',
                              title: t.title,
                              artist: t.artist ?? album.artist,
                              cover: coverFor(t),
                              service: album.service,
                            })
                          }
                          className="lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
                        />
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
                        album: albumTitleFor(t),
                        cover: coverFor(t),
                        duration: toSeconds(t.duration),
                        trackNumber: t.track_number ?? i + 1,
                        service: album.service,
                        rawData: t.rawData as Record<string, unknown> | undefined,
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
