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

  /*
   * Qobuz genres, from Qobuz's own genre ids.
   *
   * This asked for one featured list and called it the genre, using an id that
   * was not a genre at all — the interface was handing it "best-sellers",
   * because the list it offered was Qobuz's five featured *types* dressed up as
   * genres. Qobuz does publish real genres, and filters both its featured
   * albums and its featured playlists by them.
   *
   * Albums come from several featured lists at once because each holds fifty:
   * best sellers alone is a thin shelf, and the four together are still the
   * same genre, ordered by how likely each is to be wanted.
   */
  const QOBUZ_ALBUM_FEEDS = ['best-sellers', 'new-releases', 'editor-picks', 'press-awards'];
  const QOBUZ_PLAYLISTS_FOR_TRACKS = 4;

  const qobuzRequest = (endpoint: string, params: Record<string, unknown>) =>
    (qobuz as any).qobuzRequest?.(endpoint, params).catch(() => null);

  const qobuzGenreAlbums = async (genreId: string): Promise<any[]> => {
    const responses = await Promise.all(
      QOBUZ_ALBUM_FEEDS.map((type) =>
        qobuzRequest('album/getFeatured', {type, genre_id: genreId, limit: 50, offset: 0}),
      ),
    );
    return responses.flatMap((response) => (response?.albums?.items as any[]) || []);
  };

  const qobuzGenrePlaylists = async (genreId: string): Promise<any[]> => {
    const response = await qobuzRequest('playlist/getFeatured', {
      type: 'editor-picks',
      genre_ids: genreId,
      limit: 50,
      offset: 0,
    });
    return (response?.playlists?.items as any[]) || [];
  };

  const buildQobuz = async (genreId: string, kind: GenreKind): Promise<SearchResult[]> => {
    await ensureQobuzSearchReady();

    if (kind === 'albums') {
      return dedupe(
        (await qobuzGenreAlbums(genreId)).map((album: any) => ({
          id: String(album.id),
          title: String(album.title || ''),
          artist: album.artist?.name || 'Unknown Artist',
          album: String(album.title || ''),
          type: 'album',
          duration: album.tracks_count ? `${album.tracks_count} tracks` : '',
          year: toYear(album.release_date_original),
          maximum_bit_depth: album.maximum_bit_depth,
          maximum_sampling_rate: album.maximum_sampling_rate,
          hires: album.hires,
          rawData: album,
        })),
      );
    }

    if (kind === 'artists') {
      // The artists making the genre's featured records, in that order.
      return dedupe(
        (await qobuzGenreAlbums(genreId))
          .map((album: any) => album?.artist)
          .filter((artist: any) => artist?.id)
          .map((artist: any) => ({
            id: String(artist.id),
            title: String(artist.name || ''),
            artist: String(artist.name || ''),
            album: '',
            type: 'artist',
            duration: '',
            rawData: artist,
          })),
      );
    }

    const playlists = await qobuzGenrePlaylists(genreId);

    if (kind === 'playlists') {
      return dedupe(
        playlists.map((playlist: any) => ({
          id: String(playlist.id),
          title: String(playlist.name || ''),
          artist: playlist.owner?.name || 'Qobuz',
          album: '',
          type: 'playlist',
          duration: playlist.tracks_count ? `${playlist.tracks_count} tracks` : '',
          rawData: playlist,
        })),
      );
    }

    /*
     * Tracks, from the genre's own editorial playlists.
     *
     * Qobuz has no track chart of any kind, per genre or otherwise, and its
     * editors' playlists for a genre are made of that genre's music — a
     * classical playlist returns classical recordings.
     */
    const batches = await Promise.all(
      playlists
        .slice(0, QOBUZ_PLAYLISTS_FOR_TRACKS)
        .map((playlist: any) =>
          qobuzRequest('playlist/get', {playlist_id: playlist.id, extra: 'tracks', limit: 100, offset: 0}),
        ),
    );

    return dedupe(
      batches
        .flatMap((batch) => (batch?.tracks?.items as any[]) || [])
        .map((track: any) => ({
          id: String(track.id),
          title: String(track.title || '') + (track.version ? ` (${track.version})` : ''),
          artist: track.performer?.name || track.album?.artist?.name || 'Unknown Artist',
          album: track.album?.title || '',
          type: 'track',
          duration: formatSecondsReadable(Number(track.duration || 0)),
          maximum_bit_depth: track.maximum_bit_depth,
          maximum_sampling_rate: track.maximum_sampling_rate,
          hires: track.hires,
          rawData: track,
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

  /**
   * The genres a service actually publishes.
   *
   * Separate from the Charts page's list on purpose: Qobuz charts by featured
   * type — best sellers, press awards — which are not genres, and offering
   * those as genres is what left this page asking for "the best-sellers genre".
   * Deezer's list is the one it already served, unchanged.
   */
  const getGenres = async (service: string): Promise<{id: string; name: string; picture?: string}[]> => {
    if (service === 'qobuz') {
      await ensureQobuzSearchReady();
      const response = await (qobuz as any).qobuzRequest?.('genre/list', {limit: 200, offset: 0}).catch(() => null);
      const items = (response?.genres?.items as any[]) || (response?.items as any[]) || [];
      return items
        .filter((genre: any) => genre?.id != null && genre?.name)
        .map((genre: any) => ({id: String(genre.id), name: String(genre.name)}));
    }

    const response = await makeHttpRequest(`${API}/genre`).catch(() => null);
    return ((response?.data as any[]) || [])
      .filter((genre: any) => String(genre.id) !== '0')
      .map((genre: any) => ({id: String(genre.id), name: String(genre.name), picture: genre.picture_medium}));
  };

  return {getGenreContent, getGenres, coverOf};
};

export type GenreContent = ReturnType<typeof createGenreContent>;
