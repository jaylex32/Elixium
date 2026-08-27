import {resolve} from 'path';
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
  /** Resolve a YouTube link to its tracks, or null when it is not one. */
  resolveYtMusicUrl?: (url: string) => Promise<{
    kind: 'track' | 'album' | 'playlist' | 'artist';
    title: string;
    tracks: any[];
  } | null>;
  /** Download one YouTube Music track into the library. */
  downloadYtMusicTrack?: (
    videoId: string,
    metadata: any,
    onProgress?: (received: number, total: number | null) => void,
  ) => Promise<{path: string; folder: string; tagged: boolean; bitrate: number}>;
  /** Find YouTube tracks in Deezer's or Qobuz's catalogue. */
  matchYtMusicTracks?: (
    tracks: any[],
    preferred: 'deezer' | 'qobuz',
  ) => Promise<Array<{source: any; match: any; service: string | null; reason: string}>>;
  /** Find another service's tracks in YouTube Music's catalogue. */
  matchIntoYtMusic?: (
    sources: Array<{title: string; artist: string; durationSeconds?: number | null}>,
  ) => Promise<Array<{source: {title: string; artist: string}; match: any; reason: string}>>;
  /** Write the .m3u8 beside a downloaded playlist, as the other services do. */
  createPlaylistFile?: (savedFiles: string[], m3u8: string[], parsedData: any, data: any, socket: any) => Promise<void>;
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
  resolveYtMusicUrl,
  downloadYtMusicTrack,
  matchYtMusicTracks,
  matchIntoYtMusic,
  createPlaylistFile,
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

      /*
       * Converting another service's link into YouTube Music.
       *
       * The mirror of pasting a YouTube link while on Deezer. Reading the link
       * still belongs to whichever service owns it — only Deezer can say what
       * is in a Deezer playlist — and the tracks it names are then looked up on
       * YouTube Music and downloaded from there.
       *
       * A YouTube link is not converted into YouTube Music; it is already
       * there, and the branch below downloads it directly.
       */
      const foreignLink = !data.url.includes('youtube.com') && !data.url.includes('youtu.be');
      if (data.service === 'ytmusic' && foreignLink && matchIntoYtMusic && downloadYtMusicTrack) {
        emitConversionProgress({phase: 'auth', message: 'Reading the link...'});

        let source: any;
        /*
         * Read by whoever owns the link. Spotify and Deezer links go through
         * Deezer, so Qobuz is only woken for links that genuinely need it —
         * waiting on it otherwise turns an expired Qobuz token into a failure
         * for a conversion that never involved Qobuz.
         */
        if (data.url.includes('qobuz.com') || data.url.includes('tidal.com')) {
          await ensureQobuzSearchReady();
          source = await parseToQobuz(data.url, emitConversionProgress);
        } else {
          source = await parseDeezerUrl(data.url);
        }

        /* Each service names its fields differently; a match needs three. */
        const sources = (source?.tracks ?? []).map((track: any) => ({
          title: String(track?.SNG_TITLE ?? track?.title ?? ''),
          artist: String(track?.ART_NAME ?? track?.performer?.name ?? track?.artist?.name ?? ''),
          durationSeconds: Number(track?.DURATION ?? track?.duration ?? 0) || null,
        }));
        if (sources.length === 0) throw new Error('Nothing to convert at that link');

        emitConversionProgress({
          phase: 'matching',
          message: `Finding ${sources.length} track(s) on YouTube Music...`,
        });

        const matched = await matchIntoYtMusic(sources);
        const found = matched.filter((entry) => entry.match);
        if (found.length === 0) {
          throw new Error(`None of the ${sources.length} track(s) could be found on YouTube Music`);
        }

        reportUnmatched({
          tracks: found,
          unmatched: matched
            .filter((entry) => !entry.match)
            .map((entry) => ({title: entry.source.title, artist: entry.source.artist, reason: entry.reason})),
        });

        socket.emit('directUrlDownloadStart', {
          tracks: found.map((entry) => entry.match),
          contentType: 'ytmusic-playlist',
          trackCount: found.length,
        });

        const saved: string[] = [];
        for (let i = 0; i < found.length; i += 1) {
          const track = found[i].match;
          socket.emit('downloadProgress', {
            percentage: ((i + 1) / found.length) * 100,
            currentTrack: track.title,
            current: i + 1,
            total: found.length,
            itemId: data.itemId ?? 'url-download',
            itemStatus: 'downloading',
            itemProgress: Math.round(((i + 1) / found.length) * 100),
          });
          try {
            const result = await downloadYtMusicTrack(track.rawData?.videoId ?? track.id, {
              title: track.title,
              artist: track.artist,
              album: track.album,
              albumArtist: track.artist,
              year: track.year ?? null,
              trackNumber: i + 1,
              trackTotal: found.length,
              coverUrl: track.rawData?.cover,
              musicVideoType: track.rawData?.musicVideoType,
              comment: `Converted from ${data.url}`,
            });
            saved.push(result.path);
          } catch (error: any) {
            console.log(`ytmusic: ${track.title} failed — ${error?.message ?? error}`);
          }
        }

        /*
         * A downloaded playlist gets its .m3u8, the same as on the other
         * services. This was missed when the YouTube Music paths were written,
         * so a converted playlist arrived as loose files with nothing tying
         * them together.
         */
        const kind =
          String(source?.linktype ?? '')
            .split('-')
            .pop() || 'playlist';
        await createPlaylistFile?.(
          saved,
          saved.map((file) => resolve(file)),
          {linktype: `ytmusic-${kind}`, linkinfo: source?.linkinfo ?? {}},
          data,
          socket,
        );

        socket.emit('downloadComplete', {
          itemId: data.itemId ?? 'url-download',
          count: saved.length,
          files: saved,
          playlistCreated: saved.length > 1,
        });
        console.log(`🎉 Converted to YouTube Music: ${saved.length} files saved.`);
        return;
      }

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
        /*
         * On YouTube Music the link is downloaded from YouTube Music.
         *
         * It used to be a hard error unless Qobuz was selected — "YouTube URL
         * conversion is currently supported only for Qobuz downloads" — which
         * made sense when YouTube was a source to convert from and nothing
         * else. Selecting YouTube Music and pasting a YouTube link now does
         * the obvious thing.
         */
        /*
         * Converting to the selected service, when that is not YouTube Music.
         *
         * Pasting a link does not mean "download from wherever this link
         * happens to live" — it means "get me this, from the service I am
         * on", which is what a Spotify or TIDAL link already does. Downloading
         * from a service the user has not selected is the bug, not the
         * feature.
         *
         * The link is still read by YouTube Music, because nothing else can
         * say what is at a YouTube URL; only the tracks are then looked up in
         * the target catalogue.
         */
        if ((data.service === 'deezer' || data.service === 'qobuz') && resolveYtMusicUrl && matchYtMusicTracks) {
          const resolved = await resolveYtMusicUrl(data.url);
          if (!resolved || resolved.tracks.length === 0) {
            throw new Error('YouTube Music found nothing at that link');
          }

          emitConversionProgress({
            phase: 'matching',
            message: `Finding ${resolved.tracks.length} track(s) on ${data.service.toUpperCase()}...`,
          });

          const matched = await matchYtMusicTracks(resolved.tracks, data.service);
          const found = matched.filter((entry) => entry.match);
          const missing = matched.filter((entry) => !entry.match);

          if (found.length === 0) {
            throw new Error(
              `None of the ${resolved.tracks.length} track(s) could be found on ${data.service.toUpperCase()}`,
            );
          }

          /*
           * The downloaders take each service's own track payload, which is
           * what the search kept on `rawData`.
           */
          const converted = {
            tracks: found.map((entry) => entry.match.rawData),
            linktype: `${data.service}-${resolved.kind}`,
            linkinfo: {title: resolved.title, artist: {name: resolved.tracks[0]?.artist ?? ''}},
            /* Named so the manager can say which tracks had no counterpart. */
            unmatched: missing.map((entry) => ({
              title: entry.source?.title ?? '',
              artist: entry.source?.artist ?? '',
              reason: entry.reason,
            })),
          };

          reportUnmatched(converted);

          if (data.service === 'qobuz') {
            await ensureQobuzDownloadReady();
            await downloadQobuzTracks(converted, data, socket);
          } else {
            await ensureDeezerDownloadReady();
            await downloadDeezerTracks(converted, data, socket);
          }
          return;
        }

        /* On YouTube Music the link is downloaded from YouTube Music. */
        if (resolveYtMusicUrl && downloadYtMusicTrack) {
          const resolved = await resolveYtMusicUrl(data.url);
          if (!resolved || resolved.tracks.length === 0) {
            throw new Error('YouTube Music found nothing at that link');
          }

          socket.emit('directUrlDownloadStart', {
            tracks: resolved.tracks,
            contentType: `ytmusic-${resolved.kind}`,
            trackCount: resolved.tracks.length,
          });

          const saved: string[] = [];
          for (let i = 0; i < resolved.tracks.length; i += 1) {
            const track = resolved.tracks[i];
            socket.emit('downloadProgress', {
              percentage: ((i + 1) / resolved.tracks.length) * 100,
              currentTrack: track.title,
              current: i + 1,
              total: resolved.tracks.length,
              itemId: data.itemId ?? 'url-download',
              itemStatus: 'downloading',
              itemProgress: Math.round(((i + 1) / resolved.tracks.length) * 100),
            });

            try {
              const result = await downloadYtMusicTrack(track.rawData?.videoId ?? track.id, {
                title: track.title,
                artist: track.artist,
                album: track.album || resolved.title,
                albumArtist: track.artist,
                year: track.year ?? null,
                trackNumber: i + 1,
                trackTotal: resolved.tracks.length,
                coverUrl: track.rawData?.cover,
                musicVideoType: track.rawData?.musicVideoType,
                comment: `YouTube Music · ${data.url}`,
              });
              saved.push(result.path);
            } catch (error: any) {
              /* One track failing should not abandon the rest of an album. */
              console.log(`ytmusic: ${track.title} failed — ${error?.message ?? error}`);
            }
          }

          await createPlaylistFile?.(
            saved,
            saved.map((file) => resolve(file)),
            {linktype: `ytmusic-${resolved.kind}`, linkinfo: {title: resolved.title}},
            data,
            socket,
          );

          socket.emit('downloadComplete', {
            itemId: data.itemId ?? 'url-download',
            count: saved.length,
            files: saved,
            playlistCreated: saved.length > 1,
          });
          console.log(`🎉 YouTube Music download complete! ${saved.length} files saved.`);
          return;
        }

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
