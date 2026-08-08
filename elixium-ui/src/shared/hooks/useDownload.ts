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

export function useDownload() {
  const {trackDownload} = useDownloadStore();
  const {settings} = useSettingsStore();

  const download = useCallback(
    (target: DownloadTarget) => {
      const url = target.url ?? buildServiceUrl(target.id, target.type, target.service);
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
      const itemId = `url-${Date.now()}`;
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
