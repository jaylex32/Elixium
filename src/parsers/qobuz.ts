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

const splitSourceTitle = (title: string): {baseTitle: string; version: string | null} => {
  const trimmed = String(title || '').trim();
  const dashParts = trimmed
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (dashParts.length > 1) {
    return {
      baseTitle: dashParts[0],
      version: dashParts.slice(1).join(' - '),
    };
  }

  return {baseTitle: trimmed, version: null};
};

const normalizedContains = (left: unknown, right: unknown): boolean => {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  if (!a || !b) {
    return false;
  }
  return a.includes(b) || b.includes(a);
};

const getQobuzCandidateTitle = (candidate: qobuz.types.trackType): string => {
  const title = candidate.title || '';
  const version = candidate.version?.trim();
  if (!version) {
    return title;
  }

  return title.includes(version) ? title : `${title} ${version}`.trim();
};

const splitArtistCandidates = (artist?: string | null): string[] => {
  if (!artist) {
    return [];
  }

  const variants = new Set<string>();
  const normalized = artist.trim();
  if (normalized) {
    variants.add(normalized);
  }

  normalized
    .split(/\s*(?:,|;|\/)\s*/g)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      variants.add(value);

      const withoutInlineFeat = value.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '').trim();
      if (withoutInlineFeat) {
        variants.add(withoutInlineFeat);
      }

      const withoutBracketFeat = value.replace(/\((?:feat\.?|ft\.?|featuring)[^)]+\)/i, '').trim();
      if (withoutBracketFeat) {
        variants.add(withoutBracketFeat);
      }
    });

  return Array.from(variants);
};

const buildArtistSearchVariants = (artist?: string | null): string[] => {
  const variants = new Set<string>(splitArtistCandidates(artist));

  for (const variant of Array.from(variants)) {
    variant
      .split(/\s+(?:&|and|x|X)\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => variants.add(value));
  }

  return Array.from(variants);
};

const buildTitleVariants = (title: string): string[] => {
  const variants = new Set<string>();
  const push = (value?: string | null) => {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      variants.add(trimmed);
    }
  };

  push(title);

  const withoutBrackets = title.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  push(withoutBrackets.replace(/\s+/g, ' ').trim());

  const withoutFeat = title.replace(/\b(feat|ft)\..*$/i, '').trim();
  push(withoutFeat);

  const {baseTitle} = splitSourceTitle(title);
  if (baseTitle && baseTitle !== title) {
    push(baseTitle);
  }

  return Array.from(variants);
};

const buildSearchQueries = (expected: MatchCriteria): Array<{query: string; limit: number}> => {
  const queries: Array<{query: string; limit: number}> = [];
  const seen = new Set<string>();
  const titleVariants = buildTitleVariants(expected.title);
  const artistVariants = buildArtistSearchVariants(expected.artist);

  const push = (query: string | undefined, limit: number) => {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeForComparison(trimmed);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    queries.push({query: trimmed, limit});
  };

  for (const titleVariant of titleVariants) {
    for (const artistVariant of artistVariants) {
      push(`${artistVariant} ${titleVariant}`, 25);
    }
    push(titleVariant, 25);
  }

  for (const artistVariant of artistVariants) {
    push(artistVariant, 50);
  }

  if (expected.album) {
    for (const artistVariant of artistVariants) {
      push(`${artistVariant} ${expected.album}`, 25);
    }
    push(expected.album, 25);
  }

  return queries;
};

const isHighConfidenceMatch = (candidate: qobuz.types.trackType, expected: MatchCriteria): boolean => {
  const {baseTitle, version: expectedVersion} = splitSourceTitle(expected.title);
  const candidateTitle = getQobuzCandidateTitle(candidate);
  const candidateBaseTitle = candidate.title || '';
  const candidateVersion = candidate.version || '';
  const candidateArtist = candidate.performer?.name || candidate.album?.artist?.name || '';
  const candidateAlbum = (candidate.album as any)?.title || (candidate.album as any)?.name || '';
  const candidateDuration = Number(candidate.duration ?? (candidate as any)?.streamable?.duration ?? 0);
  const normalizedExpectedVersion = normalizeForComparison(expectedVersion);
  const softVersionExpected =
    normalizedExpectedVersion === 'mixed' ||
    normalizedExpectedVersion === 'mix' ||
    normalizedExpectedVersion === 'dj mix' ||
    normalizedExpectedVersion === 'continuous mix';

  const titleVariants = buildTitleVariants(expected.title);
  const titleScore = Math.max(
    ...titleVariants.map((variant) => similarityScore(candidateTitle, variant)),
    similarityScore(candidateBaseTitle, baseTitle),
  );
  if (titleScore < 0.97) {
    return false;
  }

  if (expectedVersion && !softVersionExpected) {
    const versionScore = Math.max(
      similarityScore(candidateVersion, expectedVersion),
      similarityScore(candidateTitle, expected.title),
      similarityScore(candidateAlbum, expectedVersion),
    );
    const versionContained =
      normalizedContains(candidateVersion, expectedVersion) ||
      normalizedContains(candidateTitle, expectedVersion) ||
      normalizedContains(candidateAlbum, expectedVersion);

    if (versionScore < 0.82 && !versionContained) {
      return false;
    }
  }

  if (expected.artist) {
    const artistVariants = splitArtistCandidates(expected.artist);
    const artistScore = Math.max(...artistVariants.map((variant) => similarityScore(candidateArtist, variant)));
    if (artistScore < 0.94) {
      return false;
    }
  }

  if (expected.album && candidateAlbum) {
    const albumVariants = [expected.album, baseTitle, expected.title].filter(Boolean);
    const albumScore = Math.max(...albumVariants.map((variant) => similarityScore(candidateAlbum, variant)));
    const albumContained = albumVariants.some((variant) => normalizedContains(candidateAlbum, variant));
    const strongTitleMatch = titleScore >= 0.992;
    const strongDurationMatch =
      !expected.durationSeconds || !candidateDuration || Math.abs(candidateDuration - expected.durationSeconds) <= 1;

    if (albumScore < 0.8 && !albumContained && !(strongTitleMatch && strongDurationMatch)) {
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
  const queries = buildSearchQueries(expected);

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

  for (const {query, limit} of buildSearchQueries(expected)) {
    const match = await trySearch(query, limit);
    if (match) {
      return match;
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
    throw new Error(`No match on Qobuz for ${name}${artist ? ' by ' + artist : ''}`);
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
  const artistName = body.artists
    .map((artist) => artist.name)
    .filter(Boolean)
    .join(', ');
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
          const artistName = item.artists
            .map((artist) => artist.name)
            .filter(Boolean)
            .join(', ');
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
          const artistName = item.artists
            .map((artist) => artist.name)
            .filter(Boolean)
            .join(', ');
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
