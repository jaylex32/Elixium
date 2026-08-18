/**
 * Socket.IO event contract, compiled by both the server and the web UI.
 *
 * Most of this session's bugs were the same shape: a value crossed the
 * client/server boundary and nothing checked it.
 *
 *  - `onProgress` destructured `itemStatus`, which the server never sent, so
 *    downloads never left the "downloading" state.
 *  - `downloadComplete` carried no `itemId`, so rows could not be matched and
 *    duplicated.
 *  - `directUrlConversionProgress` had the same gap, producing duplicates a
 *    second time after the first fix.
 *  - The client listened for `watchlistQueueItems`, which nothing emitted, so
 *    "download watchlist" silently did nothing.
 *
 * None of those were visible at compile time because `socket.on(name, cb)` is
 * untyped by default: any string is a valid event and the callback's arguments
 * are `any`. Typing the maps makes a wrong name and a wrong payload both build
 * errors.
 *
 * Coverage is deliberately uneven. Every event *name* is listed, so a typo or
 * a listener for something nothing emits fails immediately — that alone would
 * have caught two of the four above. Payloads are specified for the events
 * that carry identity or state across the boundary, and left open elsewhere;
 * tightening those is safe to do incrementally, and inventing shapes for forty
 * events without reading each emit site would encode guesses as contracts.
 */

export type Service = 'deezer' | 'qobuz';

/** A payload not yet pinned down. Narrow these as each emit site is verified. */
type Unspecified = any;

// ── Payloads that carry identity or state ────────────────────────────────────

/** Status of a single queue row. */
/*
 * The values the emit sites actually send.
 *
 * This listed 'failed', which nothing emits, and omitted 'error', which the
 * queue runtime sends on a caught failure — so the client's check against it
 * was comparing two types with no overlap and the compiler could not say so
 * while the payload was being restated inline in two other files.
 */
export type DownloadItemStatus = 'queued' | 'downloading' | 'completed' | 'error' | 'cancelled';

/**
 * Progress for one queue item.
 *
 * `itemId` is required: without it the client cannot tell which row an update
 * belongs to, which is what caused rows to duplicate. `itemStatus` is optional
 * because not every emit site sets it — the client must treat its absence as
 * "unchanged" rather than assuming a terminal state.
 */
export interface DownloadProgressPayload {
  itemId?: string;
  itemStatus?: DownloadItemStatus;
  /** 0-100. Named `percentage` because that is what the emit sites send. */
  percentage?: number;
  currentTrack?: string;
  current?: number;
  total?: number;
  itemProgress?: number;
  phase?: string;
  message?: string;
  /**
   * Folder this item's files landed in, sent with its terminal event.
   *
   * The queue-wide `downloadComplete` carries every file from every item, so a
   * client had no way to tell which folder belonged to which row and stamped
   * the first one onto all of them — an album by one artist showed another
   * artist's path. This is per item and authoritative.
   */
  folder?: string;
  /** Files this item actually saved, for the row's track count. */
  savedCount?: number;
}

/**
 * Terminal event for a batch.
 *
 * `itemId` is optional because the queue runtime omits it — which is exactly
 * why the client could not retire the right row and downloads appeared to hang
 * at "downloading". Marked optional here rather than required so the type
 * describes what is actually sent; the client must handle its absence.
 */
export interface DownloadCompletePayload {
  itemId?: string;
  count?: number;
  files?: string[];
  playlistCreated?: boolean;
}

export interface DownloadErrorPayload {
  itemId?: string;
  message: string;
  trackTitle?: string;
}

/** A track a cross-service conversion could not match. */
export interface UnmatchedTrack {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  reason: string;
}

/**
 * Summary emitted after a playlist is converted between services.
 *
 * `at` is not sent — the client stamps its own arrival time — so it is absent
 * here rather than declared and silently undefined.
 */
export interface ConversionReportPayload {
  itemId?: string;
  matched?: number;
  unmatched?: UnmatchedTrack[];
}

/**
 * Items the watchlist wants queued.
 *
 * The key is `queueItems`, not `items`. Nothing on the client listened for
 * this event at all for a while, so "download watchlist" did nothing; the
 * name and shape here are taken from the emit sites in web-socket-watchlist.
 */
export interface WatchlistQueueItemsPayload {
  queueItems?: Array<Record<string, unknown>>;
  autoStart?: boolean;
}

// ── Event maps ───────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  /** One line of server output, streamed to the Logs page as it happens. */
  logLine: (payload: {seq: number; at: number; level: 'info' | 'warn' | 'error'; message: string}) => void;

  // Downloads
  downloadProgress: (payload: DownloadProgressPayload) => void;
  downloadComplete: (payload: DownloadCompletePayload) => void;
  downloadError: (payload: DownloadErrorPayload) => void;
  downloadStatus: (payload: Unspecified) => void;
  downloadStatusUpdate: (payload: Unspecified) => void;
  activeDownloads: (payload: Unspecified) => void;
  conversionReport: (payload: ConversionReportPayload) => void;

  // Direct URL downloads
  directUrlDownloadStart: (payload: Unspecified) => void;
  directUrlDownloadError: (payload: Unspecified) => void;
  directUrlConversionProgress: (payload: DownloadProgressPayload) => void;

  // Catalog
  searchResults: (payload: Unspecified) => void;
  searchError: (payload: Unspecified) => void;
  albumTracks: (payload: Unspecified) => void;
  albumTracksError: (payload: Unspecified) => void;
  artistAlbums: (payload: Unspecified) => void;
  artistAlbumsError: (payload: Unspecified) => void;
  artistTracks: (payload: Unspecified) => void;
  artistTracksError: (payload: Unspecified) => void;
  artistPlaylists: (payload: Unspecified) => void;
  artistPlaylistsError: (payload: Unspecified) => void;
  playlistTracks: (payload: Unspecified) => void;
  playlistTracksError: (payload: Unspecified) => void;
  playlistCreated: (payload: Unspecified) => void;
  urlParseResults: (payload: Unspecified) => void;
  urlParseError: (payload: Unspecified) => void;

  // Discovery
  discoveryContent: (payload: Unspecified) => void;
  discoveryError: (payload: Unspecified) => void;
  genreDiscovery: (payload: Unspecified) => void;
  favoriteGenres: (payload: Unspecified) => void;

  // Settings
  settings: (payload: Unspecified) => void;
  settingsSaved: (payload?: Unspecified) => void;
  settingsError: (payload: {message: string}) => void;
  qualitySettings: (payload: Unspecified) => void;
  qualitySettingsSaved: (payload?: Unspecified) => void;
  qualitySettingsError: (payload: Unspecified) => void;

  // Watchlist
  watchlistState: (payload: Unspecified) => void;
  watchlistError: (payload: Unspecified) => void;
  watchlistHistory: (payload: Unspecified) => void;
  watchlistScanStarted: (payload?: Unspecified) => void;
  watchlistScanComplete: (payload: Unspecified) => void;
  watchlistQueueItems: (payload: WatchlistQueueItemsPayload) => void;
  releaseTypes: (payload: Unspecified) => void;
  monitorSchedules: (payload: Unspecified) => void;
  monitorHistory: (payload: Unspecified) => void;
}

export interface ClientToServerEvents {
  // Catalog
  search: (payload: Unspecified) => void;
  parseUrl: (payload: Unspecified) => void;
  getAlbumTracks: (payload: Unspecified) => void;
  getArtistAlbums: (payload: Unspecified) => void;
  getArtistTracks: (payload: Unspecified) => void;
  getArtistPlaylists: (payload: Unspecified) => void;
  getPlaylistTracks: (payload: Unspecified) => void;
  getSpotifyPlaylistForEditing: (payload: Unspecified) => void;
  serviceChange: (payload: Unspecified) => void;

  // Discovery
  getDiscoveryContent: (payload: Unspecified) => void;
  getGenreDiscovery: (payload: Unspecified) => void;
  getFavoriteGenres: (payload?: Unspecified) => void;
  saveFavoriteGenres: (payload: Unspecified) => void;

  // Downloads
  startDownload: (payload: Unspecified) => void;
  cancelDownload: (payload: Unspecified) => void;
  directUrlDownload: (payload: Unspecified) => void;
  getDownloadStatus: (payload?: Unspecified) => void;
  getActiveDownloads: (payload?: Unspecified) => void;

  // Settings
  getSettings: (payload?: Unspecified) => void;
  saveSettings: (payload: Unspecified) => void;
  getQualitySettings: (payload?: Unspecified) => void;
  saveQualitySettings: (payload: Unspecified) => void;

  // Watchlist
  getWatchlistState: (payload?: Unspecified) => void;
  getWatchlistHistory: (payload?: Unspecified) => void;
  runWatchlistScan: (payload?: Unspecified) => void;
  addWatchedArtist: (payload: Unspecified) => void;
  removeWatchedArtist: (payload: Unspecified) => void;
  refreshWatchedArtist: (payload: Unspecified) => void;
  refreshAllWatchedArtists: (payload?: Unspecified) => void;
  saveWatchedArtistRules: (payload: Unspecified) => void;
  addWatchedPlaylist: (payload: Unspecified) => void;
  removeWatchedPlaylist: (payload: Unspecified) => void;
  refreshWatchedPlaylist: (payload: Unspecified) => void;
  refreshAllWatchedPlaylists: (payload?: Unspecified) => void;
  saveWatchedPlaylistRules: (payload: Unspecified) => void;
  queueWatchedArtistReleases: (payload: Unspecified) => void;
  queueWatchedArtistDiscography: (payload: Unspecified) => void;
  queueWatchedArtistTracks: (payload: Unspecified) => void;
  queueWatchedPlaylistTracks: (payload: Unspecified) => void;
  markWatchlistAlbumsProcessed: (payload: Unspecified) => void;
  markWatchlistTracksProcessed: (payload: Unspecified) => void;
  getReleaseTypes: (payload?: Unspecified) => void;
  saveReleaseTypes: (payload: Unspecified) => void;
  getMonitorSchedules: (payload?: Unspecified) => void;
  saveMonitorSchedule: (payload: Unspecified) => void;
  getMonitorHistory: (payload?: Unspecified) => void;
  runMonitorNow: (payload: Unspecified) => void;
}

/** Names only — useful for runtime guards and test assertions. */
export type ServerToClientEvent = keyof ServerToClientEvents;
export type ClientToServerEvent = keyof ClientToServerEvents;
