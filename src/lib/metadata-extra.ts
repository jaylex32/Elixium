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
