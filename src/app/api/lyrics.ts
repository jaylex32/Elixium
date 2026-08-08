import got from 'got';

/**
 * Lyrics providers.
 *
 * Deezer serves its own timestamped lyrics, but only for an authenticated
 * session with a valid ARL. The historical fallback was a Musixmatch HTML
 * scraper, which now returns 403 — so in practice lyrics were unavailable for
 * every track on both services.
 *
 * LRCLIB is used as the general-purpose provider: a free, key-less, purpose
 * built lyrics API that returns plain *and* LRC-synced lyrics. It is queried
 * by artist/title/album/duration rather than by any service's track id, so it
 * works identically for Deezer and Qobuz.
 */

export interface SyncedLine {
  timeMs: number;
  durationMs: number;
  text: string;
}

export interface LyricsResult {
  text: string;
  synced: SyncedLine[];
  source: string;
}

/** LRCLIB asks clients to identify themselves. */
const USER_AGENT = 'Elixium (https://github.com/jaylex32/Elixium)';

/**
 * Parse LRC ("[mm:ss.xx] text") into timed lines.
 *
 * A line may carry several timestamps when the same words repeat; each becomes
 * its own entry. Blank lines are dropped — they are instrumental gaps and
 * would render as empty rows in a synced view.
 */
export const parseLrc = (lrc: string): SyncedLine[] => {
  const lines: SyncedLine[] = [];

  for (const raw of String(lrc || '').split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;

    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;

    for (const stamp of stamps) {
      const minutes = Number(stamp[1]) || 0;
      const seconds = Number(stamp[2]) || 0;
      // Fractions may be 1–3 digits; normalize to milliseconds.
      const fraction = stamp[3] ? Number(stamp[3].padEnd(3, '0')) : 0;
      lines.push({timeMs: minutes * 60000 + seconds * 1000 + fraction, durationMs: 0, text});
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);

  // Derive each line's duration from the next line's start.
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].durationMs = next ? Math.max(0, next.timeMs - lines[i].timeMs) : 0;
  }

  return lines;
};

interface LrclibRecord {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

const toResult = (record: LrclibRecord | undefined): LyricsResult | null => {
  if (!record || record.instrumental) return null;

  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  const text = record.plainLyrics?.trim() || synced.map((l) => l.text).join('\n');
  if (!text) return null;

  return {text, synced, source: 'lrclib'};
};

export interface LyricsQuery {
  artist: string;
  title: string;
  album?: string;
  durationSec?: number;
}

/**
 * Look a track up on LRCLIB.
 *
 * Tries the exact-match endpoint first (it needs duration to disambiguate
 * covers and live versions), then falls back to search, which tolerates
 * mismatched album names and durations.
 */
export const fetchLrclib = async ({artist, title, album, durationSec}: LyricsQuery): Promise<LyricsResult | null> => {
  if (!artist || !title) return null;

  const options = {
    headers: {'User-Agent': USER_AGENT},
    timeout: {request: 8000},
    retry: {limit: 1},
    responseType: 'json' as const,
  };

  try {
    const params: Record<string, string> = {artist_name: artist, track_name: title};
    if (album) params.album_name = album;
    if (durationSec && durationSec > 0) params.duration = String(Math.round(durationSec));

    const {body} = await got('https://lrclib.net/api/get', {...options, searchParams: params});
    const result = toResult(body as LrclibRecord);
    if (result) return result;
  } catch {
    // 404 here just means no exact match — fall through to search.
  }

  try {
    const {body} = await got('https://lrclib.net/api/search', {
      ...options,
      searchParams: {track_name: title, artist_name: artist},
    });
    const records = Array.isArray(body) ? (body as LrclibRecord[]) : [];
    // Prefer a record that actually has timestamps.
    return toResult(records.find((r) => r.syncedLyrics) ?? records[0]);
  } catch {
    return null;
  }
};
