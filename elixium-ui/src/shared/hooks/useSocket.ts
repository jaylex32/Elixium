import {useEffect} from 'react';
import {toast} from 'sonner';
import {getSocket} from '@/shared/lib/socket';
import {ON} from '@/shared/lib/events';
import {useAppStore} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';
import type {DownloadProgressPayload} from '@shared/socket-events';
import {useSettingsStore} from '@/store/settings-store';

export function useSocket() {
  const setConnected = useAppStore((s) => s.setConnected);
  const {onProgress, onConversionProgress, onBatchComplete, onError, setRunning, clearDone} = useDownloadStore();
  const settings = useSettingsStore((s) => s.settings);
  const addReport = useDownloadStore((s) => s.addReport);

  useEffect(() => {
    const s = getSocket();

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    if (s.connected) setConnected(true);

    /*
     * Typed from the shared contract, not restated here.
     *
     * The inline copy that used to sit in this argument omitted every field the
     * server later added, so the per-item folder was discarded at the socket
     * boundary before the store could record it.
     */
    s.on(ON.DOWNLOAD_PROGRESS, (data: DownloadProgressPayload) => {
      onProgress(data);
    });

    s.on(ON.DIRECT_DOWNLOAD_PROGRESS, (data) => {
      onConversionProgress(data);
    });

    s.on(ON.DOWNLOAD_COMPLETE, (data) => {
      const count = data.count ?? data.files?.length ?? 1;
      /*
       * The itemId matters: a direct download sends one of these per item.
       *
       * Dropping it made every completion queue-wide, so the first download to
       * finish settled every other row that was still running and stamped its
       * own folder on them — two downloads at once ended up sharing one path.
       */
      onBatchComplete(count, data.files, data.itemId);
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
     * Conversion outcome. A cross-service download can complete while quietly
     * dropping tracks that had no match; this is the only place the user finds
     * out which ones.
     */
    s.on(
      'conversionReport',
      (data) => {
        const unmatched = Array.isArray(data?.unmatched) ? data.unmatched : [];
        if (unmatched.length === 0) return;

        addReport({
          itemId: String(data.itemId ?? `report-${Date.now()}`),
          matched: Number(data.matched) || 0,
          unmatched: unmatched.map((u) => ({
            title: String(u.title ?? 'Unknown track'),
            artist: String(u.artist ?? ''),
            album: u.album,
            isrc: u.isrc,
            reason: String(u.reason ?? 'No match found'),
          })),
        });

        toast.warning(`${unmatched.length} track${unmatched.length > 1 ? 's' : ''} could not be matched`, {
          description: 'See Downloads for the list.',
        });
      },
    );

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
       * Group by the service each item came from.
       *
       * This read queue[0].service and applied it to everything, so a mixed
       * batch — a Deezer artist and a Qobuz one both scanned — sent all of it
       * to whichever happened to be first, and half the ids meant nothing to
       * that service.
       *
       * A queued playlist arrives wrapped as {type: 'playlist', service:
       * 'user-playlist', tracks: [...]}, where "service" names the wrapper
       * rather than a download target; anything unrecognised falls back to the
       * service the app is currently pointed at.
       */
      /*
       * Only Deezer and Qobuz reach the queue: a YouTube Music item is resolved
       * onto one of them before it is ever queued, so it cannot be the fallback
       * for an item that arrived without a service of its own.
       */
      const appService = useAppStore.getState().service;
      const fallbackService: 'deezer' | 'qobuz' = appService === 'qobuz' ? 'qobuz' : 'deezer';
      const groups = new Map<'deezer' | 'qobuz', Array<Record<string, unknown>>>();

      for (const item of queue) {
        const raw = item?.service;
        const target: 'deezer' | 'qobuz' = raw === 'deezer' || raw === 'qobuz' ? raw : fallbackService;
        if (!groups.has(target)) groups.set(target, []);
        (groups.get(target) as Array<Record<string, unknown>>).push(item);
      }

      setRunning(true);

      for (const [service, items] of groups) {
        const quality = service === 'deezer' ? settings.deezerQuality : settings.qobuzQuality;
        s.emit('startDownload', {
          queue: items,
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
      }

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
      s.off('conversionReport');
      s.off(ON.WATCHLIST_QUEUE_ITEMS);
    };
  }, [setConnected, onProgress, onConversionProgress, onBatchComplete, onError, setRunning, clearDone, settings, addReport]);
}
