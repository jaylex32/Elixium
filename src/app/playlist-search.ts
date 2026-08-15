import axios from 'axios';
import type {SearchResult} from './interactive-types';

/**
 * Playlist search across services, including ones we cannot download from
 * directly.
 *
 * A Spotify playlist is worth finding here even though nothing is fetched from
 * Spotify: the converter resolves it to Deezer or Qobuz tracks, so searching
 * Spotify's catalogue is a way of using its far better playlist curation as
 * input. That previously required finding the playlist in Spotify itself and
 * pasting the link back.
 *
 * Tidal is deliberately absent. Its search needs an authenticated session
 * rather than the public token Spotify exposes, so a Tidal playlist still has
 * to arrive as a URL — which the URL download and playlist watcher both accept.
 */

interface PlaylistSearchDependencies {
  qobuz: any;
  deezer: any;
  ensureQobuzSearchReady: () => Promise<void>;
  setSpotifyAnonymousToken: () => Promise<any>;
  /**
   * Read lazily, never captured.
   *
   * The spotify module declares `export let spotifyApi` and *reassigns* it
   * while authenticating, so a reference taken at startup is a different,
   * token-less object by the time a search runs — every request then came back
   * "Missing/invalid/expired access token".
   */
  getSpotifyApi: () => any;
  /** Spotify developer app credentials from the config, if the user set them. */
  getSpotifyCredentials: () => {clientId?: string; clientSecret?: string};
}

/** Cached client-credentials token; Spotify issues these for an hour. */
let appToken: {value: string; expiresAt: number} | null = null;

/**
 * Client-credentials token for catalogue search.
 *
 * The web-player token the converter uses is fine for reading a known
 * playlist, but Spotify answers /v1/search with 429 for it almost immediately —
 * it is not meant for that endpoint. A developer app's own credentials are the
 * supported way to search, and they are free to create.
 */
const getAppToken = async (clientId: string, clientSecret: string): Promise<string> => {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.value;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const {data} = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
    headers: {Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded'},
    timeout: 15000,
  });

  // Expire a minute early so a request cannot start on a token that dies mid-flight.
  appToken = {value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000};
  return appToken.value;
};

export type PlaylistSearchService = 'deezer' | 'qobuz' | 'spotify';

export const PLAYLIST_SEARCH_SERVICES: PlaylistSearchService[] = ['deezer', 'qobuz', 'spotify'];

export const createPlaylistSearch = ({
  qobuz,
  deezer,
  ensureQobuzSearchReady,
  setSpotifyAnonymousToken,
  getSpotifyApi,
  getSpotifyCredentials,
}: PlaylistSearchDependencies) => {
  const searchPlaylists = async (
    service: PlaylistSearchService,
    query: string,
    limit = 30,
    offset = 0,
  ): Promise<SearchResult[]> => {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    if (service === 'deezer') {
      const result = await deezer.searchMusicPaged(trimmed, 'PLAYLIST', Number(limit), Number(offset));
      return ((result as any)?.data || []).map((playlist: any) => ({
        id: String(playlist.PLAYLIST_ID || playlist.id),
        title: playlist.TITLE || playlist.title,
        artist: playlist.PARENT_USERNAME || playlist.user?.name || 'Deezer',
        album: 'Playlist',
        type: 'playlist',
        duration: `${playlist.NB_SONG || playlist.nb_tracks || 0} tracks`,
        // The URL is what the downloader and the playlist watcher both take,
        // so it travels with the result rather than being rebuilt client side.
        url: `https://www.deezer.com/playlist/${playlist.PLAYLIST_ID || playlist.id}`,
        sourceService: 'deezer',
        rawData: playlist,
      }));
    }

    if (service === 'qobuz') {
      await ensureQobuzSearchReady();
      const result = await qobuz.searchMusic(trimmed, 'playlist', Number(limit), Number(offset));
      return ((result as any).playlists?.items || []).map((playlist: any) => ({
        id: String(playlist.id),
        title: playlist.name,
        artist: playlist.owner?.name || 'Qobuz',
        album: 'Playlist',
        type: 'playlist',
        duration: `${playlist.tracks_count || 0} tracks`,
        url: `https://play.qobuz.com/playlist/${playlist.id}`,
        sourceService: 'qobuz',
        rawData: playlist,
      }));
    }

    // Spotify.
    const {clientId, clientSecret} = getSpotifyCredentials();
    let items: any[] = [];

    if (clientId && clientSecret) {
      const token = await getAppToken(clientId, clientSecret);
      const {data} = await axios.get('https://api.spotify.com/v1/search', {
        params: {q: trimmed, type: 'playlist', limit: Number(limit), offset: Number(offset)},
        headers: {Authorization: `Bearer ${token}`},
        timeout: 15000,
      });
      items = data?.playlists?.items || [];
    } else {
      /*
       * No developer credentials: try the web-player token the converter
       * already holds. It usually gets 429'd on search within a request or
       * two, so the failure is translated into something actionable rather
       * than a bare rate-limit code.
       */
      try {
        await setSpotifyAnonymousToken();
        const response = await getSpotifyApi().searchPlaylists(trimmed, {
          limit: Number(limit),
          offset: Number(offset),
        });
        items = response?.body?.playlists?.items || [];
      } catch (error: any) {
        const status = error?.statusCode ?? error?.response?.status;
        throw new Error(
          status === 429 || status === 401
            ? 'Spotify playlist search needs a free Spotify developer app. Add its Client ID and Secret in Settings; pasting a Spotify playlist link works without one.'
            : error?.message || 'Spotify search failed',
        );
      }
    }

    return (
      items
        // Spotify pads pages with nulls for playlists it will not serve; those
        // become blank cards that error on click if they are not dropped.
        .filter((playlist: any) => playlist && playlist.id)
        .map((playlist: any) => ({
          id: String(playlist.id),
          title: playlist.name,
          artist: playlist.owner?.display_name || 'Spotify',
          album: 'Playlist',
          type: 'playlist',
          duration: `${playlist.tracks?.total || 0} tracks`,
          url: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`,
          sourceService: 'spotify',
          rawData: {
            ...playlist,
            // Normalised so the shared cover helper finds it without a
            // Spotify-specific branch.
            picture_medium: playlist.images?.[0]?.url,
          },
        }))
    );
  };

  return {searchPlaylists};
};

export type PlaylistSearch = ReturnType<typeof createPlaylistSearch>;
