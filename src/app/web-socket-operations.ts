import type {Socket} from 'socket.io';

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
        createPlaylist: configAny.get('playlist.createPlaylist'),
        cookies: {
          arl: conf.get('cookies.arl'),
          sp_dc: configAny.get('cookies.sp_dc'),
        },
        qobuz: {
          app_id: conf.get('qobuz.app_id'),
          secrets: conf.get('qobuz.secrets'),
          token: conf.get('qobuz.token'),
        },
        saveLayout: conf.get('saveLayout'),
        coverSize: conf.get('coverSize'),
        playlist: configAny.get('playlist'),
        paths: {
          deezer: configAny.get('paths.deezer') || './Music/Deezer',
          qobuz: configAny.get('paths.qobuz') || './Music/Qobuz',
        },
        quality: {
          deezer: configAny.get('quality.deezer') || '320',
          qobuz: configAny.get('quality.qobuz') || '44khz',
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

      if (data.createPlaylist !== undefined) {
        configAny.set('playlist.createPlaylist', data.createPlaylist);
      }

      if (data.cookies) {
        if (data.cookies.arl) {
          conf.set('cookies.arl', data.cookies.arl);
          setIsDeezerDownloadReady(false);
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
      const item = activeDownloads.get(data.id);
      if (item) {
        item.status = 'cancelled';
        activeDownloads.delete(data.id);
        socket.emit('downloadProgress', {
          itemId: data.id,
          itemStatus: 'cancelled',
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
