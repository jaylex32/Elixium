import {create} from 'zustand';

export interface WatchedArtist {
  id: string;
  name: string;
  picture: string;
  addedAt: string;
  lastChecked?: string;
  newReleases?: number;
}

/**
 * A playlist the backend is monitoring.
 *
 * Field names mirror the server's `watchedPlaylists` entries so the socket
 * payload maps across without a translation layer.
 */
export interface WatchedPlaylist {
  id: string;
  name: string;
  owner?: string;
  image?: string;
  service?: string;
  trackCount?: number;
  newTrackCount?: number;
  lastCheckedAt?: string;
}

/** Normalize a raw server entry, which uses `title` where the UI wants `name`. */
export const toWatchedPlaylist = (raw: Record<string, unknown>): WatchedPlaylist => ({
  id: String(raw?.id ?? ''),
  name: (raw?.title as string) ?? (raw?.name as string) ?? 'Untitled playlist',
  owner: raw?.owner as string | undefined,
  image: raw?.image as string | undefined,
  service: raw?.service as string | undefined,
  trackCount: (raw?.lastTrackCount as number) ?? (raw?.trackCount as number),
  newTrackCount: raw?.newTrackCount as number | undefined,
  lastCheckedAt: raw?.lastCheckedAt as string | undefined,
});

export interface WantedItem {
  id: string;
  title: string;
  artist: string;
  cover: string;
  type: 'album' | 'ep' | 'single';
  releaseDate: string;
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

export type WatchlistTab = 'artists' | 'wanted' | 'history' | 'schedule';

interface WatchlistState {
  artists: WatchedArtist[];
  watchedPlaylists: WatchedPlaylist[];
  wanted: WantedItem[];
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
  history: [],
  activeTab: 'artists',
  isScanning: false,
  scheduleEnabled: false,
  scheduleDays: [1, 3, 5],
  scheduleHour: 8,

  setArtists: (artists) => set({artists}),
  setWatchedPlaylists: (watchedPlaylists) => set({watchedPlaylists}),
  setWanted: (wanted) => set({wanted}),
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
