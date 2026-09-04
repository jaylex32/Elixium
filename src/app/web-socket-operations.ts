import type {Socket} from 'socket.io';
import {cancelJob} from './download-cancellation';
import {metadataSettingsFrom} from '../lib/metadata-options';

interface WebSocketOperationsDependencies {
  socket: Socket;
  conf: any;
  queue: any;
  signale: any;
  normalizeQuality: (quality: string, service: string) => string;
  startDownloadProcess: (
    downloadQueue: any[],
    quality: string,
    service: string,
    settings: any,
    socket?: any,
  ) => Promise<void>;
  getCurrentDownloadQueue: () => any[];
  activeDownloads: Map<any, any>;
  getIsDownloading: () => boolean;
  setIsDeezerDownloadReady: (value: boolean) => void;
  setIsQobuzInitialized: (value: boolean) => void;
  setIsQobuzDownloadReady: (value: boolean) => void;
}

export const registerOperationsSocketHandlers = ({
  socket,
  conf,
  queue,
  signale,
  normalizeQuality,
  startDownloadProcess,
  getCurrentDownloadQueue,
  activeDownloads,
  getIsDownloading,
  setIsDeezerDownloadReady,
  setIsQobuzInitialized,
  setIsQobuzDownloadReady,
}: WebSocketOperationsDependencies) => {
  socket.on('getSettings', () => {
    try {
      const configAny = conf as any;
      const settings = {
        concurrency: conf.get('concurrency'),
        trackNumber: conf.get('trackNumber'),
        fallbackTrack: conf.get('fallbackTrack'),
        fallbackQuality: conf.get('fallbackQuality'),
        deezerDownloadCover: conf.get('deezerDownloadCover'),
        qobuzDownloadCover: conf.get('qobuzDownloadCover'),
        embedLyrics: conf.get('embedLyrics') !== false,
        saveLrcFile: Boolean(conf.get('saveLrcFile')),
        createPlaylist: configAny.get('playlist.createPlaylist'),
        cookies: {
          arl: conf.get('cookies.arl'),
          sp_dc: configAny.get('cookies.sp_dc'),
          spotifyClientId: configAny.get('cookies.spotifyClientId'),
          spotifyClientSecret: configAny.get('cookies.spotifyClientSecret'),
        },
        qobuz: {
          app_id: conf.get('qobuz.app_id'),
          secrets: conf.get('qobuz.secrets'),
          token: conf.get('qobuz.token'),
        },
        /* Which tags are written; the interface offers these under Metadata. */
        metadata: metadataSettingsFrom(configAny.get('metadata')),
        metadataCustom: configAny.get('metadataCustom') === true,
        ytmusic: {
          cookie: configAny.get('ytmusic.cookie'),
          /* Defaults live here as well as in the engine, so the interface
             shows what is actually in force before anything is saved. */
          preferAlbumAudio: configAny.get('ytmusic.preferAlbumAudio') !== false,
          strictAlbumAudio: configAny.get('ytmusic.strictAlbumAudio') === true,
        },
        saveLayout: conf.get('saveLayout'),
        coverSize: conf.get('coverSize'),
        playlist: configAny.get('playlist'),
        /*
         * Every path the interface can edit has to be sent back, not just the
         * ones that existed when this was written.
         *
         * Saving replaces the whole `paths` object with what the interface
         * holds, so a path that is never sent out comes back empty on the next
         * save and erases itself. Adding a field here is not optional when one
         * is added to the settings page.
         */
        paths: {
          deezer: configAny.get('paths.deezer') || './Music/Deezer',
          qobuz: configAny.get('paths.qobuz') || './Music/Qobuz',
          ytmusic: configAny.get('paths.ytmusic') || './Music/YouTube Music',
        },
        quality: {
          deezer: configAny.get('quality.deezer') || '320',
          qobuz: configAny.get('quality.qobuz') || '44khz',
          ytmusic: configAny.get('quality.ytmusic') || 'aac',
        },
        /*
         * Which services the switcher offers. Absent means on: an existing
         * config predates the setting and turning services off for people who
         * never asked would be a strange upgrade.
         */
        services: {
          deezer: configAny.get('services.deezer') !== false,
          qobuz: configAny.get('services.qobuz') !== false,
          ytmusic: configAny.get('services.ytmusic') !== false,
        },
      };
      socket.emit('settings', settings);
    } catch (error: any) {
      socket.emit('settingsError', {message: error.message});
    }
  });

  socket.on('saveSettings', (data) => {
    try {
      const configAny = conf as any;

      if (data.concurrency) {
        conf.set('concurrency', data.concurrency);
        queue.concurrency = data.concurrency;
      }

      if (data.trackNumber !== undefined) {
        conf.set('trackNumber', data.trackNumber);
      }

      if (data.fallbackTrack !== undefined) {
        conf.set('fallbackTrack', data.fallbackTrack);
      }

      if (data.fallbackQuality !== undefined) {
        conf.set('fallbackQuality', data.fallbackQuality);
      }

      if (data.deezerDownloadCover !== undefined) {
        conf.set('deezerDownloadCover', data.deezerDownloadCover);
      }

      if (data.qobuzDownloadCover !== undefined) {
        conf.set('qobuzDownloadCover', data.qobuzDownloadCover);
      }

      if (data.embedLyrics !== undefined) {
        conf.set('embedLyrics', data.embedLyrics);
      }

      if (data.saveLrcFile !== undefined) {
        conf.set('saveLrcFile', data.saveLrcFile);
      }

      if (data.createPlaylist !== undefined) {
        configAny.set('playlist.createPlaylist', data.createPlaylist);
      }

      if (data.cookies) {
        if (data.cookies.arl) {
          conf.set('cookies.arl', data.cookies.arl);
          setIsDeezerDownloadReady(false);
        }
        // Spotify developer-app credentials, used for playlist search. The
        // web-player token is rate-limited off /v1/search, so this is the only
        // reliable route.
        if (data.cookies.spotifyClientId !== undefined) {
          configAny.set('cookies.spotifyClientId', data.cookies.spotifyClientId);
        }
        if (data.cookies.spotifyClientSecret !== undefined) {
          configAny.set('cookies.spotifyClientSecret', data.cookies.spotifyClientSecret);
        }
        if (data.cookies.sp_dc) {
          configAny.set('cookies.sp_dc', data.cookies.sp_dc);
        }
      }

      if (data.qobuz) {
        if (data.qobuz.token) {
          conf.set('qobuz.token', data.qobuz.token);
          setIsQobuzDownloadReady(false);
        }
        if (data.qobuz.app_id !== undefined && data.qobuz.app_id !== null && String(data.qobuz.app_id).trim() !== '') {
          const appId = Number(data.qobuz.app_id);
          conf.set('qobuz.app_id', isNaN(appId) ? data.qobuz.app_id : appId);
          setIsQobuzInitialized(false);
          setIsQobuzDownloadReady(false);
        }
        if (data.qobuz.secrets !== undefined) {
          const s = String(data.qobuz.secrets || '').trim();
          conf.set('qobuz.secrets', s);
          setIsQobuzInitialized(false);
          setIsQobuzDownloadReady(false);
        }
      }

      /*
       * The YouTube cookie.
       *
       * YouTube refuses stream URLs to signed-out callers for most music —
       * measured at one track in six — so without this, YouTube Music
       * downloads mostly fail. It is a session credential like the Deezer
       * ARL: revocable by signing out, and never sent anywhere but YouTube.
       */
      if (data.ytmusic && data.ytmusic.cookie !== undefined) {
        configAny.set('ytmusic.cookie', String(data.ytmusic.cookie || '').trim());
      }

      /*
       * A music video's audio is not the record. Kept separate from the cookie
       * above because these arrive whether or not a session was pasted, and a
       * settings save that omitted the cookie must not reset them.
       */
      if (data.ytmusic && data.ytmusic.preferAlbumAudio !== undefined) {
        configAny.set('ytmusic.preferAlbumAudio', data.ytmusic.preferAlbumAudio === true);
      }
      if (data.ytmusic && data.ytmusic.strictAlbumAudio !== undefined) {
        configAny.set('ytmusic.strictAlbumAudio', data.ytmusic.strictAlbumAudio === true);
      }

      if (typeof data.metadataCustom === 'boolean') {
        configAny.set('metadataCustom', data.metadataCustom);
      }

      if (data.metadata && typeof data.metadata === 'object') {
        /* Merged through the same reader the writers use, so an unknown key
           cannot land in the config and a missing one keeps its default. */
        configAny.set('metadata', metadataSettingsFrom(data.metadata));
      }

      if (data.saveLayout) {
        conf.set('saveLayout', data.saveLayout);
      }

      if (data.coverSize) {
        conf.set('coverSize', data.coverSize);
      }

      if (data.paths) {
        configAny.set('paths', data.paths);
      }

      if (data.quality) {
        if (data.quality.deezer) {
          configAny.set('quality.deezer', data.quality.deezer);
        }
        if (data.quality.qobuz) {
          configAny.set('quality.qobuz', data.quality.qobuz);
        }
        /* Without this the format control saved nothing and every download
           came back as AAC whatever the setting said. */
        if (data.quality.ytmusic) {
          configAny.set('quality.ytmusic', data.quality.ytmusic);
        }
      }

      if (data.services && typeof data.services === 'object') {
        /*
         * At least one has to remain. Saving none would leave a switcher with
         * nothing in it and no way back to this setting's own page.
         */
        const wanted = {
          deezer: data.services.deezer !== false,
          qobuz: data.services.qobuz !== false,
          ytmusic: data.services.ytmusic !== false,
        };
        if (wanted.deezer || wanted.qobuz || wanted.ytmusic) {
          configAny.set('services', wanted);
        }
      }

      console.log(signale.success('Settings updated from web interface'));
      socket.emit('settingsSaved', {success: true});
    } catch (error: any) {
      socket.emit('settingsError', {message: error.message});
    }
  });

  socket.on('getQualitySettings', () => {
    try {
      const configAny = conf as any;
      const qualitySettings = {
        deezer: configAny.get('quality.deezer') || '320',
        qobuz: configAny.get('quality.qobuz') || '44khz',
      };
      socket.emit('qualitySettings', qualitySettings);
    } catch (error: any) {
      socket.emit('qualitySettingsError', {message: error.message});
    }
  });

  socket.on('saveQualitySettings', (data) => {
    try {
      const configAny = conf as any;

      if (data.deezer) {
        configAny.set('quality.deezer', data.deezer);
      }

      if (data.qobuz) {
        configAny.set('quality.qobuz', data.qobuz);
      }

      console.log(signale.success('Quality settings saved'));
      socket.emit('qualitySettingsSaved', {success: true});
    } catch (error: any) {
      socket.emit('qualitySettingsError', {message: error.message});
    }
  });

  socket.on('startDownload', async (data) => {
    try {
      const normalizedQuality = normalizeQuality(data.quality, data.service);
      await startDownloadProcess(data.queue, normalizedQuality, data.service, data.settings, socket);
    } catch (error: any) {
      socket.emit('downloadError', {message: error.message});
    }
  });

  socket.on('cancelDownload', (data) => {
    try {
      const id = String(data?.id ?? '');

      /*
       * Queue items and downloads started from a button are tracked
       * separately, and only the first had ever been looked up here — so
       * cancelling an album from the downloads list marked nothing, stopped
       * nothing, and told the caller nothing. Both are checked now.
       */
      const item = activeDownloads.get(id);
      if (item) {
        item.status = 'cancelled';
        activeDownloads.delete(id);
      }

      const stopped = cancelJob(id);

      /*
       * Answered whether or not anything was found. A cancel that silently did
       * nothing is what left the row sitting at "downloading" while the files
       * kept arriving.
       */
      if (item || stopped) {
        socket.emit('downloadProgress', {itemId: id, itemStatus: 'cancelled'});
      } else {
        /*
         * Nothing was found, so nothing was stopped — and saying "cancelled"
         * anyway would mark a row that is still downloading. The honest answer
         * is that there was nothing here to cancel.
         */
        socket.emit('downloadError', {
          itemId: id,
          message: 'That download had already finished',
        });
      }
    } catch (error: any) {
      socket.emit('downloadError', {message: error.message});
    }
  });

  socket.on('getDownloadStatus', (data?: any) => {
    const currentDownloadQueue = getCurrentDownloadQueue();
    const isDownloading = getIsDownloading();

    socket.emit('downloadStatus', {
      isDownloading,
      activeDownloads: Array.from(activeDownloads.values()),
      queueLength: currentDownloadQueue.length,
    });

    if (data && data.queueItems && Array.isArray(data.queueItems)) {
      try {
        const currentDownloads = data.queueItems;
        const statusUpdates: any[] = [];

        currentDownloads.forEach((item: any) => {
          let actualStatus = item.status || 'queued';

          if (activeDownloads && activeDownloads.has(item.id)) {
            actualStatus = 'downloading';
          } else if (currentDownloadQueue.some((queueItem: any) => queueItem.id === item.id)) {
            actualStatus = 'queued';
          } else if (item.status === 'downloading' || item.status === 'queued') {
            // Preserve resumable local queue state after reloads instead of
            // incorrectly converting everything missing from backend memory to completed.
            actualStatus = 'queued';
          }

          statusUpdates.push({
            id: item.id,
            status: actualStatus,
            title: item.title,
          });
        });

        socket.emit('downloadStatusUpdate', {
          downloads: statusUpdates,
          isDownloading,
        });

        console.log(`📊 Sent download status update for ${statusUpdates.length} items`);
      } catch (error: any) {
        console.error('Error processing queue items:', error);
      }
    }
  });

  socket.on('getActiveDownloads', () => {
    socket.emit('activeDownloads', getCurrentDownloadQueue());
  });

  socket.on('serviceChange', (data) => {
    console.log(`Client switched to ${data.service}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
};
