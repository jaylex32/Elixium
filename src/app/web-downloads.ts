import {EOL} from 'os';
import {writeFileSync} from 'fs';
import {dirname, join, resolve, sep} from 'path';

interface WebDownloadsDependencies {
  conf: any;
  qobuzDownloadTrack: any;
  deezerDownloadTrack: any;
  commonPath: (paths: string[]) => string;
  sanitizeFilename: (value: string) => string;
  trueCasePathSync: (path: string) => string;
}

export const createWebDownloads = ({
  conf,
  qobuzDownloadTrack,
  deezerDownloadTrack,
  commonPath,
  sanitizeFilename,
  trueCasePathSync,
}: WebDownloadsDependencies) => {
  const createPlaylistFile = async (savedFiles: string[], m3u8: string[], parsedData: any, data: any, socket: any) => {
    if (m3u8.length > 1 && !process.env.SIMULATE) {
      try {
        const shouldCreatePlaylist =
          parsedData.linktype === 'playlist' ||
          parsedData.linktype === 'qobuz-playlist' ||
          parsedData.linktype === 'spotify-playlist' ||
          parsedData.linktype === 'artist' ||
          parsedData.linktype === 'qobuz-artist' ||
          (conf as any).get('playlist.createPlaylist');

        if (shouldCreatePlaylist) {
          const playlistDir = commonPath([...new Set(savedFiles.map(dirname))]);
          const playlistName = sanitizeFilename(
            parsedData.linkinfo?.TITLE ||
              parsedData.linkinfo?.title ||
              parsedData.linkinfo?.name ||
              'Downloaded Content',
          );
          const playlistFile = join(playlistDir, playlistName + '.m3u8');

          const resolveFullPath: boolean =
            data.settings.resolveFullPath ?? (conf as any).get('playlist.resolveFullPath');
          let finalM3u8 = [...m3u8];

          if (!resolveFullPath) {
            const resolvedPlaylistDir = resolve(playlistDir) + sep;
            finalM3u8 = m3u8.map((file) => file.replace(resolvedPlaylistDir, ''));
          }

          const m3u8Content = '#EXTM3U' + EOL + finalM3u8.join(EOL);
          writeFileSync(playlistFile, m3u8Content, {encoding: 'utf-8'});

          console.log(`🎵 Created playlist file: ${playlistFile}`);

          socket.emit('playlistCreated', {
            path: playlistFile,
            trackCount: finalM3u8.length,
          });
        } else {
          console.log(`📁 Skipped playlist creation for ${parsedData.linktype} (not a playlist or artist)`);
        }
      } catch (error: any) {
        console.error('❌ Error creating playlist file:', error.message);
      }
    }
  };

  const substituteQobuzPlaylistVariables = (layoutPath: string, track: any, parsedData: any): string => {
    let result = layoutPath;
    const wantsNoNumbers = layoutPath.includes('{no_track_number}');
    const trackNumber = track.track_number || track.media_number || null;
    const formattedTrackNumber = trackNumber ? String(trackNumber).padStart(2, '0') : null;
    const originalTitle = track.title || 'Unknown Title';

    let cleanTitle = originalTitle;
    if (wantsNoNumbers) {
      // eslint-disable-next-line no-useless-escape
      cleanTitle = cleanTitle.replace(/^\d{1,2}[\s]*[-\.]\s*/, '');
      cleanTitle = cleanTitle.replace(/^\d{1,2}\s*/, '');
    }

    const artistName = track.album?.artist?.name || track.performer?.name || 'Unknown Artist';
    const albumTitle = track.album?.title || 'Unknown Album';
    const playlistTitle = parsedData.linkinfo?.title || parsedData.linkinfo?.name || 'Downloaded Playlist';

    result = result.replace(/{title}/g, sanitizeFilename(wantsNoNumbers ? cleanTitle : originalTitle));
    result = result.replace(/{clean_title}/g, sanitizeFilename(cleanTitle));
    result = result.replace(/{alb_artist}/g, sanitizeFilename(artistName));
    result = result.replace(/{alb_title}/g, sanitizeFilename(albumTitle));
    result = result.replace(/{list_title}/g, sanitizeFilename(playlistTitle));

    if (formattedTrackNumber && !wantsNoNumbers) {
      result = result.replace(/{track_number}/g, formattedTrackNumber);
      result = result.replace(/{track_with_dash}/g, formattedTrackNumber + ' - ');
      result = result.replace(/{track_with_dot}/g, formattedTrackNumber + '. ');
    } else {
      result = result.replace(/{track_number}/g, '');
      result = result.replace(/{track_with_dash}/g, '');
      result = result.replace(/{track_with_dot}/g, '');
    }

    result = result.replace(/{no_track_number}/g, '');
    result = result.replace(/{performer\.name}/g, sanitizeFilename(artistName));
    result = result.replace(/{album\.title}/g, sanitizeFilename(albumTitle));
    result = result.replace(/\s+/g, ' ');
    result = result.replace(/\s*-\s*-\s*/g, ' - ');
    result = result.replace(/\/\s+/g, '/');
    result = result.replace(/\s+\//g, '/');
    result = result.replace(/^\s+|\s+$/g, '');

    return result;
  };

  const downloadQobuzTracks = async (parsedData: any, data: any, socket: any) => {
    socket.emit('directUrlDownloadStart', {
      tracks: parsedData.tracks,
      contentType: parsedData.linktype || 'track',
      trackCount: parsedData.tracks.length,
    });

    console.log(`🎵 Starting Qobuz download of ${parsedData.tracks.length} tracks...`);

    const savedFiles: string[] = [];
    const m3u8: string[] = [];
    const coverSizes = conf.get('coverSize') as any;
    const qobuzDownloadCover = conf.get('qobuzDownloadCover', false) as boolean;

    for (let i = 0; i < parsedData.tracks.length; i++) {
      const track = parsedData.tracks[i];

      socket.emit('downloadProgress', {
        percentage: ((i + 1) / parsedData.tracks.length) * 100,
        currentTrack: track.title,
        current: i + 1,
        total: parsedData.tracks.length,
        itemId: 'url-download',
        itemStatus: 'downloading',
        itemProgress: 100,
      });

      try {
        const basePath = data.settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
        let layoutPath: string;
        if (parsedData.linktype === 'qobuz-playlist' || parsedData.linktype === 'spotify-playlist') {
          layoutPath = (conf.get('saveLayout') as any)['qobuz-playlist'] || 'Playlist/{list_title}/{title}';
        } else {
          layoutPath = (conf.get('saveLayout') as any)['qobuz-track'] || '{album.title}/{title}';
        }

        const wantsNoNumbers = layoutPath.includes('{no_track_number}');
        if (parsedData.linktype === 'qobuz-playlist' || parsedData.linktype === 'spotify-playlist') {
          layoutPath = substituteQobuzPlaylistVariables(layoutPath, track, parsedData);
        }

        const fullPath = join(basePath, layoutPath);

        const savedPath = await qobuzDownloadTrack({
          track,
          quality: data.quality,
          info: parsedData.info,
          coverSizes,
          path: fullPath,
          totalTracks: parsedData.tracks.length,
          message: `(${i + 1}/${parsedData.tracks.length})`,
          album: track.album,
          qobuzDownloadCover,
          listTitle: parsedData.linkinfo?.title || parsedData.linkinfo?.name || 'Downloaded Content',
          trackNumber: !wantsNoNumbers,
        });

        if (savedPath) {
          savedFiles.push(savedPath);
          m3u8.push(resolve(process.env.SIMULATE ? savedPath : trueCasePathSync(savedPath)));
          console.log(`✅ Downloaded: ${track.title}`);
        }
      } catch (trackError: any) {
        console.error(`❌ Error downloading ${track.title}: ${trackError.message}`);
      }
    }

    await createPlaylistFile(savedFiles, m3u8, parsedData, data, socket);

    socket.emit('downloadComplete', {
      count: savedFiles.length,
      files: savedFiles,
      playlistCreated: m3u8.length > 1,
    });

    console.log(`🎉 Qobuz download complete! ${savedFiles.length} files saved.`);
  };

  const downloadDeezerTracks = async (parsedData: any, data: any, socket: any) => {
    socket.emit('directUrlDownloadStart', {
      tracks: parsedData.tracks,
      contentType: parsedData.linktype || 'track',
      trackCount: parsedData.tracks.length,
    });

    console.log(`🎵 Starting Deezer download of ${parsedData.tracks.length} tracks...`);

    const savedFiles: string[] = [];
    const m3u8: string[] = [];
    const coverSizes = conf.get('coverSize') as any;

    for (let i = 0; i < parsedData.tracks.length; i++) {
      const track = parsedData.tracks[i];

      socket.emit('downloadProgress', {
        percentage: ((i + 1) / parsedData.tracks.length) * 100,
        currentTrack: track.SNG_TITLE,
        current: i + 1,
        total: parsedData.tracks.length,
      });

      try {
        const basePath = data.settings.deezerPath || (conf as any).get('paths.deezer') || './Music/Deezer';
        const layoutPath =
          parsedData.linktype === 'playlist'
            ? (conf.get('saveLayout') as any)['playlist'] || 'Playlist/{TITLE}/{SNG_TITLE}'
            : (conf.get('saveLayout') as any)['track'] || '{ALB_TITLE}/{SNG_TITLE}';

        const fullPath = join(basePath, layoutPath);

        const savedPath = await deezerDownloadTrack({
          track,
          quality: data.quality,
          info: parsedData.linkinfo || {},
          coverSizes,
          path: fullPath,
          totalTracks: parsedData.tracks.length,
          trackNumber: conf.get('trackNumber', true) as boolean,
          fallbackTrack: conf.get('fallbackTrack', true) as boolean,
          fallbackQuality: conf.get('fallbackQuality', true) as boolean,
          message: `(${i + 1}/${parsedData.tracks.length})`,
        });

        if (savedPath) {
          savedFiles.push(savedPath);
          m3u8.push(resolve(process.env.SIMULATE ? savedPath : trueCasePathSync(savedPath)));
          console.log(`✅ Downloaded: ${track.SNG_TITLE}`);
        }
      } catch (trackError: any) {
        console.error(`❌ Error downloading ${track.SNG_TITLE}: ${trackError.message}`);
      }
    }

    await createPlaylistFile(savedFiles, m3u8, parsedData, data, socket);

    socket.emit('downloadComplete', {
      count: savedFiles.length,
      files: savedFiles,
      playlistCreated: m3u8.length > 1,
    });

    console.log(`🎉 Deezer download complete! ${savedFiles.length} files saved.`);
  };

  return {downloadQobuzTracks, downloadDeezerTracks};
};
