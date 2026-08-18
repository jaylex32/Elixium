import {useCallback} from 'react';
import {toast} from 'sonner';
import {getSocket} from '@/shared/lib/socket';
import {buildServiceUrl, EMIT} from '@/shared/lib/events';
import {useDownloadStore} from '@/store/download-store';
import {useSettingsStore} from '@/store/settings-store';
import type {Service} from '@/store/app-store';

export interface DownloadTarget {
  id: string;
  type: 'album' | 'track' | 'playlist' | 'artist';
  title: string;
  artist?: string;
  cover?: string;
  service: Service;
  /** If you already have the URL, provide it directly */
  url?: string;
}

/** Distinguishes downloads started within the same millisecond. */
let urlDownloadSeq = 0;
const nextUrlDownloadId = () => (urlDownloadSeq += 1);

export function useDownload() {
  const {trackDownload} = useDownloadStore();
  const {settings} = useSettingsStore();

  const download = useCallback(
    (target: DownloadTarget) => {
      let url: string;
      try {
        url = target.url ?? buildServiceUrl(target.id, target.type, target.service);
      } catch (error) {
        // A mismatched id would otherwise fail deep inside the service API
        // with a message that says nothing about where it came from.
        toast.error('Cannot download this item', {
          description: error instanceof Error ? error.message : 'Unrecognised item id.',
        });
        return null;
      }
      const itemId = `${target.service}-${target.type}-${target.id}-${Date.now()}`;

      const socket = getSocket();

      // Register in store immediately so UI shows it
      trackDownload(itemId, {
        title: target.title,
        artist: target.artist,
        cover: target.cover,
      });

      socket.emit(EMIT.DIRECT_DOWNLOAD, {
        url,
        service: target.service,
        itemId,
        settings: {
          quality: target.service === 'deezer' ? settings.deezerQuality : settings.qobuzQuality,
          concurrency: settings.concurrency,
          trackNumber: settings.trackNumbering,
          fallbackTrack: settings.fallbackTrack,
          fallbackQuality: settings.fallbackQuality,
          deezerDownloadCover: settings.coverArt,
          qobuzDownloadCover: settings.coverArt,
        },
      });

      toast.success(`Downloading "${target.title}"`, {duration: 2000});

      return itemId;
    },
    [trackDownload, settings],
  );

  const downloadUrl = useCallback(
    (url: string, meta: {title: string; artist?: string; cover?: string; service: Service}) => {
      /*
       * A counter, not just the clock.
       *
       * "Download all ready" dispatches every URL in one synchronous loop, so
       * Date.now() returned the same value for all of them and every row shared
       * an id — the downloads ran but collapsed into a single history entry
       * that showed only the last one's details.
       */
      const itemId = `url-${Date.now()}-${nextUrlDownloadId()}`;
      const socket = getSocket();

      trackDownload(itemId, meta);

      socket.emit(EMIT.DIRECT_DOWNLOAD, {
        url,
        service: meta.service,
        itemId,
        settings: {
          quality: meta.service === 'deezer' ? settings.deezerQuality : settings.qobuzQuality,
          concurrency: settings.concurrency,
          trackNumber: settings.trackNumbering,
          fallbackTrack: settings.fallbackTrack,
          fallbackQuality: settings.fallbackQuality,
          deezerDownloadCover: settings.coverArt,
          qobuzDownloadCover: settings.coverArt,
        },
      });

      toast.success(`Downloading "${meta.title}"`, {duration: 2000});
      return itemId;
    },
    [trackDownload, settings],
  );

  return {download, downloadUrl};
}
