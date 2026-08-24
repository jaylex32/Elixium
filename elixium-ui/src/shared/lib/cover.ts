type Raw = Record<string, unknown>;

/** Extract cover image URL from any Deezer or Qobuz rawData shape */
export function extractCover(rawData: Raw | undefined | null, service: string): string | undefined {
  if (!rawData) return undefined;

  /*
   * YouTube Music carries a ready-made URL, already upgraded to full size
   * when it was parsed. Without this it falls through to the Deezer branch,
   * which reads a picture hash that YouTube items do not have — so every
   * YouTube cover would come back undefined, silently.
   */
  if (service === 'ytmusic' || rawData.ytmusic === true) {
    const cover = rawData.cover;
    if (typeof cover === 'string' && cover.startsWith('http')) return cover;
    return undefined;
  }

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
  /*
   * Picture hash → CDN URL (internal Deezer format from the private API).
   *
   * The path segment is the *kind* of image, not a constant: a playlist lives
   * under /images/playlist/, an artist under /images/artist/, and only an
   * album under /images/cover/. Playlists were missing entirely here, which is
   * why playlist artwork never appeared — PLAYLIST_PICTURE was never read, and
   * pointing its hash at /cover/ would 404 anyway.
   */
  const pictureSources: Array<[key: string, kind: string]> = [
    ['ALB_PICTURE', 'cover'],
    ['PLAYLIST_PICTURE', 'playlist'],
    ['ART_PICTURE', 'artist'],
  ];

  for (const [key, kind] of pictureSources) {
    const value = rawData[key];
    if (typeof value === 'string' && value && !value.startsWith('http')) {
      // PICTURE_TYPE, when present, is authoritative over the key we matched.
      const type = typeof rawData.PICTURE_TYPE === 'string' && rawData.PICTURE_TYPE ? rawData.PICTURE_TYPE : kind;
      return `https://e-cdns-images.dzcdn.net/images/${type}/${value}/500x500-000000-80-0-0.jpg`;
    }
  }

  // Public API format: album.cover_xl / cover_big / cover_medium
  const dAlbum = rawData.album as Raw | undefined;
  for (const key of ['cover_xl', 'cover_big', 'cover_medium', 'cover'] as const) {
    const v = (dAlbum?.[key] ?? rawData[key]) as string | undefined;
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }

  /*
   * Ready-made picture URLs, before any hash is reconstructed.
   *
   * A chart playlist carries both `picture_*` URLs and an `md5_image`, and the
   * md5 branch used to win — building an /images/cover/ path for what is a
   * playlist image, which 404s. That is why playlist artwork was blank in
   * Charts while album artwork beside it was fine. A URL the service handed us
   * is always more trustworthy than one assembled from a hash and a guess at
   * the kind.
   */
  for (const key of ['picture_xl', 'picture_big', 'picture_medium', 'picture'] as const) {
    const v = rawData[key] as string | undefined;
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }

  // md5_image hash (public API tracks, albums and playlists). picture_type
  // names the CDN folder — 'cover' for albums, 'playlist', 'artist'.
  const md5 = rawData.md5_image as string | undefined;
  if (typeof md5 === 'string' && md5) {
    const kind = typeof rawData.picture_type === 'string' && rawData.picture_type ? rawData.picture_type : 'cover';
    return `https://e-cdns-images.dzcdn.net/images/${kind}/${md5}/500x500-000000-80-0-0.jpg`;
  }

  return undefined;
}

/** Build a Deezer CDN cover URL from an ALB_PICTURE hash */
export function deezerCoverUrl(hash: string, size = 500): string {
  return `https://e-cdns-images.dzcdn.net/images/cover/${hash}/${size}x${size}-000000-80-0-0.jpg`;
}
