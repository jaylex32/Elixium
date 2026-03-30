import type {Socket} from 'socket.io';
import {formatSecondsReadable} from '../lib/util';
import type {SearchResult} from './interactive-types';

interface WebSocketCatalogDependencies {
  socket: Socket;
  deezer: any;
  qobuz: any;
  performDeezerSearch: (query: string, type: string, limit?: number, offset?: number) => Promise<SearchResult[]>;
  performQobuzSearch: (query: string, type: string, limit?: number, offset?: number) => Promise<SearchResult[]>;
  makeHttpRequest: (url: string) => Promise<any>;
  ensureQobuzSearchReady: () => Promise<void>;
  parseToQobuz: (url: string) => Promise<any>;
  parseDeezerUrl: (url: string) => Promise<any>;
}

export const registerCatalogSocketHandlers = ({
  socket,
  deezer,
  qobuz,
  performDeezerSearch,
  performQobuzSearch,
  makeHttpRequest,
  ensureQobuzSearchReady,
  parseToQobuz,
  parseDeezerUrl,
}: WebSocketCatalogDependencies) => {
  socket.on('search', async (data) => {
    try {
      let results: SearchResult[] = [];

      if (data.service === 'deezer') {
        results = await performDeezerSearch(data.query, data.type, Number(data.limit || 50), Number(data.offset || 0));
      } else if (data.service === 'qobuz') {
        results = await performQobuzSearch(data.query, data.type, Number(data.limit || 50), Number(data.offset || 0));
      }

      socket.emit('searchResults', results);
    } catch (error: any) {
      socket.emit('searchError', {message: error.message});
    }
  });

  socket.on('getArtistAlbums', async (data) => {
    try {
      const {service, artistId, limit = 30, offset = 0} = data || {};
      let items: any[] = [];
      if (service === 'deezer') {
        const url = `https://api.deezer.com/artist/${encodeURIComponent(artistId)}/albums?limit=${Number(
          limit,
        )}&index=${Number(offset)}`;
        const resp = await makeHttpRequest(url);
        items = (resp && resp.data) || [];
        items = items.map((a: any) => ({
          id: String(a.id),
          title: a.title,
          artist: a.artist?.name || 'Unknown Artist',
          type: 'album',
          duration: `${a.nb_tracks || 0} tracks`,
          rawData: a,
        }));
      } else if (service === 'qobuz') {
        await ensureQobuzSearchReady();
        const resp = await (qobuz as any).qobuzRequest?.('artist/get', {
          artist_id: artistId,
          extra: 'albums',
          offset: Number(offset),
          limit: Number(limit),
        });
        const albums = resp?.albums?.items || [];
        items = albums.map((a: any) => ({
          id: String(a.id),
          title: a.title,
          artist: a.artist?.name || 'Unknown Artist',
          type: 'album',
          duration: `${a.tracks_count || 0} tracks`,
          rawData: a,
        }));
      }
      socket.emit('artistAlbums', {artistId, items});
    } catch (error: any) {
      socket.emit('artistAlbumsError', {artistId: data?.artistId, message: error.message});
    }
  });

  socket.on('getArtistTracks', async (data) => {
    try {
      const {service, artistId, limit = 50, offset = 0} = data || {};
      let items: any[] = [];
      if (service === 'deezer') {
        const url = `https://api.deezer.com/artist/${encodeURIComponent(artistId)}/top?limit=${Number(
          limit,
        )}&index=${Number(offset)}`;
        const resp = await makeHttpRequest(url);
        const tracks = (resp && resp.data) || [];
        items = tracks.map((t: any) => ({
          id: String(t.id),
          title: t.title + (t.version ? ` ${t.version}` : ''),
          artist: t.artist?.name || 'Unknown Artist',
          album: t.album?.title || '',
          type: 'track',
          duration: formatSecondsReadable(Number(t.duration || 0)),
          rawData: t,
        }));
      } else if (service === 'qobuz') {
        await ensureQobuzSearchReady();
        const resp = await (qobuz as any).qobuzRequest?.('artist/get', {
          artist_id: artistId,
          extra: 'tracks',
          offset: Number(offset),
          limit: Number(limit),
        });
        const tracks = resp?.tracks?.items || [];
        items = tracks.map((t: any) => ({
          id: String(t.id),
          title: t.title + (t.version ? ` (${t.version})` : ''),
          artist: t.performer?.name || 'Unknown Artist',
          album: t.album?.title || '',
          type: 'track',
          duration: formatSecondsReadable(Number(t.duration || 0)),
          rawData: t,
        }));
      }
      socket.emit('artistTracks', {artistId, items});
    } catch (error: any) {
      socket.emit('artistTracksError', {artistId: data?.artistId, message: error.message});
    }
  });

  socket.on('getArtistPlaylists', async (data) => {
    try {
      const {service, artistId, artistName, limit = 30, offset = 0} = data || {};
      const query = artistName && String(artistName).trim().length > 0 ? artistName : String(artistId);
      let items: any[] = [];
      if (service === 'deezer') {
        const result = await deezer.searchMusic(query, ['PLAYLIST'], Number(limit), Number(offset));
        const dataArr = (result as any).PLAYLIST?.data || [];
        items = dataArr.map((p: any) => ({
          id: String(p.PLAYLIST_ID || p.id),
          title: p.TITLE || p.title,
          artist: p.PARENT_USERNAME || p.user?.name || 'Deezer',
          type: 'playlist',
          duration: `${p.NB_SONG || p.nb_tracks || 0} tracks`,
          rawData: p,
        }));
      } else if (service === 'qobuz') {
        await ensureQobuzSearchReady();
        const result = await qobuz.searchMusic(query, 'playlist', Number(limit), Number(offset));
        const dataArr = (result as any).playlists?.items || [];
        items = dataArr.map((p: any) => ({
          id: String(p.id),
          title: p.name,
          artist: p.owner?.name || 'Qobuz',
          type: 'playlist',
          duration: `${p.tracks_count || 0} tracks`,
          rawData: p,
        }));
      }
      socket.emit('artistPlaylists', {artistId, items});
    } catch (error: any) {
      socket.emit('artistPlaylistsError', {artistId: data?.artistId, message: error.message});
    }
  });

  socket.on('parseUrl', async (data) => {
    try {
      let parsedData: any;
      const hasExplicitService = typeof data?.service === 'string' && data.service.length > 0;
      const isQobuzTarget =
        data?.service === 'qobuz' ||
        (!hasExplicitService &&
          (data.url.includes('qobuz.com') ||
            data.url.includes('play.qobuz.com') ||
            data.url.includes('spotify.com') ||
            data.url.includes('open.spotify.com') ||
            data.url.startsWith('spotify:') ||
            data.url.includes('tidal.com') ||
            data.url.includes('youtube.com') ||
            data.url.includes('youtu.be')));

      if (
        data.url.includes('spotify.com') ||
        data.url.includes('open.spotify.com') ||
        data.url.startsWith('spotify:')
      ) {
        await ensureQobuzSearchReady();
        parsedData = isQobuzTarget ? await parseToQobuz(data.url) : await parseDeezerUrl(data.url);

        if (data.url.includes('/playlist/')) {
          parsedData.linktype = 'spotify-playlist';
        } else if (data.url.includes('/album/')) {
          parsedData.linktype = 'spotify-album';
        } else if (data.url.includes('/track/')) {
          parsedData.linktype = 'spotify-track';
        } else if (data.url.includes('/artist/')) {
          parsedData.linktype = 'spotify-artist';
        }
      } else if (data.url.includes('deezer.com')) {
        parsedData = isQobuzTarget ? await parseToQobuz(data.url) : await parseDeezerUrl(data.url);

        if (data.url.includes('/playlist/')) {
          parsedData.linktype = isQobuzTarget ? 'qobuz-playlist' : 'playlist';
        } else if (data.url.includes('/album/')) {
          parsedData.linktype = isQobuzTarget ? 'qobuz-album' : 'album';
        } else if (data.url.includes('/track/')) {
          parsedData.linktype = isQobuzTarget ? 'qobuz-track' : 'track';
        } else if (data.url.includes('/artist/')) {
          parsedData.linktype = isQobuzTarget ? 'qobuz-artist' : 'artist';
        }
      } else if (data.url.includes('tidal.com') || data.url.includes('youtube.com') || data.url.includes('youtu.be')) {
        await ensureQobuzSearchReady();
        parsedData = await parseToQobuz(data.url);

        if (data.url.includes('/playlist/')) {
          parsedData.linktype = 'qobuz-playlist';
        } else if (data.url.includes('/album/')) {
          parsedData.linktype = 'qobuz-album';
        } else if (data.url.includes('/track/') || data.url.includes('youtube.com') || data.url.includes('youtu.be')) {
          parsedData.linktype = 'qobuz-track';
        } else if (data.url.includes('/artist/')) {
          parsedData.linktype = 'qobuz-artist';
        }
      } else if (data.url.includes('qobuz.com') || data.url.includes('play.qobuz.com')) {
        await ensureQobuzSearchReady();
        parsedData = await parseToQobuz(data.url);

        if (data.url.includes('/playlist/')) {
          parsedData.linktype = 'qobuz-playlist';
        } else if (data.url.includes('/album/')) {
          parsedData.linktype = 'qobuz-album';
        } else if (data.url.includes('/track/')) {
          parsedData.linktype = 'qobuz-track';
        } else if (data.url.includes('/artist/')) {
          parsedData.linktype = 'qobuz-artist';
        }
      } else {
        throw new Error('Unsupported URL format');
      }

      if (!parsedData.tracks || parsedData.tracks.length === 0) {
        throw new Error('No tracks found in the provided URL');
      }

      parsedData.metadata = {
        originalUrl: data.url,
        service: data.url.includes('deezer.com')
          ? 'deezer'
          : data.url.includes('qobuz.com') || data.url.includes('play.qobuz.com')
          ? 'qobuz'
          : data.url.includes('tidal.com')
          ? 'tidal'
          : data.url.includes('youtube.com') || data.url.includes('youtu.be')
          ? 'youtube'
          : 'spotify',
        contentType: parsedData.linktype,
        trackCount: parsedData.tracks.length,
        title:
          parsedData.linkinfo?.title ||
          parsedData.linkinfo?.name ||
          parsedData.linkinfo?.TITLE ||
          parsedData.linkinfo?.ALB_TITLE ||
          'Unknown Content',
      };

      socket.emit('urlParseResults', parsedData);
    } catch (error: any) {
      console.error('URL parsing error:', error);
      socket.emit('urlParseError', {message: error.message});
    }
  });
};
