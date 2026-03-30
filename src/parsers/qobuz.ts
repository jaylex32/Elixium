import PQueue from 'p-queue';
import {qobuz, spotify} from '../core';

const queue = new PQueue({concurrency: 25});

type playlistConversionProgressType = {
  phase: 'playlist' | 'metadata' | 'matching';
  message: string;
  current?: number;
  total?: number;
  percentage?: number;
};

const normalizeForComparison = (input: unknown): string => {
  if (!input) {
    return '';
  }
  return String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const levenshteinDistance = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({length: rows}, (_, row) => [row]);

  for (let col = 0; col < cols; col++) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      if (a[row - 1] === b[col - 1]) {
        matrix[row][col] = matrix[row - 1][col - 1];
      } else {
        matrix[row][col] = Math.min(matrix[row - 1][col] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col - 1] + 1);
      }
    }
  }

  return matrix[a.length][b.length];
};

const similarityScore = (first: unknown, second: unknown): number => {
  const normalizedFirst = normalizeForComparison(first);
  const normalizedSecond = normalizeForComparison(second);

  if (!normalizedFirst && !normalizedSecond) {
    return 1;
  }
  if (!normalizedFirst || !normalizedSecond) {
    return 0;
  }
  if (normalizedFirst === normalizedSecond) {
    return 1;
  }

  const distance = levenshteinDistance(normalizedFirst, normalizedSecond);
  return 1 - distance / Math.max(normalizedFirst.length, normalizedSecond.length);
};

interface MatchCriteria {
  title: string;
  artist?: string | null;
  album?: string | null;
  durationSeconds?: number | null;
  isrc?: string | null;
}

const isHighConfidenceMatch = (candidate: qobuz.types.trackType, expected: MatchCriteria): boolean => {
  const candidateTitle = candidate.title || '';
  const candidateArtist = candidate.performer?.name || candidate.album?.artist?.name || '';
  const candidateAlbum = (candidate.album as any)?.title || (candidate.album as any)?.name || '';
  const candidateDuration = Number(candidate.duration ?? (candidate as any)?.streamable?.duration ?? 0);

  const titleScore = similarityScore(candidateTitle, expected.title);
  if (titleScore < 0.97) {
    return false;
  }

  if (expected.artist) {
    const artistScore = similarityScore(candidateArtist, expected.artist);
    if (artistScore < 0.94) {
      return false;
    }
  }

  if (expected.album && candidateAlbum) {
    const albumScore = similarityScore(candidateAlbum, expected.album);
    if (albumScore < 0.9) {
      return false;
    }
  }

  if (expected.durationSeconds && candidateDuration) {
    if (Math.abs(candidateDuration - expected.durationSeconds) > 2) {
      return false;
    }
  }

  return true;
};

const pickMatchingTrack = (
  candidates: qobuz.types.trackType[] | undefined,
  expected: MatchCriteria,
  {requireIsrc = false}: {requireIsrc?: boolean} = {},
): qobuz.types.trackType | undefined => {
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  const normalizedExpectedIsrc = expected.isrc ? expected.isrc.toUpperCase() : null;

  for (const candidate of candidates) {
    const candidateIsrc = candidate.isrc ? String(candidate.isrc).toUpperCase() : null;

    if (normalizedExpectedIsrc && candidateIsrc === normalizedExpectedIsrc) {
      return candidate;
    }

    if (requireIsrc && normalizedExpectedIsrc) {
      continue;
    }

    if (isHighConfidenceMatch(candidate, expected)) {
      return candidate;
    }
  }

  return undefined;
};

/**
 * Alternative search function that tries multiple strategies
 */
export const searchQobuzTrack = async (
  name: string,
  artist?: string,
  album?: string,
  durationSeconds?: number,
): Promise<qobuz.types.trackType> => {
  const expected: MatchCriteria = {
    title: name,
    artist: artist || null,
    album: album || null,
    durationSeconds: durationSeconds ?? null,
  };
  const tryPick = (items?: qobuz.types.trackType[]) => pickMatchingTrack(items, expected);
  const queries: Array<{query: string; limit: number}> = [];
  if (artist) {
    const combined = `${artist} ${name}`.trim();
    if (combined) {
      queries.push({query: combined, limit: 25});
    }
  }

  if (name) {
    queries.push({query: name, limit: 25});
  }

  if (artist) {
    queries.push({query: artist, limit: 50});
  }

  for (const {query, limit} of queries) {
    if (!query) {
      continue;
    }

    const result = await qobuz.searchMusic(query, 'track', limit);
    const match = tryPick(result?.tracks?.items);
    if (match) {
      return match;
    }
  }

  const cleanName = name
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/feat\..*$/i, '')
    .replace(/ft\..*$/i, '')
    .trim();

  if (cleanName && cleanName !== name) {
    const result = await qobuz.searchMusic(cleanName, 'track', 25);
    const match = tryPick(result?.tracks?.items);
    if (match) {
      return match;
    }
  }

  throw new Error(`No track found for ${name}${artist ? ' by ' + artist : ''}`);
};

/**
 * Convert ISRC to Qobuz track
 */

export const isrc2qobuz = async (
  name: string,
  isrc?: string,
  artist?: string,
  album?: string,
  durationSeconds?: number,
): Promise<qobuz.types.trackType> => {
  const normalizedIsrc = isrc ? isrc.toUpperCase() : null;
  const expected: MatchCriteria = {
    title: name,
    artist: artist || null,
    album: album || null,
    durationSeconds: durationSeconds ?? null,
    isrc: normalizedIsrc,
  };

  const trySearch = async (
    query: string | undefined,
    limit: number,
    requireIsrc = false,
  ): Promise<qobuz.types.trackType | undefined> => {
    if (!query) {
      return undefined;
    }

    const result = await qobuz.searchMusic(query, 'track', limit);
    return pickMatchingTrack(result?.tracks?.items, expected, {requireIsrc});
  };

  if (normalizedIsrc) {
    const matchByIsrc = await trySearch(normalizedIsrc, 20, true);
    if (matchByIsrc) {
      return matchByIsrc;
    }
  }

  const combinedQuery = artist ? `${artist} ${name}`.trim() : name;
  const matchByCombined = await trySearch(combinedQuery, 25);
  if (matchByCombined) {
    return matchByCombined;
  }

  const matchByName = await trySearch(name, 25);
  if (matchByName) {
    return matchByName;
  }

  if (artist) {
    const matchByArtist = await trySearch(artist, 50);
    if (matchByArtist) {
      return matchByArtist;
    }
  }

  const cleanName = name
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/feat\..*$/i, '')
    .replace(/ft\..*$/i, '')
    .trim();

  if (cleanName && cleanName !== name) {
    const matchByCleanName = await trySearch(cleanName, 25);
    if (matchByCleanName) {
      return matchByCleanName;
    }
  }

  if (artist) {
    try {
      const fallback = await searchQobuzTrack(name, artist, album, durationSeconds);
      if (fallback && isHighConfidenceMatch(fallback, expected)) {
        return fallback;
      }
    } catch (_) {
      // ignore and throw generic error below
    }
  }

  if (!normalizedIsrc) {
    throw new Error('ISRC code not found for ' + name);
  }

  throw new Error(`No match on Qobuz for ${name} (ISRC: ${normalizedIsrc})`);
};

/**
 * Convert UPC to Qobuz album
 */
export const upc2qobuz = async (
  name: string,
  upc?: string,
): Promise<[qobuz.types.albumType, qobuz.types.trackType[]]> => {
  if (!upc) {
    throw new Error('UPC code not found for ' + name);
  }

  // Clean UPC (remove leading zeros if longer than 12 digits)
  if (upc.length > 12 && upc.startsWith('0')) {
    upc = upc.slice(-12);
  }

  try {
    // Search for album by UPC or name
    const searchResult = await qobuz.searchMusic(name, 'album', 20);

    for (const album of searchResult.albums.items) {
      if (album.upc === upc) {
        // Get full album info with tracks
        const fullAlbum = await qobuz.getAlbumInfo(album.id);
        return [fullAlbum, fullAlbum.tracks.items];
      }
    }

    throw new Error(`No match on Qobuz for ${name} (UPC: ${upc})`);
  } catch (error) {
    throw new Error(`No match on Qobuz for ${name} (UPC: ${upc})`);
  }
};

/**
 * Convert Spotify track to Qobuz track
 */
export const track2qobuz = async (id: string): Promise<qobuz.types.trackType> => {
  const {body} = await spotify.spotifyApi.getTrack(id);
  const artistName = body.artists[0]?.name || '';
  const albumName = body.album?.name;
  const durationSeconds = body.duration_ms ? Math.round(body.duration_ms / 1000) : undefined;
  return await isrc2qobuz(body.name, body.external_ids?.isrc, artistName, albumName, durationSeconds);
};

/**
 * Convert Spotify album to Qobuz album
 */
export const album2qobuz = async (id: string): Promise<[qobuz.types.albumType, qobuz.types.trackType[]]> => {
  const {body} = await spotify.spotifyApi.getAlbum(id);
  return await upc2qobuz(body.name, body.external_ids.upc);
};

/**
 * Convert Spotify playlist to Qobuz tracks
 */
export const playlist2Qobuz = async (
  id: string,
  onError?: (item: SpotifyApi.PlaylistTrackObject, index: number, err: Error) => void,
  onProgress?: (progress: playlistConversionProgressType) => void,
): Promise<[any, qobuz.types.trackType[]]> => {
  console.log('📋 Fetching Spotify playlist data via spclient...');
  const playlistBundle = await spotify.getSpotifyPlaylistBundle(id, (progress) => {
    if (onProgress) {
      onProgress({
        phase: progress.phase as 'playlist' | 'metadata' | 'matching',
        message: progress.message,
        current: progress.current,
        total: progress.total,
        percentage: progress.percentage,
      });
    }
  });
  const tracks: qobuz.types.trackType[] = [];
  const spotifyTracks = playlistBundle.tracks;
  const totalTracks = spotifyTracks.length;
  let processed = 0;
  let failures = 0;
  if (onProgress) {
    onProgress({
      phase: 'matching',
      message: `Matching ${totalTracks} Spotify tracks on Qobuz...`,
      current: 0,
      total: totalTracks,
      percentage: 0,
    });
  }

  // Convert each track to Qobuz
  await queue.addAll(
    spotifyTracks.map((item: SpotifyApi.TrackObjectFull, index: number) => {
      return async () => {
        try {
          const artistName = item.artists[0]?.name || '';
          const durationSeconds = item.duration_ms ? Math.round(item.duration_ms / 1000) : undefined;
          const albumName = item.album?.name;
          const track = await isrc2qobuz(item.name, item.external_ids?.isrc, artistName, albumName, durationSeconds);
          track.track_number = index + 1;
          tracks.push(track);
        } catch (err: any) {
          failures++;
          console.log(`❌ Failed to convert: ${item?.name} - ${err.message}`);
          if (onError) {
            onError({track: item} as SpotifyApi.PlaylistTrackObject, index, err);
          }
        } finally {
          processed++;
          if (onProgress) {
            onProgress({
              phase: 'matching',
              message: `Matching tracks on Qobuz... ${processed}/${totalTracks}`,
              current: processed,
              total: totalTracks,
              percentage: totalTracks > 0 ? Math.round((processed / totalTracks) * 100) : 100,
            });
          }
        }
      };
    }),
  );

  if (onProgress) {
    onProgress({
      phase: 'matching',
      message: `Matched ${tracks.length}/${totalTracks} tracks on Qobuz${
        failures > 0 ? ` (${failures} not found)` : ''
      }.`,
      current: totalTracks,
      total: totalTracks,
      percentage: 100,
    });
  }

  // console.log(`🎯 Successfully ${tracks.length} out of ${items.length} tracks`);

  // Create playlist info object compatible with Qobuz structure
  const playlistInfo = {
    id: playlistBundle.id,
    name: playlistBundle.name,
    title: playlistBundle.name,
    owner: {
      name: playlistBundle.ownerName || playlistBundle.ownerId,
      id: playlistBundle.ownerId,
    },
    tracks_count: playlistBundle.totalTracks,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    created_at: new Date().getTime() / 1000,
    updated_at: new Date().getTime() / 1000,
    description: playlistBundle.description || '',
    image: {
      large: playlistBundle.imageUrl || '',
      small: playlistBundle.imageUrl || '',
      thumbnail: playlistBundle.imageUrl || '',
    },
  };

  return [playlistInfo, tracks];
};

/**
 * Convert Spotify artist top tracks to Qobuz tracks
 */
export const artist2Qobuz = async (
  id: string,
  onError?: (item: SpotifyApi.TrackObjectFull, index: number, err: Error) => void,
): Promise<qobuz.types.trackType[]> => {
  const {body} = await spotify.spotifyApi.getArtistTopTracks(id, 'US');
  const tracks: qobuz.types.trackType[] = [];

  await queue.addAll(
    body.tracks.map((item: SpotifyApi.TrackObjectFull, index: number) => {
      return async () => {
        try {
          const artistName = item.artists[0]?.name || '';
          const albumName = item.album?.name;
          const durationSeconds = item.duration_ms ? Math.round(item.duration_ms / 1000) : undefined;
          const track = await isrc2qobuz(item.name, item.external_ids?.isrc, artistName, albumName, durationSeconds);
          tracks.push(track);
        } catch (err: any) {
          if (onError) {
            onError(item, index, err);
          }
        }
      };
    }),
  );

  return tracks;
};
