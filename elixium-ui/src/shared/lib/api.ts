import axios from 'axios';
import {useQuery, useMutation} from '@tanstack/react-query';
import type {Service, RawSearchResult, RawDiscoveryItem, ItemTracksResponse} from '@/types';

export const http = axios.create({baseURL: '/api', timeout: 30000});

http.interceptors.response.use(
  (r) => r,
  (e) => Promise.reject(new Error(e.response?.data?.error ?? e.message ?? 'Request failed')),
);

// ── Stream URL constructor ────────────────────────────────────────────────────
/** Constructs the URL for the backend audio streaming endpoint */
export function getStreamUrl(id: string, service: Service, quality?: string): string {
  const q = quality ?? (service === 'deezer' ? 'flac' : '44khz');
  return `/api/stream?service=${service}&id=${encodeURIComponent(id)}&quality=${q}`;
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
export function useAlbumTracks(albumId: string, service: Service, enabled = true) {
  return useQuery<ItemTracksResponse>({
    queryKey: ['item-tracks', service, 'album', albumId],
    queryFn: async () => {
      const res = await http.get('/item-tracks', {
        params: {service, itemType: 'album', id: albumId, limit: 100},
      });
      return res.data as ItemTracksResponse;
    },
    enabled: !!albumId && enabled,
    staleTime: 1000 * 60 * 10,
  });
}

// ── Artist albums ─────────────────────────────────────────────────────────────
export function useArtistAlbums(artistId: string, service: Service, enabled = true) {
  return useQuery<ItemTracksResponse>({
    queryKey: ['item-tracks', service, 'artist', artistId],
    queryFn: async () => {
      const res = await http.get('/item-tracks', {
        params: {service, itemType: 'artist', id: artistId, limit: 30},
      });
      return res.data as ItemTracksResponse;
    },
    enabled: !!artistId && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Playlist tracks ─────────────────────────────────────────────────────────
export function usePlaylistTracks(playlistId: string, service: Service, enabled = true) {
  return useQuery<ItemTracksResponse>({
    queryKey: ['item-tracks', service, 'playlist', playlistId],
    queryFn: async () => {
      const res = await http.get('/item-tracks', {
        params: {service, itemType: 'playlist', id: playlistId, limit: 100},
      });
      return res.data as ItemTracksResponse;
    },
    enabled: !!playlistId && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

// ── URL parse (via REST — more reliable than socket for one-shot calls) ──────
export function useParseUrl() {
  return useMutation({
    mutationFn: async (url: string) => {
      const res = await http.post('/parse-url', {url});
      return res.data;
    },
  });
}
