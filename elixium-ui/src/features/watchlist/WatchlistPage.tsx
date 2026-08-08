import {useEffect} from 'react';
import {Eye, RefreshCw, Download, Plus, Clock, Trash2, CheckSquare, Square} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Badge} from '@/shared/components/ui/Badge';
import {Spinner} from '@/shared/components/ui/Spinner';
import {TabsRoot, TabsList, TabsTrigger, TabsContent} from '@/shared/components/ui/Tabs';
import {useWatchlistStore, type WatchlistTab} from '@/store/watchlist-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {useAppStore} from '@/store/app-store';
import {getSocket} from '@/shared/lib/socket';

interface WatchlistState {
  watchedArtists?: Array<{
    id: string;
    name: string;
    picture_url?: string;
    picture?: string;
    addedAt?: string;
    lastChecked?: string;
  }>;
  wantedAlbums?: Array<{
    id: string;
    title: string;
    artist: {name: string};
    image?: {large?: string};
    release_date_original?: string;
    product_type?: string;
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
  } = useWatchlistStore();
  const {download} = useDownload();
  const setPage = useAppStore((s) => s.setPage);

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
          })),
        );
      }
      if (state.wantedAlbums) {
        setWanted(
          state.wantedAlbums.map((a) => ({
            id: a.id,
            title: a.title,
            artist: a.artist?.name ?? 'Unknown',
            cover: a.image?.large ?? '',
            type: (a.product_type as 'album' | 'ep' | 'single') ?? 'album',
            releaseDate: a.release_date_original ?? '',
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
    const selected = wanted.filter((i) => i.selected);
    if (!selected.length) return;
    selected.forEach((i) =>
      download({id: i.id, type: 'album', title: i.title, artist: i.artist, cover: i.cover, service: 'qobuz'}),
    );
    toast.success(`Queued ${selected.length} release${selected.length > 1 ? 's' : ''}`);
    setPage('downloads');
  };

  const selectedCount = wanted.filter((i) => i.selected).length;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto animate-fade-in">
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
          <TabsTrigger value="wanted">
            Wanted{' '}
            {wanted.length > 0 && (
              <Badge variant="warning" className="ml-1">
                {wanted.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
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
                  <p className="text-sm font-medium text-text-primary text-center truncate w-full">{artist.name}</p>
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

        <TabsContent value="wanted" className="mt-5 space-y-4">
          {wanted.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="ghost" size="sm" onClick={selectAllWanted}>
                <CheckSquare size={14} /> Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAllWanted}>
                <Square size={14} /> Deselect all
              </Button>
              {selectedCount > 0 && (
                <Button size="sm" onClick={handleDownloadSelected}>
                  <Download size={14} /> Download {selectedCount} selected
                </Button>
              )}
            </div>
          )}
          <div className="space-y-2">
            {wanted.map((item) => (
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
                <span className="text-xs text-text-muted shrink-0">{item.downloadedAt}</span>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="schedule" className="mt-5">
          <div className="rounded-xl border border-border bg-card-bg p-6 max-w-sm">
            <p className="font-medium text-text-primary mb-4">Automatic scan schedule</p>
            <p className="text-sm text-text-muted">Schedule configuration coming soon.</p>
          </div>
        </TabsContent>
      </TabsRoot>
    </div>
  );
}
