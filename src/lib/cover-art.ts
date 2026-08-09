/**
 * Cover-art sizing, shared by both services.
 *
 * Three separate things were broken here:
 *
 *  1. `coverSize` is stored as a per-quality object ({'128','320',flac}), but
 *     the web Settings UI writes a single number. `coverSizes['flac']` was then
 *     undefined, and the Deezer URL became ".../undefinedxundefined-...jpg".
 *  2. Qobuz ignored the setting entirely when saving a cover — it always used
 *     `album.image.large`.
 *  3. Qobuz embedding capped at `image.large` because downloadAlbumCover had no
 *     branch above 600.
 *
 * The CDNs are not equivalent, which is why sizing cannot be a bare number
 * passed to both:
 *
 *  - Deezer renders any dimension on demand, up to 1800. 3000 returns 403.
 *  - Qobuz serves fixed rungs only — _50, _230, _600, _max and _org. Anything
 *    else 404s. _max and _org are both 4000x4000; _org is simply less
 *    compressed (6.7MB vs 1.7MB on a sampled release).
 *
 * Both verified against the live CDNs rather than assumed.
 */

/** Used when nothing valid is configured. */
export const DEFAULT_COVER_SIZE = 1000;

/** Deezer renders on demand but refuses beyond this. */
export const DEEZER_MAX_COVER_SIZE = 1800;

/** The only widths Qobuz actually hosts, ascending. */
const QOBUZ_RUNGS = [
  {width: 50, suffix: '50'},
  {width: 230, suffix: '230'},
  {width: 600, suffix: '600'},
  {width: 4000, suffix: 'max'},
] as const;

export type QualityTier = '128' | '320' | 'flac';

const toPositive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * Normalise whatever `coverSize` holds into a pixel width.
 *
 * Accepts both the per-quality object and the single number the web UI saves,
 * so an existing config keeps working either way and neither transport has to
 * know which shape is on disk.
 */
export const resolveCoverSize = (setting: unknown, tier: QualityTier = 'flac'): number => {
  const direct = toPositive(setting);
  if (direct) return direct;

  if (setting && typeof setting === 'object') {
    const bag = setting as Record<string, unknown>;
    // Prefer the tier being downloaded, then any populated key — a partially
    // filled object should still beat falling back to the default.
    for (const key of [tier, 'flac', '320', '128']) {
      const found = toPositive(bag[key]);
      if (found) return found;
    }
  }

  return DEFAULT_COVER_SIZE;
};

/** Deezer cover URL, clamped to what the CDN will actually render. */
export const deezerCoverUrl = (picture: string, size: number): string => {
  const width = Math.min(Math.max(size, 1), DEEZER_MAX_COVER_SIZE);
  return `https://e-cdns-images.dzcdn.net/images/cover/${picture}/${width}x${width}-000000-80-0-0.jpg`;
};

/**
 * The smallest Qobuz rung that meets the requested size.
 *
 * "At least what was asked for" rather than nearest: 1500 is numerically
 * closer to 600 than to 4000, but answering a 1500px request with a 600px
 * image is the bug this replaces. Falls back to the largest rung.
 */
export const qobuzCoverSuffix = (size: number): string =>
  (QOBUZ_RUNGS.find((rung) => rung.width >= size) ?? QOBUZ_RUNGS[QOBUZ_RUNGS.length - 1]).suffix;

/**
 * Rewrite a Qobuz cover URL to the rung matching `size`.
 *
 * Qobuz's album payload only offers thumbnail/small/large (50/230/600), so the
 * URL is rebuilt from whichever one is present — that is the only way to reach
 * _max, which the API never links directly.
 */
export const qobuzCoverUrl = (image: {large?: string; small?: string; thumbnail?: string} | undefined, size: number): string | null => {
  const source = image?.large || image?.small || image?.thumbnail;
  if (!source) return null;

  const suffix = qobuzCoverSuffix(size);
  // e.g. ".../0724384960650_600.jpg" -> ".../0724384960650_max.jpg"
  const rewritten = source.replace(/_(?:50|230|600|max|org)\.jpg(\?.*)?$/i, `_${suffix}.jpg$1`);
  return rewritten === source && !/_[a-z0-9]+\.jpg/i.test(source) ? source : rewritten;
};
