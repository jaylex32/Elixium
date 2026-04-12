import type {Socket} from 'socket.io';

interface WebSocketMediaDependencies {
  socket: Socket;
  deezer: any;
  qobuz: any;
  parseDeezerUrl: (url: string) => Promise<any>;
  parseQobuzUrl: (url: string) => Promise<any>;
  parseToQobuz: (url: string, onProgress?: (progress: any) => void) => Promise<any>;
  ensureQobuzSearchReady: () => Promise<void>;
  ensureDeezerDownloadReady: () => Promise<void>;
}

export const registerMediaSocketHandlers = ({
  socket,
  deezer,
  qobuz,
  parseDeezerUrl,
  parseQobuzUrl,
  parseToQobuz,
  ensureQobuzSearchReady,
  ensureDeezerDownloadReady,
}: WebSocketMediaDependencies) => {
  socket.on('getAlbumTracks', async (data) => {
    try {
      if (data.service === 'deezer') {
        try {
          const albumUrl = `https://deezer.com/album/${data.albumId}`;
          const albumTracksData = await parseDeezerUrl(albumUrl);

          if (!albumTracksData || !albumTracksData.tracks || !Array.isArray(albumTracksData.tracks)) {
            throw new Error('Invalid album data received from Deezer');
          }

          socket.emit('albumTracks', {
            albumId: data.albumId,
            service: 'deezer',
            tracks: albumTracksData.tracks,
            albumInfo: albumTracksData.linkinfo || {},
          });
        } catch (deezerError: any) {
          console.error('❌ Deezer album tracks error:', deezerError.message);
          socket.emit('albumTracksError', {
            message: `Failed to fetch Deezer album tracks: ${deezerError.message}`,
            albumId: data.albumId,
          });
        }
      } else if (data.service === 'qobuz') {
        await ensureQobuzSearchReady();

        try {
          const albumData = await qobuz.getAlbumInfo(data.albumId);

          if (!albumData) {
            throw new Error('No album data returned from Qobuz API');
          }
          if (!albumData.tracks) {
            throw new Error('Album exists but has no tracks data');
          }
          if (!albumData.tracks.items || !Array.isArray(albumData.tracks.items)) {
            throw new Error('Album tracks data is malformed');
          }

          const tracks = albumData.tracks.items.map((t: any) => {
            t.album = {
              ...albumData,
              tracks: null,
            };

            if (t.version && !t.title.includes(t.version)) {
              t.title += ` (${t.version})`;
            }

            return t;
          });

          socket.emit('albumTracks', {
            albumId: data.albumId,
            service: 'qobuz',
            tracks,
            albumInfo: {
              title: albumData.title,
              artist: albumData.artist?.name,
              release_date: albumData.release_date_original,
            },
          });
        } catch (qobuzError: any) {
          console.error('❌ Direct Qobuz API failed:', qobuzError.message);
          socket.emit('albumTracksError', {
            message: `Cannot load album tracks: ${qobuzError.message}. This is a known issue with some Qobuz albums.`,
            albumId: data.albumId,
            suggestion: 'download_whole_album',
          });
        }
      } else {
        throw new Error(`Unsupported service: ${data.service}`);
      }
    } catch (error: any) {
      console.error('❌ General album tracks error:', error.message);
      socket.emit('albumTracksError', {
        message: error.message,
        albumId: data.albumId,
      });
    }
  });

  socket.on('getSpotifyPlaylistForEditing', async (data) => {
    try {
      const targetService = data?.service === 'deezer' ? 'deezer' : 'qobuz';
      let playlistData: any;

      if (targetService === 'deezer') {
        await ensureDeezerDownloadReady();
        playlistData = await parseDeezerUrl(String(data.url));
      } else {
        await ensureQobuzSearchReady();
        playlistData = await parseToQobuz(String(data.url));
      }

      if (!playlistData || !playlistData.tracks || !Array.isArray(playlistData.tracks)) {
        throw new Error('Invalid playlist data returned from Spotify conversion');
      }

      const linkinfo = playlistData.linkinfo as any;
      socket.emit('playlistTracks', {
        playlistId: data.playlistId,
        service: targetService,
        tracks: playlistData.tracks,
        playlistInfo: {
          title: linkinfo?.title || linkinfo?.name || linkinfo?.TITLE || 'Spotify Playlist',
          artist:
            linkinfo?.owner?.name || linkinfo?.owner?.id || linkinfo?.PARENT_USERNAME || linkinfo?.artist || 'Spotify',
          ...linkinfo,
        },
      });
    } catch (error: any) {
      console.error('❌ Spotify playlist editing error:', error.message);
      socket.emit('playlistTracksError', {
        message: `Failed to process Spotify playlist for editing: ${error.message}`,
        playlistId: data.playlistId,
      });
    }
  });

  socket.on('getPlaylistTracks', async (data) => {
    try {
      if (data.service === 'deezer') {
        try {
          await ensureDeezerDownloadReady();

          const playlistUrl = `https://deezer.com/playlist/${data.playlistId}`;
          const playlistTracksData = await parseDeezerUrl(playlistUrl);

          if (!playlistTracksData || !playlistTracksData.tracks || !Array.isArray(playlistTracksData.tracks)) {
            throw new Error('Invalid playlist data received from Deezer');
          }

          const linkinfo = playlistTracksData.linkinfo as any;
          socket.emit('playlistTracks', {
            playlistId: data.playlistId,
            service: 'deezer',
            tracks: playlistTracksData.tracks,
            playlistInfo: {
              title: linkinfo?.title || linkinfo?.TITLE || data.playlistData.title || 'Deezer Playlist',
              artist: linkinfo?.artist || linkinfo?.PARENT_USERNAME || 'Deezer',
              ...linkinfo,
            },
          });
        } catch (deezerError: any) {
          console.error('❌ Deezer playlist tracks error:', deezerError.message);

          if (
            deezerError.message.includes('MISSING_SESSION_PARAMETER_USER_ID') ||
            deezerError.message.includes('USER_ID')
          ) {
            socket.emit('playlistTracksError', {
              message: `Deezer authentication required for playlist access. Please check your ARL cookie in settings.`,
              playlistId: data.playlistId,
              suggestion: 'check_authentication',
            });
          } else {
            socket.emit('playlistTracksError', {
              message: `Failed to fetch Deezer playlist tracks: ${deezerError.message}`,
              playlistId: data.playlistId,
            });
          }
        }
      } else if (data.service === 'qobuz') {
        await ensureQobuzSearchReady();

        try {
          const playlistUrl = `https://play.qobuz.com/playlist/${data.playlistId}`;
          const playlistData = await parseQobuzUrl(playlistUrl);

          if (!playlistData) {
            throw new Error('No playlist data returned from Qobuz API');
          }
          if (!playlistData.tracks || !Array.isArray(playlistData.tracks)) {
            throw new Error('Playlist exists but has no tracks data');
          }

          const qobuzLinkinfo = playlistData.linkinfo as any;
          socket.emit('playlistTracks', {
            playlistId: data.playlistId,
            service: 'qobuz',
            tracks: playlistData.tracks,
            playlistInfo: {
              title: qobuzLinkinfo?.title || qobuzLinkinfo?.name || data.playlistData.title || 'Qobuz Playlist',
              artist: qobuzLinkinfo?.owner?.name || qobuzLinkinfo?.user?.name || 'Qobuz',
              ...qobuzLinkinfo,
            },
          });
        } catch (qobuzError: any) {
          console.error('❌ Qobuz playlist API failed:', qobuzError.message);

          socket.emit('playlistTracksError', {
            message: `Cannot load playlist tracks: ${qobuzError.message}. This playlist may be private or unavailable.`,
            playlistId: data.playlistId,
            suggestion: 'download_whole_playlist',
          });
        }
      } else {
        throw new Error(`Unsupported service: ${data.service}`);
      }
    } catch (error: any) {
      console.error('❌ General playlist tracks error:', error.message);
      socket.emit('playlistTracksError', {
        message: error.message,
        playlistId: data.playlistId,
      });
    }
  });
};
