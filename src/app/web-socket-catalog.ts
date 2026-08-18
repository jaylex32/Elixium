import type {Socket} from 'socket.io';
import type {SearchResult} from './interactive-types';
import type {ArtistContent} from './artist-content';

interface WebSocketCatalogDependencies {
  socket: Socket;
  artistContent: ArtistContent;
  performDeezerSearch: (query: string, type: string, limit?: number, offset?: number) => Promise<SearchResult[]>;
  performQobuzSearch: (query: string, type: string, limit?: number, offset?: number) => Promise<SearchResult[]>;
  ensureQobuzSearchReady: () => Promise<void>;
  parseToQobuz: (url: string) => Promise<any>;
  parseDeezerUrl: (url: string) => Promise<any>;
}

export const registerCatalogSocketHandlers = ({
  socket,
  artistContent,
  performDeezerSearch,
  performQobuzSearch,
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

  /*
   * Artist lists now come from the shared artist-content module, which the
   * REST surface serves too. Keeping two copies of the Deezer and Qobuz
   * shapes meant a fix to one silently left the other wrong.
   */
  socket.on('getArtistAlbums', async (data) => {
    try {
      // artistName travels with the request for the same reason as the REST
      // route: a discography carries no artist on each album.
      const {service, artistId, artistName, limit = 30, offset = 0} = data || {};
      const items = await artistContent.getArtistAlbums(service, artistId, Number(limit), Number(offset), artistName);
      socket.emit('artistAlbums', {artistId, items});
    } catch (error: any) {
      socket.emit('artistAlbumsError', {artistId: data?.artistId, message: error.message});
    }
  });

  socket.on('getArtistTracks', async (data) => {
    try {
      const {service, artistId, artistName, limit = 50, offset = 0} = data || {};
      const items = await artistContent.getArtistTracks(service, artistId, Number(limit), Number(offset), artistName);
      socket.emit('artistTracks', {artistId, items});
    } catch (error: any) {
      socket.emit('artistTracksError', {artistId: data?.artistId, message: error.message});
    }
  });

  socket.on('getArtistPlaylists', async (data) => {
    try {
      const {service, artistId, artistName, limit = 30, offset = 0} = data || {};
      const items = await artistContent.getArtistPlaylists(
        service,
        artistId,
        artistName,
        Number(limit),
        Number(offset),
      );
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
          // A Deezer track holds its name here, which is why every track URL
          // was listed as "Unknown Content".
          parsedData.linkinfo?.SNG_TITLE ||
          // A single track carries no linkinfo at all, so its name is only on
          // the track itself — which is why one pasted track URL was listed as
          // "Unknown Content" in the download manager.
          parsedData.tracks?.[0]?.SNG_TITLE ||
          parsedData.tracks?.[0]?.title ||
          'Unknown Content',
      };

      socket.emit('urlParseResults', parsedData);
    } catch (error: any) {
      console.error('URL parsing error:', error);
      socket.emit('urlParseError', {message: error.message});
    }
  });
};
