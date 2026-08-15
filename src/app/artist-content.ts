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
  const getArtistAlbums = async (
    service: string,
    artistId: string,
    limit = 30,
    offset = 0,
  ): Promise<SearchResult[]> => {
    if (service === 'deezer') {
      const url = `https://api.deezer.com/artist/${encodeURIComponent(artistId)}/albums?limit=${Number(
        limit,
      )}&index=${Number(offset)}`;
      const response = await makeHttpRequest(url);
      return dedupeReleases(
        ((response && response.data) || []).map((album: any) => ({
          id: String(album.id),
          title: album.title,
          artist: album.artist?.name || 'Unknown Artist',
          album: album.title,
          type: 'album',
          duration: releaseLabel(album.record_type, album.nb_tracks),
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
          artist: album.artist?.name || 'Unknown Artist',
          album: album.title,
          type: 'album',
          duration: releaseLabel(album.release_type, album.tracks_count),
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
  ): Promise<SearchResult[]> => {
    if (service === 'deezer') {
      const url = `https://api.deezer.com/artist/${encodeURIComponent(artistId)}/top?limit=${Number(
        limit,
      )}&index=${Number(offset)}`;
      const response = await makeHttpRequest(url);
      return ((response && response.data) || []).map((track: any) => ({
        id: String(track.id),
        title: track.title + (track.version ? ` ${track.version}` : ''),
        artist: track.artist?.name || 'Unknown Artist',
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
        artist: track.performer?.name || 'Unknown Artist',
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
