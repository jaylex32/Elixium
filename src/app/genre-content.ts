import {formatSecondsReadable} from '../lib/util';
import type {SearchResult} from './interactive-types';

/**
 * Everything a genre page shows, assembled from the endpoints that actually
 * respect the genre.
 *
 * This page used to read Deezer's chart endpoints for all four kinds, which is
 * wrong in two ways that were plainly visible: `/chart/{genre}/artists` and
 * `/genre/{genre}/artists` both ignore the genre entirely and return the global
 * top artists — asking for Reggae produced Taylor Swift and Drake — and
 * `/chart/{genre}/albums` holds about four records, so the shelf looked empty.
 *
 * What each kind is built from, and why:
 *
 *  - tracks    the genre's radio stations. A radio is a curated stream of that
 *              genre and returns real depth, unlike the four-item chart.
 *  - artists   derived from those tracks and from the editorial selection.
 *              Deezer publishes no working per-genre artist list, so the
 *              artists are the ones actually making the genre's music rather
 *              than whoever is globally popular this week.
 *  - albums    the chart, the editorial selection and the albums those radio
 *              tracks come from, combined.
 *  - playlists the chart, which is genre-correct and well curated.
 */

export type GenreKind = 'albums' | 'tracks' | 'artists' | 'playlists';

interface GenreContentDependencies {
  makeHttpRequest: (url: string) => Promise<any>;
  qobuz: any;
  ensureQobuzSearchReady: () => Promise<void>;
}

const API = 'https://api.deezer.com';

/** Assembling a genre costs several requests, so the result is kept a while. */
const CACHE_TTL_MS = 30 * 60 * 1000;
/*
 * A thin result is almost always a request that failed, not a genre with
 * nothing in it, so it is kept only briefly and retried.
 *
 * Reggaeton demonstrated this: its radio lookup failed once under a burst of
 * requests, leaving six albums where every other genre had a hundred — and the
 * full-length cache then served that for half an hour.
 */
const THIN_TTL_MS = 60 * 1000;
const THIN_RESULT = 12;
const cache = new Map<string, {at: number; items: SearchResult[]}>();

/** Radios to draw on. Three is deep enough to fill a page without dawdling. */
const RADIOS_PER_GENRE = 3;
const TRACKS_PER_RADIO = 100;
/** Editorial playlists, for the genres Deezer runs no radio for. */
const PLAYLISTS_PER_GENRE = 4;
const TRACKS_PER_PLAYLIST = 100;

const coverOf = (item: any): string | undefined =>
  item?.cover_medium || item?.cover_big || item?.cover || item?.picture_medium || item?.picture_big || item?.picture;

const toYear = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
};

const trackResult = (track: any): SearchResult => ({
  id: String(track.id),
  title: String(track.title || '') + (track.title_version ? ` ${track.title_version}` : ''),
  artist: track.artist?.name || 'Unknown Artist',
  album: track.album?.title || '',
  type: 'track',
  duration: formatSecondsReadable(Number(track.duration || 0)),
  rawData: track,
});

const albumResult = (album: any, artistName?: string): SearchResult => ({
  id: String(album.id),
  title: String(album.title || ''),
  artist: album.artist?.name || artistName || 'Unknown Artist',
  album: String(album.title || ''),
  type: 'album',
  duration: '',
  year: toYear(album.release_date),
  rawData: album,
});

const artistResult = (artist: any): SearchResult => ({
  id: String(artist.id),
  title: String(artist.name || ''),
  artist: String(artist.name || ''),
  album: '',
  type: 'artist',
  duration: '',
  rawData: artist,
});

const playlistResult = (playlist: any): SearchResult => ({
  id: String(playlist.id),
  title: String(playlist.title || ''),
  artist: playlist.user?.name || 'Deezer',
  album: '',
  type: 'playlist',
  duration: playlist.nb_tracks ? `${playlist.nb_tracks} tracks` : '',
  rawData: playlist,
});

/** First occurrence wins, so the better-curated source stays at the front. */
const dedupe = (items: SearchResult[]): SearchResult[] => {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
};

export const createGenreContent = ({makeHttpRequest, qobuz, ensureQobuzSearchReady}: GenreContentDependencies) => {
  /** Every track the genre's radios are playing. */
  const radioTracks = async (genreId: string, attempt = 0): Promise<any[]> => {
    const radios = await makeHttpRequest(`${API}/genre/${encodeURIComponent(genreId)}/radios`).catch(() => null);
    const ids = ((radios?.data as any[]) || []).slice(0, RADIOS_PER_GENRE).map((radio: any) => radio.id);
    if (ids.length === 0) return [];

    const batches = await Promise.all(
      ids.map((id: any) =>
        makeHttpRequest(`${API}/radio/${encodeURIComponent(String(id))}/tracks?limit=${TRACKS_PER_RADIO}`).catch(
          () => null,
        ),
      ),
    );
    const tracks = batches.flatMap((batch) => (batch?.data as any[]) || []);

    /*
     * One retry when every batch came back empty.
     *
     * These fire together, so a burst can have them all rate-limited at once —
     * and the result is a genre that looks bare rather than one that failed.
     */
    if (tracks.length === 0 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return radioTracks(genreId, 1);
    }
    return tracks;
  };

  /**
   * The genre's editorial playlists, as tracks.
   *
   * Not every genre has radios — Deezer runs none for Reggaeton, which left it
   * showing six albums while Reggae showed a hundred. Its playlists are
   * curated by the same editors and carry the same music, so they stand in.
   */
  const playlistTracks = async (genreId: string): Promise<any[]> => {
    const playlists = await makeHttpRequest(
      `${API}/chart/${encodeURIComponent(genreId)}/playlists?limit=${PLAYLISTS_PER_GENRE}`,
    ).catch(() => null);

    const ids = ((playlists?.data as any[]) || []).slice(0, PLAYLISTS_PER_GENRE).map((playlist: any) => playlist.id);
    if (ids.length === 0) return [];

    const batches = await Promise.all(
      ids.map((id: any) =>
        makeHttpRequest(`${API}/playlist/${encodeURIComponent(String(id))}/tracks?limit=${TRACKS_PER_PLAYLIST}`).catch(
          () => null,
        ),
      ),
    );
    return batches.flatMap((batch) => (batch?.data as any[]) || []);
  };

  /** Whatever the genre actually has: its radios, else its playlists. */
  const depthTracks = async (genreId: string): Promise<any[]> => {
    const fromRadios = await radioTracks(genreId);
    if (fromRadios.length > 0) return fromRadios;
    return playlistTracks(genreId);
  };

  const buildDeezer = async (genreId: string, kind: GenreKind): Promise<SearchResult[]> => {
    if (kind === 'playlists') {
      const chart = await makeHttpRequest(`${API}/chart/${encodeURIComponent(genreId)}/playlists?limit=100`).catch(
        () => null,
      );
      return dedupe(((chart?.data as any[]) || []).map(playlistResult));
    }

    if (kind === 'tracks') {
      const [chart, radio] = await Promise.all([
        makeHttpRequest(`${API}/chart/${encodeURIComponent(genreId)}/tracks?limit=100`).catch(() => null),
        depthTracks(genreId),
      ]);
      return dedupe([...((chart?.data as any[]) || []).map(trackResult), ...radio.map(trackResult)]);
    }

    // Albums and artists share their sources, so they are gathered once.
    const [chartAlbums, selection, radio] = await Promise.all([
      makeHttpRequest(`${API}/chart/${encodeURIComponent(genreId)}/albums?limit=100`).catch(() => null),
      makeHttpRequest(`${API}/editorial/${encodeURIComponent(genreId)}/selection?limit=100`).catch(() => null),
      depthTracks(genreId),
    ]);

    const chartList = (chartAlbums?.data as any[]) || [];
    const selectionList = (selection?.data as any[]) || [];

    if (kind === 'albums') {
      // The albums those radio tracks belong to carry no artist of their own,
      // so the track's artist is passed alongside.
      const fromRadio = radio
        .filter((track: any) => track?.album?.id)
        .map((track: any) => albumResult(track.album, track.artist?.name));
      return dedupe([
        ...chartList.map((a) => albumResult(a)),
        ...selectionList.map((a) => albumResult(a)),
        ...fromRadio,
      ]);
    }

    // Artists, in the order they are most likely to be wanted: the ones
    // charting in the genre, then the editorial picks, then everyone the
    // radios play.
    const artists = [
      ...chartList.map((album: any) => album.artist).filter(Boolean),
      ...selectionList.map((album: any) => album.artist).filter(Boolean),
      ...radio.map((track: any) => track.artist).filter(Boolean),
    ];
    return dedupe(artists.filter((artist: any) => artist?.id).map(artistResult));
  };

  const buildQobuz = async (genreId: string, kind: GenreKind): Promise<SearchResult[]> => {
    // Qobuz publishes featured albums per genre and nothing else, so the other
    // three kinds are honestly empty rather than filled with something else.
    if (kind !== 'albums') return [];

    await ensureQobuzSearchReady();
    const response = await qobuz
      .qobuzRequest?.('album/getFeatured', {type: 'best-sellers', genre_id: genreId, limit: 100, offset: 0})
      .catch(() => null);

    return dedupe(
      ((response?.albums?.items as any[]) || []).map((album: any) => ({
        id: String(album.id),
        title: String(album.title || ''),
        artist: album.artist?.name || 'Unknown Artist',
        album: String(album.title || ''),
        type: 'album',
        duration: '',
        year: toYear(album.release_date_original),
        rawData: album,
      })),
    );
  };

  /**
   * One page of a genre.
   *
   * The whole list is assembled once and paged in memory: the sources are a
   * few hundred items at most, and paging them at the source would mean
   * re-running every request for each scroll.
   */
  const getGenreContent = async (
    service: string,
    genreId: string,
    kind: GenreKind,
    limit = 50,
    offset = 0,
  ): Promise<SearchResult[]> => {
    const key = `${service}:${genreId}:${kind}`;
    const cached = cache.get(key);

    const ttl = cached && cached.items.length <= THIN_RESULT ? THIN_TTL_MS : CACHE_TTL_MS;

    let items: SearchResult[];
    if (cached && Date.now() - cached.at < ttl) {
      items = cached.items;
    } else {
      items = service === 'qobuz' ? await buildQobuz(genreId, kind) : await buildDeezer(genreId, kind);
      if (cache.size > 60) cache.clear();
      cache.set(key, {at: Date.now(), items});
    }

    return items.slice(offset, offset + limit);
  };

  return {getGenreContent, coverOf};
};

export type GenreContent = ReturnType<typeof createGenreContent>;
