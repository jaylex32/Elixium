import {formatSecondsReadable} from '../lib/util';
import type {SearchResult} from './interactive-types';

/**
 * An artist's albums, top tracks and related playlists.
 *
 * Lifted out of the socket handlers so the REST surface can serve the same
 * three lists. The artist view needs them behind a query cache with paging,
 * and a socket emit is a poor fit for that: the response carries no request
 * identity, so two tabs opened quickly cannot tell whose reply arrived.
 *
 * Every function returns the same result shape the catalog search produces, so
 * the client can render an artist's albums with the album card it already has.
 */

interface ArtistContentDependencies {
  deezer: any;
  qobuz: any;
  makeHttpRequest: (url: string) => Promise<any>;
  ensureQobuzSearchReady: () => Promise<void>;
}

export type ArtistContentKind = 'albums' | 'tracks' | 'playlists';

/** Normalise a release date to `YYYY-MM-DD`, ignoring unusable placeholders. */
const toReleaseDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toYear = (value: unknown): number | null => {
  const date = toReleaseDate(value);
  return date ? Number(date.slice(0, 4)) : null;
};

/**
 * Drop exact duplicates from a release list.
 *
 * Both services list the same record once per territory or per explicit/clean
 * variant, so an artist page showed the same album two or three times in a
 * row. Matching on title *and* release date keeps genuinely different
 * editions — a deluxe or a remaster carries its own title or its own date —
 * while collapsing the entries that differ only by an id.
 */
const dedupeReleases = (items: SearchResult[]): SearchResult[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title.toLowerCase()}|${item.releaseDate ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Human label for an album card's subtitle.
 *
 * Deezer's artist/albums endpoint carries no track count — only `record_type`
 * — so counting it produced "0 tracks" on every album. The record type is the
 * useful fact there anyway: it separates singles and EPs from albums.
 */
/*
 * Track counts for a Deezer discography, from the public API only.
 *
 * Deezer's /artist/{id}/albums carries no track count, and its private
 * discography endpoint does — but that endpoint runs on the same authenticated
 * session as downloads and playback, and its error path can swap that session
 * for an anonymous one. Trading a working download for a number on a card is
 * not a trade worth making, so the count comes from the public /album/{id}
 * instead: a different host, no session, nothing to corrupt.
 *
 * One request per album, capped, pooled and cached. If any of it fails or runs
 * long the cards simply show no count.
 */
const COUNT_TTL = 30 * 60 * 1000;
const COUNT_CONCURRENCY = 6;
/** Never let a cosmetic lookup hold the listing up. */
const COUNT_BUDGET_MS = 2500;

const albumTrackCounts = new Map<string, {at: number; count: number}>();

const publicTrackCounts = async (
  makeHttpRequest: (url: string) => Promise<any>,
  albumIds: string[],
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  const pending: string[] = [];

  for (const id of albumIds) {
    const cached = albumTrackCounts.get(id);
    if (cached && Date.now() - cached.at < COUNT_TTL) counts.set(id, cached.count);
    else pending.push(id);
  }
  if (pending.length === 0) return counts;

  const deadline = Date.now() + COUNT_BUDGET_MS;
  let cursor = 0;

  const worker = async () => {
    while (cursor < pending.length && Date.now() < deadline) {
      const id = pending[cursor++];
      try {
        const album = await makeHttpRequest(`https://api.deezer.com/album/${encodeURIComponent(id)}`);
        const count = Number(album?.nb_tracks || 0);
        if (count > 0) {
          counts.set(id, count);
          albumTrackCounts.set(id, {at: Date.now(), count});
        }
      } catch {
        // One album without a count costs that album a caption, nothing more.
      }
    }
  };

  await Promise.all(Array.from({length: Math.min(COUNT_CONCURRENCY, pending.length)}, worker));

  // Bounded so a long browsing session cannot grow this without limit.
  if (albumTrackCounts.size > 2000) albumTrackCounts.clear();
  return counts;
};

/** The bare number of tracks, for the card that shows it beside the year. */
const toTrackCount = (value: unknown): number | undefined => {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : undefined;
};

const releaseLabel = (recordType: unknown, trackCount: unknown): string => {
  const count = Number(trackCount || 0);
  if (count > 0) return `${count} track${count === 1 ? '' : 's'}`;
  const kind = String(recordType || '').trim();
  if (!kind) return '';
  return kind.toUpperCase() === 'EP' ? 'EP' : kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
};

export const createArtistContent = ({
  deezer,
  qobuz,
  makeHttpRequest,
  ensureQobuzSearchReady,
}: ArtistContentDependencies) => {
  /*
   * `artistName` is the artist whose page this is.
   *
   * Deezer's /artist/{id}/albums does not repeat the artist on each album — it
   * is implied by the request — so every album in a discography was labelled
   * "Unknown Artist". The caller already knows the name; it just was not being
   * passed down.
   */
  const getArtistAlbums = async (
    service: string,
    artistId: string,
    limit = 30,
    offset = 0,
    artistName?: string,
  ): Promise<SearchResult[]> => {
    const knownArtist = artistName && String(artistName).trim().length > 0 ? String(artistName).trim() : '';
    if (service === 'deezer') {
      const url = `https://api.deezer.com/artist/${encodeURIComponent(artistId)}/albums?limit=${Number(
        limit,
      )}&index=${Number(offset)}`;
      const response = await makeHttpRequest(url);
      const releases = (response && response.data) || [];
      const counts = await publicTrackCounts(
        makeHttpRequest,
        releases.map((album: any) => String(album.id)),
      );
      return dedupeReleases(
        releases.map((album: any) => ({
          id: String(album.id),
          title: album.title,
          artist: album.artist?.name || knownArtist || 'Unknown Artist',
          album: album.title,
          type: 'album',
          duration: releaseLabel(album.record_type, album.nb_tracks),
          trackCount: counts.get(String(album.id)) ?? toTrackCount(album.nb_tracks),
          year: toYear(album.release_date),
          releaseDate: toReleaseDate(album.release_date),
          rawData: album,
        })),
      );
    }

    if (service === 'qobuz') {
      await ensureQobuzSearchReady();
      const response = await (qobuz as any).qobuzRequest?.('artist/get', {
        artist_id: artistId,
        extra: 'albums',
        offset: Number(offset),
        limit: Number(limit),
      });
      return dedupeReleases(
        (response?.albums?.items || []).map((album: any) => ({
          id: String(album.id),
          title: album.title,
          artist: album.artist?.name || knownArtist || 'Unknown Artist',
          album: album.title,
          type: 'album',
          duration: releaseLabel(album.release_type, album.tracks_count),
          trackCount: toTrackCount(album.tracks_count),
          year: toYear(album.release_date_original),
          releaseDate: toReleaseDate(album.release_date_original),
          maximum_bit_depth: album.maximum_bit_depth,
          maximum_sampling_rate: album.maximum_sampling_rate,
          hires: album.hires,
          rawData: album,
        })),
      );
    }

    return [];
  };

  const getArtistTracks = async (
    service: string,
    artistId: string,
    limit = 50,
    offset = 0,
    artistName?: string,
  ): Promise<SearchResult[]> => {
    const knownArtist = artistName && String(artistName).trim().length > 0 ? String(artistName).trim() : '';
    if (service === 'deezer') {
      const url = `https://api.deezer.com/artist/${encodeURIComponent(artistId)}/top?limit=${Number(
        limit,
      )}&index=${Number(offset)}`;
      const response = await makeHttpRequest(url);
      return ((response && response.data) || []).map((track: any) => ({
        id: String(track.id),
        title: track.title + (track.version ? ` ${track.version}` : ''),
        artist: track.artist?.name || knownArtist || 'Unknown Artist',
        album: track.album?.title || '',
        type: 'track',
        duration: formatSecondsReadable(Number(track.duration || 0)),
        rawData: track,
      }));
    }

    if (service === 'qobuz') {
      await ensureQobuzSearchReady();
      const response = await (qobuz as any).qobuzRequest?.('artist/get', {
        artist_id: artistId,
        extra: 'tracks',
        offset: Number(offset),
        limit: Number(limit),
      });
      return (response?.tracks?.items || []).map((track: any) => ({
        id: String(track.id),
        title: track.title + (track.version ? ` (${track.version})` : ''),
        artist: track.performer?.name || knownArtist || 'Unknown Artist',
        album: track.album?.title || '',
        type: 'track',
        duration: formatSecondsReadable(Number(track.duration || 0)),
        rawData: track,
      }));
    }

    return [];
  };

  /**
   * Playlists connected to an artist.
   *
   * Neither service exposes "playlists by artist" as an endpoint, so this is a
   * playlist search on the artist's name — which is what the editorial and
   * user playlists featuring them are actually called. The name is required
   * for that reason; an id alone would search for a number.
   */
  const getArtistPlaylists = async (
    service: string,
    artistId: string,
    artistName?: string,
    limit = 30,
    offset = 0,
  ): Promise<SearchResult[]> => {
    const query = artistName && String(artistName).trim().length > 0 ? String(artistName) : String(artistId);

    if (service === 'deezer') {
      const result = await deezer.searchMusicPaged(query, 'PLAYLIST', Number(limit), Number(offset));
      return ((result as any)?.data || []).map((playlist: any) => ({
        id: String(playlist.PLAYLIST_ID || playlist.id),
        title: playlist.TITLE || playlist.title,
        artist: playlist.PARENT_USERNAME || playlist.user?.name || 'Deezer',
        album: 'Playlist',
        type: 'playlist',
        duration: `${playlist.NB_SONG || playlist.nb_tracks || 0} tracks`,
        rawData: playlist,
      }));
    }

    if (service === 'qobuz') {
      await ensureQobuzSearchReady();
      const result = await qobuz.searchMusic(query, 'playlist', Number(limit), Number(offset));
      return ((result as any).playlists?.items || []).map((playlist: any) => ({
        id: String(playlist.id),
        title: playlist.name,
        artist: playlist.owner?.name || 'Qobuz',
        album: 'Playlist',
        type: 'playlist',
        duration: `${playlist.tracks_count || 0} tracks`,
        rawData: playlist,
      }));
    }

    return [];
  };

  return {getArtistAlbums, getArtistTracks, getArtistPlaylists};
};

export type ArtistContent = ReturnType<typeof createArtistContent>;
