type Raw = Record<string, unknown>;

/** Extract cover image URL from any Deezer or Qobuz rawData shape */
export function extractCover(rawData: Raw | undefined | null, service: string): string | undefined {
  if (!rawData) return undefined;

  if (service === 'qobuz') {
    // Standard Qobuz album object: image.large
    const img = rawData.image as Raw | undefined;
    if (typeof img?.large === 'string' && img.large) return img.large;
    if (typeof img?.small === 'string' && img.small) return img.small;
    if (typeof img?.thumbnail === 'string' && img.thumbnail) return img.thumbnail;

    // Nested album object (for tracks returned from search)
    const album = rawData.album as Raw | undefined;
    const albumImg = album?.image as Raw | undefined;
    if (typeof albumImg?.large === 'string' && albumImg.large) return albumImg.large;

    // Playlist / collection image_rectangle
    const rect = rawData.image_rectangle as string | undefined;
    if (typeof rect === 'string' && rect) return rect;

    // Array of images (images_complete, images300, images_rectangle)
    for (const key of ['images_complete', 'images300', 'images_rectangle'] as const) {
      const arr = rawData[key] as string[] | undefined;
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') return arr[0];
    }

    // Flat cover_url or picture_url
    for (const key of ['cover_url', 'picture_url', 'cover', 'picture'] as const) {
      const v = rawData[key] as string | undefined;
      if (typeof v === 'string' && v.startsWith('http')) return v;
    }

    return undefined;
  }

  // ── Deezer ──────────────────────────────────────────────────────────────
  // ALB_PICTURE hash → CDN URL (internal Deezer format from piped API)
  const hash = (rawData.ALB_PICTURE as string | undefined) ?? (rawData.ART_PICTURE as string | undefined);
  if (typeof hash === 'string' && hash && !hash.startsWith('http')) {
    const type = rawData.ALB_PICTURE ? 'cover' : 'artist';
    return `https://e-cdns-images.dzcdn.net/images/${type}/${hash}/500x500-000000-80-0-0.jpg`;
  }

  // Public API format: album.cover_xl / cover_big / cover_medium
  const dAlbum = rawData.album as Raw | undefined;
  for (const key of ['cover_xl', 'cover_big', 'cover_medium', 'cover'] as const) {
    const v = (dAlbum?.[key] ?? rawData[key]) as string | undefined;
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }

  // md5_image hash (public API tracks)
  const md5 = rawData.md5_image as string | undefined;
  if (typeof md5 === 'string' && md5) {
    return `https://e-cdns-images.dzcdn.net/images/cover/${md5}/500x500-000000-80-0-0.jpg`;
  }

  // Fallback: any picture_* field
  for (const key of ['picture_xl', 'picture_big', 'picture_medium', 'picture'] as const) {
    const v = rawData[key] as string | undefined;
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }

  return undefined;
}

/** Build a Deezer CDN cover URL from an ALB_PICTURE hash */
export function deezerCoverUrl(hash: string, size = 500): string {
  return `https://e-cdns-images.dzcdn.net/images/cover/${hash}/${size}x${size}-000000-80-0-0.jpg`;
}
