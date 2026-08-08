// All backend socket event names in one place.
// Frontend emits these:
export const EMIT = {
  SEARCH: 'search',
  GET_DISCOVERY: 'getDiscoveryContent',
  GET_ALBUM_TRACKS: 'getAlbumTracks',
  GET_PLAYLIST_TRACKS: 'getPlaylistTracks',
  GET_ARTIST_ALBUMS: 'getArtistAlbums',
  PARSE_URL: 'parseUrl',
  DIRECT_DOWNLOAD: 'directUrlDownload',
  START_DOWNLOAD: 'startDownload',
  CANCEL_DOWNLOAD: 'cancelDownload',
  GET_SETTINGS: 'getSettings',
  SAVE_SETTINGS: 'saveSettings',
  GET_WATCHLIST: 'getWatchlistState',
  ADD_WATCHED_ARTIST: 'addWatchedArtist',
  REMOVE_WATCHED_ARTIST: 'removeWatchedArtist',
  QUEUE_WATCHLIST_RELEASES: 'queueWatchedArtistReleases',
  RUN_MONITOR: 'runMonitorNow',
  GET_GENRE_DISCOVERY: 'getGenreDiscovery',
} as const;

// Frontend listens for these:
export const ON = {
  SEARCH_RESULTS: 'searchResults',
  SEARCH_ERROR: 'searchError',
  DISCOVERY_CONTENT: 'discoveryContent',
  DISCOVERY_ERROR: 'discoveryError',
  ALBUM_TRACKS: 'albumTracks',
  ALBUM_TRACKS_ERROR: 'albumTracksError',
  PLAYLIST_TRACKS: 'playlistTracks',
  ARTIST_ALBUMS: 'artistAlbums',
  URL_PARSE_RESULTS: 'urlParseResults',
  URL_PARSE_ERROR: 'urlParseError',
  DOWNLOAD_PROGRESS: 'downloadProgress',
  DOWNLOAD_COMPLETE: 'downloadComplete',
  DOWNLOAD_ERROR: 'directUrlDownloadError',
  DIRECT_DOWNLOAD_START: 'directUrlDownloadStart',
  DIRECT_DOWNLOAD_PROGRESS: 'directUrlConversionProgress',
  SETTINGS: 'settings',
  SETTINGS_SAVED: 'settingsSaved',
  SETTINGS_ERROR: 'settingsError',
  WATCHLIST_STATE: 'watchlistState',
  WATCHLIST_QUEUE_ITEMS: 'watchlistQueueItems',
  WATCHLIST_ERROR: 'watchlistError',
  GENRE_DISCOVERY: 'genreDiscovery',
} as const;

// Build a service URL from an ID + type (for directUrlDownload)
/**
 * True when an id could plausibly belong to the given service.
 *
 * Qobuz ids are numeric; Deezer's are too. A Spotify id is 22-character
 * base62, so pasting one into a Qobuz URL yields a link the API rejects with
 * "Invalid argument: playlist_id (accepted type are number)" — which surfaces
 * far from the actual mistake.
 */
export function isPlausibleServiceId(id: string, service: 'deezer' | 'qobuz'): boolean {
  const value = String(id ?? '').trim();
  if (!value) return false;
  // Both supported services use numeric ids; Qobuz album ids can be
  // alphanumeric, so only reject the clearly-foreign 22-char base62 form.
  if (service === 'qobuz' || service === 'deezer') {
    return !/^[A-Za-z0-9]{22}$/.test(value) || /^\d+$/.test(value);
  }
  return true;
}

/**
 * Build a service URL from an id that belongs to that service.
 *
 * If you hold an item from a *different* source (a watched Spotify playlist,
 * say), pass its original URL to the download instead — the id will not
 * resolve here.
 */
export function buildServiceUrl(
  id: string,
  type: 'album' | 'track' | 'playlist' | 'artist',
  service: 'deezer' | 'qobuz',
): string {
  if (!isPlausibleServiceId(id, service)) {
    throw new Error(
      `"${id}" does not look like a ${service} ${type} id (it resembles a Spotify id). ` +
        'Pass the original URL instead so it can be converted.',
    );
  }
  if (service === 'deezer') return `https://www.deezer.com/${type}/${id}`;
  const typeMap = {album: 'album', track: 'track', playlist: 'playlist', artist: 'artist'};
  return `https://open.qobuz.com/${typeMap[type]}/${id}`;
}
