export type Service = 'deezer' | 'qobuz' | 'ytmusic';

// ── Core media entities ──────────────────────────────────────────────

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  trackNumber?: number;
  service: Service;
  /** 30-second Deezer preview URL from rawData.preview (no auth needed) */
  previewUrl?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  year?: number | string;
  tracks?: number;
  type?: string;
  service: Service;
}

export interface Artist {
  id: string;
  name: string;
  picture?: string;
  fans?: number;
  service: Service;
}

// ── Backend response shapes ──────────────────────────────────────────

/** Raw result from /api/search or searchResults socket event */
export interface RawSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  year?: number | null;
  /** ISO `YYYY-MM-DD` when the service supplies one — used by the newest sort. */
  releaseDate?: string | null;
  type: 'track' | 'album' | 'artist' | 'playlist';
  /** Tracks on a release, when the service reports one. */
  trackCount?: number;
  rawData: Record<string, unknown>;
}

/** Raw discovery item from /api/discovery or discoveryContent socket event */
export interface RawDiscoveryItem {
  id: string;
  title: string;
  artist: string;
  type: string;
  year?: number | null;
  duration: string;
  rawData: Record<string, unknown>;
}

/** Track returned by /api/item-tracks */
export interface RawTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: string | number;
  track_number?: number;
  rawData?: Record<string, unknown>;
  preview?: string;
}

/** Response from /api/item-tracks */
export interface ItemTracksResponse {
  service: string;
  itemType: string;
  id: string;
  tracks: RawTrack[];
  metadata: {
    title?: string;
    artist?: string;
    release_date?: string;
    cover?: string;
  };
}

// ── Settings ─────────────────────────────────────────────────────────

export interface AppSettings {
  deezerArl: string;
  spotifySpDc: string;
  qobuzAppId: string;
  qobuzSecrets: string;
  qobuzToken: string;
  deezerQuality: 'FLAC' | 'MP3_320' | 'MP3_128';
  qobuzQuality: '5' | '6' | '7' | '27';
  concurrency: number;
  downloadPath: string;
  qobuzDownloadPath: string;
  ytmusicDownloadPath: string;
  ytmusicFormat: 'aac' | 'opus';
  /** Which services the switcher offers. */
  enabledServices: {deezer: boolean; qobuz: boolean; ytmusic: boolean};
  trackNumbering: boolean;
  coverArt: boolean;
  createPlaylists: boolean;
  fallbackTrack: boolean;
  fallbackQuality: boolean;
  fileTemplate: string;
}
