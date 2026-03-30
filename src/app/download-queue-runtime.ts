import {EOL} from 'os';
import {existsSync, mkdirSync, writeFileSync} from 'fs';
import path, {dirname, join, resolve, sep} from 'path';
import {qobuzSaveLayout} from '../lib/util';

interface DownloadQueueRuntimeDependencies {
  conf: any;
  qobuz: any;
  parseDeezerUrl: (url: string) => Promise<any>;
  parseQobuzUrl: (url: string) => Promise<any>;
  deezerDownloadTrack: any;
  qobuzDownloadTrack: any;
  initDeezerForDownload: () => Promise<void>;
  initQobuzForDownload: () => Promise<void>;
  shouldUseVariousArtists: (settings?: any) => boolean;
  commonPath: (paths: string[]) => string;
  sanitizeFilename: (value: string) => string;
  trueCasePathSync: (path: string) => string;
  activeDownloads: Map<any, any>;
  getIsDeezerDownloadReady: () => boolean;
  getIsQobuzDownloadReady: () => boolean;
  setIsDownloading: (value: boolean) => void;
  setCurrentDownloadQueue: (queue: any[]) => void;
  setDownloadProgress: (value: number) => void;
  clearActiveDownloads: () => void;
}

export const createDownloadQueueRuntime = ({
  conf,
  qobuz,
  parseDeezerUrl,
  parseQobuzUrl,
  deezerDownloadTrack,
  qobuzDownloadTrack,
  initDeezerForDownload,
  initQobuzForDownload,
  shouldUseVariousArtists,
  commonPath,
  sanitizeFilename,
  trueCasePathSync,
  activeDownloads,
  getIsDeezerDownloadReady,
  getIsQobuzDownloadReady,
  setIsDownloading,
  setCurrentDownloadQueue,
  setDownloadProgress,
  clearActiveDownloads,
}: DownloadQueueRuntimeDependencies) => {
  const commonDirectoryPath = (paths: string[]) => {
    const normalized = paths.filter(Boolean).map((entry) => path.resolve(String(entry)));
    if (!normalized.length) {
      return '';
    }

    if (normalized.length === 1) {
      return normalized[0];
    }

    const parsed = normalized.map((entry) => {
      const root = path.parse(entry).root;
      const segments = entry.slice(root.length).split(path.sep).filter(Boolean);
      return {root, segments};
    });

    const baseRoot = parsed[0].root;
    const rootMismatch = parsed.some(({root}) => root.toLowerCase() !== baseRoot.toLowerCase());
    if (rootMismatch) {
      return baseRoot;
    }

    const sharedSegments: string[] = [];
    for (let index = 0; index < parsed[0].segments.length; index += 1) {
      const segment = parsed[0].segments[index];
      const matchesAll = parsed.every(({segments}) => segments[index] === segment);
      if (!matchesAll) {
        break;
      }
      sharedSegments.push(segment);
    }

    return sharedSegments.length ? path.join(baseRoot, ...sharedSegments) : baseRoot;
  };

  const isPlaylistLikeItem = (item: any) =>
    item &&
    (item.type === 'playlist' ||
      item.type === 'qobuz-playlist' ||
      item.type === 'spotify-playlist' ||
      item.type === 'artist' ||
      item.type === 'qobuz-artist' ||
      item.service === 'user-playlist');

  const createQueuePlaylistFile = async (
    savedFiles: string[],
    m3u8Files: string[],
    firstItem: any,
    settings: any,
    quality: string,
    socket?: any,
  ) => {
    if (process.env.SIMULATE) {
      return;
    }

    const playlistSourceFiles = [...new Set(savedFiles)];
    const playlistSourceDirs = [...new Set(playlistSourceFiles.map(dirname))];
    const playlistDir =
      commonDirectoryPath(playlistSourceDirs) || (playlistSourceFiles.length ? dirname(playlistSourceFiles[0]) : '');
    if (!playlistDir) {
      return;
    }

    let playlistName: string;
    if (firstItem.type.includes('playlist') || firstItem.service === 'user-playlist') {
      playlistName = sanitizeFilename(firstItem.title || 'Downloaded Playlist');
    } else if (firstItem.type.includes('artist')) {
      playlistName = sanitizeFilename(`${firstItem.artist} - Discography`);
    } else {
      playlistName = sanitizeFilename('Downloaded Music');
    }

    const playlistFile = join(playlistDir, playlistName + '.m3u8');
    const resolveFullPath = settings.resolveFullPath ?? (conf as any).get('playlist.resolveFullPath', false);
    let finalM3u8Files = [...new Set(m3u8Files)];

    if (
      firstItem.service === 'user-playlist' &&
      firstItem.playlistData?.source === 'watchlist' &&
      Array.isArray(firstItem.playlistData?.allTracks)
    ) {
      const qobuzBasePath = settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
      const qobuzLayoutPath = (conf.get('saveLayout') as any)['qobuz-playlist'] || 'Playlist/{list_title}/{title}';
      const qobuzPathTemplate = join(qobuzBasePath, qobuzLayoutPath);
      const normalizedQuality = String(quality || settings.qobuzQuality || settings.quality || '').toLowerCase();
      const qobuzExt =
        normalizedQuality === '5' || normalizedQuality === 'mp3' || normalizedQuality === '320kbps' ? '.mp3' : '.flac';

      const rebuiltPlaylistFiles = firstItem.playlistData.allTracks
        .map((track: any) => {
          const expectedPath =
            qobuzSaveLayout({
              track,
              album: track?.album || {},
              path: qobuzPathTemplate,
              minimumIntegerDigits: firstItem.playlistData.allTracks.length >= 100 ? 3 : 2,
              trackNumber: true,
              qobuzDownloadCover: false,
              listTitle: firstItem.title || firstItem.playlistData?.title || 'Watchlist Playlist',
            }) + qobuzExt;

          const resolvedPath = resolve(expectedPath);
          if (!existsSync(resolvedPath)) {
            return null;
          }

          try {
            return resolve(trueCasePathSync(resolvedPath));
          } catch {
            return resolvedPath;
          }
        })
        .filter(Boolean) as string[];

      if (rebuiltPlaylistFiles.length > finalM3u8Files.length) {
        finalM3u8Files = [...new Set(rebuiltPlaylistFiles)];
      }
    }

    if (finalM3u8Files.length <= 1) {
      return;
    }

    if (!resolveFullPath) {
      const resolvedPlaylistDir = resolve(playlistDir) + sep;
      finalM3u8Files = finalM3u8Files.map((file) => String(file).replace(resolvedPlaylistDir, ''));
    }

    const m3u8Content = '#EXTM3U' + EOL + finalM3u8Files.join(EOL);
    mkdirSync(dirname(playlistFile), {recursive: true});
    writeFileSync(playlistFile, m3u8Content, {encoding: 'utf-8'});

    console.log(`🎵 Created playlist file: ${playlistFile} (${finalM3u8Files.length} tracks)`);

    if (socket) {
      socket.emit('playlistCreated', {
        path: playlistFile,
        trackCount: finalM3u8Files.length,
      });
    }
  };

  const finalizeQueuePlaylist = async (
    savedFiles: string[],
    m3u8Files: string[],
    downloadQueue: any[],
    itemFiles: Map<string, {savedFiles: string[]; m3u8Files: string[]}>,
    settings: any,
    quality: string,
    socket?: any,
  ) => {
    if (process.env.SIMULATE) {
      return;
    }

    try {
      const playlistItems = downloadQueue.filter((item) => isPlaylistLikeItem(item));
      const shouldCreatePlaylist = playlistItems.length > 0 || (conf as any).get('playlist.createPlaylist');

      if (!shouldCreatePlaylist) {
        const contentTypes = [...new Set(downloadQueue.map((item) => item.type))].join(', ');
        console.log(`📁 Skipped playlist creation for content types: ${contentTypes} (albums don't need playlists)`);
        return;
      }

      if (!playlistItems.length) {
        const firstItem = downloadQueue[0];
        if (firstItem && m3u8Files.length > 1) {
          await createQueuePlaylistFile(savedFiles, m3u8Files, firstItem, settings, quality, socket);
        }
        return;
      }

      for (const item of playlistItems) {
        const itemFileState = itemFiles.get(String(item.id));
        const isWatchlistPlaylist =
          item.service === 'user-playlist' &&
          item.playlistData?.source === 'watchlist' &&
          Array.isArray(item.playlistData?.allTracks);

        if (!itemFileState?.savedFiles?.length) {
          continue;
        }

        if (!isWatchlistPlaylist && (!itemFileState.m3u8Files?.length || itemFileState.m3u8Files.length <= 1)) {
          continue;
        }

        await createQueuePlaylistFile(
          itemFileState.savedFiles,
          itemFileState.m3u8Files,
          item,
          settings,
          quality,
          socket,
        );
      }
    } catch (error: any) {
      console.error('❌ Error creating playlist file:', error.message);
    }
  };

  const pushSavedPath = (
    savedPath: string,
    savedFiles: string[],
    m3u8Files: string[],
    itemFiles: Map<string, {savedFiles: string[]; m3u8Files: string[]}>,
    itemId: string,
  ) => {
    savedFiles.push(savedPath);
    if (!itemFiles.has(String(itemId))) {
      itemFiles.set(String(itemId), {savedFiles: [], m3u8Files: []});
    }
    const scopedFiles = itemFiles.get(String(itemId));
    if (!scopedFiles) {
      return;
    }
    scopedFiles.savedFiles.push(savedPath);
    if (!process.env.SIMULATE) {
      const resolvedPath = resolve(trueCasePathSync(savedPath));
      m3u8Files.push(resolvedPath);
      scopedFiles.m3u8Files.push(resolvedPath);
    } else {
      const resolvedPath = resolve(savedPath);
      m3u8Files.push(resolvedPath);
      scopedFiles.m3u8Files.push(resolvedPath);
    }
  };

  const startDownloadProcess = async (
    downloadQueue: any[],
    quality: string,
    service: string,
    settings: any,
    socket?: any,
  ) => {
    setIsDownloading(true);
    setCurrentDownloadQueue(downloadQueue);
    setDownloadProgress(0);

    const savedFiles: string[] = [];
    const m3u8Files: string[] = [];
    const itemFiles = new Map<string, {savedFiles: string[]; m3u8Files: string[]}>();

    try {
      for (let i = 0; i < downloadQueue.length; i++) {
        const item = downloadQueue[i];

        activeDownloads.set(item.id, {
          ...item,
          status: 'downloading',
          startTime: new Date(),
        });

        const downloadProgress = ((i + 1) / downloadQueue.length) * 100;
        setDownloadProgress(downloadProgress);

        if (socket) {
          socket.emit('downloadProgress', {
            percentage: downloadProgress,
            currentTrack: item.title,
            current: i + 1,
            total: downloadQueue.length,
            itemId: item.id,
            itemStatus: 'downloading',
            itemProgress: 100,
          });
        }

        try {
          if (item.type === 'track') {
            let savedPath: string | null | undefined = null;

            if (service === 'deezer') {
              if (!getIsDeezerDownloadReady()) {
                await initDeezerForDownload();
              }

              const basePath = settings.deezerPath || (conf as any).get('paths.deezer') || './Music/Deezer';
              const layoutPath = (conf.get('saveLayout') as any)['track'] || '{ALB_TITLE}/{SNG_TITLE}';
              const fullPath = join(basePath, layoutPath);

              savedPath = await deezerDownloadTrack({
                track: item.rawData,
                quality,
                info: {} as Record<string, unknown>,
                coverSizes: conf.get('coverSize') as any,
                path: fullPath,
                totalTracks: downloadQueue.length,
                trackNumber: conf.get('trackNumber', true) as boolean,
                fallbackTrack: conf.get('fallbackTrack', true) as boolean,
                fallbackQuality: conf.get('fallbackQuality', true) as boolean,
                message: `(${i + 1}/${downloadQueue.length})`,
              });
            } else if (service === 'qobuz') {
              if (!getIsQobuzDownloadReady()) {
                await initQobuzForDownload();
              }

              const basePath = settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
              const layoutPath = (conf.get('saveLayout') as any)['qobuz-track'] || '{album.title}/{title}';
              const fullPath = join(basePath, layoutPath);

              savedPath = await qobuzDownloadTrack({
                track: item.rawData,
                quality,
                info: {type: 'qobuz-track', id: item.id},
                coverSizes: conf.get('coverSize') as any,
                path: fullPath,
                totalTracks: downloadQueue.length,
                message: `(${i + 1}/${downloadQueue.length})`,
                album: item.rawData.album,
                qobuzDownloadCover: settings.qobuzDownloadCover || (conf.get('qobuzDownloadCover', false) as boolean),
              });
            }

            if (savedPath) {
              pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);

              const activeItem = activeDownloads.get(item.id);
              if (activeItem) {
                activeItem.status = 'completed';
                activeItem.endTime = new Date();
              }

              if (socket) {
                socket.emit('downloadProgress', {
                  itemId: item.id,
                  itemStatus: 'completed',
                });
              }
            }
          } else if (item.type === 'album') {
            if (service === 'deezer') {
              if (!getIsDeezerDownloadReady()) {
                await initDeezerForDownload();
              }

              const albumData = await parseDeezerUrl(`https://deezer.com/album/${item.id}`);
              const basePath = settings.deezerPath || (conf as any).get('paths.deezer') || './Music/Deezer';
              const layoutPath = (conf.get('saveLayout') as any)['album'] || '{ALB_TITLE}/{SNG_TITLE}';
              const fullPath = join(basePath, layoutPath);

              console.log(`🎵 Starting Deezer album download: ${item.title} (${albumData.tracks.length} tracks)`);

              for (let trackIndex = 0; trackIndex < albumData.tracks.length; trackIndex++) {
                const track = albumData.tracks[trackIndex];
                const albumProgress = ((trackIndex + 1) / albumData.tracks.length) * 100;

                if (socket) {
                  socket.emit('downloadProgress', {
                    percentage: downloadProgress,
                    current: i + 1,
                    total: downloadQueue.length,
                    itemId: item.id,
                    itemStatus: 'downloading',
                    itemProgress: albumProgress,
                    currentTrack: `${track.SNG_TITLE} (Album: ${item.title})`,
                    albumTrack: `${trackIndex + 1}/${albumData.tracks.length}`,
                    albumProgress,
                  });
                }

                const savedPath = await deezerDownloadTrack({
                  track,
                  quality,
                  info: albumData.linkinfo,
                  coverSizes: conf.get('coverSize') as any,
                  path: fullPath,
                  totalTracks: albumData.tracks.length,
                  trackNumber: conf.get('trackNumber', true) as boolean,
                  fallbackTrack: conf.get('fallbackTrack', true) as boolean,
                  fallbackQuality: conf.get('fallbackQuality', true) as boolean,
                  message: `Album: ${item.title} (${trackIndex + 1}/${albumData.tracks.length})`,
                });

                if (savedPath) {
                  pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                  console.log(`✅ Downloaded: ${track.SNG_TITLE} from ${item.title}`);
                }
              }
            } else if (service === 'qobuz') {
              if (!getIsQobuzDownloadReady()) {
                await initQobuzForDownload();
              }

              const albumData = await parseQobuzUrl(`https://play.qobuz.com/album/${item.id}`);
              const basePath = settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
              const layoutPath = (conf.get('saveLayout') as any)['qobuz-album'] || '{album.title}/{title}';
              const fullPath = join(basePath, layoutPath);

              console.log(`🎵 Starting Qobuz album download: ${item.title} (${albumData.tracks.length} tracks)`);

              for (let trackIndex = 0; trackIndex < albumData.tracks.length; trackIndex++) {
                const track = albumData.tracks[trackIndex];
                const albumProgress = ((trackIndex + 1) / albumData.tracks.length) * 100;

                if (socket) {
                  socket.emit('downloadProgress', {
                    percentage: downloadProgress,
                    current: i + 1,
                    total: downloadQueue.length,
                    itemId: item.id,
                    itemStatus: 'downloading',
                    itemProgress: albumProgress,
                    currentTrack: `${track.title} (Album: ${item.title})`,
                    albumTrack: `${trackIndex + 1}/${albumData.tracks.length}`,
                    albumProgress,
                  });
                }

                const savedPath = await qobuzDownloadTrack({
                  track,
                  quality,
                  info: albumData.info,
                  coverSizes: conf.get('coverSize') as any,
                  path: fullPath,
                  totalTracks: albumData.tracks.length,
                  message: `Album: ${item.title} (${trackIndex + 1}/${albumData.tracks.length})`,
                  album: track.album,
                  qobuzDownloadCover: settings.qobuzDownloadCover || (conf.get('qobuzDownloadCover', false) as boolean),
                });

                if (savedPath) {
                  pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                  console.log(`✅ Downloaded: ${track.title} from ${item.title}`);
                }
              }
            }
          } else if (item.type === 'playlist') {
            if (item.service === 'user-playlist') {
              console.log(`🎵 Starting user playlist download: ${item.title} (${item.tracks.length} tracks)`);
              const useVariousArtists = shouldUseVariousArtists(settings);
              const basePath =
                service === 'deezer'
                  ? settings.deezerPath || (conf as any).get('paths.deezer') || './Music/Deezer'
                  : settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
              const layoutPath =
                service === 'qobuz'
                  ? (conf.get('saveLayout') as any)['qobuz-playlist'] ||
                    'Playlist/{list_title}/{no_track_number}{title}'
                  : 'Playlist/{TITLE}/{SNG_TITLE}';
              const fullPath = join(basePath, layoutPath);

              for (let trackIndex = 0; trackIndex < item.tracks.length; trackIndex++) {
                const track = item.tracks[trackIndex];
                const trackService = track.service || service;
                const playlistProgress = ((trackIndex + 1) / item.tracks.length) * 100;
                try {
                  if (socket) {
                    socket.emit('downloadProgress', {
                      percentage: downloadProgress,
                      current: i + 1,
                      total: downloadQueue.length,
                      itemId: item.id,
                      itemStatus: 'downloading',
                      itemProgress: playlistProgress,
                      currentTrack: `${track.title} (Playlist: ${item.title})`,
                      albumTrack: `${trackIndex + 1}/${item.tracks.length}`,
                      albumProgress: playlistProgress,
                    });
                  }

                  let savedPath = null;
                  if (trackService === 'deezer') {
                    if (!getIsDeezerDownloadReady()) await initDeezerForDownload();

                    let trackData = track.rawData || track;
                    if (track.id) {
                      try {
                        const freshTrackData = await parseDeezerUrl(`https://deezer.com/track/${track.id}`);
                        if (freshTrackData && freshTrackData.tracks && freshTrackData.tracks[0]) {
                          trackData = freshTrackData.tracks[0];
                          console.log(`🔄 Refreshed track data for: ${track.title}`);
                        }
                      } catch (_refreshError: any) {
                        console.log(`⚠️ Could not refresh track data for ${track.title}, using stored data`);
                      }
                    }

                    const playlistInfo: Record<string, any> = {TITLE: item.title};
                    if (useVariousArtists) {
                      playlistInfo.ART_NAME = 'Various Artists';
                    }

                    savedPath = await deezerDownloadTrack({
                      track: trackData,
                      quality,
                      info: playlistInfo,
                      coverSizes: conf.get('coverSize') as any,
                      path: fullPath,
                      totalTracks: item.tracks.length,
                      trackNumber: conf.get('trackNumber', true) as boolean,
                      fallbackTrack: conf.get('fallbackTrack', true) as boolean,
                      fallbackQuality: conf.get('fallbackQuality', true) as boolean,
                      message: `User Playlist: ${item.title}`,
                    });
                  } else if (trackService === 'qobuz') {
                    if (!getIsQobuzDownloadReady()) await initQobuzForDownload();

                    const trackData = track.rawData || track;
                    const qobuzPlaylistInfo: Record<string, any> = item.playlistData?.qobuzInfo || {
                      type: 'qobuz-playlist',
                      id: item.id,
                    };
                    if (useVariousArtists) {
                      qobuzPlaylistInfo.album_artist = 'Various Artists';
                    }

                    savedPath = await qobuzDownloadTrack({
                      track: trackData,
                      quality,
                      info: qobuzPlaylistInfo,
                      coverSizes: conf.get('coverSize') as any,
                      path: fullPath,
                      totalTracks: item.tracks.length,
                      message: `User Playlist: ${item.title}`,
                      album: track.album || {title: item.title},
                      qobuzDownloadCover: conf.get('qobuzDownloadCover', false) as boolean,
                      listTitle: item.title,
                      trackNumber: conf.get('trackNumber', true) as boolean,
                      fallbackTrack: conf.get('fallbackTrack', true) as boolean,
                      fallbackQuality: conf.get('fallbackQuality', true) as boolean,
                    });
                  }
                  if (savedPath) {
                    pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                    console.log(`✅ Downloaded: ${track.title} from user playlist ${item.title}`);
                  }
                } catch (trackError: any) {
                  console.error(`❌ Error downloading ${track.title}: ${trackError.message}`);
                }
              }
            } else if (service === 'deezer') {
              if (!getIsDeezerDownloadReady()) {
                await initDeezerForDownload();
              }

              const playlistData = await parseDeezerUrl(`https://deezer.com/playlist/${item.id}`);
              const basePath = settings.deezerPath || (conf as any).get('paths.deezer') || './Music/Deezer';
              const layoutPath = (conf.get('saveLayout') as any)['playlist'] || 'Playlist/{TITLE}/{SNG_TITLE}';
              const fullPath = join(basePath, layoutPath);

              for (const track of playlistData.tracks) {
                const savedPath = await deezerDownloadTrack({
                  track,
                  quality,
                  info: playlistData.linkinfo,
                  coverSizes: conf.get('coverSize') as any,
                  path: fullPath,
                  totalTracks: playlistData.tracks.length,
                  trackNumber: conf.get('trackNumber', true) as boolean,
                  fallbackTrack: conf.get('fallbackTrack', true) as boolean,
                  fallbackQuality: conf.get('fallbackQuality', true) as boolean,
                  message: `Playlist: ${item.title}`,
                });

                if (savedPath) {
                  pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                }
              }
            } else if (service === 'qobuz') {
              if (!getIsQobuzDownloadReady()) {
                await initQobuzForDownload();
              }

              const playlistData = await parseQobuzUrl(`https://play.qobuz.com/playlist/${item.id}`);
              const basePath = settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
              const layoutPath = (conf.get('saveLayout') as any)['qobuz-playlist'] || 'Playlist/{list_title}/{title}';
              const fullPath = join(basePath, layoutPath);

              for (const track of playlistData.tracks) {
                const savedPath = await qobuzDownloadTrack({
                  track,
                  quality,
                  info: playlistData.info,
                  coverSizes: conf.get('coverSize') as any,
                  path: fullPath,
                  totalTracks: playlistData.tracks.length,
                  message: `Playlist: ${item.title}`,
                  album: track.album,
                  qobuzDownloadCover: settings.qobuzDownloadCover || (conf.get('qobuzDownloadCover', false) as boolean),
                  listTitle: playlistData.linkinfo.title || playlistData.linkinfo.name || 'Unknown Playlist',
                });

                if (savedPath) {
                  pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                }
              }
            }
          } else if (item.type === 'artist') {
            if (service === 'deezer') {
              if (!getIsDeezerDownloadReady()) {
                await initDeezerForDownload();
              }

              const artistData = await parseDeezerUrl(`https://deezer.com/artist/${item.id}`);
              const basePath = settings.deezerPath || (conf as any).get('paths.deezer') || './Music/Deezer';
              const layoutPath = (conf.get('saveLayout') as any)['artist'] || '{ALB_TITLE}/{SNG_TITLE}';
              const fullPath = join(basePath, layoutPath);

              for (const track of artistData.tracks) {
                const savedPath = await deezerDownloadTrack({
                  track,
                  quality,
                  info: artistData.linkinfo,
                  coverSizes: conf.get('coverSize') as any,
                  path: fullPath,
                  totalTracks: artistData.tracks.length,
                  trackNumber: conf.get('trackNumber', true) as boolean,
                  fallbackTrack: conf.get('fallbackTrack', true) as boolean,
                  fallbackQuality: conf.get('fallbackQuality', true) as boolean,
                  message: `Artist: ${item.title}`,
                });

                if (savedPath) {
                  pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                }
              }
            } else if (service === 'qobuz') {
              if (!getIsQobuzDownloadReady()) {
                await initQobuzForDownload();
              }

              const artistAlbumsResponse = await qobuz.getArtistAlbums(item.id);
              const basePath = settings.qobuzPath || (conf as any).get('paths.qobuz') || './Music/Qobuz';
              const layoutPath = (conf.get('saveLayout') as any)['qobuz-album'] || '{album.title}/{title}';
              const fullPath = join(basePath, layoutPath);

              for (const album of artistAlbumsResponse.albums.items) {
                const albumData = await parseQobuzUrl(`https://play.qobuz.com/album/${album.id}`);

                for (const track of albumData.tracks) {
                  const savedPath = await qobuzDownloadTrack({
                    track,
                    quality,
                    info: albumData.info,
                    coverSizes: conf.get('coverSize') as any,
                    path: fullPath,
                    totalTracks: albumData.tracks.length,
                    message: `Artist: ${item.title} - Album: ${album.title}`,
                    album: track.album,
                    qobuzDownloadCover:
                      settings.qobuzDownloadCover || (conf.get('qobuzDownloadCover', false) as boolean),
                  });

                  if (savedPath) {
                    pushSavedPath(savedPath, savedFiles, m3u8Files, itemFiles, item.id);
                  }
                }
              }
            }
          }
        } catch (error: any) {
          const activeItem = activeDownloads.get(item.id);
          if (activeItem) {
            activeItem.status = 'error';
            activeItem.errorMessage = error.message;
            activeItem.endTime = new Date();
          }

          if (socket) {
            socket.emit('downloadProgress', {
              itemId: item.id,
              itemStatus: 'error',
              errorMessage: error.message,
            });
          }

          console.error(`Error downloading ${item.title}: ${error.message}`);
        }

        activeDownloads.delete(item.id);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }

      await finalizeQueuePlaylist(savedFiles, m3u8Files, downloadQueue, itemFiles, settings, quality, socket);

      if (socket) {
        socket.emit('downloadComplete', {
          count: savedFiles.length,
          files: savedFiles,
          playlistCreated: m3u8Files.length > 1,
        });
      }
    } catch (error: any) {
      if (socket) {
        socket.emit('downloadError', {message: error.message});
      }
      throw error;
    } finally {
      setIsDownloading(false);
      setCurrentDownloadQueue([]);
      setDownloadProgress(0);
      clearActiveDownloads();
    }
  };

  return {startDownloadProcess};
};
