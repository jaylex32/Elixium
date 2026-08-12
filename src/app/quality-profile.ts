import {existsSync, openSync, readSync, closeSync} from 'fs';

/**
 * Quality profiles and the upgrade cutoff.
 *
 * The watchlist could already tell what it had *not* downloaded. It could not
 * tell that what it had was worse than what is now available — so a release
 * grabbed as MP3 before a Qobuz subscription existed stayed MP3 forever, and
 * the only way to improve it was to delete the files and force a re-scan.
 *
 * A profile names the tier you are satisfied with. Anything already in the
 * library below that tier becomes an upgrade candidate; anything at or above
 * it is left alone. This mirrors Lidarr's cutoff, which is the piece of it the
 * watchlist was missing.
 *
 * Existing quality is read from the files rather than from download history,
 * which matters because the history does not record it — reading the files is
 * the only thing that works for a library built before this existed.
 */

/** Ascending. A profile is satisfied by its own tier or anything above. */
export const QUALITY_TIERS = ['mp3', 'lossless', 'hires'] as const;

export type QualityTier = (typeof QUALITY_TIERS)[number];

export const QUALITY_TIER_LABELS: Record<QualityTier, string> = {
  mp3: 'MP3',
  lossless: 'FLAC 16-bit',
  hires: 'FLAC 24-bit (hi-res)',
};

const tierRank = (tier: QualityTier): number => QUALITY_TIERS.indexOf(tier);

/** Whether `have` already satisfies `cutoff`. */
export const meetsCutoff = (have: QualityTier | null, cutoff: QualityTier): boolean =>
  have !== null && tierRank(have) >= tierRank(cutoff);

/**
 * Read a FLAC's bit depth from its STREAMINFO block.
 *
 * Extension alone cannot separate 16-bit from hi-res, and re-downloading every
 * FLAC because the profile asks for 24-bit would be worse than not offering
 * the tier at all.
 *
 * Layout: "fLaC" magic (4 bytes), a 4-byte METADATA_BLOCK_HEADER, then
 * STREAMINFO. Bytes 18-21 pack four fields back to back:
 *
 *   bits  0-19  sample rate
 *   bits 20-22  channels - 1
 *   bits 23-27  bits per sample - 1
 *   bits 28-31  first nibble of the total sample count
 *
 * Bit depth therefore straddles bytes 20 and 21, so the window has to be 32
 * bits wide. readUInt32BE rather than shifting bytes together, because
 * `buf[18] << 24` overflows into the sign bit in JavaScript and yields a
 * negative number.
 */
const readFlacBitDepth = (filePath: string): number | null => {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(26);
    const read = readSync(fd, buf, 0, 26, 0);
    if (read < 26 || buf.toString('latin1', 0, 4) !== 'fLaC') return null;

    const packed = buf.readUInt32BE(18);
    const bitDepth = ((packed >>> 4) & 0x1f) + 1;
    return bitDepth > 0 && bitDepth <= 32 ? bitDepth : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to do if the handle is already gone.
      }
    }
  }
};

/** Classify one audio file. Returns null for anything that is not audio. */
/**
 * @param probeDepth Open the file to separate 16-bit from hi-res FLAC.
 *
 * Off by default because it is enormously expensive and almost never needed.
 * Reading a header means an open + read per track: on a large library that is
 * thousands of syscalls, and over a network share thousands of round trips,
 * which is what made the Library page appear to hang for tens of seconds.
 *
 * The distinction only changes an outcome when the cutoff is `hires` — at any
 * lower cutoff both 16-bit and 24-bit FLAC already satisfy it, so the extension
 * alone answers the question. The caller turns this on only for that case.
 */
export const classifyFileQuality = (filePath: string, probeDepth = false): QualityTier | null => {
  const lower = filePath.toLowerCase();

  if (lower.endsWith('.flac')) {
    if (!probeDepth) return 'lossless';
    const depth = readFlacBitDepth(filePath);
    // Unknown depth is treated as 16-bit: assuming hi-res would wrongly mark a
    // plain FLAC as already satisfying the highest cutoff.
    return depth !== null && depth > 16 ? 'hires' : 'lossless';
  }

  if (lower.endsWith('.mp3') || lower.endsWith('.m4a') || lower.endsWith('.aac') || lower.endsWith('.ogg')) {
    return 'mp3';
  }

  return null;
};

export interface QualityProfile {
  /** Tier at which a release is considered done. */
  cutoff: QualityTier;
  /** Whether releases below the cutoff are re-fetched at all. */
  upgradeExisting: boolean;
}

export const DEFAULT_QUALITY_PROFILE: QualityProfile = {
  // Lossless, not hi-res: hi-res would flag most libraries as needing an
  // upgrade on first run, which is a surprising default for an automatic
  // downloader.
  cutoff: 'lossless',
  // Off by default — turning this on can queue a large amount of traffic, and
  // that should be a decision, not a side effect of upgrading Elixium.
  upgradeExisting: false,
};

export const readQualityProfile = (conf: any): QualityProfile => {
  const raw = conf.get('qualityProfile');
  const cutoff = raw?.cutoff;
  return {
    cutoff: QUALITY_TIERS.includes(cutoff) ? cutoff : DEFAULT_QUALITY_PROFILE.cutoff,
    upgradeExisting: raw?.upgradeExisting === true,
  };
};

export const writeQualityProfile = (conf: any, patch: Partial<QualityProfile>): QualityProfile => {
  const current = readQualityProfile(conf);
  const next: QualityProfile = {
    cutoff: QUALITY_TIERS.includes(patch.cutoff as QualityTier) ? (patch.cutoff as QualityTier) : current.cutoff,
    upgradeExisting: typeof patch.upgradeExisting === 'boolean' ? patch.upgradeExisting : current.upgradeExisting,
  };
  conf.set('qualityProfile', next);
  return next;
};

/**
 * Best tier a service can currently deliver.
 *
 * Deezer tops out at FLAC 16-bit, so a hi-res cutoff is unreachable there and
 * must not mark every Deezer release as permanently upgradable.
 */
export const bestAvailableTier = (service: 'deezer' | 'qobuz', album?: {maximum_bit_depth?: number}): QualityTier => {
  if (service === 'deezer') return 'lossless';
  return Number(album?.maximum_bit_depth) > 16 ? 'hires' : 'lossless';
};

/**
 * Whether a release already in the library is worth re-fetching.
 *
 * Requires the service to actually offer something better — otherwise an
 * unreachable cutoff would re-queue the same release on every scan.
 */
export const needsUpgrade = (have: QualityTier | null, profile: QualityProfile, available: QualityTier): boolean => {
  if (!profile.upgradeExisting) return false;
  if (have === null) return false;
  if (meetsCutoff(have, profile.cutoff)) return false;
  return tierRank(available) > tierRank(have);
};

/** Guard so a caller cannot pass a path that does not exist. */
export const isReadablePath = (target: string): boolean => Boolean(target) && existsSync(target);
