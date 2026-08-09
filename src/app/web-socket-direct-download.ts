import type {Socket} from 'socket.io';

interface WebSocketDirectDownloadDependencies {
  socket: Socket;
  parseToQobuz: (url: string, onProgress?: (progress: any) => void) => Promise<any>;
  parseDeezerUrl: (url: string) => Promise<any>;
  ensureQobuzSearchReady: () => Promise<void>;
  ensureQobuzDownloadReady: () => Promise<void>;
  ensureDeezerDownloadReady: () => Promise<void>;
  shouldUseVariousArtists: (settings?: any) => boolean;
  downloadQobuzTracks: (parsedData: any, data: any, socket: any) => Promise<void>;
  downloadDeezerTracks: (parsedData: any, data: any, socket: any) => Promise<void>;
}

export const registerDirectDownloadSocketHandler = ({
  socket,
  parseToQobuz,
  parseDeezerUrl,
  ensureQobuzSearchReady,
  ensureQobuzDownloadReady,
  ensureDeezerDownloadReady,
  shouldUseVariousArtists,
  downloadQobuzTracks,
  downloadDeezerTracks,
}: WebSocketDirectDownloadDependencies) => {
  socket.on('directUrlDownload', async (data) => {
    try {
      let parsedData: any;
      const emitConversionProgress = (progress: {
        phase: string;
        message: string;
        current?: number;
        total?: number;
        percentage?: number;
      }) => {
        const total = progress.total && progress.total > 0 ? progress.total : 100;
        const percentage =
          progress.percentage !== undefined
            ? Math.max(0, Math.min(100, progress.percentage))
            : progress.current !== undefined
            ? Math.max(0, Math.min(100, Math.round((progress.current / total) * 100)))
            : 0;
        const current =
          progress.current !== undefined
            ? progress.current
            : progress.percentage !== undefined
            ? Math.round((percentage / 100) * total)
            : 0;

        // Without the itemId the client files conversion progress under a
        // synthetic '__conversion__' key, producing a second row for the same
        // job alongside the real download.
        socket.emit('directUrlConversionProgress', {
          itemId: data.itemId,
          phase: progress.phase,
          message: progress.message,
          current,
          total,
          percentage,
        });

        socket.emit('downloadProgress', {
          percentage,
          current,
          total,
          currentTrack: progress.message,
          itemId: data.itemId ?? 'url-conversion',
          itemStatus: 'downloading',
          itemProgress: percentage,
        });
      };

      /**
       * Report tracks the conversion could not match.
       *
       * Previously these were counted and logged server-side only, so a
       * playlist simply arrived short with no explanation.
       */
      const reportUnmatched = (parsed: any) => {
        const unmatched = Array.isArray(parsed?.unmatched) ? parsed.unmatched : [];
        if (unmatched.length === 0) return;
        socket.emit('conversionReport', {
          itemId: data.itemId,
          matched: parsed?.tracks?.length ?? 0,
          unmatched,
        });
      };

      console.log('🚀 Direct URL download started');
      console.log('📄 URL:', data.url);
      console.log('🎵 Selected service:', data.service);

      if (
        data.url.includes('spotify.com') ||
        data.url.includes('open.spotify.com') ||
        data.url.startsWith('spotify:')
      ) {
        console.log(`🎵 Converting Spotify to ${data.service.toUpperCase()}...`);
        emitConversionProgress({
          phase: 'auth',
          message: `Starting Spotify to ${data.service.toUpperCase()} conversion...`,
          percentage: 2,
          current: 2,
          total: 100,
        });

        if (data.service === 'qobuz') {
          await ensureQobuzSearchReady();

          parsedData = await parseToQobuz(data.url, emitConversionProgress);
          emitConversionProgress({
            phase: 'matching',
            message: `Conversion ready. ${parsedData?.tracks?.length || 0} tracks will be downloaded.`,
            percentage: 100,
            current: 100,
            total: 100,
          });

          await ensureQobuzDownloadReady();
          reportUnmatched(parsedData);
          await downloadQobuzTracks(parsedData, data, socket);
        } else if (data.service === 'deezer') {
          await ensureDeezerDownloadReady();

          parsedData = await parseDeezerUrl(data.url);

          if (!parsedData?.tracks || parsedData.tracks.length === 0) {
            throw new Error('No matching tracks found for the provided Spotify playlist');
          }

          const useVariousArtists = shouldUseVariousArtists(data.settings);
          if (!useVariousArtists && parsedData.linkinfo?.ART_NAME === 'Various Artists') {
            delete parsedData.linkinfo.ART_NAME;
          }

          reportUnmatched(parsedData);
          await downloadDeezerTracks(parsedData, data, socket);
        }
      } else if (data.url.includes('deezer.com')) {
        console.log('🎵 Processing Deezer URL...');
        if (data.service === 'qobuz') {
          await ensureQobuzSearchReady();
          parsedData = await parseToQobuz(data.url, emitConversionProgress);

          await ensureQobuzDownloadReady();
          reportUnmatched(parsedData);
          await downloadQobuzTracks(parsedData, data, socket);
        } else {
          parsedData = await parseDeezerUrl(data.url);

          await ensureDeezerDownloadReady();
          reportUnmatched(parsedData);
          await downloadDeezerTracks(parsedData, data, socket);
        }
      } else if (data.url.includes('tidal.com')) {
        if (data.service !== 'qobuz') {
          throw new Error('TIDAL URL conversion is currently supported only for Qobuz downloads.');
        }

        console.log('🎵 Converting TIDAL to QOBUZ...');
        await ensureQobuzSearchReady();
        parsedData = await parseToQobuz(data.url, emitConversionProgress);

        await ensureQobuzDownloadReady();
        reportUnmatched(parsedData);
        await downloadQobuzTracks(parsedData, data, socket);
      } else if (data.url.includes('youtube.com') || data.url.includes('youtu.be')) {
        if (data.service !== 'qobuz') {
          throw new Error('YouTube URL conversion is currently supported only for Qobuz downloads.');
        }

        console.log('🎵 Converting YouTube to QOBUZ...');
        await ensureQobuzSearchReady();
        parsedData = await parseToQobuz(data.url, emitConversionProgress);

        await ensureQobuzDownloadReady();
        reportUnmatched(parsedData);
        await downloadQobuzTracks(parsedData, data, socket);
      } else if (data.url.includes('qobuz.com') || data.url.includes('play.qobuz.com')) {
        console.log('🎵 Processing Qobuz URL...');

        await ensureQobuzSearchReady();
        parsedData = await parseToQobuz(data.url, emitConversionProgress);

        await ensureQobuzDownloadReady();
        reportUnmatched(parsedData);
        await downloadQobuzTracks(parsedData, data, socket);
      } else {
        throw new Error('Unsupported URL format');
      }
    } catch (error: any) {
      console.error('❌ Direct URL download error:', error);
      socket.emit('directUrlDownloadError', {message: error.message});
    }
  });
};
