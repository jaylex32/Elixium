import {existsSync, readdirSync} from 'fs';
import {
  QUALITY_TIERS,
  bestAvailableTier,
  classifyFileQuality,
  meetsCutoff,
  needsUpgrade,
  readQualityProfile,
  type QualityTier,
} from './quality-profile';
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
  DiscographyReleaseRecord,
} from './watchlist-store';
import {WatchlistStore, type ReleaseType, DEFAULT_RELEASE_TYPES, ALL_RELEASE_TYPES} from './watchlist-store';

interface QobuzWatchlistDependencies {
  conf: Config | any;
  qobuz: any;
  ensureQobuzSearchReady: () => Promise<void>;
  /**
   * Deezer's albums for an artist, in Deezer's own shape.
   *
   * The watchlist began as Qobuz-only and every lookup went to Qobuz, so a
   * watched Deezer artist was queried with a Deezer id against the wrong
   * catalogue — it silently found nothing forever.
   */
  fetchDeezerArtistAlbums?: (artistId: string) => Promise<any[]>;
  dispatchQueueItems?: (queueItems: any[], options?: {autoStart?: boolean; source?: string}) => Promise<void> | void;
  broadcastState?: (state: any) => void;
}

interface WatchedArtistInput {
  id: string;
  /**
   * What the interface actually sends.
   *
   * The socket payload has always used `artistId`, while this module read
   * `id` — so every added artist resolved to `String(undefined)`, they all
   * shared one key, and each new one silently overwrote the last. Only ever
   * one artist could be watched.
   */
  artistId?: string;
  name?: string;
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

/*
 * Edition markers that identify the *same* record rather than a different one.
 *
 * Without stripping these, "Album" and "Album (Deluxe Edition)" normalize to
 * different keys, so both are treated as new and both get downloaded — and
 * again for the remaster, the anniversary edition, and the explicit version.
 * Collapsing them means the first one wins and the rest are recognised as
 * already handled.
 *
 * Deliberately NOT collapsed: "Live", "Acoustic", "Instrumental", "Remix" and
 * "Demo" are genuinely different recordings, not repackages of the same one.
 */
const EDITION_MARKERS = [
  'deluxe',
  'deluxe edition',
  'super deluxe',
  'expanded',
  'expanded edition',
  'remaster',
  'remastered',
  'remastered version',
  'anniversary edition',
  'special edition',
  'limited edition',
  'collectors edition',
  'bonus track version',
  'bonus tracks',
  'explicit',
  'clean',
  'standard edition',
  'original mix',
  'single version',
  'radio edit',
];

/**
 * Remove edition/packaging qualifiers so variants of one release share a key.
 *
 * Handles the three shapes services actually use: a parenthetical, a bracketed
 * suffix, and a trailing " - Qualifier".
 */
export const stripEditionMarkers = (value: string): string => {
  let text = String(value || '');

  // "(...)" and "[...]" whose contents are only edition words, plus optional years.
  text = text.replace(/[([]([^)\]]*)[)\]]/g, (match, inner: string) => {
    const cleaned = normalizeWatchlistText(inner)
      .replace(/\b(19|20)\d{2}\b/g, '')
      // Ordinals too, so "20th Anniversary Edition" reduces to the marker.
      .replace(/\b\d+(st|nd|rd|th)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    return EDITION_MARKERS.includes(cleaned) ? '' : match;
  });

  // Trailing " - Qualifier".
  text = text.replace(/\s[-–—]\s([^-–—]+)$/, (match, tail: string) => {
    const cleaned = normalizeWatchlistText(tail)
      .replace(/\b(19|20)\d{2}\b/g, '')
      // Ordinals too, so "20th Anniversary Edition" reduces to the marker.
      .replace(/\b\d+(st|nd|rd|th)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return EDITION_MARKERS.includes(cleaned) ? '' : match;
  });

  return text.trim();
};

/**
 * Infer what kind of release an album is.
 *
 * Qobuz exposes no release-type field, so this reads the signals it does give:
 * track count, the `version` string, the title, and whether the credited
 * artist is a various-artists placeholder. It is a heuristic, not metadata —
 * a 4-track album by an artist who releases short records will read as an EP.
 * Erring toward "album" keeps real releases from being filtered away.
 */
export const classifyReleaseType = (album: any): ReleaseType => {
  const title = normalizeWatchlistText(album?.title || album?.name || '');
  const version = normalizeWatchlistText(album?.version || '');
  const artistName = normalizeWatchlistText(album?.artist?.name || '');
  const trackCount = Number(album?.tracks_count) || 0;
  const durationSec = Number(album?.duration) || 0;
  const haystack = `${title} ${version}`;

  // Explicit markers win over any count-based guess.
  if (/\blive\b|\bin concert\b|\bunplugged\b|\bsession(s)?\b/.test(haystack)) return 'live';
  if (/\bcompilation\b|\bgreatest hits\b|\bbest of\b|\banthology\b|\bcollection\b/.test(haystack)) {
    return 'compilation';
  }
  if (/\bvarious artists\b|\bva\b/.test(artistName)) return 'compilation';
  if (/\bsingle\b/.test(haystack)) return 'single';
  if (/\bep\b/.test(haystack)) return 'ep';

  // Otherwise fall back to size. Duration guards against an "album" that is
  // three long tracks, and against an EP padded with many short ones.
  if (trackCount > 0) {
    if (trackCount <= 2) return 'single';
    if (trackCount <= 6 && durationSec > 0 && durationSec < 30 * 60) return 'ep';
    if (trackCount <= 4) return 'ep';
  }

  return 'album';
};

const buildAlbumKey = (artist: string, title: string) =>
  `${normalizeWatchlistText(artist)}::${normalizeWatchlistText(stripEditionMarkers(title))}`;

/**
 * The pre-edition-stripping key.
 *
 * Existing state was written with this format, so a scan must still match it —
 * otherwise every previously downloaded album reappears as new the first time
 * the improved key ships.
 */
const buildLegacyAlbumKey = (artist: string, title: string) =>
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

/** Index cached per root, because rebuilding it walks the whole library. */
const libraryIndexCache = new Map<string, {at: number; index: Map<string, QualityTier>}>();

/** Scans in progress, so simultaneous callers share one walk. */
const libraryIndexInflight = new Map<string, Promise<Map<string, QualityTier>>>();

/**
 * How long an index stays fresh.
 *
 * Long enough that opening the Library page, switching filters and expanding
 * artists all reuse one scan; short enough that a finished download shows up
 * without a restart.
 */
const LIBRARY_INDEX_TTL_MS = 60_000;

export const invalidateLibraryIndex = (): void => {
  libraryIndexCache.clear();
};

/**
 * Index the library by normalized name, recording the best audio quality found.
 *
 * Returns names only would answer "do I have this?" but not "is what I have
 * good enough?" — so a release grabbed as MP3 stayed MP3 forever. The quality
 * is read from the files because download history never recorded it, and
 * reading the files is the only thing that works for a library that predates
 * the quality profile.
 *
 * A file's tier is attributed to its own name *and* to every directory above
 * it, so both "Artist/Album/01 Track.flac" and a flat "Album.flac" resolve.
 *
 * Asynchronous and cached, which is not incidental. The synchronous version
 * opened and read every FLAC on the main thread: a 5,760-file library blocked
 * the event loop for ~2 seconds, during which the server answered nothing —
 * concurrent requests measured the same 2s latency. On a large library that
 * runs past a reverse proxy's origin timeout and surfaces as a 502, and past
 * Socket.IO's ping timeout it drops every connected client. It ran on every
 * Library page view and on every watchlist scan.
 */
const scanLibrary = async (rootPath: string, probeDepth: boolean): Promise<Map<string, QualityTier>> => {
  const names = new Map<string, QualityTier>();
  if (!rootPath || !existsSync(rootPath)) return names;

  const write = (key: string, tier: QualityTier | null) => {
    if (!key) return;
    if (!tier) {
      // Keep the bare presence signal for non-audio entries (folders), without
      // claiming a quality we have not observed.
      if (!names.has(key)) names.set(key, 'mp3');
      return;
    }
    const existing = names.get(key);
    if (!existing || QUALITY_TIERS.indexOf(tier) > QUALITY_TIERS.indexOf(existing)) names.set(key, tier);
  };

  /**
   * Index a name under every form a release might be looked up by.
   *
   * The default path template is "{alb_artist} - {alb_title}", so an album
   * folder is "Draco Rosa - OLAS DE LUZ" while the release is known upstream
   * as "OLAS DE LUZ". Recording only the full name meant those never matched,
   * so an album sitting on disk still read as missing — and the duplicate
   * check that predates this had the same blind spot.
   *
   * Splitting on the first " - " recovers the title. An album whose own name
   * contains " - " still indexes under its full form, so nothing is lost.
   */
  const record = (rawName: string, tier: QualityTier | null) => {
    const normalized = normalizeWatchlistText(rawName);
    write(normalized, tier);

    const separator = rawName.indexOf(' - ');
    if (separator > 0) {
      write(normalizeWatchlistText(rawName.slice(separator + 3)), tier);
      write(normalizeWatchlistText(stripEditionMarkers(rawName.slice(separator + 3))), tier);
    }
    write(normalizeWatchlistText(stripEditionMarkers(rawName)), tier);
  };

  const stack: Array<{dir: string; ancestors: string[]}> = [{dir: rootPath, ancestors: []}];
  let filesSinceYield = 0;

  while (stack.length > 0) {
    /*
     * Hand the event loop back regularly.
     *
     * Reading a FLAC header costs ~0.3ms, so a few thousand files add up to
     * seconds of one uninterruptible task — during which the process answers
     * nothing. Yielding every 200 files keeps request latency flat while the
     * scan runs; it makes the scan marginally slower and the server usable,
     * which is the right trade.
     */
    if (filesSinceYield >= 200) {
      filesSinceYield = 0;
      await new Promise((resolve) => setImmediate(resolve));
    }

    const {dir, ancestors} = stack.pop() as {dir: string; ancestors: string[]};
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, {withFileTypes: true}) as any;
    } catch {
      continue;
    }

    for (const entry of entries as any[]) {
      const fullPath = path.join(dir, entry.name);
      // Raw, not normalized: `record` needs the original " - " separator to
      // recover the album title from a "{artist} - {album}" folder name.
      const rawName = path.parse(entry.name).name || entry.name;

      if (entry.isDirectory()) {
        record(rawName, null);
        stack.push({dir: fullPath, ancestors: rawName ? [...ancestors, rawName] : ancestors});
        continue;
      }

      const tier = classifyFileQuality(fullPath, probeDepth);
      filesSinceYield++;
      record(rawName, tier);
      // Promote the tier onto the enclosing album/artist folders too.
      if (tier) for (const ancestor of ancestors) record(ancestor, tier);
    }
  }

  return names;
};

/**
 * Cached, event-loop-friendly wrapper around the scan.
 *
 * The walk itself is still synchronous per directory — that part is fast. What
 * matters is yielding to the event loop between directories so the server keeps
 * answering while a large library is indexed, and reusing the result instead of
 * rescanning on every request.
 */
const collectFilesystemTokens = async (rootPath: string, probeDepth = false): Promise<Map<string, QualityTier>> => {
  if (!rootPath || !existsSync(rootPath)) return new Map();

  const cacheKey = rootPath + (probeDepth ? '::deep' : '');
  const cached = libraryIndexCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LIBRARY_INDEX_TTL_MS) return cached.index;

  /*
   * Collapse concurrent scans onto one promise.
   *
   * Opening the Library page fires a request while the watchlist scheduler may
   * already be scanning; without this they would walk the tree twice at once
   * and double the cost of the thing being optimised.
   */
  const inflight = libraryIndexInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = scanLibrary(rootPath, probeDepth)
    .then((index) => {
      libraryIndexCache.set(cacheKey, {at: Date.now(), index});
      return index;
    })
    .finally(() => {
      libraryIndexInflight.delete(cacheKey);
    });

  libraryIndexInflight.set(cacheKey, run);
  return run;
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
  fetchDeezerArtistAlbums,
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

  /** The id the interface sent, under either name. */
  const artistKeyOf = (artist: WatchedArtistInput): string => String(artist.artistId ?? artist.id ?? '').trim();

  const normaliseService = (service?: string): WatchedArtistRecord['service'] =>
    String(service || '').toLowerCase() === 'deezer' ? 'deezer' : 'qobuz';

  const toWatchedArtist = (artist: WatchedArtistInput): WatchedArtistRecord => ({
    id: artistKeyOf(artist),
    name: String(artist.name || 'Unknown Artist'),
    // Whichever service the artist actually came from. This was pinned to
    // 'qobuz', so a Deezer artist was stored as a Qobuz one and every later
    // lookup for it went to the wrong catalogue.
    service: normaliseService(artist.service),
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

  /**
   * Discography of every watched artist, split into what is held and what is not.
   *
   * The watchlist only ever answered "what is new since the last scan", so
   * there was no way to see an artist's catalogue against the library — the
   * question Lidarr's main screen exists to answer. Nothing new is fetched
   * here: candidates are already recorded per artist, and the library index
   * now carries a quality tier, so this is a projection over existing state
   * and stays cheap enough to call on every page view.
   *
   * A release counts as held if the filesystem index knows its title. That is
   * deliberately independent of download history: files moved in by hand still
   * count, and a history entry whose files were deleted does not.
   */
  /**
   * Each watched artist's catalogue against what is actually on disk.
   *
   * Reads the stored discography, not the candidate queue. Candidates are
   * "new since the last scan" and are removed the moment a release is queued
   * or dismissed, so deriving Library from them meant every release vanished
   * from the page as soon as it was downloaded — the opposite of what a
   * library view is for, and why it reported "not scanned yet" to anyone who
   * had actually used the watchlist.
   *
   * `fetchIfMissing` performs the Qobuz round trip for artists with no stored
   * snapshot. It is off for the plain page load so opening Library is always
   * fast, and on when the client explicitly asks to refresh.
   */
  const getLibraryOverview = async (artistId?: string, options: {fetchIfMissing?: boolean} = {}) => {
    const profile = readQualityProfile(conf);
    // Only a hires cutoff needs 16-bit vs 24-bit told apart, and that is the
    // only thing that justifies opening every file.
    const libraryTokens = await collectFilesystemTokens(getQobuzPath(), profile.cutoff === 'hires');

    const selected = () => {
      const state = store.getState();
      return artistId
        ? state.watchedArtists.filter((entry) => String(entry.id) === String(artistId))
        : state.watchedArtists;
    };

    if (options.fetchIfMissing) {
      for (const artist of selected()) {
        const existing = store.getState().discographies?.[String(artist.id)];
        if (existing && existing.releases.length > 0) continue;
        try {
          await ensureQobuzSearchReady();
          recordDiscography(String(artist.id), await fetchAllArtistAlbums(artist));
        } catch {
          // One artist failing must not blank the whole page.
        }
      }
    }

    const state = store.getState();
    const processedByKey = new Map(state.processedAlbums.map((entry) => [entry.normalizedKey, entry]));

    const summaries = selected().map((artist) => {
      const snapshot = state.discographies?.[String(artist.id)];
      const stored = snapshot?.releases ?? [];

      const releases = stored.map((release) => {
        const normalizedTitle = normalizeWatchlistText(stripEditionMarkers(release.title));
        const haveTier = libraryTokens.get(normalizedTitle) ?? null;
        const availableTier = bestAvailableTier('qobuz', {maximum_bit_depth: release.maximumBitDepth});

        /*
         * Download history is a fallback, not the primary signal. Files on
         * disk are the truth — something copied in by hand counts, and a
         * history entry whose files were deleted does not.
         */
        const key = buildAlbumKey(artist.name, release.title);
        const downloaded = processedByKey.get(key)?.reason === 'downloaded';
        const owned = haveTier !== null || downloaded;

        return {
          id: release.id,
          title: release.title,
          year: release.year,
          image: release.image,
          releaseType: release.releaseType,
          owned,
          quality: haveTier,
          availableQuality: availableTier,
          upgradable: haveTier !== null && !meetsCutoff(haveTier, profile.cutoff) && availableTier !== haveTier,
          reason: owned ? 'owned' : 'missing',
        };
      });

      const owned = releases.filter((r) => r.owned).length;
      return {
        artistId: String(artist.id),
        name: artist.name,
        image: artist.image ?? '',
        total: releases.length,
        owned,
        missing: releases.length - owned,
        upgradable: releases.filter((r) => r.upgradable).length,
        scannedAt: snapshot?.fetchedAt ?? null,
        releases: releases.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
      };
    });

    return {cutoff: profile.cutoff, artists: summaries};
  };

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

  const getReleaseTypes = (): ReleaseType[] => {
    const current = store.getState().releaseTypes;
    return Array.isArray(current) && current.length > 0 ? current : [...DEFAULT_RELEASE_TYPES];
  };

  /**
   * Replace the accepted release kinds.
   *
   * Rejects an empty selection: saving "collect nothing" silently stops every
   * scan from ever producing a candidate, which looks identical to the
   * watchlist being broken.
   */
  const saveReleaseTypes = (types: string[]) => {
    const allowed = new Set(ALL_RELEASE_TYPES);
    const next = [...new Set((types || []).map(String))].filter((t): t is ReleaseType => allowed.has(t as ReleaseType));
    const effective = next.length > 0 ? next : [...DEFAULT_RELEASE_TYPES];

    const state = store.update((draft) => {
      draft.releaseTypes = effective;
    });
    pushMonitorHistory('artists', 'info', `Release types set to ${effective.join(', ')}`);
    return enrichState(state);
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
    const id = artistKeyOf(artist);
    if (!id) throw new Error('That artist has no id, so it cannot be watched.');

    const service = normaliseService(artist.service);

    const state = store.update((draft) => {
      /* Matched on service *and* id: the two catalogues number their artists
         independently, so the same id routinely means different people. */
      const existing = draft.watchedArtists.find(
        (entry) => String(entry.id) === id && normaliseService(entry.service) === service,
      );
      if (existing) {
        existing.name = String(artist.name || existing.name);
        existing.image = String(artist.image || existing.image || '');
        existing.service = service;
        return;
      }
      draft.watchedArtists.unshift(toWatchedArtist(artist));
    });
    pushMonitorHistory('artists', 'success', `Added ${artist.name || 'artist'} to monitor`);
    return enrichState(state);
  };

  const isAlbumOwnedByWatchedArtist = (album: any, artist: WatchedArtistRecord) =>
    String(album?.artist?.id || '') === String(artist.id);

  /**
   * Persist a trimmed snapshot of an artist's releases.
   *
   * Called wherever the discography is already in hand, so keeping Library
   * populated costs no extra Qobuz requests.
   */
  const recordDiscography = (artistId: string, albums: any[]) => {
    if (!Array.isArray(albums) || albums.length === 0) return;

    const releases: DiscographyReleaseRecord[] = albums.map((album: any) => ({
      id: String(album?.id ?? ''),
      title: String(album?.title || album?.name || 'Unknown Album'),
      year: album?.release_date_original ? new Date(album.release_date_original).getFullYear() : null,
      image: String(album?.image?.large || album?.image?.small || album?.image?.thumbnail || ''),
      releaseType: classifyReleaseType(album),
      maximumBitDepth: Number(album?.maximum_bit_depth) || 16,
    }));

    store.update((draft) => {
      if (!draft.discographies) draft.discographies = {};
      draft.discographies[artistId] = {
        artistId,
        fetchedAt: new Date().toISOString(),
        releases,
      };
    });
  };

  /**
   * Deezer albums, translated into the shape the rest of this module expects.
   *
   * Everything downstream — release classification, the discography snapshot,
   * the owned-album check — was written against Qobuz's payload. Mapping here
   * means one adapter instead of a service branch in each of them.
   */
  const fetchDeezerAlbumsFor = async (artist: WatchedArtistRecord) => {
    if (!fetchDeezerArtistAlbums) return [];
    const albums = await fetchDeezerArtistAlbums(String(artist.id));

    return albums.map((album: any) => {
      const raw = album?.rawData ?? album;
      return {
        id: String(raw?.id ?? album?.id ?? ''),
        title: String(raw?.title ?? album?.title ?? 'Unknown Album'),
        // Deezer's artist/albums payload omits the artist object entirely, so
        // the owned-by check would reject every album without this.
        artist: {id: String(artist.id), name: artist.name},
        release_date_original: raw?.release_date ?? null,
        tracks_count: Number(raw?.nb_tracks) || 0,
        duration: Number(raw?.duration) || 0,
        // Deezer is lossy-only; 16-bit keeps the quality rules meaningful
        // rather than leaving them comparing against undefined.
        maximum_bit_depth: 16,
        image: {
          large: raw?.cover_xl || raw?.cover_big || raw?.cover_medium || '',
          small: raw?.cover_medium || '',
          thumbnail: raw?.cover_small || '',
        },
        version: raw?.record_type && String(raw.record_type).toLowerCase() !== 'album' ? String(raw.record_type) : '',
      };
    });
  };

  const fetchAllArtistAlbums = async (artist: WatchedArtistRecord) => {
    // Deezer artists take the adapter above; Qobuz keeps its paged path below,
    // untouched.
    if (artist.service === 'deezer') return fetchDeezerAlbumsFor(artist);

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
    const qualityProfile = readQualityProfile(conf);
    const libraryTokens = await collectFilesystemTokens(getQobuzPath(), qualityProfile.cutoff === 'hires');
    const nextCandidates: WatchlistCandidateRecord[] = [];

    // Which release kinds the user wants collected at all. Anything else is
    // still recorded, but flagged so it never reaches the wanted list or an
    // automatic download.
    const allowedTypes = new Set<ReleaseType>(
      Array.isArray(state.releaseTypes) && state.releaseTypes.length > 0 ? state.releaseTypes : DEFAULT_RELEASE_TYPES,
    );

    albums.forEach((album) => {
      const title = String(album?.title || album?.name || 'Unknown Album');
      const rawArtist = album?.artist?.name || artist.name;
      const releaseType = classifyReleaseType(album);
      const normalizedTitle = normalizeWatchlistText(stripEditionMarkers(title));
      const normalizedKey = buildAlbumKey(rawArtist, title);
      // Match legacy-format entries too, so shipping the improved key does not
      // resurface everything already downloaded.
      const legacyKey = buildLegacyAlbumKey(rawArtist, title);

      let reason: WatchlistCandidateRecord['reason'] = 'new';
      let duplicateSource = '';
      const matchedKey = processedByKey.has(normalizedKey)
        ? normalizedKey
        : processedByKey.has(legacyKey)
        ? legacyKey
        : '';

      /*
       * What the library already holds, and whether the service can beat it.
       *
       * Checked before the duplicate branches so an album that is "already
       * processed" but sitting below the cutoff still surfaces as wanted —
       * that is the entire point of an upgrade cutoff, and the old flow
       * short-circuited on `already-processed` and never looked at quality.
       */
      const haveTier = libraryTokens.get(normalizedTitle) ?? null;
      const availableTier = bestAvailableTier('qobuz', album);
      const upgradable = needsUpgrade(haveTier, qualityProfile, availableTier);

      if (upgradable) {
        reason = 'new';
        duplicateSource = `upgrade:${haveTier}->${availableTier}`;
      } else if (matchedKey) {
        const processedReason = processedByKey.get(matchedKey)?.reason || 'history';
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
      } else if (!allowedTypes.has(releaseType)) {
        // Checked last so a genuine duplicate still reports as such — the more
        // specific explanation is the more useful one.
        reason = 'filtered-type';
        duplicateSource = releaseType;
      }

      nextCandidates.push({
        id: String(album.id),
        releaseType,
        artistId: String(artist.id),
        artist: String(album?.artist?.name || artist.name),
        title,
        year: album?.release_date_original ? new Date(album.release_date_original).getFullYear() : null,
        image: String(album?.image?.large || album?.image?.thumbnail || album?.image?.small || album?.cover || ''),
        /* The artist's service, not a constant. Stamping every candidate
         * 'qobuz' meant a watched Deezer artist produced Deezer album ids that
         * were then downloaded through Qobuz — which answers "No result
         * matching given argument" for every one of them. */
        service: normaliseService(artist.service),
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
        service: normaliseService((playlist as any)?.service),
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
    service: artist ? normaliseService(artist.service) : 'qobuz',
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
    const libraryTokens = await collectFilesystemTokens(getQobuzPath());
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
          service: normaliseService((trackItem as any).service),
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
              service: normaliseService(candidate.service),
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
          service: normaliseService(candidate.service),
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
      if (watchedArtist.service !== 'deezer') await ensureQobuzSearchReady();
      const albums = await fetchAllArtistAlbums(watchedArtist);
      // Snapshot the discography while we have it. Library reads this rather
      // than the candidate queue, which empties as releases are downloaded.
      recordDiscography(String(watchedArtist.id), albums);
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
    /* The candidate's own service. This was 'qobuz' regardless, and it is the
     * builder the Watchlist download button actually uses — so a correctly
     * tagged Deezer candidate still had its id sent to Qobuz, which answers
     * "No result matching given argument" for every one. */
    service: normaliseService(candidate.service),
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
            service: normaliseService(candidate.service),
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
            service: normaliseService(candidate.service),
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
            service: normaliseService(candidate.service),
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
      /*
       * `void schedulerTick()` discarded the promise. schedulerTick guards the
       * scan itself, but the work before that inner try — reading schedules —
       * is unprotected, and a throw there escaped as an unhandled rejection.
       * Because this runs on a timer, that took the server down with nobody
       * touching it, which is the worst version of the failure to diagnose.
       */
      schedulerTick().catch((error: any) => {
        console.error(`Watchlist scheduler tick failed: ${error?.message || error}`);
      });
    }, SCHEDULER_TICK_MS);
  };

  startScheduler();

  return {
    loadAvailableGenres,
    getState,
    getLibraryOverview,
    getFavoriteGenres,
    getMonitorSchedules,
    getMonitorHistory,
    saveMonitorSchedule,
    runMonitorNow,
    saveFavoriteGenres,
    getReleaseTypes,
    saveReleaseTypes,
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
