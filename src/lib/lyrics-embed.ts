import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';
import {fetchLrclib, type LyricsResult} from './lyrics-provider';

/**
 * Lyrics for downloaded files.
 *
 * The Deezer tagger has always written a USLT frame / LYRICS vorbis comment
 * when `track.LYRICS` is present, but the only source was Deezer's own API,
 * which needs a working session — so in practice nothing was ever embedded.
 * Qobuz's equivalent was commented out entirely. This attaches lyrics from
 * LRCLIB, which needs no credentials and covers both services.
 */

export interface LyricsOptions {
  /** Write the words into the audio file's tags. */
  embed?: boolean;
  /** Write a sidecar .lrc next to the audio file (synced lyrics only). */
  saveLrc?: boolean;
}

export interface TrackIdentity {
  artist: string;
  title: string;
  album?: string;
  durationSec?: number;
}

/** In-process cache: an album's tracks are fetched back to back. */
const cache = new Map<string, LyricsResult | null>();

const cacheKey = ({artist, title, album}: TrackIdentity) => `${artist}::${title}::${album ?? ''}`.toLowerCase();

/** Look lyrics up once per track, tolerating any provider failure. */
export const lookupLyrics = async (identity: TrackIdentity): Promise<LyricsResult | null> => {
  const key = cacheKey(identity);
  if (cache.has(key)) return cache.get(key) ?? null;

  let result: LyricsResult | null = null;
  try {
    result = await fetchLrclib(identity);
  } catch {
    // Lyrics are an enhancement; never fail a download over them.
    result = null;
  }

  cache.set(key, result);
  return result;
};

/**
 * Render timed lines back to LRC.
 *
 * Players expect [mm:ss.xx]; centiseconds are the conventional precision, and
 * minutes are not wrapped at 60 because tracks can exceed an hour.
 */
export const toLrc = (lyrics: LyricsResult, identity: TrackIdentity): string => {
  const header = [
    `[ar:${identity.artist}]`,
    `[ti:${identity.title}]`,
    identity.album ? `[al:${identity.album}]` : '',
    '[by:Elixium]',
  ].filter(Boolean);

  const body = lyrics.synced.map((line) => {
    const totalSeconds = Math.max(0, line.timeMs) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const centis = Math.floor((line.timeMs % 1000) / 10);
    const stamp = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(
      2,
      '0',
    )}]`;
    return `${stamp}${line.text}`;
  });

  return [...header, ...body].join('\n');
};

/** Replace an audio file's extension with .lrc. */
export const lrcPathFor = (audioPath: string): string => audioPath.replace(/\.[^./\\]+$/, '') + '.lrc';

/**
 * Fetch lyrics, attach them to the track for the tagger, and optionally write
 * a .lrc beside the audio.
 *
 * Mutates `track` because both taggers read `track.LYRICS` — matching the
 * shape Deezer's own API returns keeps a single code path in the writers.
 * Returns what was found so a caller can report it.
 */
export const applyLyrics = async (
  track: any,
  identity: TrackIdentity,
  savePath: string,
  options: LyricsOptions,
): Promise<{embedded: boolean; lrcWritten: boolean; synced: boolean}> => {
  const result = {embedded: false, lrcWritten: false, synced: false};
  if (!options.embed && !options.saveLrc) return result;
  if (!identity.artist || !identity.title) return result;

  const lyrics = await lookupLyrics(identity);
  if (!lyrics?.text) return result;

  result.synced = lyrics.synced.length > 0;

  if (options.embed && !track.LYRICS) {
    track.LYRICS = {LYRICS_TEXT: lyrics.text};
    result.embedded = true;
  }

  // A sidecar is only useful when it carries timings; plain text is already
  // in the tag.
  if (options.saveLrc && lyrics.synced.length > 0) {
    try {
      const target = lrcPathFor(savePath);
      const dir = dirname(target);
      if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
      writeFileSync(target, toLrc(lyrics, identity), 'utf8');
      result.lrcWritten = true;
    } catch {
      // A failed sidecar must not fail the download.
    }
  }

  return result;
};
