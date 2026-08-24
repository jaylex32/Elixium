import {useCallback} from 'react';
import {toast} from 'sonner';
import {getSocket} from '@/shared/lib/socket';
import {buildServiceUrl, EMIT} from '@/shared/lib/events';
import {useDownloadStore} from '@/store/download-store';
import {useSettingsStore} from '@/store/settings-store';
import type {Service} from '@/store/app-store';
import {http} from '@/shared/lib/api';

export interface DownloadTarget {
  id: string;
  type: 'album' | 'track' | 'playlist' | 'artist';
  title: string;
  artist?: string;
  cover?: string;
  service: Service;
  /** If you already have the URL, provide it directly */
  url?: string;
  /** YouTube Music only: the length, which is the matcher's strongest signal. */
  durationSeconds?: number | null;
}

/** Distinguishes downloads started within the same millisecond. */
let urlDownloadSeq = 0;
const nextUrlDownloadId = () => (urlDownloadSeq += 1);

export function useDownload() {
  const {trackDownload} = useDownloadStore();
  const {settings} = useSettingsStore();

  /*
   * Download from YouTube Music itself.
   *
   * The audio comes from YouTube — lossy AAC, which is the best it offers —
   * and the tags and artwork come from the browse pages, so the file lands in
   * the library looking like every other download.
   *
   * A whole album or playlist is expanded first: YouTube addresses those by a
   * browse id, and each track has to be fetched by its own video id.
   */
  const downloadFromYouTube = useCallback(
    async (target: DownloadTarget) => {
      try {
        type YtTrack = {
          id: string;
          title: string;
          artist: string;
          album?: string;
          rawData?: {videoId?: string; trackNumber?: number; cover?: string};
        };

        let tracks: YtTrack[] = [];
        let album = '';
        let albumArtist = target.artist ?? '';
        let year: number | null = null;
        let cover = target.cover;

        if (target.type === 'track') {
          tracks = [{id: target.id, title: target.title, artist: target.artist ?? '', rawData: {videoId: target.id}}];
        } else {
          const endpoint = target.type === 'playlist' ? '/ytmusic/playlist' : '/ytmusic/album';
          const {data} = await http.get(endpoint, {params: {id: target.id}});
          tracks = Array.isArray(data?.tracks) ? data.tracks : [];
          album = String(data?.title ?? '');
          albumArtist = String(data?.artist ?? albumArtist);
          year = data?.year ?? null;
          cover = data?.cover || cover;
        }

        if (tracks.length === 0) {
          toast.error('Nothing to download', {description: target.title});
          return;
        }

        toast.success(`Downloading "${target.title}" from YouTube Music`, {
          description: tracks.length > 1 ? `${tracks.length} tracks` : undefined,
          duration: 2500,
        });

        for (const track of tracks) {
          const videoId = track.rawData?.videoId ?? track.id;
          if (!videoId) continue;

          // One queue row per track, so progress is visible per file.
          const itemId = `ytmusic-${videoId}-${Date.now()}-${nextUrlDownloadId()}`;
          trackDownload(itemId, {
            title: track.title,
            artist: track.artist || albumArtist,
            cover: track.rawData?.cover || cover,
          });

          await http.post('/ytmusic/download', {
            videoId,
            itemId,
            title: track.title,
            artist: track.artist || albumArtist,
            album: track.album || album,
            albumArtist,
            year,
            trackNumber: track.rawData?.trackNumber ?? null,
            trackTotal: tracks.length > 1 ? tracks.length : null,
            cover: track.rawData?.cover || cover,
          });
        }
      } catch (error) {
        toast.error('Could not download from YouTube Music', {
          description: error instanceof Error ? error.message : 'YouTube may be refusing the request.',
        });
      }
    },
    [trackDownload],
  );

  const download = useCallback(
    (target: DownloadTarget) => {
      if (target.service === 'ytmusic') {
        void downloadFromYouTube(target);
        return null;
      }

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
    [trackDownload, settings, downloadFromYouTube],
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
