import {useEffect} from 'react';
import {toast} from 'sonner';
import {getSocket} from '@/shared/lib/socket';
import {ON} from '@/shared/lib/events';
import {useAppStore} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';
import {useSettingsStore} from '@/store/settings-store';

export function useSocket() {
  const setConnected = useAppStore((s) => s.setConnected);
  const {onProgress, onConversionProgress, onBatchComplete, onError, setRunning, clearDone} = useDownloadStore();
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    const s = getSocket();

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    if (s.connected) setConnected(true);

    s.on(
      ON.DOWNLOAD_PROGRESS,
      (data: {
        itemId?: string;
        percentage?: number;
        currentTrack?: string;
        current?: number;
        total?: number;
        itemStatus?: string;
        itemProgress?: number;
      }) => {
        onProgress(data);
      },
    );

    s.on(ON.DIRECT_DOWNLOAD_PROGRESS, (data: {phase: string; message: string; percentage: number; itemId?: string}) => {
      onConversionProgress(data);
    });

    s.on(ON.DOWNLOAD_COMPLETE, (data: {count?: number; files?: string[]}) => {
      const count = data.count ?? data.files?.length ?? 1;
      onBatchComplete(count);
      toast.success(`Download complete — ${count} track${count > 1 ? 's' : ''}`);
      // Retire finished rows shortly after, so the list settles back to what
      // is actually still running instead of accumulating completed entries.
      window.setTimeout(() => clearDone(), 4000);
    });

    s.on(ON.DOWNLOAD_ERROR, (data: {message?: string; itemId?: string}) => {
      const id = data.itemId ?? '__error__';
      onError(id, data.message ?? 'Download failed');
      toast.error(data.message ?? 'Download failed');
    });

    s.on(ON.DIRECT_DOWNLOAD_START, () => setRunning(true));

    /*
     * Watchlist queue -> actual download.
     *
     * Queueing from the watchlist calls queueWatchedArtistReleases /
     * queueWatchedPlaylistTracks, which mark the items and broadcast the
     * resulting queue as `watchlistQueueItems`. The client was expected to
     * take that queue and ask the server to run it — and no handler existed,
     * so selecting tracks and pressing Download did nothing at all. This is
     * the missing link.
     */
    s.on(ON.WATCHLIST_QUEUE_ITEMS, (data: {queueItems?: Array<Record<string, unknown>>; autoStart?: boolean}) => {
      const queue = Array.isArray(data?.queueItems) ? data.queueItems : [];
      if (queue.length === 0) {
        toast.info('Nothing new to download', {description: 'Those items were already processed.'});
        return;
      }

      if (!data.autoStart) {
        toast.success(`${queue.length} item${queue.length > 1 ? 's' : ''} queued`);
        return;
      }

      /*
       * A queued playlist arrives wrapped: {type: 'playlist', service:
       * 'user-playlist', tracks: [...]}. That "service" names the wrapper, not
       * a download target — forwarding it verbatim would ask the server to
       * download from a service that does not exist. The target is whichever
       * service the app is pointed at.
       */
      const itemService = queue[0]?.service;
      const service: 'deezer' | 'qobuz' =
        itemService === 'deezer' || itemService === 'qobuz'
          ? itemService
          : useAppStore.getState().service;
      const quality = service === 'deezer' ? settings.deezerQuality : settings.qobuzQuality;

      setRunning(true);
      s.emit('startDownload', {
        queue,
        service,
        quality,
        settings: {
          quality,
          concurrency: settings.concurrency,
          trackNumber: settings.trackNumbering,
          fallbackTrack: settings.fallbackTrack,
          fallbackQuality: settings.fallbackQuality,
          deezerDownloadCover: settings.coverArt,
          qobuzDownloadCover: settings.coverArt,
        },
      });

      toast.success(`Downloading ${queue.length} track${queue.length > 1 ? 's' : ''}`, {
        description: 'Progress is on the Downloads page.',
      });
    });

    return () => {
      s.off('connect');
      s.off('disconnect');
      s.off(ON.DOWNLOAD_PROGRESS);
      s.off(ON.DIRECT_DOWNLOAD_PROGRESS);
      s.off(ON.DOWNLOAD_COMPLETE);
      s.off(ON.DOWNLOAD_ERROR);
      s.off(ON.DIRECT_DOWNLOAD_START);
      s.off(ON.WATCHLIST_QUEUE_ITEMS);
    };
  }, [setConnected, onProgress, onConversionProgress, onBatchComplete, onError, setRunning, clearDone, settings]);
}
