import {parseToQobuz} from './to-qobuz-parser';

/**
 * Parse Spotify URLs and convert to Qobuz tracks
 * Similar to parseInfo but for Spotify-to-Qobuz conversion
 */
export const parseSpotifyToQobuz = async (
  url: string,
  onProgress?: (progress: {
    phase: string;
    message: string;
    current?: number;
    total?: number;
    percentage?: number;
  }) => void,
): Promise<{
  info: {type: string; id: string};
  linktype: string;
  linkinfo: any;
  tracks: any[];
}> => {
  return await parseToQobuz(url, onProgress);
};
