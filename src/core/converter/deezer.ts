import axios from 'axios';
import delay from 'delay';
import {getAlbumInfo, getAlbumTracks, getTrackInfo, searchAlternative, searchMusic} from '../deezer/api';
import type {albumType, trackType} from '../deezer/types';

const instance = axios.create({baseURL: 'https://api.deezer.com/', timeout: 15000});

type DeezerTrackMatchCriteria = {
  title: string;
  artist?: string | null;
  album?: string | null;
  durationSeconds?: number | null;
  isrc?: string | null;
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

const getDeezerCandidateTitle = (candidate: trackType): string => {
  const title = candidate.SNG_TITLE || '';
  const version = candidate.VERSION?.trim();
  if (!version) {
    return title;
  }

  return title.includes(version) ? title : `${title} ${version}`.trim();
};

const isHighConfidenceMatch = (candidate: trackType, expected: DeezerTrackMatchCriteria): boolean => {
  const candidateTitle = getDeezerCandidateTitle(candidate);
  const candidateArtist = candidate.ART_NAME || candidate.ARTISTS?.[0]?.ART_NAME || '';
  const candidateAlbum = candidate.ALB_TITLE || '';
  const candidateDuration = Number(candidate.DURATION || 0);

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
  candidates: trackType[] | undefined,
  expected: DeezerTrackMatchCriteria,
  {requireIsrc = false}: {requireIsrc?: boolean} = {},
): trackType | undefined => {
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  const normalizedExpectedIsrc = expected.isrc ? expected.isrc.toUpperCase() : null;

  for (const candidate of candidates) {
    const candidateIsrc = candidate.ISRC ? String(candidate.ISRC).toUpperCase() : null;

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

const searchDeezerTrack = async (
  name: string,
  artist?: string,
  album?: string,
  durationSeconds?: number,
  isrc?: string,
): Promise<trackType> => {
  const expected: DeezerTrackMatchCriteria = {
    title: name,
    artist: artist || null,
    album: album || null,
    durationSeconds: durationSeconds ?? null,
    isrc: isrc || null,
  };

  const tryPick = async (candidates?: trackType[], requireIsrc = false): Promise<trackType | undefined> => {
    const match = pickMatchingTrack(candidates, expected, {requireIsrc});
    if (!match?.SNG_ID) {
      return undefined;
    }
    return await getTrackInfo(match.SNG_ID);
  };

  if (artist) {
    const alternativeResult = await searchAlternative(artist, name, 15);
    const alternativeMatch = await tryPick(alternativeResult?.TRACK?.data);
    if (alternativeMatch) {
      return alternativeMatch;
    }
  }

  const queries: Array<string | undefined> = [artist ? `${artist} ${name}`.trim() : undefined, name, artist];

  for (const query of queries) {
    if (!query) {
      continue;
    }

    const result = await searchMusic(query, ['TRACK'], artist ? 25 : 50);
    const match = await tryPick(result?.TRACK?.data);
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
    const result = await searchMusic(cleanName, ['TRACK'], 25);
    const match = await tryPick(result?.TRACK?.data);
    if (match) {
      return match;
    }
  }

  throw new Error(`No match on deezer for ${name}${artist ? ' by ' + artist : ''}`);
};

export const isrc2deezer = async (
  name: string,
  isrc?: string,
  artist?: string,
  album?: string,
  durationSeconds?: number,
) => {
  const normalizedIsrc = isrc ? isrc.toUpperCase() : null;

  if (normalizedIsrc) {
    const {data} = await instance.get<any>('track/isrc:' + normalizedIsrc);
    if (!data.error) {
      return await getTrackInfo(data.id);
    }
  }

  return await searchDeezerTrack(name, artist, album, durationSeconds, normalizedIsrc || undefined);
};

export const upc2deezer = async (name: string, upc?: string): Promise<[albumType, trackType[]]> => {
  if (!upc) {
    throw new Error('UPC code not found for ' + name);
  } else if (upc.length > 12 && upc.startsWith('0')) {
    upc = upc.slice(-12);
  }

  const {data} = await instance.get<any>('album/upc:' + upc);
  if (data.error) {
    throw new Error(`No match on deezer for ${name} (UPC: ${upc})`);
  }

  const albumInfo = await getAlbumInfo(data.id);
  const albumTracks = await getAlbumTracks(data.id);
  return [albumInfo, albumTracks.data];
};

// Retry on rate limit error
instance.interceptors.response.use(async (response: Record<string, any>) => {
  if (response.data.error && Object.keys(response.data.error).length > 0) {
    if (response.data.error.code === 4) {
      await delay.range(1000, 1500);
      return await instance(response.config);
    }
  }

  return response;
});
