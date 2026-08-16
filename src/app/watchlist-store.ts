import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import path from 'path';
import {WATCHLIST_DATA_FILE} from './brand';

export interface WatchedArtistRecord {
  id: string;
  name: string;
  /**
   * The catalogue this artist belongs to.
   *
   * Was fixed at 'qobuz', which is why watching a Deezer artist stored it as a
   * Qobuz one and every later lookup searched the wrong service.
   */
  service: 'qobuz' | 'deezer';
  image: string;
  lastCheckedAt: string | null;
  status: 'idle' | 'checking' | 'ready' | 'error';
  lastError?: string;
  rules?: {
    autoQueueAlbums?: boolean;
    autoQueueTracks?: boolean;
    trackLimit?: number;
  };
}

export interface WatchedPlaylistRecord {
  id: string;
  url: string;
  title: string;
  owner: string;
  service: 'qobuz' | 'spotify' | 'deezer' | 'tidal';
  image: string;
  lastCheckedAt: string | null;
  status: 'idle' | 'checking' | 'ready' | 'error' | 'coming-soon';
  lastError?: string;
  lastTrackCount?: number;
  rules?: {
    autoQueueTracks?: boolean;
  };
}

export interface FavoriteGenreRecord {
  id: string;
  label: string;
  service: 'qobuz';
}

export interface ProcessedAlbumRecord {
  id: string;
  artistId: string;
  artist: string;
  title: string;
  year: number | null;
  image: string;
  service: 'qobuz';
  normalizedKey: string;
  reason: 'queued' | 'duplicate' | 'dismissed' | 'downloaded';
  duplicateSource?: string;
  processedAt: string;
}

export interface ProcessedTrackRecord {
  id: string;
  artistId: string;
  artist: string;
  title: string;
  album?: string;
  image?: string;
  service: 'qobuz';
  normalizedKey: string;
  reason: 'queued' | 'duplicate' | 'dismissed' | 'downloaded';
  duplicateSource?: string;
  processedAt: string;
}

export interface WatchlistCandidateRecord {
  id: string;
  artistId: string;
  artist: string;
  title: string;
  year: number | null;
  image: string;
  service: 'qobuz';
  normalizedKey: string;
  reason: 'new' | 'duplicate' | 'already-processed' | 'needs-review' | 'filtered-type';
  releaseType?: ReleaseType;
  duplicateSource?: string;
  rawData: any;
  checkedAt: string;
}

export interface PlaylistCandidateRecord {
  id: string;
  playlistId: string;
  playlistTitle: string;
  artist: string;
  title: string;
  album?: string;
  image?: string;
  service: 'qobuz';
  normalizedKey: string;
  reason: 'new' | 'duplicate' | 'already-processed' | 'needs-review' | 'filtered-type';
  releaseType?: ReleaseType;
  duplicateSource?: string;
  rawData: any;
  checkedAt: string;
}

export interface MonitorScheduleRecord {
  enabled: boolean;
  mode: 'interval-hours' | 'interval-days' | 'weekdays' | 'monthly';
  intervalHours: number;
  intervalDays: number;
  weekdays: number[];
  monthDays: number[];
  hour: number;
  minute: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface MonitorHistoryRecord {
  id: string;
  kind: 'artists' | 'playlists';
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  details?: string;
  createdAt: string;
}

export interface WatchlistData {
  version: number;
  watchedArtists: WatchedArtistRecord[];
  watchedPlaylists: WatchedPlaylistRecord[];
  favoriteGenres: FavoriteGenreRecord[];
  processedAlbums: ProcessedAlbumRecord[];
  processedTracks: ProcessedTrackRecord[];
  candidates: WatchlistCandidateRecord[];
  playlistCandidates: PlaylistCandidateRecord[];
  schedules: {
    artists: MonitorScheduleRecord;
    playlists: MonitorScheduleRecord;
  };
  monitorHistory: MonitorHistoryRecord[];
  availableGenres?: FavoriteGenreRecord[];
  /**
   * Which kinds of release the watchlist should collect.
   *
   * Equivalent to a Lidarr metadata profile. Without it every single, EP and
   * compilation an artist appears on is treated as a wanted release, which
   * buries the actual albums.
   */
  releaseTypes?: ReleaseType[];
  /**
   * Each watched artist's full discography, kept for the Library view.
   *
   * Library originally derived its rows from `candidates`, which is the
   * "new since the last scan" queue — and queueing or dismissing a release
   * removes it from that queue. So the page whose whole purpose is showing
   * owned versus missing deleted every release the moment you downloaded it,
   * and read as "not scanned yet" for anyone who had actually used the
   * watchlist.
   *
   * Stored separately so downloading moves a release from missing to owned
   * instead of removing it from view. Only the fields Library renders are
   * kept, because the full Qobuz album payloads would multiply the size of
   * this file for no benefit.
   */
  discographies?: Record<string, ArtistDiscographyRecord>;
}

/** A trimmed snapshot of one artist's releases. */
export interface ArtistDiscographyRecord {
  artistId: string;
  fetchedAt: string;
  releases: DiscographyReleaseRecord[];
}

export interface DiscographyReleaseRecord {
  id: string;
  title: string;
  year: number | null;
  image: string;
  releaseType: ReleaseType;
  /** Drives whether Qobuz can offer better than what is on disk. */
  maximumBitDepth: number;
}

export type ReleaseType = 'album' | 'ep' | 'single' | 'live' | 'compilation';

export const ALL_RELEASE_TYPES: ReleaseType[] = ['album', 'ep', 'single', 'live', 'compilation'];

/** Albums and EPs by default — the two most people actually want to keep. */
export const DEFAULT_RELEASE_TYPES: ReleaseType[] = ['album', 'ep'];

const defaultSchedule = (): MonitorScheduleRecord => ({
  enabled: false,
  mode: 'interval-days',
  intervalHours: 12,
  intervalDays: 1,
  weekdays: [1],
  monthDays: [1],
  hour: 8,
  minute: 0,
  lastRunAt: null,
  nextRunAt: null,
});

const defaultWatchlistData = (): WatchlistData => ({
  version: 2,
  watchedArtists: [],
  watchedPlaylists: [],
  favoriteGenres: [],
  processedAlbums: [],
  processedTracks: [],
  candidates: [],
  playlistCandidates: [],
  schedules: {
    artists: defaultSchedule(),
    playlists: defaultSchedule(),
  },
  monitorHistory: [],
  releaseTypes: [...DEFAULT_RELEASE_TYPES],
  discographies: {},
});

export class WatchlistStore {
  private readonly filePath: string;
  private data: WatchlistData;

  constructor(filePath = path.resolve(process.cwd(), WATCHLIST_DATA_FILE)) {
    this.filePath = filePath;
    this.data = this.load();
  }

  private load(): WatchlistData {
    if (!existsSync(this.filePath)) {
      return defaultWatchlistData();
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return {
        ...defaultWatchlistData(),
        ...parsed,
        watchedArtists: Array.isArray(parsed?.watchedArtists) ? parsed.watchedArtists : [],
        watchedPlaylists: Array.isArray(parsed?.watchedPlaylists) ? parsed.watchedPlaylists : [],
        favoriteGenres: Array.isArray(parsed?.favoriteGenres) ? parsed.favoriteGenres : [],
        processedAlbums: Array.isArray(parsed?.processedAlbums) ? parsed.processedAlbums : [],
        processedTracks: Array.isArray(parsed?.processedTracks) ? parsed.processedTracks : [],
        candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
        playlistCandidates: Array.isArray(parsed?.playlistCandidates) ? parsed.playlistCandidates : [],
        releaseTypes: Array.isArray(parsed?.releaseTypes) ? parsed.releaseTypes : [...DEFAULT_RELEASE_TYPES],
        schedules: {
          artists: {
            ...defaultSchedule(),
            ...(parsed?.schedules?.artists || {}),
          },
          playlists: {
            ...defaultSchedule(),
            ...(parsed?.schedules?.playlists || {}),
          },
        },
        monitorHistory: Array.isArray(parsed?.monitorHistory) ? parsed.monitorHistory : [],
      };
    } catch {
      return defaultWatchlistData();
    }
  }

  private persist() {
    mkdirSync(path.dirname(this.filePath), {recursive: true});
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  getState(): WatchlistData {
    return JSON.parse(JSON.stringify(this.data));
  }

  update(mutator: (draft: WatchlistData) => void): WatchlistData {
    mutator(this.data);
    this.persist();
    return this.getState();
  }

  replace(nextState: WatchlistData): WatchlistData {
    this.data = nextState;
    this.persist();
    return this.getState();
  }
}

export default WatchlistStore;
