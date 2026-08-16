type Raw = Record<string, unknown> | undefined | null;

/**
 * Does this track or album carry explicit content?
 *
 * Read from `rawData` on the client rather than added to every result mapper on
 * the server. The raw payload already travels with every result — search,
 * charts, artist tabs, playlists, favourites — so one reader covers all of them
 * and cannot fall out of step with a path someone forgets to update.
 *
 * The services disagree on the field, and Deezer disagrees with itself: its
 * private API sends `EXPLICIT_LYRICS` on a track and a nested
 * `EXPLICIT_ALBUM_CONTENT.EXPLICIT_LYRICS_STATUS` on an album, while the public
 * API sends `explicit_lyrics`. Qobuz calls it `parental_warning`.
 *
 * Values arrive as booleans, numbers and numeric strings depending on the
 * endpoint, so each is normalised rather than trusted.
 */
export function isExplicit(rawData: Raw): boolean {
  if (!rawData) return false;

  const truthy = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return false;
  };

  // Qobuz.
  if (truthy(rawData.parental_warning)) return true;

  // Deezer, public API shape.
  if (truthy(rawData.explicit_lyrics)) return true;
  // 1 = explicit; 2/3/4 mean "unknown" or "edited", which are not explicit.
  if (rawData.explicit_content_lyrics === 1) return true;

  // Deezer, private API shape.
  if (truthy(rawData.EXPLICIT_LYRICS)) return true;

  const albumContent = rawData.EXPLICIT_ALBUM_CONTENT as Record<string, unknown> | undefined;
  if (albumContent && albumContent.EXPLICIT_LYRICS_STATUS === 1) return true;

  // A track nested inside an album payload, or an album inside a track's.
  const nested = (rawData.album ?? rawData.track) as Raw;
  if (nested && nested !== rawData) {
    if (truthy(nested.parental_warning) || truthy(nested.explicit_lyrics)) return true;
  }

  return false;
}
