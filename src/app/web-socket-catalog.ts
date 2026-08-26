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
  /** Resolve a YouTube link natively, or null when it is not one. */
  resolveYtMusicUrl?: (url: string) => Promise<{
    kind: 'track' | 'album' | 'playlist' | 'artist';
    title: string;
    tracks: SearchResult[];
  } | null>;
}

/**
 * A message worth showing for a failed paste.
 *
 * Spotify's client reports its errors as objects, so `error.message` comes out
 * as the string "[object Object]" — which tells the reader nothing at all, and
 * hides the common case: being rate limited, which passes on its own.
 */
const describeParseError = (error: any): string => {
  const message = String(error?.message ?? '');
  if (message && message !== '[object Object]') return message;

  const status = Number(error?.statusCode ?? error?.status ?? 0);
  const retryAfter = Number(error?.headers?.['retry-after'] ?? 0);
  if (status === 429 || retryAfter > 0) {
    return retryAfter
      ? `Spotify is rate limiting requests — try again in about ${retryAfter} seconds`
      : 'Spotify is rate limiting requests — try again shortly';
  }
  if (status === 401 || status === 403) return 'Spotify rejected the request — check the sp_dc cookie in Settings';
  if (status === 404) return 'That link could not be found';
  return status ? `The link could not be read (HTTP ${status})` : 'The link could not be read';
};

export const registerCatalogSocketHandlers = ({
  socket,
  artistContent,
  performDeezerSearch,
  performQobuzSearch,
  ensureQobuzSearchReady,
  parseToQobuz,
  parseDeezerUrl,
  resolveYtMusicUrl,
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

      /*
       * A YouTube link comes from YouTube Music.
       *
       * It used to be handed to the Qobuz matcher, along with Spotify and
       * Tidal links — correct when YouTube was only a source to convert from,
       * wrong now that it is a service that can serve the link itself. Anyone
       * whose Qobuz token had expired got "qobuz-search is unavailable" for a
       * link that has nothing to do with Qobuz.
       *
       * Falls through to the old path when the link cannot be resolved, or
       * when a service was asked for explicitly.
       */
      const link = String(data?.url || '');
      const isYouTubeLink = link.includes('youtube.com') || link.includes('youtu.be');
      /*
       * A YouTube link is read by YouTube Music, and downloaded from whichever
       * service is selected.
       *
       * On YouTube Music that means downloading it directly. On Deezer or
       * Qobuz it means converting — finding those same tracks in that
       * catalogue — which is what pasting a Spotify or TIDAL link already does.
       * You cannot download from a service you have not selected.
       *
       * Reading the link always goes through YouTube Music, because it is the
       * only thing that can say what is at a YouTube URL. Only the download
       * target follows the selection.
       */
      if (isYouTubeLink && resolveYtMusicUrl) {
        /*
         * Failures are reported, not swallowed.
         *
         * Returning null here used to drop through to the Qobuz branch, which
         * is how a YouTube problem kept surfacing as a Qobuz credentials error
         * and hid the real reason for three attempts at this.
         */
        const resolved = await resolveYtMusicUrl(link).catch((error: any) => {
          throw new Error(`YouTube Music could not read that link: ${error?.message ?? error}`);
        });
        if (!resolved || resolved.tracks.length === 0) {
          throw new Error('YouTube Music found nothing at that link');
        }
        if (resolved && resolved.tracks.length > 0) {
          /*
           * The preview names the service the tracks will come from, which is
           * the selected one — the download follows the same rule.
           */
          const target = data?.service === 'deezer' || data?.service === 'qobuz' ? data.service : 'ytmusic';
          socket.emit('urlParseResults', {
            tracks: resolved.tracks,
            linktype: `${target}-${resolved.kind}`,
            linkinfo: {title: resolved.title, artist: {name: resolved.tracks[0]?.artist ?? ''}},
            service: target,
            metadata: {
              originalUrl: String(data.url),
              service: target,
              contentType: `${target}-${resolved.kind}`,
              trackCount: resolved.tracks.length,
              title: resolved.title || resolved.tracks[0]?.title || 'Unknown Content',
            },
          });
          return;
        }
      }
      const hasExplicitService = typeof data?.service === 'string' && data.service.length > 0;
      /*
       * On YouTube Music, another service's link is read by that service and
       * converted — so the preview names YouTube Music, because that is where
       * the tracks will come from. Reading it is still Deezer's or Qobuz's job:
       * only they can say what is in their own playlist.
       */
      const convertingToYtMusic = data?.service === 'ytmusic' && !isYouTubeLink;

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
        /*
         * Only wake Qobuz when Qobuz is the one reading.
         *
         * This waited on Qobuz for every Spotify link, including the ones it
         * then handed to Deezer — so an expired Qobuz token broke Spotify
         * links for people not using Qobuz at all, and reported it as a Qobuz
         * credentials error.
         */
        if (isQobuzTarget) await ensureQobuzSearchReady();
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

      if (convertingToYtMusic) {
        parsedData.metadata.service = 'ytmusic';
        parsedData.metadata.contentType = `ytmusic-${String(parsedData.linktype || 'track')
          .split('-')
          .pop()}`;
      }

      socket.emit('urlParseResults', parsedData);
    } catch (error: any) {
      console.error('URL parsing error:', error);
      socket.emit('urlParseError', {message: describeParseError(error)});
    }
  });
};
