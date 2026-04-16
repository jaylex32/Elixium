import {existsSync, readdirSync} from 'fs';
import path from 'path';
import {getUrlParts, tidal} from '../core';
import {getSpotifyPlaylistBundle} from '../core/converter/spotify';
import type Config from '../lib/config';
import {parseToQobuz} from '../lib/to-qobuz-parser';
import type {
  FavoriteGenreRecord,
  MonitorHistoryRecord,
  MonitorScheduleRecord,
  PlaylistCandidateRecord,
  ProcessedAlbumRecord,
  ProcessedTrackRecord,
  WatchlistCandidateRecord,
  WatchlistData,
  WatchedArtistRecord,
  WatchedPlaylistRecord,
} from './watchlist-store';
import {WatchlistStore} from './watchlist-store';

interface QobuzWatchlistDependencies {
  conf: Config | any;
  qobuz: any;
  ensureQobuzSearchReady: () => Promise<void>;
  dispatchQueueItems?: (queueItems: any[], options?: {autoStart?: boolean; source?: string}) => Promise<void> | void;
  broadcastState?: (state: any) => void;
}

interface WatchedArtistInput {
  id: string;
  name: string;
  image?: string;
  service?: string;
}

type MonitorKind = 'artists' | 'playlists';

const FALLBACK_QOBUZ_GENRES: FavoriteGenreRecord[] = [
  {id: 'pop', label: 'Pop', service: 'qobuz'},
  {id: 'hip-hop', label: 'Hip-Hop', service: 'qobuz'},
  {id: 'jazz', label: 'Jazz', service: 'qobuz'},
  {id: 'electronic', label: 'Electronic', service: 'qobuz'},
  {id: 'classical', label: 'Classical', service: 'qobuz'},
  {id: 'rock', label: 'Rock', service: 'qobuz'},
];

export const normalizeWatchlistText = (value: string) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const buildAlbumKey = (artist: string, title: string) =>
  `${normalizeWatchlistText(artist)}::${normalizeWatchlistText(title)}`;

const buildTrackKey = (artist: string, title: string) => buildAlbumKey(artist, title);
const WATCHLIST_ARTIST_ALBUM_PAGE_SIZE = 100;
const WATCHLIST_PLAYLIST_TRACK_PAGE_SIZE = 100;
const SCHEDULER_TICK_MS = 60_000;

const normalizePlaylistImage = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const extractPlaylistTrackImage = (tracks: any[]) => {
  if (!Array.isArray(tracks)) return '';
  for (const track of tracks) {
    const image = normalizePlaylistImage(
      track?.album?.image?.large,
      track?.album?.image?.thumbnail,
      track?.album?.image?.small,
      track?.image,
      track?.rawData?.album?.image?.large,
      track?.rawData?.album?.image?.thumbnail,
      track?.rawData?.album?.image?.small,
      track?.rawData?.album?.cover,
      track?.rawData?.cover,
    );
    if (image) return image;
  }
  return '';
};

const collectFilesystemTokens = (rootPath: string) => {
  const names = new Set<string>();
  if (!rootPath || !existsSync(rootPath)) return names;

  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(current, {withFileTypes: true}) as any;
    } catch {
      continue;
    }

    for (const entry of entries as any[]) {
      const fullPath = path.join(current, entry.name);
      const normalized = normalizeWatchlistText(path.parse(entry.name).name || entry.name);
      if (normalized) names.add(normalized);
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }

  return names;
};

const clampNumber = (value: any, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const normalizeSchedule = (schedule: Partial<MonitorScheduleRecord> | undefined): MonitorScheduleRecord => {
  const mode = ['interval-hours', 'interval-days', 'weekdays', 'monthly'].includes(String(schedule?.mode))
    ? (schedule?.mode as MonitorScheduleRecord['mode'])
    : 'interval-days';
  const weekdays = Array.isArray(schedule?.weekdays)
    ? [...new Set((schedule?.weekdays || []).map((entry) => clampNumber(entry, 0, 6, 0)))]
    : [1];
  const monthDays = Array.isArray(schedule?.monthDays)
    ? [...new Set((schedule?.monthDays || []).map((entry) => clampNumber(entry, 1, 31, 1)))]
    : [1];

  return {
    enabled: Boolean(schedule?.enabled),
    mode,
    intervalHours: clampNumber(schedule?.intervalHours, 1, 168, 12),
    intervalDays: clampNumber(schedule?.intervalDays, 1, 30, 1),
    weekdays: weekdays.length ? weekdays : [1],
    monthDays: monthDays.length ? monthDays : [1],
    hour: clampNumber(schedule?.hour, 0, 23, 8),
    minute: clampNumber(schedule?.minute, 0, 59, 0),
    lastRunAt: schedule?.lastRunAt ? String(schedule.lastRunAt) : null,
    nextRunAt: schedule?.nextRunAt ? String(schedule.nextRunAt) : null,
  };
};

const setTime = (date: Date, hour: number, minute: number) => {
  const next = new Date(date);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const computeNextRunAt = (schedule: MonitorScheduleRecord, now = new Date()): string | null => {
  if (!schedule.enabled) return null;

  if (schedule.mode === 'interval-hours') {
    const last = schedule.lastRunAt ? new Date(schedule.lastRunAt) : now;
    return new Date(last.getTime() + schedule.intervalHours * 60 * 60 * 1000).toISOString();
  }

  if (schedule.mode === 'interval-days') {
    const base = schedule.lastRunAt ? new Date(schedule.lastRunAt) : now;
    const next = setTime(base, schedule.hour, schedule.minute);
    if (schedule.lastRunAt) {
      next.setDate(next.getDate() + schedule.intervalDays);
    } else if (next <= now) {
      next.setDate(next.getDate() + schedule.intervalDays);
    }
    return next.toISOString();
  }

  if (schedule.mode === 'monthly') {
    const targetDays = schedule.monthDays.length ? [...schedule.monthDays].sort((a, b) => a - b) : [1];
    for (let offset = 0; offset < 62; offset += 1) {
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      if (!targetDays.includes(candidate.getDate())) continue;
      const withTime = setTime(candidate, schedule.hour, schedule.minute);
      if (withTime > now) return withTime.toISOString();
    }

    const fallback = new Date(now);
    fallback.setMonth(fallback.getMonth() + 1, targetDays[0]);
    return setTime(fallback, schedule.hour, schedule.minute).toISOString();
  }

  const today = new Date(now);
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(today);
    candidate.setDate(today.getDate() + offset);
    if (!schedule.weekdays.includes(candidate.getDay())) continue;
    const withTime = setTime(candidate, schedule.hour, schedule.minute);
    if (withTime > now) return withTime.toISOString();
  }

  return setTime(new Date(now.getTime() + 24 * 60 * 60 * 1000), schedule.hour, schedule.minute).toISOString();
};

export const createQobuzWatchlistService = ({
  conf,
  qobuz,
  ensureQobuzSearchReady,
  dispatchQueueItems,
  broadcastState,
}: QobuzWatchlistDependencies) => {
  const store = new WatchlistStore();
  let availableGenres = [...FALLBACK_QOBUZ_GENRES];
  let schedulerRunning = false;
  let schedulerTimer: NodeJS.Timeout | null = null;

  const getQobuzPath = () => {
    const configured = conf?.get?.('paths.qobuz') || './Music/Qobuz';
    return path.resolve(process.cwd(), configured);
  };

  const pushMonitorHistory = (
    kind: MonitorKind,
    level: MonitorHistoryRecord['level'],
    message: string,
    details = '',
  ) => {
    store.update((draft) => {
      draft.monitorHistory.unshift({
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        level,
        message,
        details,
        createdAt: new Date().toISOString(),
      });
      draft.monitorHistory = draft.monitorHistory.slice(0, 300);
    });
  };

  const toWatchedArtist = (artist: WatchedArtistInput): WatchedArtistRecord => ({
    id: String(artist.id),
    name: String(artist.name || 'Unknown Artist'),
    service: 'qobuz',
    image: String(artist.image || ''),
    lastCheckedAt: null,
    status: 'idle',
    rules: {
      autoQueueAlbums: false,
      autoQueueTracks: false,
      trackLimit: 20,
    },
  });

  const enrichState = (state: WatchlistData) => {
    const albumCountByArtist = new Map<string, number>();
    const trackCountByPlaylist = new Map<string, number>();

    state.candidates.forEach((candidate) => {
      if (candidate.reason === 'new' || candidate.reason === 'needs-review') {
        albumCountByArtist.set(candidate.artistId, (albumCountByArtist.get(candidate.artistId) || 0) + 1);
      }
    });

    state.playlistCandidates.forEach((candidate) => {
      if (candidate.reason === 'new' || candidate.reason === 'needs-review') {
        trackCountByPlaylist.set(candidate.playlistId, (trackCountByPlaylist.get(candidate.playlistId) || 0) + 1);
      }
    });

    const schedules = {
      artists: normalizeSchedule(state.schedules?.artists),
      playlists: normalizeSchedule(state.schedules?.playlists),
    };

    return {
      ...state,
      schedules,
      availableGenres,
      watchedArtists: state.watchedArtists.map((artist) => ({
        ...artist,
        newReleaseCount: albumCountByArtist.get(String(artist.id)) || 0,
      })),
      watchedPlaylists: state.watchedPlaylists.map((playlist) => ({
        ...playlist,
        newTrackCount: trackCountByPlaylist.get(String(playlist.id)) || 0,
      })),
      summary: {
        watchedArtists: state.watchedArtists.length,
        watchedPlaylists: state.watchedPlaylists.length,
        newCandidates: state.candidates.filter(
          (candidate) => candidate.reason === 'new' || candidate.reason === 'needs-review',
        ).length,
        newPlaylistCandidates: state.playlistCandidates.filter(
          (candidate) => candidate.reason === 'new' || candidate.reason === 'needs-review',
        ).length,
        favoriteGenres: state.favoriteGenres.length,
      },
    };
  };

  const getState = () => enrichState(store.getState());

  const parseGenreList = (payload: any): FavoriteGenreRecord[] => {
    const rawItems = payload?.genres?.items || payload?.genres || payload?.items || [];
    if (!Array.isArray(rawItems)) return [];

    return rawItems
      .map((genre: any) => {
        const id = String(genre?.id || genre?.slug || '').trim();
        const label = String(genre?.name || genre?.title || '').trim();
        if (!id || !label) return null;
        return {id, label, service: 'qobuz'} as FavoriteGenreRecord;
      })
      .filter(Boolean) as FavoriteGenreRecord[];
  };

  const loadAvailableGenres = async () => {
    try {
      await ensureQobuzSearchReady();
      const response = await qobuz.qobuzRequest?.('genre/list', {limit: 200, offset: 0});
      const fetched = parseGenreList(response);
      if (fetched.length > 0) availableGenres = fetched;
    } catch {
      availableGenres = [...FALLBACK_QOBUZ_GENRES];
    }
    return availableGenres;
  };

  const getFavoriteGenres = () => ({
    genres: store.getState().favoriteGenres,
    availableGenres,
  });

  const getMonitorSchedules = () => {
    const state = store.getState();
    return {
      artists: normalizeSchedule(state.schedules?.artists),
      playlists: normalizeSchedule(state.schedules?.playlists),
    };
  };

  const saveFavoriteGenres = (genreIds: string[]) => {
    const allowed = new Set(availableGenres.map((genre) => genre.id));
    const nextGenres = availableGenres.filter((genre) => allowed.has(genre.id) && genreIds.includes(genre.id));
    const state = store.update((draft) => {
      draft.favoriteGenres = nextGenres;
    });
    return enrichState(state);
  };

  const addWatchedArtist = (artist: WatchedArtistInput) => {
    const state = store.update((draft) => {
      const id = String(artist.id);
      const existing = draft.watchedArtists.find((entry) => String(entry.id) === id);
      if (existing) {
        existing.name = String(artist.name || existing.name);
        existing.image = String(artist.image || existing.image || '');
        existing.service = 'qobuz';
        return;
      }
      draft.watchedArtists.unshift(toWatchedArtist(artist));
    });
    pushMonitorHistory('artists', 'success', `Added ${artist.name || 'artist'} to monitor`);
    return enrichState(state);
  };

  const isAlbumOwnedByWatchedArtist = (album: any, artist: WatchedArtistRecord) =>
    String(album?.artist?.id || '') === String(artist.id);

  const fetchAllArtistAlbums = async (artist: WatchedArtistRecord) => {
    const albumById = new Map<string, any>();
    let offset = 0;
    let total = Number.MAX_SAFE_INTEGER;

    while (offset < total) {
      const response = await qobuz.getArtistAlbums(String(artist.id), {
        offset,
        limit: WATCHLIST_ARTIST_ALBUM_PAGE_SIZE,
      });
      const albumsPayload = response?.albums || {};
      const items = Array.isArray(albumsPayload?.items)
        ? albumsPayload.items
        : Array.isArray(albumsPayload)
        ? albumsPayload
        : [];

      total = Number(albumsPayload?.total || items.length || 0);
      if (!items.length) break;

      items.forEach((album: any) => {
        if (!album?.id) return;
        if (!isAlbumOwnedByWatchedArtist(album, artist)) return;
        albumById.set(String(album.id), album);
      });

      offset += items.length;
      if (items.length < WATCHLIST_ARTIST_ALBUM_PAGE_SIZE) break;
    }

    return Array.from(albumById.values());
  };

  const fetchAllPlaylistTracks = async (playlistId: string) => {
    const trackById = new Map<string, any>();
    let playlistInfo: any = null;
    let offset = 0;
    let total = Number.MAX_SAFE_INTEGER;

    while (offset < total) {
      const response = await qobuz.getPlaylistTracks(String(playlistId), {
        offset,
        limit: WATCHLIST_PLAYLIST_TRACK_PAGE_SIZE,
      });
      const tracksPayload = response?.tracks || {};
      const items = Array.isArray(tracksPayload?.items)
        ? tracksPayload.items
        : Array.isArray(tracksPayload)
        ? tracksPayload
        : [];

      if (!playlistInfo) playlistInfo = response;
      total = Number(tracksPayload?.total || items.length || 0);
      if (!items.length) break;

      items.forEach((track: any) => {
        if (!track?.id) return;
        trackById.set(String(track.id), track);
      });

      offset += items.length;
      if (items.length < WATCHLIST_PLAYLIST_TRACK_PAGE_SIZE) break;
    }

    return {playlistInfo, tracks: Array.from(trackById.values())};
  };

  const fetchSpotifyWatchlistPlaylistMeta = async (playlistId: string) => {
    try {
      const bundle = await getSpotifyPlaylistBundle(String(playlistId));
      return {
        id: String(bundle.id || playlistId),
        title: String(bundle.name || 'Playlist'),
        owner: String(bundle.ownerName || bundle.ownerId || 'Spotify'),
        image: normalizePlaylistImage(bundle.imageUrl),
      };
    } catch {
      return null;
    }
  };

  const fetchTidalWatchlistPlaylistMeta = async (playlistId: string) => {
    try {
      const playlistInfo = await tidal.getPlaylist(String(playlistId));
      const imageUrls = playlistInfo?.image ? tidal.albumArtToUrl(String(playlistInfo.image)) : null;
      return {
        id: String(playlistInfo?.uuid || playlistId),
        title: String(playlistInfo?.title || 'Playlist'),
        owner: String(playlistInfo?.creator?.id || 'TIDAL'),
        image: normalizePlaylistImage(imageUrls?.xl, imageUrls?.lg, imageUrls?.md, imageUrls?.sm),
      };
    } catch {
      return null;
    }
  };

  const fetchWatchedPlaylistSource = async (playlist: {
    id: string;
    url: string;
    service: WatchedPlaylistRecord['service'];
  }) => {
    if (playlist.service === 'qobuz') {
      const {playlistInfo, tracks} = await fetchAllPlaylistTracks(String(playlist.id));
      return {
        playlistInfo: {
          id: String(playlist.id),
          title: String(playlistInfo?.name || playlistInfo?.title || 'Playlist'),
          owner: String(playlistInfo?.owner?.name || playlistInfo?.owner?.display_name || ''),
          image: normalizePlaylistImage(
            playlistInfo?.image_rectangle?.[0]?.url ||
              playlistInfo?.images300?.[0] ||
              playlistInfo?.images150?.[0] ||
              playlistInfo?.image?.large ||
              '',
          ),
        },
        tracks,
      };
    }

    await ensureQobuzSearchReady();
    const parsedData = await parseToQobuz(String(playlist.url));
    if (!['qobuz-playlist', 'spotify-playlist'].includes(parsedData.linktype)) {
      throw new Error(`Unsupported monitored playlist type: ${playlist.service}`);
    }

    const spotifyMeta = playlist.service === 'spotify' ? await fetchSpotifyWatchlistPlaylistMeta(playlist.id) : null;
    const tidalMeta = playlist.service === 'tidal' ? await fetchTidalWatchlistPlaylistMeta(playlist.id) : null;
    const fallbackMeta = spotifyMeta || tidalMeta;
    const trackImage = extractPlaylistTrackImage(parsedData.tracks || []);
    const playlistImage =
      playlist.service === 'tidal'
        ? normalizePlaylistImage(
            trackImage,
            parsedData.linkinfo?.image?.large,
            parsedData.linkinfo?.image?.thumbnail,
            parsedData.linkinfo?.image?.small,
            fallbackMeta?.image,
          )
        : normalizePlaylistImage(
            fallbackMeta?.image,
            parsedData.linkinfo?.image?.large,
            parsedData.linkinfo?.image?.thumbnail,
            parsedData.linkinfo?.image?.small,
            trackImage,
          );

    return {
      playlistInfo: {
        id: String(parsedData.linkinfo?.id || fallbackMeta?.id || playlist.id),
        title: String(parsedData.linkinfo?.title || parsedData.linkinfo?.name || fallbackMeta?.title || 'Playlist'),
        owner: String(
          parsedData.linkinfo?.owner?.name || parsedData.linkinfo?.owner?.id || fallbackMeta?.owner || playlist.service,
        ),
        image: playlistImage,
      },
      tracks: parsedData.tracks || [],
    };
  };

  const removeWatchedArtist = (artistId: string) => {
    const state = store.update((draft) => {
      draft.watchedArtists = draft.watchedArtists.filter((artist) => String(artist.id) !== String(artistId));
      draft.candidates = draft.candidates.filter((candidate) => String(candidate.artistId) !== String(artistId));
    });
    pushMonitorHistory('artists', 'info', `Removed artist monitor`, `Artist ${artistId}`);
    return enrichState(state);
  };

  const classifyAlbums = async (artist: WatchedArtistRecord, albums: any[]) => {
    const state = store.getState();
    const processedByKey = new Map(state.processedAlbums.map((entry) => [entry.normalizedKey, entry]));
    const libraryTokens = collectFilesystemTokens(getQobuzPath());
    const nextCandidates: WatchlistCandidateRecord[] = [];

    albums.forEach((album) => {
      const title = String(album?.title || album?.name || 'Unknown Album');
      const normalizedTitle = normalizeWatchlistText(title);
      const normalizedArtist = normalizeWatchlistText(album?.artist?.name || artist.name);
      const normalizedKey = `${normalizedArtist}::${normalizedTitle}`;

      let reason: WatchlistCandidateRecord['reason'] = 'new';
      let duplicateSource = '';
      if (processedByKey.has(normalizedKey)) {
        const processedReason = processedByKey.get(normalizedKey)?.reason || 'history';
        if (['downloaded', 'dismissed', 'duplicate'].includes(processedReason)) {
          reason = 'already-processed';
          duplicateSource = processedReason;
        } else {
          reason = 'needs-review';
          duplicateSource = processedReason;
        }
      } else if (libraryTokens.has(normalizedTitle)) {
        reason = 'needs-review';
        duplicateSource = 'local-library';
      }

      nextCandidates.push({
        id: String(album.id),
        artistId: String(artist.id),
        artist: String(album?.artist?.name || artist.name),
        title,
        year: album?.release_date_original ? new Date(album.release_date_original).getFullYear() : null,
        image: String(album?.image?.large || album?.image?.thumbnail || album?.image?.small || album?.cover || ''),
        service: 'qobuz',
        normalizedKey,
        reason,
        duplicateSource: duplicateSource || undefined,
        rawData: album,
        checkedAt: new Date().toISOString(),
      });
    });

    return nextCandidates.sort((left, right) => {
      const leftYear = left.year || 0;
      const rightYear = right.year || 0;
      return rightYear - leftYear || left.title.localeCompare(right.title);
    });
  };

  const classifyPlaylistTracks = async (playlist: WatchedPlaylistRecord, tracks: any[]) => {
    const state = store.getState();
    const processedByKey = new Map(state.processedTracks.map((entry) => [entry.normalizedKey, entry]));
    const nextCandidates: PlaylistCandidateRecord[] = [];

    tracks.forEach((track) => {
      const artist = String(track?.performer?.name || track?.artist?.name || 'Unknown Artist');
      const title = String(track?.title || 'Unknown Track');
      const normalizedKey = buildTrackKey(artist, title);
      let reason: PlaylistCandidateRecord['reason'] = 'new';
      let duplicateSource = '';

      if (processedByKey.has(normalizedKey)) {
        const processedReason = processedByKey.get(normalizedKey)?.reason || 'history';
        if (['downloaded', 'dismissed', 'duplicate'].includes(processedReason)) {
          reason = 'already-processed';
          duplicateSource = processedReason;
        } else if (processedReason === 'queued') {
          reason = 'new';
        } else {
          reason = 'needs-review';
          duplicateSource = processedReason;
        }
      }

      nextCandidates.push({
        id: String(track.id),
        playlistId: String(playlist.id),
        playlistTitle: playlist.title,
        artist,
        title,
        album: String(track?.album?.title || ''),
        image: String(track?.album?.image?.thumbnail || track?.album?.image?.small || track?.album?.image?.large || ''),
        service: 'qobuz',
        normalizedKey,
        reason,
        duplicateSource: duplicateSource || undefined,
        rawData: track,
        checkedAt: new Date().toISOString(),
      });
    });

    return nextCandidates;
  };

  const getArtistTracks = async (artist: WatchedArtistRecord, limit = 20) => {
    await ensureQobuzSearchReady();
    let items: any[] = [];

    try {
      const response = await qobuz.qobuzRequest?.('artist/get', {
        artist_id: String(artist.id),
        extra: 'tracks',
      });
      items = response?.tracks?.items || response?.tracks || [];
    } catch {}

    if (!items.length) {
      const result = await qobuz.searchMusic(artist.name, 'track', Math.max(25, Number(limit) * 2), 0);
      items = ((result as any)?.tracks?.items || []).filter(
        (track: any) =>
          normalizeWatchlistText(track?.performer?.name || track?.artist?.name || '') ===
          normalizeWatchlistText(artist.name),
      );
    }

    return items.slice(0, Math.max(1, Number(limit)));
  };

  const createTrackQueueItem = (artist: WatchedArtistRecord | null, track: any, playlistTitle = '') => ({
    id: String(track?.id || track?.track_id || ''),
    title: String(track?.title || 'Unknown Track'),
    artist: String(track?.performer?.name || track?.artist?.name || artist?.name || 'Unknown Artist'),
    album: String(track?.album?.title || playlistTitle || ''),
    type: 'track',
    service: 'qobuz',
    duration: Number(track?.duration || 0),
    rawData: track,
  });

  const queueArtistTracks = async (
    artistId: string,
    options: {reason?: ProcessedTrackRecord['reason']; limit?: number} = {},
  ) => {
    const state = store.getState();
    const artist = state.watchedArtists.find((entry) => String(entry.id) === String(artistId));
    if (!artist) return {state: getState(), queueItems: []};

    const processedByKey = new Map(state.processedTracks.map((entry) => [entry.normalizedKey, entry]));
    const libraryTokens = collectFilesystemTokens(getQobuzPath());
    const tracks = await getArtistTracks(artist, options.limit || artist.rules?.trackLimit || 20);
    const queueItems = tracks
      .filter((track: any) => {
        const normalizedKey = buildTrackKey(
          track?.performer?.name || track?.artist?.name || artist.name,
          track?.title || '',
        );
        const normalizedTitle = normalizeWatchlistText(track?.title || '');
        return !processedByKey.has(normalizedKey) && !libraryTokens.has(normalizedTitle);
      })
      .map((track: any) => createTrackQueueItem(artist, track));

    const nextState = store.update((draft) => {
      const processedAt = new Date().toISOString();
      queueItems.forEach((trackItem) => {
        const normalizedKey = buildTrackKey(trackItem.artist, trackItem.title);
        const exists = draft.processedTracks.find((entry) => entry.normalizedKey === normalizedKey);
        if (exists) return;
        draft.processedTracks.unshift({
          id: trackItem.id,
          artistId: String(artist.id),
          artist: trackItem.artist,
          title: trackItem.title,
          album: trackItem.album,
          image: String(trackItem.rawData?.album?.image?.thumbnail || trackItem.rawData?.album?.image?.small || ''),
          service: 'qobuz',
          normalizedKey,
          reason: options.reason || 'queued',
          processedAt,
        });
      });
      draft.processedTracks = draft.processedTracks.slice(0, 1000);
    });

    return {state: enrichState(nextState), queueItems};
  };

  const addWatchedPlaylist = async (url: string) => {
    const info = await getUrlParts(String(url || '').trim(), true);
    const serviceByType: Record<string, WatchedPlaylistRecord['service'] | undefined> = {
      'qobuz-playlist': 'qobuz',
      'spotify-playlist': 'spotify',
      'tidal-playlist': 'tidal',
      playlist: 'deezer',
    };
    const playlistService = serviceByType[String(info.type)];
    if (!playlistService) {
      throw new Error('That URL is not a supported playlist link.');
    }

    const {playlistInfo, tracks} = await fetchWatchedPlaylistSource({
      id: String(info.id),
      url: String(url),
      service: playlistService,
    });
    const state = store.update((draft) => {
      const existing = draft.watchedPlaylists.find(
        (entry) => String(entry.id) === String(info.id) && entry.service === playlistService,
      );
      const nextImage = String(playlistInfo?.image || '');
      const nextTitle = String(playlistInfo?.title || 'Playlist');
      const nextOwner = String(playlistInfo?.owner || '');
      if (existing) {
        existing.url = String(url);
        existing.title = nextTitle;
        existing.owner = nextOwner;
        existing.image = nextImage || existing.image;
        existing.service = playlistService;
        existing.status = 'idle';
        existing.lastError = '';
        existing.lastTrackCount = tracks.length;
        return;
      }

      draft.watchedPlaylists.unshift({
        id: String(info.id),
        url: String(url),
        title: nextTitle,
        owner: nextOwner,
        service: playlistService,
        image: nextImage,
        lastCheckedAt: null,
        status: 'idle',
        lastTrackCount: tracks.length,
        rules: {
          autoQueueTracks: false,
        },
      });
    });
    pushMonitorHistory('playlists', 'success', `Added playlist monitor`, String(url));
    return enrichState(state);
  };

  const removeWatchedPlaylist = (playlistId: string) => {
    const state = store.update((draft) => {
      draft.watchedPlaylists = draft.watchedPlaylists.filter((entry) => String(entry.id) !== String(playlistId));
      draft.playlistCandidates = draft.playlistCandidates.filter(
        (entry) => String(entry.playlistId) !== String(playlistId),
      );
    });
    pushMonitorHistory('playlists', 'info', `Removed playlist monitor`, `Playlist ${playlistId}`);
    return enrichState(state);
  };

  const queueWatchedPlaylistTracks = async (
    playlistId: string,
    trackIds: string[],
    options: {sourceTracks?: any[]; playlistTitle?: string} = {},
  ) => {
    const current = store.getState();
    const watchedPlaylist = current.watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
    if (!watchedPlaylist) {
      return {state: getState(), queueItems: []};
    }

    const targets = current.playlistCandidates.filter(
      (candidate) => String(candidate.playlistId) === String(playlistId) && trackIds.includes(String(candidate.id)),
    );
    const queueableTargets = targets.filter((candidate) => ['new', 'needs-review'].includes(candidate.reason));
    const queueableIds = new Set(queueableTargets.map((candidate) => String(candidate.id)));
    const playlistTitle =
      options.playlistTitle || queueableTargets[0]?.playlistTitle || watchedPlaylist.title || 'Watchlist Playlist';
    let allPlaylistTracks = Array.isArray(options.sourceTracks) ? options.sourceTracks.filter(Boolean) : [];

    if (!allPlaylistTracks.length) {
      try {
        const sourceSnapshot = await fetchWatchedPlaylistSource({
          id: String(watchedPlaylist.id),
          url: String(watchedPlaylist.url),
          service: watchedPlaylist.service,
        });
        allPlaylistTracks = sourceSnapshot.tracks.filter(Boolean);
      } catch {
        allPlaylistTracks = current.playlistCandidates
          .filter((candidate) => String(candidate.playlistId) === String(playlistId))
          .map((candidate) => candidate.rawData)
          .filter(Boolean);
      }
    }

    const queueItems = queueableTargets.length
      ? [
          {
            id: `watchlist-playlist-${playlistId}-${Date.now()}`,
            title: playlistTitle,
            artist: `${queueableTargets.length} tracks`,
            type: 'playlist',
            service: 'user-playlist',
            playlistData: {
              id: playlistId,
              title: playlistTitle,
              source: 'watchlist',
              allTracks: allPlaylistTracks,
            },
            tracks: queueableTargets.map((candidate) => ({
              ...createTrackQueueItem(null, candidate.rawData, candidate.playlistTitle),
              service: 'qobuz',
            })),
          },
        ]
      : [];

    const state = store.update((draft) => {
      const processedAt = new Date().toISOString();
      queueableTargets.forEach((candidate) => {
        const exists = draft.processedTracks.find(
          (entry) =>
            entry.normalizedKey === candidate.normalizedKey && entry.artistId === `playlist:${candidate.playlistId}`,
        );
        if (exists) return;
        draft.processedTracks.unshift({
          id: candidate.id,
          artistId: `playlist:${candidate.playlistId}`,
          artist: candidate.artist,
          title: candidate.title,
          album: candidate.album,
          image: candidate.image,
          service: 'qobuz',
          normalizedKey: candidate.normalizedKey,
          reason: 'queued',
          processedAt,
        });
      });
      draft.playlistCandidates = draft.playlistCandidates.filter(
        (candidate) => !(String(candidate.playlistId) === String(playlistId) && queueableIds.has(String(candidate.id))),
      );
      draft.processedTracks = draft.processedTracks.slice(0, 1000);
    });

    return {state: enrichState(state), queueItems};
  };

  const refreshWatchedPlaylist = async (playlistId: string, options: {allowAutoQueue?: boolean} = {}) => {
    const current = store.getState();
    const watchedPlaylist = current.watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
    if (!watchedPlaylist) return {state: getState(), queueItems: [] as any[]};

    store.update((draft) => {
      const playlist = draft.watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
      if (playlist) {
        playlist.status = 'checking';
        playlist.lastError = '';
      }
    });

    try {
      const {playlistInfo, tracks} = await fetchWatchedPlaylistSource({
        id: String(watchedPlaylist.id),
        url: String(watchedPlaylist.url),
        service: watchedPlaylist.service,
      });
      const candidates = await classifyPlaylistTracks(watchedPlaylist, tracks);

      const state = store.update((draft) => {
        const playlist = draft.watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
        if (playlist) {
          playlist.status = 'ready';
          playlist.lastCheckedAt = new Date().toISOString();
          playlist.lastError = '';
          playlist.lastTrackCount = tracks.length;
          playlist.title = String(playlistInfo?.title || playlist.title);
          playlist.owner = String(playlistInfo?.owner || playlist.owner);
          playlist.image = String(playlistInfo?.image || playlist.image || '');
        }
        draft.playlistCandidates = draft.playlistCandidates.filter(
          (candidate) => String(candidate.playlistId) !== String(playlistId),
        );
        draft.playlistCandidates.push(...candidates);
      });

      let nextState = enrichState(state);
      const queueItems: any[] = [];

      if (options.allowAutoQueue && watchedPlaylist.rules?.autoQueueTracks) {
        const autoTrackIds = candidates
          .filter((candidate) => candidate.reason === 'new')
          .map((candidate) => String(candidate.id));
        if (autoTrackIds.length) {
          const queued = await queueWatchedPlaylistTracks(String(playlistId), autoTrackIds, {
            sourceTracks: tracks,
            playlistTitle: String(playlistInfo?.title || watchedPlaylist.title),
          });
          nextState = queued.state;
          queueItems.push(...queued.queueItems);
        }
      }

      return {state: nextState, queueItems};
    } catch (error: any) {
      const state = store.update((draft) => {
        const playlist = draft.watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
        if (playlist) {
          playlist.status = 'error';
          playlist.lastCheckedAt = new Date().toISOString();
          playlist.lastError = error?.message || 'Unable to refresh playlist';
        }
      });
      return {state: enrichState(state), queueItems: [] as any[]};
    }
  };

  const refreshAllWatchedPlaylists = async (options: {allowAutoQueue?: boolean} = {}) => {
    const state = store.getState();
    let nextState = getState();
    const queueItems: any[] = [];
    for (const playlist of state.watchedPlaylists) {
      const refreshed = await refreshWatchedPlaylist(String(playlist.id), options);
      nextState = refreshed.state;
      queueItems.push(...refreshed.queueItems);
    }
    return {state: nextState, queueItems};
  };

  const refreshWatchedArtist = async (artistId: string, options: {allowAutoQueue?: boolean} = {}) => {
    const current = store.getState();
    const watchedArtist = current.watchedArtists.find((artist) => String(artist.id) === String(artistId));
    if (!watchedArtist) return {state: getState(), queueItems: [] as any[]};

    store.update((draft) => {
      const artist = draft.watchedArtists.find((entry) => String(entry.id) === String(artistId));
      if (artist) {
        artist.status = 'checking';
        artist.lastError = '';
      }
    });

    try {
      await ensureQobuzSearchReady();
      const albums = await fetchAllArtistAlbums(watchedArtist);
      const candidates = await classifyAlbums(watchedArtist, albums);

      const state = store.update((draft) => {
        const artist = draft.watchedArtists.find((entry) => String(entry.id) === String(artistId));
        if (artist) {
          artist.status = 'ready';
          artist.lastCheckedAt = new Date().toISOString();
          artist.lastError = '';
        }
        draft.candidates = draft.candidates.filter((candidate) => String(candidate.artistId) !== String(artistId));
        draft.candidates.push(...candidates);
      });

      let nextState = enrichState(state);
      const queueItems: any[] = [];

      if (options.allowAutoQueue && watchedArtist.rules?.autoQueueAlbums) {
        const autoAlbumIds = candidates
          .filter((candidate) => candidate.reason === 'new' || candidate.reason === 'needs-review')
          .map((candidate) => String(candidate.id));
        if (autoAlbumIds.length) {
          const queued = queueWatchedArtistReleases(autoAlbumIds);
          nextState = queued.state;
          queueItems.push(...queued.queueItems);
        }
      }

      if (options.allowAutoQueue && watchedArtist.rules?.autoQueueTracks) {
        const queuedTracks = await queueArtistTracks(String(artistId), {reason: 'queued'});
        nextState = queuedTracks.state;
        queueItems.push(...queuedTracks.queueItems);
      }

      return {state: nextState, queueItems};
    } catch (error: any) {
      const state = store.update((draft) => {
        const artist = draft.watchedArtists.find((entry) => String(entry.id) === String(artistId));
        if (artist) {
          artist.status = 'error';
          artist.lastCheckedAt = new Date().toISOString();
          artist.lastError = error?.message || 'Unable to refresh artist';
        }
      });
      return {state: enrichState(state), queueItems: [] as any[]};
    }
  };

  const refreshAllWatchedArtists = async (options: {allowAutoQueue?: boolean} = {}) => {
    const state = store.getState();
    let nextState = getState();
    const queueItems: any[] = [];
    for (const artist of state.watchedArtists) {
      const refreshed = await refreshWatchedArtist(String(artist.id), options);
      nextState = refreshed.state;
      queueItems.push(...refreshed.queueItems);
    }
    return {state: nextState, queueItems};
  };

  const createQueueItem = (candidate: WatchlistCandidateRecord) => ({
    id: String(candidate.id),
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.title,
    type: 'album',
    service: 'qobuz',
    duration: candidate.year ? `${candidate.year}` : 'Album',
    year: candidate.year,
    rawData: candidate.rawData,
  });

  const queueWatchedArtistReleases = (albumIds: string[]) => {
    const current = store.getState();
    const queuedCandidates = current.candidates.filter((candidate) => albumIds.includes(String(candidate.id)));
    const queueableCandidates = queuedCandidates.filter((candidate) =>
      ['new', 'needs-review'].includes(candidate.reason),
    );
    const queueableIds = queueableCandidates.map((candidate) => String(candidate.id));
    const queueItems = queueableCandidates.map(createQueueItem);

    const state = store.update((draft) => {
      const processedAt = new Date().toISOString();
      queueableCandidates.forEach((candidate) => {
        const exists = draft.processedAlbums.find((entry) => entry.normalizedKey === candidate.normalizedKey);
        if (!exists) {
          draft.processedAlbums.unshift({
            id: candidate.id,
            artistId: candidate.artistId,
            artist: candidate.artist,
            title: candidate.title,
            year: candidate.year,
            image: candidate.image,
            service: 'qobuz',
            normalizedKey: candidate.normalizedKey,
            reason: 'queued',
            duplicateSource: candidate.duplicateSource,
            processedAt,
          });
        }
      });
      draft.candidates = draft.candidates.filter((candidate) => !queueableIds.includes(String(candidate.id)));
      draft.processedAlbums = draft.processedAlbums.slice(0, 600);
    });

    return {state: enrichState(state), queueItems};
  };

  const queueWatchedArtistDiscography = async (artistId: string) => {
    const state = store.getState();
    const artist = state.watchedArtists.find((entry) => String(entry.id) === String(artistId));
    if (!artist) return {state: getState(), queueItems: [] as any[]};

    const existingCandidates = state.candidates.filter((candidate) => String(candidate.artistId) === String(artistId));
    let targetCandidates = existingCandidates;

    if (!targetCandidates.length) {
      const refreshed = await refreshWatchedArtist(String(artistId));
      targetCandidates = refreshed.state.candidates.filter(
        (candidate: WatchlistCandidateRecord) => String(candidate.artistId) === String(artistId),
      );
    }

    return queueWatchedArtistReleases(targetCandidates.map((candidate) => String(candidate.id)));
  };

  const updateWatchedArtistRules = (artistId: string, rules: WatchedArtistRecord['rules']) => {
    const nextState = store.update((draft) => {
      const artist = draft.watchedArtists.find((entry) => String(entry.id) === String(artistId));
      if (!artist) return;
      artist.rules = {
        autoQueueAlbums: Boolean(rules?.autoQueueAlbums),
        autoQueueTracks: Boolean(rules?.autoQueueTracks),
        trackLimit: Math.max(5, Number(rules?.trackLimit || artist.rules?.trackLimit || 20)),
      };
    });
    return enrichState(nextState);
  };

  const updateWatchedPlaylistRules = (playlistId: string, rules: WatchedPlaylistRecord['rules']) => {
    const nextState = store.update((draft) => {
      const playlist = draft.watchedPlaylists.find((entry) => String(entry.id) === String(playlistId));
      if (!playlist) return;
      playlist.rules = {
        autoQueueTracks: Boolean(rules?.autoQueueTracks),
      };
    });
    return enrichState(nextState);
  };

  const markWatchlistAlbumsProcessed = (albumIds: string[], reason: ProcessedAlbumRecord['reason'] = 'dismissed') => {
    const current = store.getState();
    const targets = current.candidates.filter((candidate) => albumIds.includes(String(candidate.id)));
    const state = store.update((draft) => {
      const processedAt = new Date().toISOString();
      targets.forEach((candidate) => {
        const exists = draft.processedAlbums.find((entry) => entry.normalizedKey === candidate.normalizedKey);
        if (!exists) {
          draft.processedAlbums.unshift({
            id: candidate.id,
            artistId: candidate.artistId,
            artist: candidate.artist,
            title: candidate.title,
            year: candidate.year,
            image: candidate.image,
            service: 'qobuz',
            normalizedKey: candidate.normalizedKey,
            reason,
            duplicateSource: candidate.duplicateSource,
            processedAt,
          });
        }
      });
      draft.candidates = draft.candidates.filter((candidate) => !albumIds.includes(String(candidate.id)));
      draft.processedAlbums = draft.processedAlbums.slice(0, 600);
    });
    return enrichState(state);
  };

  const markWatchlistTracksProcessed = (
    playlistId: string,
    trackIds: string[],
    reason: ProcessedTrackRecord['reason'] = 'dismissed',
  ) => {
    const current = store.getState();
    const targets = current.playlistCandidates.filter(
      (candidate) => String(candidate.playlistId) === String(playlistId) && trackIds.includes(String(candidate.id)),
    );
    const state = store.update((draft) => {
      const processedAt = new Date().toISOString();
      targets.forEach((candidate) => {
        const exists = draft.processedTracks.find(
          (entry) =>
            entry.normalizedKey === candidate.normalizedKey && entry.artistId === `playlist:${candidate.playlistId}`,
        );
        if (!exists) {
          draft.processedTracks.unshift({
            id: candidate.id,
            artistId: `playlist:${candidate.playlistId}`,
            artist: candidate.artist,
            title: candidate.title,
            album: candidate.album,
            image: candidate.image,
            service: 'qobuz',
            normalizedKey: candidate.normalizedKey,
            reason,
            duplicateSource: candidate.duplicateSource,
            processedAt,
          });
        }
      });
      draft.playlistCandidates = draft.playlistCandidates.filter(
        (candidate) =>
          !(String(candidate.playlistId) === String(playlistId) && trackIds.includes(String(candidate.id))),
      );
      draft.processedTracks = draft.processedTracks.slice(0, 1000);
    });
    return enrichState(state);
  };

  const getWatchlistHistory = () => {
    const state = store.getState();
    const albumItems = state.processedAlbums.map((entry) => ({...entry, entryType: 'album'}));
    const trackItems = state.processedTracks.map((entry) => ({...entry, entryType: 'track'}));
    return [...albumItems, ...trackItems].sort(
      (left, right) => new Date(right.processedAt).getTime() - new Date(left.processedAt).getTime(),
    );
  };

  const getMonitorHistory = () =>
    store
      .getState()
      .monitorHistory.slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const getGenreDiscovery = async (genreId: string, limit = 18, offset = 0) => {
    await ensureQobuzSearchReady();
    if (!availableGenres.length) await loadAvailableGenres();

    const genre = availableGenres.find((entry) => String(entry.id) === String(genreId));
    let items: any[] = [];

    try {
      const featured = await qobuz.qobuzRequest?.('album/getFeatured', {
        type: 'new-releases-full',
        genre_ids: String(genreId),
        offset: Number(offset),
        limit: Number(limit),
      });
      items = featured?.albums?.items || featured?.items || [];
    } catch {}

    if (!items.length) {
      const query = genre?.label || genreId;
      const result = await qobuz.searchMusic(query, 'album', Number(limit), Number(offset));
      items = (result as any)?.albums?.items || [];
    }

    const mapped = items.slice(0, Number(limit)).map((album: any) => ({
      id: String(album.id),
      title: album.title || 'Unknown Album',
      artist: album.artist?.name || 'Unknown Artist',
      type: 'album',
      year: album.release_date_original ? new Date(album.release_date_original).getFullYear() : null,
      duration: `${album.tracks_count || 0} tracks`,
      rawData: album,
    }));

    return {
      items: mapped,
      hasMore: items.length >= Number(limit),
      offset: Number(offset),
      limit: Number(limit),
    };
  };

  const saveMonitorSchedule = (kind: MonitorKind, input: Partial<MonitorScheduleRecord>) => {
    const current = getMonitorSchedules()[kind];
    const next = normalizeSchedule({...current, ...input});
    next.lastRunAt = null;
    next.nextRunAt = computeNextRunAt(next);
    const state = store.update((draft) => {
      draft.schedules[kind] = next;
    });
    pushMonitorHistory(kind, 'info', `${kind === 'artists' ? 'Artist' : 'Playlist'} schedule updated`);
    return enrichState(state);
  };

  const maybeDispatchQueueItems = async (queueItems: any[], source: string) => {
    if (!queueItems.length || !dispatchQueueItems) return;
    await Promise.resolve(dispatchQueueItems(queueItems, {autoStart: true, source}));
  };

  const executeMonitorRun = async (kind: MonitorKind, reason = 'scheduled') => {
    if (kind === 'artists') {
      const result = await refreshAllWatchedArtists({allowAutoQueue: true});
      const nextState = store.update((draft) => {
        const schedule = normalizeSchedule(draft.schedules.artists);
        schedule.lastRunAt = new Date().toISOString();
        schedule.nextRunAt = computeNextRunAt(schedule);
        draft.schedules.artists = schedule;
      });
      pushMonitorHistory(
        'artists',
        'success',
        `Artist scan completed`,
        `${result.queueItems.length} queue items (${reason})`,
      );
      const enriched = enrichState(nextState);
      broadcastState?.(enriched);
      await maybeDispatchQueueItems(result.queueItems, `artists-${reason}`);
      return {state: enriched, queueItems: result.queueItems};
    }

    const result = await refreshAllWatchedPlaylists({allowAutoQueue: true});
    const nextState = store.update((draft) => {
      const schedule = normalizeSchedule(draft.schedules.playlists);
      schedule.lastRunAt = new Date().toISOString();
      schedule.nextRunAt = computeNextRunAt(schedule);
      draft.schedules.playlists = schedule;
    });
    pushMonitorHistory(
      'playlists',
      'success',
      `Playlist scan completed`,
      `${result.queueItems.length} queue items (${reason})`,
    );
    const enriched = enrichState(nextState);
    broadcastState?.(enriched);
    await maybeDispatchQueueItems(result.queueItems, `playlists-${reason}`);
    return {state: enriched, queueItems: result.queueItems};
  };

  const runMonitorNow = async (kind: MonitorKind) => executeMonitorRun(kind, 'manual');

  const schedulerTick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const schedules = getMonitorSchedules();
      const now = new Date();
      for (const kind of ['artists', 'playlists'] as MonitorKind[]) {
        const schedule = schedules[kind];
        if (!schedule.enabled || !schedule.nextRunAt) continue;
        if (new Date(schedule.nextRunAt).getTime() > now.getTime()) continue;
        try {
          await executeMonitorRun(kind, 'scheduled');
        } catch (error: any) {
          pushMonitorHistory(
            kind,
            'error',
            `${kind === 'artists' ? 'Artist' : 'Playlist'} scan failed`,
            error?.message || 'Unknown error',
          );
        }
      }
    } finally {
      schedulerRunning = false;
    }
  };

  const startScheduler = () => {
    if (schedulerTimer) return;
    store.update((draft) => {
      draft.schedules.artists = normalizeSchedule(draft.schedules.artists);
      draft.schedules.playlists = normalizeSchedule(draft.schedules.playlists);
      if (draft.schedules.artists.enabled && !draft.schedules.artists.nextRunAt) {
        draft.schedules.artists.nextRunAt = computeNextRunAt(draft.schedules.artists);
      }
      if (draft.schedules.playlists.enabled && !draft.schedules.playlists.nextRunAt) {
        draft.schedules.playlists.nextRunAt = computeNextRunAt(draft.schedules.playlists);
      }
    });
    schedulerTimer = setInterval(() => {
      void schedulerTick();
    }, SCHEDULER_TICK_MS);
  };

  startScheduler();

  return {
    loadAvailableGenres,
    getState,
    getFavoriteGenres,
    getMonitorSchedules,
    getMonitorHistory,
    saveMonitorSchedule,
    runMonitorNow,
    saveFavoriteGenres,
    addWatchedArtist,
    addWatchedPlaylist,
    removeWatchedArtist,
    removeWatchedPlaylist,
    updateWatchedArtistRules,
    updateWatchedPlaylistRules,
    refreshWatchedArtist,
    refreshAllWatchedArtists,
    refreshWatchedPlaylist,
    refreshAllWatchedPlaylists,
    queueWatchedArtistReleases,
    queueWatchedArtistDiscography,
    queueWatchedArtistTracks: queueArtistTracks,
    queueWatchedPlaylistTracks,
    markWatchlistAlbumsProcessed,
    markWatchlistTracksProcessed,
    getWatchlistHistory,
    getGenreDiscovery,
    getAvailableGenres: () => availableGenres,
  };
};

export type QobuzWatchlistService = ReturnType<typeof createQobuzWatchlistService>;
