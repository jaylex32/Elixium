import {useEffect} from 'react';
import {Eye, RefreshCw, Download, Plus, Clock, Trash2, CheckSquare, Square, ListMusic, AlertTriangle, Zap} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Badge} from '@/shared/components/ui/Badge';
import {Switch} from '@/shared/components/ui/Switch';
import {Spinner} from '@/shared/components/ui/Spinner';
import {TabsRoot, TabsList, TabsTrigger, TabsContent} from '@/shared/components/ui/Tabs';
import {useWatchlistStore, toWatchedPlaylist, type WatchlistTab} from '@/store/watchlist-store';
import {useAppStore} from '@/store/app-store';
import {getSocket} from '@/shared/lib/socket';
import {socketSend} from '@/shared/lib/socket-client';
import {ScheduleEditor} from './ScheduleEditor';
import {FavoriteGenres} from './FavoriteGenres';
import {ReleaseTypeFilter} from './ReleaseTypeFilter';

interface WatchlistState {
  watchedArtists?: Array<{
    id: string;
    name: string;
    picture_url?: string;
    picture?: string;
    addedAt?: string;
    lastChecked?: string;
    rules?: {autoQueueAlbums?: boolean; autoQueueTracks?: boolean; trackLimit?: number};
  }>;
  watchedPlaylists?: Array<Record<string, unknown>>;
  /*
   * The server sends `candidates` (new albums from watched artists) and
   * `playlistCandidates` (new tracks on watched playlists). This interface
   * previously declared `wantedAlbums`, which the server has never sent — so
   * the Wanted tab read undefined and rendered empty while hundreds of found
   * items sat in state, and nothing could ever be queued from it.
   */
  candidates?: Array<{
    id: string;
    artistId?: string;
    artist?: string;
    title: string;
    year?: number | null;
    image?: string;
    service?: string;
    reason?: string;
    releaseType?: string;
  }>;
  playlistCandidates?: Array<{
    id: string;
    reason?: string;
    playlistId: string;
    playlistTitle?: string;
    artist?: string;
    title: string;
    album?: string;
    image?: string;
  }>;
  downloadHistory?: Array<{
    id: string;
    title: string;
    artist: string;
    cover?: string;
    downloadedAt: string;
    quality?: string;
  }>;
  schedule?: {enabled: boolean; days: number[]; hour: number};
}

export function WatchlistPage() {
  const {
    artists,
    wanted,
    history,
    activeTab,
    isScanning,
    lastScan,
    setArtists,
    setWanted,
    setHistory,
    toggleWanted,
    selectAllWanted,
    deselectAllWanted,
    setActiveTab,
    setScanning,
    setLastScan,
    setWatchedPlaylists,
    watchedPlaylists,
    playlistWanted,
    setPlaylistWanted,
    togglePlaylistWanted,
    selectAllPlaylistWanted,
  } = useWatchlistStore();
  const setPage = useAppStore((s) => s.setPage);

  // A watched playlist that cannot be scanned silently produces nothing. The
  // usual cause is an expired Spotify sp_dc cookie returning 401, which was
  // invisible here — the playlist simply never yielded new tracks.
  const failingPlaylists = watchedPlaylists.filter((p) => p.status === 'error');

  useEffect(() => {
    const socket = getSocket();
    socket.emit('getWatchlistState');

    const onState = (state: WatchlistState) => {
      if (state.watchedArtists) {
        setArtists(
          state.watchedArtists.map((a) => ({
            id: a.id,
            name: a.name,
            picture: a.picture_url ?? a.picture ?? '',
            addedAt: a.addedAt ?? new Date().toISOString(),
            lastChecked: a.lastChecked,
            rules: a.rules,
          })),
        );
      }
      // The server has monitored playlists too; the UI previously dropped them
      // on the floor, which is why the Playlists page had nothing to show.
      if (state.watchedPlaylists) {
        setWatchedPlaylists(state.watchedPlaylists.map(toWatchedPlaylist));
      }
      if (state.candidates) {
        /*
         * Wanted lists what can actually be acted on. Candidates also carry
         * entries already downloaded, dismissed, or excluded by the release
         * type filter — showing those made the count meaningless and offered
         * downloads the server would refuse to queue.
         */
        const actionable = state.candidates.filter(
          (a) => !a.reason || a.reason === 'new' || a.reason === 'needs-review',
        );
        setWanted(
          actionable.map((a) => ({
            id: a.id,
            title: a.title,
            artist: a.artist ?? 'Unknown',
            cover: a.image ?? '',
            type: 'album' as const,
            releaseDate: a.year ? String(a.year) : '',
            selected: false,
          })),
        );
      }
      if (state.playlistCandidates) {
        const actionableTracks = state.playlistCandidates.filter(
          (t) => !t.reason || t.reason === 'new' || t.reason === 'needs-review',
        );
        setPlaylistWanted(
          actionableTracks.map((t) => ({
            id: t.id,
            playlistId: t.playlistId,
            playlistTitle: t.playlistTitle ?? 'Playlist',
            title: t.title,
            artist: t.artist ?? 'Unknown',
            album: t.album,
            cover: t.image,
            selected: false,
          })),
        );
      }
      if (state.downloadHistory) {
        setHistory(
          state.downloadHistory.map((h) => ({
            id: h.id,
            title: h.title,
            artist: h.artist,
            cover: h.cover ?? '',
            downloadedAt: h.downloadedAt,
            quality: h.quality ?? '',
          })),
        );
      }
    };

    socket.on('watchlistState', onState);
    socket.on('watchlistScanStarted', () => setScanning(true));
    socket.on('watchlistScanComplete', (data: {time?: string}) => {
      setScanning(false);
      setLastScan(data?.time ?? new Date().toISOString());
      toast.success('Watchlist scan complete');
      socket.emit('getWatchlistState');
    });

    return () => {
      socket.off('watchlistState', onState);
      socket.off('watchlistScanStarted');
      socket.off('watchlistScanComplete');
    };
  }, []);

  const handleScan = () => {
    getSocket().emit('runWatchlistScan');
    toast.info('Scanning for new releases…');
    setScanning(true);
  };

  const handleDownloadSelected = () => {
    const albums = wanted.filter((i) => i.selected);
    const tracks = playlistWanted.filter((t) => t.selected);
    if (!albums.length && !tracks.length) return;

    const socket = getSocket();

    /*
     * Queue through the watchlist's own handlers, not the generic download
     * path. These also mark the items processed server-side, so a finished
     * release stops reappearing as "new" on the next scan.
     */
    if (albums.length) {
      socket.emit('queueWatchedArtistReleases', {albumIds: albums.map((a) => a.id), autoStart: true});
    }

    // Playlist tracks are queued per playlist: the handler takes one
    // playlistId plus the track ids belonging to it.
    const byPlaylist = new Map<string, string[]>();
    for (const t of tracks) {
      byPlaylist.set(t.playlistId, [...(byPlaylist.get(t.playlistId) ?? []), t.id]);
    }
    for (const [playlistId, trackIds] of byPlaylist) {
      socket.emit('queueWatchedPlaylistTracks', {playlistId, trackIds, autoStart: true});
    }

    const total = albums.length + tracks.length;
    toast.success(`Queued ${total} item${total > 1 ? 's' : ''}`);
    setPage('downloads');
  };

  const selectedCount = wanted.filter((i) => i.selected).length + playlistWanted.filter((t) => t.selected).length;

  return (
    <div className="mx-auto max-w-6xl animate-fade-in space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Eye size={20} className="text-accent" />
          <div>
            <h2 className="font-semibold text-text-primary">Qobuz Watchlist</h2>
            {lastScan && <p className="text-xs text-text-muted">Last scan: {new Date(lastScan).toLocaleString()}</p>}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={handleScan} disabled={isScanning}>
          {isScanning ? <Spinner size="sm" /> : <RefreshCw size={14} />}
          {isScanning ? 'Scanning…' : 'Scan now'}
        </Button>
      </div>

      {failingPlaylists.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/8 p-4" role="alert">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">
              {failingPlaylists.length} watched playlist{failingPlaylists.length > 1 ? 's' : ''} failed on the last scan
            </p>
            <p className="mt-0.5 text-xs text-text-muted">{failingPlaylists.map((p) => p.name).join(', ')}</p>
            <p className="mt-1.5 text-xs text-warning">{failingPlaylists[0].lastError}</p>

            {/*
              This status is whatever the last scan recorded, not a live check.
              Renewing an expired cookie does not clear it until something scans
              again — so the banner says when it was observed and offers the
              retry, rather than implying the credential is broken right now.
            */}
            {failingPlaylists[0].lastCheckedAt && (
              <p className="mt-1 text-xs text-text-muted">
                Recorded {new Date(failingPlaylists[0].lastCheckedAt).toLocaleString()}. If you have updated your
                Spotify cookie since, re-check to clear this.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={isScanning}
                onClick={() => {
                  socketSend('refreshAllWatchedPlaylists', {});
                  toast.info('Re-checking watched playlists…');
                }}
              >
                <RefreshCw size={13} />
                Re-check now
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPage('settings')}>
                Open Settings
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-md border border-border bg-secondary-bg px-4 py-3">
        <Zap size={15} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-xs text-text-muted">
          <span className="font-medium text-text-secondary">Auto</span> makes a scheduled scan download new items by
          itself. Leave it off to have scans only collect them under{' '}
          <span className="font-medium text-text-secondary">Wanted</span> for you to pick. Repackages of a release you
          already have — deluxe, remaster, explicit, anniversary — are skipped automatically.
        </p>
      </div>

      <TabsRoot value={activeTab} onValueChange={(v) => setActiveTab(v as WatchlistTab)}>
        <TabsList>
          <TabsTrigger value="artists">
            Artists{' '}
            {artists.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {artists.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="playlists">
            Playlists{' '}
            {watchedPlaylists.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {watchedPlaylists.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="wanted">
            Wanted{' '}
            {wanted.length + playlistWanted.length > 0 && (
              <Badge variant="warning" className="ml-1">
                {wanted.length + playlistWanted.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="genres">Filters</TabsTrigger>
        </TabsList>

        <TabsContent value="artists" className="mt-5">
          {artists.length === 0 ? (
            <div className="py-20 text-center text-text-muted">
              <Plus size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-text-secondary font-medium">No artists being watched</p>
              <p className="text-sm mt-1">Search for artists and add them to the watchlist</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {artists.map((artist) => (
                <div
                  key={artist.id}
                  className="group flex flex-col items-center gap-3 rounded-xl p-4 border border-border bg-card-bg hover:border-accent/40 transition-colors"
                >
                  {artist.picture ? (
                    <img src={artist.picture} alt={artist.name} className="h-20 w-20 rounded-full object-cover" />
                  ) : (
                    <div className="h-20 w-20 rounded-full bg-surface-bg flex items-center justify-center">
                      <Eye size={24} className="text-text-muted" />
                    </div>
                  )}
                  <p className="w-full truncate text-center text-sm font-medium text-text-primary">{artist.name}</p>

                  <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 text-xs">
                    <Switch
                      checked={Boolean(artist.rules?.autoQueueAlbums)}
                      onCheckedChange={(v) => {
                        socketSend('saveWatchedArtistRules', {
                          artistId: artist.id,
                          rules: {
                            autoQueueAlbums: v,
                            autoQueueTracks: Boolean(artist.rules?.autoQueueTracks),
                            trackLimit: artist.rules?.trackLimit ?? 20,
                          },
                        });
                        toast.success(v ? `Auto-download on for ${artist.name}` : `Auto-download off for ${artist.name}`);
                      }}
                    />
                    <span className={artist.rules?.autoQueueAlbums ? 'text-accent' : 'text-text-muted'}>Auto</span>
                  </label>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-danger"
                    onClick={() => {
                      getSocket().emit('removeWatchedArtist', {artistId: artist.id});
                      setArtists(artists.filter((a) => a.id !== artist.id));
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/*
          Watched playlists had no home in this page at all — they were only
          visible on the Playlists page, with no way to grab just their new
          tracks. Each row here downloads exactly what the last scan found.
        */}
        <TabsContent value="playlists" className="mt-5 space-y-2">
          {watchedPlaylists.length === 0 ? (
            <div className="py-20 text-center text-text-muted">
              <ListMusic size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium text-text-secondary">No playlists being watched</p>
              <p className="mt-1 text-sm">Add one from the Watchlist to track its new tracks.</p>
            </div>
          ) : (
            watchedPlaylists.map((p) => {
              const newTracks = playlistWanted.filter((t) => t.playlistId === p.id);

              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-3 rounded-md border border-border bg-card-bg p-4 sm:flex-row sm:items-center"
                >
                  {p.image ? (
                    <img src={p.image} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-sm object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-surface-bg">
                      <ListMusic size={18} className="text-text-muted" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{p.name}</p>
                    <p className="truncate text-xs text-text-muted">
                      {p.owner ?? 'Playlist'}
                      {p.service ? ` · ${p.service}` : ''}
                      {p.trackCount ? ` · ${p.trackCount} tracks` : ''}
                    </p>
                    {p.status === 'error' && (
                      <p className="mt-0.5 truncate text-xs text-warning">Last scan failed — re-check above.</p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {/* With this on, a scheduled scan queues and downloads new
                        tracks on its own. Off, the scan only builds the list. */}
                    <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 text-xs">
                      <Switch
                        checked={Boolean(p.rules?.autoQueueTracks)}
                        onCheckedChange={(v) => {
                          socketSend('saveWatchedPlaylistRules', {playlistId: p.id, rules: {autoQueueTracks: v}});
                          toast.success(v ? `Auto-download on for ${p.name}` : `Auto-download off for ${p.name}`);
                        }}
                      />
                      <span className={p.rules?.autoQueueTracks ? 'text-accent' : 'text-text-muted'}>Auto</span>
                    </label>
                    {newTracks.length > 0 && <Badge variant="warning">{newTracks.length} new</Badge>}
                    <Button
                      size="sm"
                      disabled={newTracks.length === 0}
                      onClick={() => {
                        getSocket().emit('queueWatchedPlaylistTracks', {
                          playlistId: p.id,
                          trackIds: newTracks.map((t) => t.id),
                          autoStart: true,
                        });
                        toast.info(`Queueing ${newTracks.length} new tracks…`, {description: p.name});
                        setPage('downloads');
                      }}
                    >
                      <Download size={14} />
                      {newTracks.length > 0 ? `Download ${newTracks.length} new` : 'Nothing new'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="wanted" className="mt-5 space-y-4">
          {(wanted.length > 0 || playlistWanted.length > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  selectAllWanted();
                  selectAllPlaylistWanted(true);
                }}
              >
                <CheckSquare size={14} /> Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  deselectAllWanted();
                  selectAllPlaylistWanted(false);
                }}
              >
                <Square size={14} /> Deselect all
              </Button>
              {selectedCount > 0 && (
                <Button size="sm" onClick={handleDownloadSelected}>
                  <Download size={14} /> Download {selectedCount} selected
                </Button>
              )}
            </div>
          )}
          {wanted.length > 0 && (
            <h3 className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <Eye size={13} className="text-accent" />
              New releases from watched artists
              <span className="font-normal normal-case tracking-normal"> ({wanted.length})</span>
            </h3>
          )}

          <div className="space-y-2">
            {wanted.slice(0, 200).map((item) => (
              <div
                key={item.id}
                onClick={() => toggleWanted(item.id)}
                className={cn(
                  'flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-all',
                  item.selected ? 'border-accent/40 bg-accent/5' : 'border-border bg-card-bg hover:border-accent/20',
                )}
              >
                <div
                  className={cn(
                    'h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                    item.selected ? 'bg-accent border-accent' : 'border-border',
                  )}
                >
                  {item.selected && <span className="text-white text-xs">✓</span>}
                </div>
                {item.cover && (
                  <img src={item.cover} alt={item.title} className="h-12 w-12 rounded-lg object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{item.title}</p>
                  <p className="text-xs text-text-muted truncate">{item.artist}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="capitalize">
                    {item.type}
                  </Badge>
                  {item.releaseDate && <span className="text-xs text-text-muted">{item.releaseDate}</span>}
                </div>
              </div>
            ))}
          </div>
          {wanted.length === 0 && (
            <div className="py-20 text-center text-text-muted">
              <Eye size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-text-secondary font-medium">No new releases found yet</p>
              <p className="text-sm mt-1">Run a scan to check for new releases</p>
            </div>
          )}

          {playlistWanted.length > 0 && (
            <section className="space-y-2 pt-2">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <ListMusic size={13} className="text-accent" />
                New on your playlists
                <span className="font-normal normal-case tracking-normal"> ({playlistWanted.length})</span>
              </h3>

              {playlistWanted.slice(0, 200).map((t) => (
                <div
                  key={t.id}
                  onClick={() => togglePlaylistWanted(t.id)}
                  className={cn(
                    'rows-track flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors',
                    t.selected ? 'border-accent/40 bg-accent/5' : 'border-border bg-card-bg hover:border-accent/20',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                      t.selected ? 'border-accent bg-accent' : 'border-border',
                    )}
                  >
                    {t.selected && <span className="text-xs text-white">✓</span>}
                  </div>

                  {t.cover ? (
                    <img src={t.cover} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-xs object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs bg-surface-bg">
                      <ListMusic size={14} className="text-text-muted" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{t.title}</p>
                    <p className="truncate text-xs text-text-muted">{t.artist}</p>
                  </div>

                  <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                    {t.playlistTitle}
                  </Badge>
                </div>
              ))}

              {playlistWanted.length > 200 && (
                <p className="pt-1 text-center text-xs text-text-muted">
                  Showing the first 200 of {playlistWanted.length}. Queue these to reveal the rest.
                </p>
              )}
            </section>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-5 space-y-2">
          {history.length === 0 ? (
            <div className="py-20 text-center text-text-muted">
              <Clock size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-text-secondary font-medium">No download history yet</p>
            </div>
          ) : (
            history.map((item) => (
              <div key={item.id} className="flex items-center gap-4 rounded-xl border border-border bg-card-bg p-4">
                {item.cover && (
                  <img src={item.cover} alt={item.title} className="h-10 w-10 rounded-lg object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{item.title}</p>
                  <p className="text-xs text-text-muted truncate">{item.artist}</p>
                </div>
                <span className="shrink-0 text-xs text-text-muted">
                  {item.downloadedAt ? new Date(item.downloadedAt).toLocaleDateString() : ""}
                </span>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="schedule" className="mt-5">
          <ScheduleEditor />
        </TabsContent>

        <TabsContent value="genres" className="mt-5 space-y-8">
          <ReleaseTypeFilter />
          <div className="h-px bg-border" />
          <FavoriteGenres />
        </TabsContent>
      </TabsRoot>
    </div>
  );
}
