import {create} from 'zustand';

export interface WatchedArtist {
  id: string;
  name: string;
  picture: string;
  addedAt: string;
  lastChecked?: string;
  newReleases?: number;
  /**
   * Server-side automation rules. When autoQueueAlbums is on, a scheduled
   * scan queues and downloads new releases without asking — this is what
   * makes the watchlist run unattended rather than only building a list.
   */
  rules?: {autoQueueAlbums?: boolean; autoQueueTracks?: boolean; trackLimit?: number};
}

/**
 * A playlist the backend is monitoring.
 *
 * Field names mirror the server's `watchedPlaylists` entries so the socket
 * payload maps across without a translation layer.
 */
export interface WatchedPlaylist {
  id: string;
  /**
   * The original link, e.g. an open.spotify.com URL.
   *
   * Load-bearing: a watched playlist's id belongs to *its* service, so it
   * cannot be pasted into another service's URL template. Downloads go
   * through this URL and let the parser convert.
   */
  url?: string;
  name: string;
  owner?: string;
  image?: string;
  service?: string;
  trackCount?: number;
  newTrackCount?: number;
  lastCheckedAt?: string;
  status?: string;
  lastError?: string;
  rules?: {autoQueueTracks?: boolean};
}

/** Normalize a raw server entry, which uses `title` where the UI wants `name`. */
export const toWatchedPlaylist = (raw: Record<string, unknown>): WatchedPlaylist => ({
  id: String(raw?.id ?? ''),
  url: raw?.url as string | undefined,
  name: (raw?.title as string) ?? (raw?.name as string) ?? 'Untitled playlist',
  owner: raw?.owner as string | undefined,
  image: raw?.image as string | undefined,
  service: raw?.service as string | undefined,
  trackCount: (raw?.lastTrackCount as number) ?? (raw?.trackCount as number),
  newTrackCount: raw?.newTrackCount as number | undefined,
  lastCheckedAt: raw?.lastCheckedAt as string | undefined,
  status: raw?.status as string | undefined,
  lastError: raw?.lastError as string | undefined,
  rules: raw?.rules as {autoQueueTracks?: boolean} | undefined,
});

export interface WantedItem {
  id: string;
  title: string;
  artist: string;
  /** The server sends it with every candidate; it makes the name a link. */
  artistId?: string;
  cover: string;
  type: 'album' | 'ep' | 'single';
  releaseDate: string;
  selected: boolean;
}

/**
 * A track the watchlist found on a followed playlist.
 *
 * Kept separate from album candidates because queueing one goes through a
 * different server call (queueWatchedPlaylistTracks, which needs the owning
 * playlist id) than an artist release does.
 */
export interface WantedTrack {
  id: string;
  playlistId: string;
  playlistTitle: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  selected: boolean;
}

export interface WatchlistHistory {
  id: string;
  title: string;
  artist: string;
  cover: string;
  downloadedAt: string;
  quality: string;
}

export type WatchlistTab = 'artists' | 'playlists' | 'wanted' | 'history' | 'schedule' | 'genres';

interface WatchlistState {
  artists: WatchedArtist[];
  watchedPlaylists: WatchedPlaylist[];
  wanted: WantedItem[];
  playlistWanted: WantedTrack[];
  history: WatchlistHistory[];
  activeTab: WatchlistTab;
  isScanning: boolean;
  lastScan?: string;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleHour: number;

  setArtists: (artists: WatchedArtist[]) => void;
  setWatchedPlaylists: (playlists: WatchedPlaylist[]) => void;
  setWanted: (items: WantedItem[]) => void;
  setPlaylistWanted: (items: WantedTrack[]) => void;
  togglePlaylistWanted: (id: string) => void;
  selectAllPlaylistWanted: (selected: boolean) => void;
  setHistory: (items: WatchlistHistory[]) => void;
  toggleWanted: (id: string) => void;
  selectAllWanted: () => void;
  deselectAllWanted: () => void;
  setActiveTab: (tab: WatchlistTab) => void;
  setScanning: (scanning: boolean) => void;
  setLastScan: (time: string) => void;
  setSchedule: (enabled: boolean, days: number[], hour: number) => void;
}

export const useWatchlistStore = create<WatchlistState>()((set) => ({
  artists: [],
  watchedPlaylists: [],
  wanted: [],
  playlistWanted: [],
  history: [],
  activeTab: 'artists',
  isScanning: false,
  scheduleEnabled: false,
  scheduleDays: [1, 3, 5],
  scheduleHour: 8,

  setArtists: (artists) => set({artists}),
  setWatchedPlaylists: (watchedPlaylists) => set({watchedPlaylists}),
  setWanted: (wanted) => set({wanted}),
  setPlaylistWanted: (playlistWanted) => set({playlistWanted}),

  togglePlaylistWanted: (id) =>
    set((s) => ({playlistWanted: s.playlistWanted.map((t) => (t.id === id ? {...t, selected: !t.selected} : t))})),

  selectAllPlaylistWanted: (selected) =>
    set((s) => ({playlistWanted: s.playlistWanted.map((t) => ({...t, selected}))})),
  setHistory: (history) => set({history}),

  toggleWanted: (id) =>
    set((s) => ({
      wanted: s.wanted.map((i) => (i.id === id ? {...i, selected: !i.selected} : i)),
    })),

  selectAllWanted: () => set((s) => ({wanted: s.wanted.map((i) => ({...i, selected: true}))})),

  deselectAllWanted: () => set((s) => ({wanted: s.wanted.map((i) => ({...i, selected: false}))})),

  setActiveTab: (activeTab) => set({activeTab}),
  setScanning: (isScanning) => set({isScanning}),
  setLastScan: (lastScan) => set({lastScan}),
  setSchedule: (scheduleEnabled, scheduleDays, scheduleHour) => set({scheduleEnabled, scheduleDays, scheduleHour}),
}));
