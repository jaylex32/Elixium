import axios from 'axios';
import {useQuery, useMutation} from '@tanstack/react-query';
import type {Service, RawSearchResult, RawDiscoveryItem, ItemTracksResponse} from '@/types';

export const http = axios.create({baseURL: '/api', timeout: 30000});

http.interceptors.response.use(
  (r) => r,
  (e) => Promise.reject(new Error(e.response?.data?.error ?? e.message ?? 'Request failed')),
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
  return `/api/v1/tracks/${encodeURIComponent(id)}/stream?service=${service}&quality=${q}`;
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
      const res = await http.get('/discovery', {
        params: {service, type, limit: 18},
      });
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
export function useLyrics(id: string | undefined, service: Service | undefined, enabled = true) {
  return useQuery<LyricsResult | null>({
    queryKey: ['lyrics', service, id],
    queryFn: async () => {
      const res = await http.get(`/v1/tracks/${encodeURIComponent(id!)}/lyrics`, {params: {service}});
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
