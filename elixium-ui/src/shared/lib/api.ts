import axios from 'axios';
import {useQuery, useMutation, useInfiniteQuery} from '@tanstack/react-query';
import type {Service, RawSearchResult, RawDiscoveryItem, ItemTracksResponse} from '@/types';
import {getToken, notifyAuthRequired, withToken} from './auth-token';

export const http = axios.create({baseURL: '/api', timeout: 30000});

// Attach the API token when this browser has one. Loopback is exempt server
// side, so on the host machine there is no token and nothing is added.
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set('X-Elixium-Token', token);
  return config;
});

http.interceptors.response.use(
  (r) => r,
  (e) => {
    // Surface a refusal distinctly so the UI can ask for a token rather than
    // reporting a generic failure the user cannot act on.
    if (e.response?.status === 401) {
      notifyAuthRequired();
      return Promise.reject(new Error('auth_required'));
    }
    /*
     * Legacy /api routes send `{error: "text"}`; /api/v1 sends the envelope
     * `{error: {code, message, details}}`. Reading only the first shape turned
     * a versioned error into "[object Object]" — no use to anyone reading it.
     */
    const payload = e.response?.data?.error;
    const message = typeof payload === 'string' ? payload : (payload?.message ?? e.message ?? 'Request failed');
    return Promise.reject(new Error(message));
  },
);

// ── Stream URL constructor ────────────────────────────────────────────────────
/**
 * URL for the backend audio streaming endpoint.
 *
 * Targets v1 rather than the legacy /api/stream: v1 serves Deezer tracks from
 * a decrypted-buffer cache (so seeking does not re-download the track) and
 * reports whether the audio is the real thing via X-Elixium-Stream.
 */
export function getStreamUrl(id: string, service: Service, quality?: string): string {
  const q = quality ?? (service === 'deezer' ? 'flac' : '44khz');
  // withToken because an <audio> element cannot set headers; a no-op on
  // loopback, where no token is stored.
  return withToken(`/api/v1/tracks/${encodeURIComponent(id)}/stream?service=${service}&quality=${q}`);
}

export type StreamKind = 'full' | 'preview' | 'unknown';

/**
 * Ask the server whether a track will stream in full, using a HEAD request so
 * no audio is transferred.
 *
 * An <audio> element gives no access to response headers, so the only way for
 * the UI to distinguish a real track from Deezer's silent 30-second preview
 * fallback is to ask separately.
 */
export async function probeStreamKind(id: string, service: Service, quality?: string): Promise<StreamKind> {
  try {
    const res = await fetch(getStreamUrl(id, service, quality), {method: 'HEAD'});
    const kind = res.headers.get('X-Elixium-Stream');
    return kind === 'full' || kind === 'preview' ? kind : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Discovery ────────────────────────────────────────────────────────────────
export function useDiscovery(service: Service, type: string, enabled = true) {
  return useQuery<RawDiscoveryItem[]>({
    queryKey: ['discovery', service, type],
    queryFn: async () => {
      /* YouTube Music has its own feeds; the generic endpoint knows only
         Deezer and Qobuz and silently answered with Deezer's. */
      const path = service === 'ytmusic' ? '/ytmusic/discovery' : '/discovery';
      const res = await http.get(path, {params: {service, type, limit: 18}});
      return (res.data?.items ?? res.data ?? []) as RawDiscoveryItem[];
    },
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

// ── Search ───────────────────────────────────────────────────────────────────
export function useSearch(query: string, service: Service, type: string) {
  return useQuery<RawSearchResult[]>({
    queryKey: ['search', service, type, query],
    queryFn: async () => {
      if (!query || query.trim().length < 2) return [];
      const res = await http.post('/search', {query: query.trim(), service, type, limit: 50});
      return (Array.isArray(res.data) ? res.data : res.data?.results ?? []) as RawSearchResult[];
    },
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 2,
  });
}

/** How many results one page of search asks for. */
export const SEARCH_PAGE_SIZE = 50;

/**
 * Search, one page at a time.
 *
 * The catalog APIs cap a response at a page, so a search stopped dead at 50
 * results with no way to reach the rest. Both services take an offset, so the
 * pages simply continue from where the last one ended.
 *
 * A short page means the end of the catalog: neither service reports a total,
 * so running out is the only reliable signal that there is nothing more.
 */
/*
 * Cursors for YouTube Music's paged endpoints.
 *
 * Deezer and Qobuz page by a number, which `useInfiniteQuery` carries for free
 * as the page parameter. YouTube pages by an opaque token that only the
 * previous response knows — and a page here is an array, so consumers can keep
 * calling `.flat()` on it, which leaves nowhere to put the token.
 *
 * So it is kept beside the query instead. Entries are overwritten as paging
 * advances and mean nothing once a search changes, which is why none are
 * pruned.
 */
const ytCursors = new Map<string, string | null>();

export function useSearchPages(query: string, service: Service, type: string) {
  return useInfiniteQuery<RawSearchResult[]>({
    queryKey: ['search', service, type, query],
    initialPageParam: 0,
    queryFn: async ({pageParam}) => {
      if (!query || query.trim().length < 2) return [];

      /*
       * YouTube Music pages by cursor, not by offset.
       *
       * Asking it for an offset returns the first rows again, so each response
       * carries a token for the next page and that token is what gets sent
       * back. The response is `{items, cursor}` rather than a bare array.
       */
      if (service === 'ytmusic') {
        const key = `search:${type}:${query.trim()}`;
        const page = pageParam as number;
        const cursor = page === 0 ? undefined : ytCursors.get(`${key}:${page}`);
        // A later page with no stored token means the results ran out.
        if (page > 0 && !cursor) return [];

        const yt = await http.get('/ytmusic/search', {
          params: {q: query.trim(), type, limit: SEARCH_PAGE_SIZE, ...(cursor ? {cursor} : {})},
        });
        const items = (yt.data?.items ?? []) as RawSearchResult[];
        ytCursors.set(`${key}:${page + 1}`, yt.data?.cursor ?? null);
        return items;
      }

      const res = await http.post('/search', {
        query: query.trim(),
        service,
        type,
        limit: SEARCH_PAGE_SIZE,
        offset: pageParam as number,
      });
      return (Array.isArray(res.data) ? res.data : res.data?.results ?? []) as RawSearchResult[];
    },
    getNextPageParam: (lastPage, allPages) => {
      /* For YouTube there is another page exactly when a token came back. */
      if (service === 'ytmusic') {
        return ytCursors.get(`search:${type}:${query.trim()}:${allPages.length}`) ? allPages.length : undefined;
      }
      return lastPage.length < SEARCH_PAGE_SIZE ? undefined : allPages.length * SEARCH_PAGE_SIZE;
    },
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 2,
  });
}

// ── Artist content ───────────────────────────────────────────────────────────
export type ArtistContentKind = 'albums' | 'tracks' | 'playlists';

/** Page size per artist tab; albums and playlists are grids, tracks a list. */
const ARTIST_PAGE_SIZE: Record<ArtistContentKind, number> = {albums: 30, tracks: 50, playlists: 30};

/**
 * One artist's albums, top tracks or related playlists, paged.
 *
 * The artist view used to show top tracks only, so there was no route from an
 * artist to their discography — the albums endpoint existed on the server and
 * nothing called it.
 */
export function useArtistContent(
  kind: ArtistContentKind,
  artistId: string,
  service: Service,
  artistName?: string,
  enabled = true,
) {
  const limit = ARTIST_PAGE_SIZE[kind];

  return useInfiniteQuery<RawSearchResult[]>({
    queryKey: ['artist-content', service, kind, artistId],
    initialPageParam: 0,
    queryFn: async ({pageParam}) => {
      /*
       * One request for the whole tab.
       *
       * The artist page shows ten of each kind and hides the rest behind a
       * "more" link. The server follows those, so everything arrives at once
       * and there is nothing left to page through.
       *
       * Albums went from ten to fifty this way, and playlists from none at all
       * — the tab returned an empty array whatever the artist had, while the
       * albums grid was showing those same playlists as though they were
       * records. Tracks are topped up from a search, because YouTube publishes
       * only five top songs and no link to more.
       */
      if (service === 'ytmusic') {
        if ((pageParam as number) > 0) return [];
        const {data} = await http.get('/ytmusic/artist-content', {params: {id: artistId, kind}});
        return (Array.isArray(data) ? data : []) as RawSearchResult[];
      }

      const res = await http.get('/artist-content', {
        params: {service, artistId, kind, artistName, limit, offset: pageParam as number},
      });
      return (Array.isArray(res.data) ? res.data : []) as RawSearchResult[];
    },
    getNextPageParam: (lastPage, allPages) => (lastPage.length < limit ? undefined : allPages.length * limit),
    enabled: !!artistId && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Album tracks ─────────────────────────────────────────────────────────────
export type ItemType = 'album' | 'artist' | 'playlist';

const ITEM_DEFAULTS: Record<ItemType, {limit: number; staleTime: number}> = {
  album: {limit: 100, staleTime: 1000 * 60 * 10},
  artist: {limit: 30, staleTime: 1000 * 60 * 5},
  playlist: {limit: 100, staleTime: 1000 * 60 * 5},
};

/**
 * Expand any catalog item into its track/album list.
 *
 * The three per-type hooks below were byte-for-byte identical apart from the
 * itemType and limit, which meant a component could only show the types
 * someone had already written a hook for. Taking the type as an argument lets
 * one modal render all three.
 */
export function useItemTracks(itemType: ItemType, id: string, service: Service, enabled = true) {
  const {limit, staleTime} = ITEM_DEFAULTS[itemType];

  return useQuery<ItemTracksResponse>({
    queryKey: ['item-tracks', service, itemType, id],
    queryFn: async () => {
      /*
       * YouTube Music is addressed by browse id, not by the numeric ids the
       * other services use, and `/item-tracks` knows nothing about it — so
       * every YouTube album, playlist and artist opened to an empty modal
       * that had quietly asked Qobuz for it.
       */
      if (service === 'ytmusic') {
        if (itemType === 'artist') {
          const {data} = await http.get('/ytmusic/artist', {params: {id}});
          return {
            service,
            itemType,
            id,
            tracks: (data?.topTracks ?? []) as ItemTracksResponse['tracks'],
            metadata: {title: data?.name, artist: data?.name, cover: data?.cover},
          } as ItemTracksResponse;
        }

        const endpoint = itemType === 'playlist' ? '/ytmusic/playlist' : '/ytmusic/album';
        const {data} = await http.get(endpoint, {params: {id}});
        return {
          service,
          itemType,
          id,
          tracks: (data?.tracks ?? []) as ItemTracksResponse['tracks'],
          metadata: {
            title: data?.title,
            artist: data?.artist,
            cover: data?.cover,
            release_date: data?.year ? String(data.year) : undefined,
          },
        } as ItemTracksResponse;
      }

      const res = await http.get('/item-tracks', {params: {service, itemType, id, limit}});
      return res.data as ItemTracksResponse;
    },
    enabled: !!id && enabled,
    staleTime,
  });
}

export const useAlbumTracks = (albumId: string, service: Service, enabled = true) =>
  useItemTracks('album', albumId, service, enabled);

/**
 * An artist expands to their TOP TRACKS, not their albums — both services
 * return tracks for this item type. Named accordingly; the previous
 * `useArtistAlbums` caused the artist view to render tracks as album cards.
 */
export const useArtistTopTracks = (artistId: string, service: Service, enabled = true) =>
  useItemTracks('artist', artistId, service, enabled);

export const usePlaylistTracks = (playlistId: string, service: Service, enabled = true) =>
  useItemTracks('playlist', playlistId, service, enabled);

// ── URL parse (via REST — more reliable than socket for one-shot calls) ──────
/**
 * Resolves a share link to a track list.
 *
 * Targets /api/v1 explicitly: the unversioned surface has no parse-url route,
 * so this previously posted to an endpoint that did not exist and 404'd.
 */
export function useParseUrl() {
  return useMutation({
    mutationFn: async (payload: string | {url: string; service?: Service}) => {
      const body = typeof payload === 'string' ? {url: payload} : payload;
      const res = await http.post('/v1/parse-url', body);
      // v1 wraps every response in {ok, data}; unwrap to the parsed link.
      return res.data?.data ?? res.data;
    },
  });
}

// ── Lyrics ──────────────────────────────────────────────────────────────────
export interface SyncedLine {
  timeMs: number;
  durationMs: number;
  text: string;
}

export interface LyricsResult {
  text: string;
  synced: SyncedLine[];
  writers: string | null;
  copyright: string | null;
}

/**
 * Lyrics for a track.
 *
 * 404 is an expected outcome (many tracks simply have none), so it is not
 * retried and the caller renders an empty state rather than an error.
 */
/**
 * YouTube Music's own front page, shelf by shelf.
 *
 * Deezer and Qobuz are asked for named editorial feeds — trending, new
 * releases, best sellers — because that is how those services publish. YouTube
 * Music names its own rows instead, and two of the fixed names resolved to the
 * same feed, so the page showed one set of cards twice under different
 * headings. These are the rows its website shows.
 *
 * One request for the whole page: every row comes out of the same few browse
 * calls, so fetching per row would repeat the work.
 */
export function useYtMusicShelves(enabled = true) {
  return useQuery<{title: string; items: RawSearchResult[]}[]>({
    queryKey: ['ytmusic', 'shelves'],
    queryFn: async () => {
      const res = await http.get('/ytmusic/shelves');
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled,
    staleTime: 1000 * 60 * 10,
  });
}

export function useLyrics(
  id: string | undefined,
  service: Service | undefined,
  enabled = true,
  /*
   * YouTube tracks are identified by a video id, which no lyrics database
   * knows. The name is what a fallback search needs, and only the caller has
   * it — Deezer and Qobuz look theirs up server-side from the track id.
   */
  track?: {artist?: string; title?: string},
) {
  return useQuery<LyricsResult | null>({
    queryKey: ['lyrics', service, id],
    queryFn: async () => {
      const res = await http.get(`/v1/tracks/${encodeURIComponent(id!)}/lyrics`, {
        params: {
          service,
          ...(service === 'ytmusic' ? {artist: track?.artist ?? '', title: track?.title ?? ''} : {}),
        },
      });
      return (res.data?.data ?? null) as LyricsResult | null;
    },
    enabled: Boolean(id && service) && enabled,
    retry: false,
    staleTime: 1000 * 60 * 30,
  });
}

// ── Service credential verification ─────────────────────────────────────────
export interface VerifyResult {
  service: Service;
  ok: boolean;
  account?: string | null;
  reason?: string;
  message: string;
}

/**
 * Exercise a service's stored credentials.
 *
 * /health reports whether a credential is *present*, which stays true for an
 * expired Deezer ARL — the cause of silent 30-second previews and missing
 * lyrics. This performs a real authenticated call and reports what happened.
 */
export function useVerifyService() {
  return useMutation<VerifyResult, Error, Service>({
    mutationFn: async (service: Service) => {
      const res = await http.post(`/v1/services/${service}/verify`);
      return (res.data?.data ?? res.data) as VerifyResult;
    },
  });
}

// ── Charts ───────────────────────────────────────────────────────────────────
export type ChartKind = 'tracks' | 'albums' | 'artists' | 'playlists';
export interface ChartGenre {
  id: string;
  name: string;
  picture?: string;
}

export function useChartGenres(service: Service) {
  return useQuery<ChartGenre[]>({
    queryKey: ['chart-genres', service],
    queryFn: async () => (await http.get('/charts/genres', {params: {service}})).data as ChartGenre[],
    staleTime: 1000 * 60 * 60,
  });
}

const CHART_PAGE_SIZE = 50;

export interface ChartCountry {
  id: string;
  name: string;
  picture?: string;
  trackCount?: number;
}

/** Official per-country charts, the way deemix lists them. */
export function useChartCountries(enabled = true) {
  return useQuery<ChartCountry[]>({
    queryKey: ['chart-countries'],
    queryFn: async () => (await http.get('/charts/countries')).data as ChartCountry[],
    staleTime: 1000 * 60 * 60,
    enabled,
  });
}

export function useCountryChart(playlistId: string, enabled = true) {
  return useInfiniteQuery<RawSearchResult[]>({
    queryKey: ['country-chart', playlistId],
    initialPageParam: 0,
    queryFn: async ({pageParam}) => {
      const res = await http.get('/charts/country', {
        params: {playlistId, limit: CHART_PAGE_SIZE, offset: pageParam as number},
      });
      return (Array.isArray(res.data) ? res.data : []) as RawSearchResult[];
    },
    getNextPageParam: (last, all) => (last.length < CHART_PAGE_SIZE ? undefined : all.length * CHART_PAGE_SIZE),
    enabled: Boolean(playlistId) && enabled,
    staleTime: 1000 * 60 * 10,
  });
}

export interface ArtistInfo {
  id: string;
  name: string;
  picture: string;
}

/**
 * An artist's picture, for views that arrived without one.
 *
 * A track or album row carries the artist's id and name but no artwork, so an
 * artist opened from one showed an empty circle while the same artist opened
 * from a search showed their photograph.
 */
export function useArtistInfo(artistId: string, service: Service, enabled = true) {
  return useQuery<ArtistInfo>({
    queryKey: ['artist-info', service, artistId],
    queryFn: async () => (await http.get('/artist-info', {params: {service, artistId}})).data as ArtistInfo,
    enabled: enabled && Boolean(artistId),
    staleTime: 1000 * 60 * 60,
  });
}

/**
 * The genres a service publishes, for the Genres page.
 *
 * Not useChartGenres: for Qobuz that returns featured types — best sellers,
 * press awards — which are how Qobuz charts, not genres, and asking the
 * catalogue for "the best-sellers genre" is why that page was empty.
 */
export function useGenres(service: Service) {
  return useQuery<ChartGenre[]>({
    queryKey: ['genres', service],
    queryFn: async () => {
      /* Same story: picking YouTube Music used to show Deezer's genre list. */
      if (service === 'ytmusic') {
        const {data} = await http.get('/ytmusic/genres');
        return (Array.isArray(data) ? data : []).map((g: {id: string; name: string}) => ({
          id: g.id,
          name: g.name,
        })) as ChartGenre[];
      }
      return (await http.get('/genres', {params: {service}})).data as ChartGenre[];
    },
    staleTime: 1000 * 60 * 60,
  });
}

export type GenreKind = 'albums' | 'tracks' | 'artists' | 'playlists';

const GENRE_PAGE_SIZE = 50;

/**
 * A genre's own content, which is not the same thing as its chart.
 *
 * Deezer's per-genre artist endpoints return the global top artists whatever
 * genre is asked for — Reggae answered with Taylor Swift — and its per-genre
 * album chart holds about four records. The server assembles this from the
 * sources that do respect the genre instead.
 */
export function useGenreContent(service: Service, genreId: string, kind: GenreKind, enabled = true) {
  return useInfiniteQuery<RawSearchResult[]>({
    queryKey: ['genre-content', service, genreId, kind],
    initialPageParam: 0,
    queryFn: async ({pageParam}) => {
      /*
       * YouTube Music has its own genre pages, and the shared endpoint has no
       * branch for it — a YouTube genre id sent there was handed to Deezer's
       * catalogue, which returned whatever it made of an opaque blob. The
       * genre list was YouTube's and the contents were somebody else's.
       *
       * The page arrives whole, so there is nothing after the first.
       */
      if (service === 'ytmusic') {
        if ((pageParam as number) > 0) return [];
        const {data} = await http.get('/ytmusic/genre-content', {params: {id: genreId, kind}});
        return (Array.isArray(data) ? data : []) as RawSearchResult[];
      }

      const res = await http.get('/genre-content', {
        params: {service, genreId, kind, limit: GENRE_PAGE_SIZE, offset: pageParam as number},
      });
      return (Array.isArray(res.data) ? res.data : []) as RawSearchResult[];
    },
    getNextPageParam: (last, all) => (last.length < GENRE_PAGE_SIZE ? undefined : all.length * GENRE_PAGE_SIZE),
    enabled: enabled && Boolean(genreId),
    staleTime: 1000 * 60 * 15,
  });
}

export function useCharts(service: Service, genreId: string, kind: ChartKind) {
  return useInfiniteQuery<RawSearchResult[]>({
    queryKey: ['charts', service, genreId, kind],
    initialPageParam: 0,
    queryFn: async ({pageParam}) => {
      const res = await http.get('/charts', {
        params: {service, genreId, kind, limit: CHART_PAGE_SIZE, offset: pageParam as number},
      });
      return (Array.isArray(res.data) ? res.data : []) as RawSearchResult[];
    },
    getNextPageParam: (last, all) => (last.length < CHART_PAGE_SIZE ? undefined : all.length * CHART_PAGE_SIZE),
    staleTime: 1000 * 60 * 10,
  });
}

// ── Playlist search across services ──────────────────────────────────────────
export type PlaylistSearchService = 'deezer' | 'qobuz' | 'spotify';

/** A playlist result carries the share URL, which is what downloads take. */
export interface PlaylistResult extends RawSearchResult {
  url?: string;
  sourceService?: PlaylistSearchService;
}

export function usePlaylistSearch(service: PlaylistSearchService, query: string) {
  return useInfiniteQuery<PlaylistResult[]>({
    queryKey: ['playlist-search', service, query],
    initialPageParam: 0,
    queryFn: async ({pageParam}) => {
      if (query.trim().length < 2) return [];
      const res = await http.get('/playlist-search', {
        params: {service, query: query.trim(), limit: 30, offset: pageParam as number},
      });
      return (Array.isArray(res.data) ? res.data : []) as PlaylistResult[];
    },
    getNextPageParam: (last, all) => (last.length < 30 ? undefined : all.length * 30),
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Favorites ────────────────────────────────────────────────────────────────
export interface FavoriteRecord {
  id: string;
  type: 'track' | 'album' | 'artist' | 'playlist';
  service: Service;
  title: string;
  artist?: string;
  cover?: string;
  duration?: string;
  addedAt: number;
}

export function useFavorites(type?: FavoriteRecord['type']) {
  return useQuery<FavoriteRecord[]>({
    queryKey: ['favorites', type ?? 'all'],
    queryFn: async () => (await http.get('/favorites', {params: {type}})).data as FavoriteRecord[],
    staleTime: 1000 * 10,
  });
}

export function useToggleFavorite() {
  return useMutation({
    mutationFn: async (record: Omit<FavoriteRecord, 'addedAt'>) =>
      (await http.post('/favorites/toggle', record)).data as {favorited: boolean; favorites: FavoriteRecord[]},
  });
}

export function useClearFavorites() {
  return useMutation({mutationFn: async () => (await http.delete('/favorites')).data as FavoriteRecord[]});
}

// ── Server log ───────────────────────────────────────────────────────────────
export interface LogEntry {
  seq: number;
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export function useLogBacklog() {
  return useQuery<LogEntry[]>({
    queryKey: ['logs'],
    queryFn: async () => (await http.get('/logs')).data as LogEntry[],
    // The socket delivers new lines; this is only the history on first paint.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useClearLogs() {
  return useMutation({mutationFn: async () => (await http.delete('/logs')).data as LogEntry[]});
}
