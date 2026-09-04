/**
 * Tags both services expose but none of the writers were emitting.
 *
 * The four taggers (Deezer MP3/FLAC, Qobuz MP3/FLAC) grew independently and
 * drifted: Qobuz wrote TOTALDISCS but no COMPILATION, Deezer wrote MEDIA but
 * no COPYRIGHT on MP3, and none of them wrote ReplayGain at all even though
 * Deezer returns `GAIN` on every track and Qobuz returns a gain *and* a peak
 * in `audio_info`. This centralises the formatting so the four stay aligned.
 */

/**
 * ReplayGain track gain, formatted the way players expect.
 *
 * The unit suffix is not decorative — foobar2000, mpd, Rockbox and the
 * vorbis-comment spec all parse "<float> dB", and a bare number is silently
 * ignored by most of them.
 */
export const formatGain = (gain: unknown): string | null => {
  const n = Number(gain);
  if (!Number.isFinite(n) || n === 0) return null;
  return `${n.toFixed(2)} dB`;
};

/**
 * ReplayGain peak as a linear sample value.
 *
 * Unitless by spec, and conventionally six decimals. Values above 1.0 are
 * legitimate (inter-sample peaks on loud masters), so this does not clamp.
 */
export const formatPeak = (peak: unknown): string | null => {
  const n = Number(peak);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(6);
};

/**
 * Whether a release should be flagged as a compilation.
 *
 * Both taggers already inferred this from a "Various Artists" album artist;
 * this keeps the single rule in one place so MP3 and FLAC cannot disagree.
 */
export const isCompilation = (albumArtist: unknown): boolean =>
  typeof albumArtist === 'string' && /various\s*artists?|^various$/i.test(albumArtist.trim());

/**
 * A release/track version, e.g. "(Extended Club Mix Edit)".
 *
 * Deezer puts this in VERSION and Qobuz in `version`; both were dropped
 * entirely, so a remix and its original tagged identically and collapsed into
 * one entry in most libraries.
 */
export const cleanVersion = (version: unknown): string | null => {
  if (typeof version !== 'string') return null;
  // Strip the wrapping parens the APIs usually include; players add their own.
  const trimmed = version
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Written as ENCODEDBY / TENC so a file's origin is traceable later. */
export const ENCODED_BY = 'Elixium';

/**
 * The most accurate release date available, as `YYYY-MM-DD`.
 *
 * Deezer's public album endpoint reports `release_date`, and for anything
 * reissued that is the date of the reissue: a 1973 record that arrived on
 * streaming in 2011 is tagged 2011, so a library sorted by year files it
 * beside music made four decades later. The private track payload carries the
 * physical and original dates alongside it, and either is the date a listener
 * means when they ask what year something is from.
 *
 * Preference order is oldest-known-first for that reason, and every candidate
 * has to look like a real date before it is used — Deezer returns `0000-00-00`
 * for a release it has no date for, which would otherwise tag the file year 0.
 *
 * Falls back to exactly what was used before, so a track whose payload carries
 * none of the richer fields is tagged as it always was.
 */
export const bestReleaseDate = (track: unknown, album: unknown): string | null => {
  const looksLikeADate = (value: unknown): value is string =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000');

  const from = (source: unknown, key: string): unknown =>
    source && typeof source === 'object' ? (source as Record<string, unknown>)[key] : undefined;

  const candidates = [
    from(track, 'ORIGINAL_RELEASE_DATE'),
    from(track, 'PHYSICAL_RELEASE_DATE'),
    from(album, 'ORIGINAL_RELEASE_DATE'),
    from(album, 'PHYSICAL_RELEASE_DATE'),
    from(track, 'DIGITAL_RELEASE_DATE'),
    from(album, 'release_date'),
  ];

  for (const candidate of candidates) {
    if (looksLikeADate(candidate)) return candidate;
  }
  return null;
};
