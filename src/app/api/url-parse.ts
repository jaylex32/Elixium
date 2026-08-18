/**
 * Shared link resolution for Deezer / Qobuz / Spotify / Tidal / YouTube URLs.
 *
 * Both the Socket.IO `parseUrl` handler and the REST `POST /api/v1/parse-url`
 * route delegate here, so the two transports can never disagree about what a
 * given link resolves to.
 */

export type SourceService = 'deezer' | 'qobuz' | 'spotify' | 'tidal' | 'youtube';

export interface ParseUrlDependencies {
  parseToQobuz: (url: string) => Promise<any>;
  parseDeezerUrl: (url: string) => Promise<any>;
  ensureQobuzSearchReady: () => Promise<void>;
}

export interface ParsedLinkMetadata {
  originalUrl: string;
  service: SourceService;
  contentType: string | undefined;
  trackCount: number;
  title: string;
}

const has = (url: string, ...needles: string[]): boolean => needles.some((needle) => url.includes(needle));

const isSpotify = (url: string): boolean => has(url, 'spotify.com', 'open.spotify.com') || url.startsWith('spotify:');
const isDeezer = (url: string): boolean => has(url, 'deezer.com');
const isQobuz = (url: string): boolean => has(url, 'qobuz.com', 'play.qobuz.com');
const isTidal = (url: string): boolean => has(url, 'tidal.com');
const isYouTube = (url: string): boolean => has(url, 'youtube.com', 'youtu.be');

/** Which upstream the link physically points at, regardless of where we resolve it to. */
export const detectSourceService = (url: string): SourceService => {
  if (isDeezer(url)) return 'deezer';
  if (isQobuz(url)) return 'qobuz';
  if (isTidal(url)) return 'tidal';
  if (isYouTube(url)) return 'youtube';
  return 'spotify';
};

/** The `/album/`, `/track/` … segment of the link, if present. */
const detectContentKind = (url: string): 'playlist' | 'album' | 'track' | 'artist' | undefined => {
  if (url.includes('/playlist/')) return 'playlist';
  if (url.includes('/album/')) return 'album';
  if (url.includes('/track/')) return 'track';
  if (url.includes('/artist/')) return 'artist';
  return undefined;
};

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

/**
 * Resolve a link to a concrete track list.
 *
 * `preferredService` mirrors the socket handler's optional `service` field: when
 * a caller explicitly asks for Deezer we resolve Deezer links natively instead
 * of routing them through the Qobuz matcher.
 */
export const parseMediaUrl = async (
  rawUrl: string,
  preferredService: string | undefined,
  deps: ParseUrlDependencies,
): Promise<any> => {
  const url = String(rawUrl || '').trim();
  if (!url) throw new Error('No URL provided');

  const explicit = typeof preferredService === 'string' && preferredService.length > 0;
  const routeToQobuz =
    preferredService === 'qobuz' || (!explicit && (isQobuz(url) || isSpotify(url) || isTidal(url) || isYouTube(url)));

  let parsed: any;
  let prefix = '';

  if (isSpotify(url)) {
    await deps.ensureQobuzSearchReady();
    parsed = routeToQobuz ? await deps.parseToQobuz(url) : await deps.parseDeezerUrl(url);
    prefix = 'spotify-';
  } else if (isDeezer(url)) {
    parsed = routeToQobuz ? await deps.parseToQobuz(url) : await deps.parseDeezerUrl(url);
    prefix = routeToQobuz ? 'qobuz-' : '';
  } else if (isTidal(url) || isYouTube(url) || isQobuz(url)) {
    await deps.ensureQobuzSearchReady();
    parsed = await deps.parseToQobuz(url);
    prefix = 'qobuz-';
  } else {
    throw new Error('Unsupported URL format');
  }

  // A bare YouTube watch link has no /track/ segment but always resolves to one track.
  const kind = detectContentKind(url) ?? (isYouTube(url) ? 'track' : undefined);
  if (kind) parsed.linktype = `${prefix}${kind}`;

  if (!parsed?.tracks || parsed.tracks.length === 0) {
    throw new Error('No tracks found in the provided URL');
  }

  const metadata: ParsedLinkMetadata = {
    originalUrl: url,
    service: detectSourceService(url),
    contentType: parsed.linktype,
    trackCount: parsed.tracks.length,
    title:
      // SNG_TITLE last: a Deezer track carries its name only there, which is
      // why every track URL was listed as "Unknown Content".
      firstString(
        parsed.linkinfo?.title,
        parsed.linkinfo?.name,
        parsed.linkinfo?.TITLE,
        parsed.linkinfo?.ALB_TITLE,
        parsed.linkinfo?.SNG_TITLE,
        // A single track carries no linkinfo, so its name is only on the track.
        parsed.tracks?.[0]?.SNG_TITLE,
        parsed.tracks?.[0]?.title,
      ) ?? 'Unknown Content',
  };

  parsed.metadata = metadata;
  return parsed;
};
