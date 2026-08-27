/**
 * Turning YouTube Music's renderer trees into the shape the rest of Elixium
 * speaks.
 *
 * The innertube response is a UI description, not a data model: a song's
 * artist, album and duration all arrive as one flat list of text runs in the
 * second column, separated by bullet characters, in an order that varies by
 * result type. There is no field to read. The functions here do the reading,
 * defensively, because every one of these paths is a shape YouTube can change
 * without telling anybody.
 *
 * Nothing here throws on a malformed item. A search that returns twenty
 * results of which one is unrecognisable should return nineteen, not fail —
 * the alternative is a whole page disappearing because YouTube added a badge.
 */
import type {SearchResult} from '../../app/interactive-types';

/** The bullet YouTube separates metadata segments with. */
const BULLET = '•';

/**
 * Read a renderer's text runs as a flat array of strings.
 *
 * Two shapes exist and both turn up on the same page: list columns nest their
 * runs under `text`, while header fields carry `runs` directly. Handling only
 * the first returned an empty title for every album and playlist.
 */
const runsOf = (node: any): string[] => {
  const runs = node?.runs ?? node?.text?.runs;
  return Array.isArray(runs) ? runs.map((run: any) => String(run?.text ?? '')) : [];
};

/** The text of one flex column, joined. */
const columnText = (item: any, index: number): string =>
  runsOf(item?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer).join('');

/**
 * Split a metadata column into its bullet-separated segments.
 *
 * Artists arrive as several runs joined by commas and ampersands, so the
 * segments have to be rebuilt from the runs rather than from a split on the
 * rendered string — a band with a bullet in its name would otherwise cut the
 * line in the wrong place.
 */
const segmentsOf = (item: any, index: number): string[] => {
  const runs = runsOf(item?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer);
  const segments: string[] = [];
  let current = '';
  for (const run of runs) {
    if (run.trim() === BULLET) {
      segments.push(current.trim());
      current = '';
      continue;
    }
    current += run;
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
};

/** `6:10` or `1:02:03` to seconds. Returns null for anything else. */
export const durationToSeconds = (value: string): number | null => {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
};

/** Does this segment look like a duration rather than a name? */
const isDuration = (value: string): boolean => durationToSeconds(value) !== null;

/**
 * The largest cover the URL can serve.
 *
 * YouTube hands back a 120px thumbnail in search results, which is unusable as
 * embedded artwork. Both of its image hosts encode the size in the URL and
 * will serve a larger one on request, so the size is rewritten rather than
 * accepted. Covers matter here: a downloaded file carries its artwork forever.
 */
export const upgradeThumbnail = (url: string, size = 1000): string => {
  if (!url) return '';
  // googleusercontent: ...=w120-h120-l90-rj
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  // i.ytimg.com/vi/<id>/hqdefault.jpg and friends
  if (/i\.ytimg\.com\/vi\//.test(url)) return url.replace(/\/[a-z]+default\.jpg/, '/maxresdefault.jpg');
  return url;
};

/** The best thumbnail an item carries, upgraded. */
export const thumbnailOf = (item: any, size = 1000): string => {
  const thumbs =
    item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    item?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ??
    /* Home and genre cards nest it one level deeper, under
       `thumbnailRenderer` rather than `thumbnail` — miss this and every
       card on the home page renders without artwork. */
    item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    item?.thumbnails ??
    [];
  if (!Array.isArray(thumbs) || thumbs.length === 0) return '';
  const largest = [...thumbs].sort((a, b) => (a?.width ?? 0) - (b?.width ?? 0)).pop();
  return upgradeThumbnail(String(largest?.url ?? ''), size);
};

/** The video id a song row plays. */
const videoIdOf = (item: any): string =>
  String(
    item?.playlistItemData?.videoId ??
      item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
        ?.watchEndpoint?.videoId ??
      '',
  );

/**
 * What kind of upload a row plays.
 *
 * YouTube labels every row: ATV is the album audio — the master, the same one
 * on the release — while OMV, OFFICIAL_SOURCE_MUSIC and UGC are videos, whose
 * audio is the video's soundtrack rather than the record. That distinction is
 * invisible in the title and audible in the file: a video carries label
 * idents, crowd noise, a different mix and a different length.
 *
 * Read rather than guessed. The alternative is inferring it from a channel
 * name ending in " - Topic", which is a convention rather than a rule.
 */
export const musicVideoTypeOf = (item: any): string => {
  const endpoints = [
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint,
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint,
    item?.navigationEndpoint,
  ];
  for (const endpoint of endpoints) {
    const kind = endpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
    if (kind) return String(kind);
  }
  return '';
};

/** Is this the album master rather than a video's soundtrack? */
export const isAlbumAudio = (musicVideoType: string | undefined | null): boolean =>
  String(musicVideoType ?? '') === 'MUSIC_VIDEO_TYPE_ATV';

/** The browse id an album, artist or playlist row opens. */
const browseIdOf = (item: any): string =>
  String(
    item?.navigationEndpoint?.browseEndpoint?.browseId ??
      item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
        ?.watchPlaylistEndpoint?.playlistId ??
      '',
  );

/** A year, if one of the segments is a bare four-digit number. */
const yearOf = (segments: string[]): number | null => {
  const year = segments.find((segment) => /^(19|20)\d{2}$/.test(segment.trim()));
  return year ? Number(year) : null;
};

/**
 * One search row, as a SearchResult.
 *
 * `type` is passed in rather than inferred: the row itself only says "Song" or
 * "Album" in a segment that is localised, and reading a localised string to
 * decide a code path is a bug waiting for the first non-English user.
 */
/**
 * The ids a row links its artist and album to.
 *
 * Every name in a row is a link with a browse id behind it, tagged by what it
 * points at — so an artist can be told from an album without depending on which
 * column it landed in, which varies by row type. Reading them is what lets a
 * YouTube Music track behave like a Deezer or Qobuz one: the names become ways
 * into the catalogue rather than plain text.
 */
export const linkedIdsOf = (item: any): {artistId?: string; albumId?: string} => {
  const found: {artistId?: string; albumId?: string} = {};

  for (const column of item?.flexColumns ?? []) {
    for (const run of column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) {
      const endpoint = run?.navigationEndpoint?.browseEndpoint;
      const browseId = endpoint?.browseId;
      if (!browseId) continue;
      const pageType = String(
        endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '',
      );
      if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' && !found.artistId) found.artistId = String(browseId);
      if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' && !found.albumId) found.albumId = String(browseId);
    }
  }

  return found;
};

/**
 * Is this row marked explicit?
 *
 * YouTube Music badges it the same way the other services flag it, and even
 * distinguishes a clean edit of the same song — so this is read rather than
 * inferred from the title.
 */
export const isExplicitRow = (item: any): boolean =>
  (item?.badges ?? []).some((badge: any) => badge?.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE');

export const parseSearchItem = (item: any, type: 'track' | 'album' | 'artist' | 'playlist'): SearchResult | null => {
  if (!item) return null;

  const title = columnText(item, 0).trim();
  if (!title) return null;

  const segments = segmentsOf(item, 1);
  const cover = thumbnailOf(item);

  if (type === 'artist') {
    const id = browseIdOf(item);
    if (!id) return null;
    return {
      id,
      title,
      artist: title,
      album: '',
      duration: '',
      type: 'artist',
      rawData: {ytmusic: true, browseId: id, cover, subscribers: segments[1] ?? ''},
    };
  }

  if (type === 'track') {
    const id = videoIdOf(item);
    if (!id) return null;

    /*
     * Segments for a song are [artist, album, duration] — but the album is
     * absent for singles and non-album uploads, so the duration is found from
     * the end rather than by position.
     */
    const durationText = segments.find(isDuration) ?? '';
    const withoutDuration = segments.filter((segment) => !isDuration(segment));
    const artist = withoutDuration[0] ?? '';
    const album = withoutDuration.length > 1 ? withoutDuration[withoutDuration.length - 1] : '';

    return {
      id,
      title,
      artist,
      album,
      duration: durationText,
      type: 'track',
      rawData: {
        ytmusic: true,
        videoId: id,
        cover,
        durationSeconds: durationToSeconds(durationText),
        artists: withoutDuration.slice(0, Math.max(1, withoutDuration.length - 1)),
        explicit: isExplicitRow(item),
        musicVideoType: musicVideoTypeOf(item),
        ...linkedIdsOf(item),
      },
    };
  }

  const id = browseIdOf(item);
  if (!id) return null;

  if (type === 'album') {
    return {
      id,
      title,
      artist:
        segments.find((segment) => !/^(19|20)\d{2}$/.test(segment) && !/^(Album|Single|EP)$/i.test(segment)) ?? '',
      album: title,
      duration: '',
      year: yearOf(segments),
      type: 'album',
      rawData: {ytmusic: true, browseId: id, cover, segments, explicit: isExplicitRow(item), ...linkedIdsOf(item)},
    };
  }

  // Playlist: the last segment is usually a track count such as "50 songs".
  const countSegment = segments.find((segment) => /\d+\s+(song|track)/i.test(segment));
  const trackCount = countSegment ? Number(/\d+/.exec(countSegment)?.[0] ?? 0) : undefined;
  return {
    id,
    title,
    artist: segments.find((segment) => !/^Playlist$/i.test(segment) && segment !== countSegment) ?? 'YouTube Music',
    album: '',
    duration: '',
    type: 'playlist',
    ...(trackCount ? {trackCount} : {}),
    rawData: {ytmusic: true, browseId: id, cover, segments, explicit: isExplicitRow(item), ...linkedIdsOf(item)},
  };
};

/**
 * Every row in a search response, of the requested type.
 *
 * The shelf is reached through five levels of single-child wrappers, any of
 * which is absent when YouTube returns no results — hence the optional chain
 * rather than a series of guards that would all say the same thing.
 */
export const parseSearch = (
  response: any,
  type: 'track' | 'album' | 'artist' | 'playlist',
  limit = 50,
): SearchResult[] => {
  const sections =
    response?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
    [];

  const results: SearchResult[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const rows = section?.musicShelfRenderer?.contents;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const parsed = parseSearchItem(row?.musicResponsiveListItemRenderer, type);
      if (parsed) results.push(parsed);
      if (results.length >= limit) return results;
    }
  }
  return results;
};

/**
 * The cursor for the next page, if YouTube offered one.
 *
 * Buried at a different depth depending on which shape the response came in,
 * and absent once the results run out — which is the only signal that there is
 * nothing more, since no total is ever reported.
 */
export const continuationOf = (response: any): string | null => {
  const shelf =
    response?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  const fromShelf = (Array.isArray(shelf) ? shelf : [])
    .map((section: any) => section?.musicShelfRenderer?.continuations?.[0]?.nextContinuationData?.continuation)
    .find(Boolean);
  if (fromShelf) return String(fromShelf);

  const continued = response?.continuationContents?.musicShelfContinuation;
  const fromContinued = continued?.continuations?.[0]?.nextContinuationData?.continuation;
  if (fromContinued) return String(fromContinued);

  /* Grid pages — an artist's full discography — carry theirs elsewhere again. */
  const grid =
    response?.continuationContents?.gridContinuation ?? response?.continuationContents?.musicPlaylistShelfContinuation;
  const fromGrid = grid?.continuations?.[0]?.nextContinuationData?.continuation;
  return fromGrid ? String(fromGrid) : null;
};

/** The cursor for the next batch of home shelves, if there is one. */
export const shelfContinuationOf = (response: any): string | null => {
  const list =
    response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer ??
    response?.continuationContents?.sectionListContinuation;
  const token = list?.continuations?.[0]?.nextContinuationData?.continuation;
  return token ? String(token) : null;
};

/**
 * The rows of a search continuation.
 *
 * A continued response puts its results under `continuationContents` rather
 * than where the first page put them, so the first-page parser finds nothing
 * in it and silently returns an empty page — which reads as "no more results"
 * and stops the paging one page in.
 */
export const parseSearchContinuation = (
  response: any,
  type: 'track' | 'album' | 'artist' | 'playlist',
  limit = 50,
): SearchResult[] => {
  const rows = response?.continuationContents?.musicShelfContinuation?.contents;
  const results: SearchResult[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const parsed = parseSearchItem(row?.musicResponsiveListItemRenderer, type);
    if (parsed) results.push(parsed);
    if (results.length >= limit) break;
  }
  return results;
};

/**
 * The cards on a "more" page — an artist's full albums, singles or playlists.
 *
 * These arrive as a grid of the same two-row cards the artist page used, so
 * they are read the same way and carry the same types.
 */
export const parseGrid = (response: any, artistName = '', limit = 100, artistBrowseId = ''): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const take = (node: any) => {
    const card = parseCarouselCard(node, artistName, artistBrowseId);
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      results.push(card);
    }
  };

  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || results.length >= limit) return;
    if (node.musicTwoRowItemRenderer) {
      take(node);
      return;
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };

  walk(response?.contents ?? response?.continuationContents);
  return results;
};

// ── Album, playlist and artist pages ─────────────────────────────────────────

/** A release or playlist, with its tracks. */
export interface YtMusicCollection {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  cover: string;
  trackCount: number;
  tracks: SearchResult[];
}

/** The header block, which differs by page type but not by much. */
const headerOf = (response: any): any => {
  const sections =
    response?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ?? [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const header = section?.musicResponsiveHeaderRenderer ?? section?.musicEditablePlaylistDetailHeaderRenderer;
    if (header) return header;
  }
  return response?.header?.musicDetailHeaderRenderer ?? null;
};

/** Every track row on a browse page, wherever the shelf ended up. */
const trackRowsOf = (response: any): any[] => {
  const sections =
    response?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ?? [];
  const rows: any[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const shelf = section?.musicShelfRenderer?.contents ?? section?.musicPlaylistShelfRenderer?.contents;
    if (Array.isArray(shelf)) rows.push(...shelf);
  }
  return rows;
};

/** The duration a browse row puts in its fixed column rather than its text. */
const fixedDurationOf = (item: any): string => {
  const columns = item?.fixedColumns ?? [];
  for (const column of Array.isArray(columns) ? columns : []) {
    const text = runsOf(column?.musicResponsiveListItemFixedColumnRenderer).join('');
    if (isDuration(text)) return text;
  }
  return '';
};

/**
 * One track from an album, playlist or artist page.
 *
 * The columns differ per page and cannot be read by position. An album row
 * puts the duration in a fixed column and leaves the artist blank; an artist's
 * top-songs row has no duration at all, a play count in the third column and
 * the album in the fourth. So each column is identified by what it contains
 * rather than by where it sits.
 */
export const parseCollectionTrack = (item: any, album: string, cover: string): SearchResult | null => {
  if (!item) return null;
  const title = columnText(item, 0).trim();
  const id = videoIdOf(item);
  if (!title || !id) return null;

  const extras: string[] = [];
  const columnCount = Array.isArray(item?.flexColumns) ? item.flexColumns.length : 0;
  for (let index = 2; index < columnCount; index += 1) {
    const text = columnText(item, index).trim();
    if (text) extras.push(text);
  }

  /* A duration may be in a fixed column, or among the flex columns, or absent. */
  const duration = fixedDurationOf(item) || extras.find(isDuration) || '';

  /*
   * Whatever is left that is neither a duration nor a play count is the album.
   * "1.2B plays" is matched on the digits-plus-word shape rather than the word
   * itself, which is localised.
   */
  const albumFromRow = extras.find((text) => !isDuration(text) && !/^[\d.,]+[KMB]?\s+\S+$/i.test(text)) ?? '';

  const trackNumber = Number(runsOf(item?.index).join('') || item?.index?.runs?.[0]?.text || 0) || null;

  return {
    id,
    title,
    artist: columnText(item, 1).trim(),
    album: album || albumFromRow,
    duration,
    type: 'track',
    rawData: {
      ytmusic: true,
      videoId: id,
      cover: thumbnailOf(item) || cover,
      durationSeconds: durationToSeconds(duration),
      ...(trackNumber ? {trackNumber} : {}),
      /* An album row is badged the same way a search row is, so a track keeps
         its marking when the album it belongs to is opened. */
      explicit: isExplicitRow(item),
      /* A playlist can hold anything the person who made it dropped in, videos
         included, so each row says which it is. */
      musicVideoType: musicVideoTypeOf(item),
      ...linkedIdsOf(item),
    },
  };
};

/**
 * An album or playlist page.
 *
 * `id` is passed in because the response does not reliably echo the browse id
 * that produced it, and the caller always knows it.
 */
export const parseCollection = (response: any, id: string): YtMusicCollection | null => {
  const header = headerOf(response);
  let title = runsOf(header?.title).join('').trim();

  /*
   * An album shared as a playlist arrives with no header at all.
   *
   * A `music.youtube.com/playlist?list=OLAK5uy_...` link — what the share
   * button gives for an album — answers in the two-column layout with the
   * tracks present and nothing describing them: no header, no microformat, not
   * even a title. Declining on a missing header meant that link resolved to
   * nothing, and the paste failed.
   *
   * Every row names its own album and artist, so the description is rebuilt
   * from the tracks. The album named by most rows is the album, which is
   * steadier than trusting the first row on a compilation.
   */
  if (!title) {
    const named = trackRowsOf(response)
      .map((row) => parseCollectionTrack(row?.musicResponsiveListItemRenderer, '', ''))
      .filter((track): track is SearchResult => track !== null);

    const counts = new Map<string, number>();
    for (const track of named) {
      const album = String(track.album ?? '').trim();
      if (album) counts.set(album, (counts.get(album) ?? 0) + 1);
    }
    const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    title = commonest || named[0]?.title || '';
  }

  if (!title) return null;

  const subtitle = runsOf(header?.subtitle);
  const secondSubtitle = runsOf(header?.secondSubtitle).join('');

  /*
   * The subtitle reads "Album • 2013" — it carries the type and the year, and
   * on an album page it does not name the artist at all. The artist is in
   * `straplineTextOne`, beside the little round artist photo. Reading it from
   * the subtitle produced an empty artist for every album, which then made
   * every match against Deezer or Qobuz far weaker than it needed to be.
   */
  const subtitleText = subtitle.join('');
  const year = Number(/(19|20)\d{2}/.exec(subtitleText)?.[0] ?? 0) || null;
  const artist =
    runsOf(header?.straplineTextOne).join('').trim() ||
    subtitle
      .filter((run) => run.trim() && run.trim() !== BULLET)
      .slice(1)
      .find((run) => !/^(19|20)\d{2}$/.test(run.trim())) ||
    '';

  /*
   * The artist link, from the header.
   *
   * An album page names its artist once, beside the round photo, rather than on
   * every row — so the rows have no artist link of their own and the tracks
   * inherit this one. Without it a track opened from an album named its artist
   * as plain text while the same track found in search linked through.
   */
  const artistId = String(
    (header?.straplineTextOne?.runs ?? []).find(
      (run: any) =>
        run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
          ?.pageType === 'MUSIC_PAGE_TYPE_ARTIST',
    )?.navigationEndpoint?.browseEndpoint?.browseId ?? '',
  );

  const rows = trackRowsOf(response);

  /* With no header there is no artwork or artist either; the rows carry both. */
  const firstRow = rows[0]?.musicResponsiveListItemRenderer;
  const cover = thumbnailOf(header) || thumbnailOf(header?.thumbnail) || thumbnailOf(firstRow);
  const artistName = artist || parseCollectionTrack(firstRow, '', '')?.artist || '';
  const tracks = rows
    .map((row) => parseCollectionTrack(row?.musicResponsiveListItemRenderer, title, cover))
    .filter((track): track is SearchResult => track !== null)
    /*
     * An album page does not repeat the artist on every row — it is stated
     * once in the header. Leaving those rows blank would hand the matcher a
     * track with no artist to match on.
     */
    .map((track) => (track.artist ? track : {...track, artist: artistName.trim()}))
    /* Rows inherit the page's artist link and its album id. */
    .map((track) => ({
      ...track,
      rawData: {
        ...track.rawData,
        ...(artistId && !track.rawData?.artistId ? {artistId} : {}),
        ...(!track.rawData?.albumId ? {albumId: id} : {}),
      },
    }));

  const declaredCount = Number(/(\d+)\s+(song|track)/i.exec(secondSubtitle)?.[1] ?? 0);

  return {
    id,
    title,
    artist: artistName.trim(),
    year,
    cover,
    trackCount: declaredCount || tracks.length,
    tracks,
  };
};

// ── Artist pages ─────────────────────────────────────────────────────────────

/** An artist page: who they are, what they are known for, what they released. */
/** Where the rest of a shelf lives, once its first ten are shown. */
export interface YtMusicMoreLink {
  browseId: string;
  params?: string;
}

export interface YtMusicArtist {
  id: string;
  name: string;
  cover: string;
  subscribers: string;
  topTracks: SearchResult[];
  releases: SearchResult[];
  /**
   * The "more" links, grouped by what they hold.
   *
   * Albums and singles are separate shelves with separate links, so each kind
   * is a list rather than a single target — following only the first would
   * lose half a discography.
   */
  more: {albums?: YtMusicMoreLink[]; playlists?: YtMusicMoreLink[]};
}

/**
 * One card from a carousel — an album, single or video.
 *
 * The subtitle is "2023" or "Album • 2023" depending on the shelf, so the year
 * is extracted by pattern rather than by position.
 */
const parseCarouselCard = (node: any, artistName: string, artistBrowseId = ''): SearchResult | null => {
  const item = node?.musicTwoRowItemRenderer;
  if (!item) return null;

  const title = runsOf(item.title).join('').trim();
  const endpoint = item?.navigationEndpoint?.browseEndpoint;
  const browseId = String(endpoint?.browseId ?? '');
  if (!title || !browseId) return null;

  /*
   * What the card actually is, according to YouTube.
   *
   * Every carousel on an artist page renders identically, and this used to
   * assume they were all albums. They are not: "Featured on" and "Playlists
   * by …" are playlists and "Fans might also like" is other artists, so all
   * fifty items came back typed as albums. The Playlists tab filtered for
   * playlists, found none of them, and said the artist had none — while the
   * Albums tab showed playlists and artists as though they were records.
   *
   * `pageType` is how YouTube itself distinguishes them, and unlike the shelf
   * headings it is not translated, so it still works for somebody not reading
   * English.
   */
  const pageType = String(
    endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '',
  );
  const type: SearchResult['type'] =
    pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' ? 'playlist' : pageType === 'MUSIC_PAGE_TYPE_ARTIST' ? 'artist' : 'album';

  const subtitle = runsOf(item.subtitle).join('');
  const year = Number(/(19|20)\d{2}/.exec(subtitle)?.[0] ?? 0) || null;

  return {
    id: browseId,
    title,
    /*
     * A playlist card's subtitle reads "Playlist • YouTube Music": the kind
     * first, the curator second. Taking the first segment labelled every
     * playlist "Playlist", which says nothing.
     */
    artist: type === 'album' ? artistName : subtitle.split('•').slice(1).join('•').trim() || artistName,
    album: type === 'album' ? title : '',
    duration: '',
    year,
    type,
    rawData: {
      ytmusic: true,
      browseId,
      cover: thumbnailOf(item),
      subtitle,
      /* An album card links to the artist whose shelf it came from. */
      ...(type === 'album' && artistBrowseId ? {artistId: artistBrowseId} : {}),
    },
  };
};

/**
 * An artist page.
 *
 * Album and single shelves are merged. They are separated in the interface by
 * a localised heading, and branching on a translated string is a bug waiting
 * for the first person who does not use English — while for the purpose here,
 * "things this artist released", the distinction earns nothing.
 */
export const parseArtist = (response: any, id: string): YtMusicArtist | null => {
  const sections =
    response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ?? [];
  if (!Array.isArray(sections) || sections.length === 0) return null;

  const header =
    response?.header?.musicImmersiveHeaderRenderer ?? response?.header?.musicVisualHeaderRenderer ?? headerOf(response);

  const name = runsOf(header?.title).join('').trim();
  if (!name) return null;

  const topTracks: SearchResult[] = [];
  const releases: SearchResult[] = [];
  const seen = new Set<string>();
  /*
   * Where the rest of each kind lives.
   *
   * An artist page shows ten albums and ten playlists and hides the remainder
   * behind a "more" link, so a discography of eighty looked like ten. The link
   * is keyed by what its shelf holds rather than by the shelf's heading, which
   * is translated.
   */
  const more: YtMusicArtist['more'] = {};

  for (const section of sections) {
    const shelfRows = section?.musicShelfRenderer?.contents;
    if (Array.isArray(shelfRows)) {
      for (const row of shelfRows) {
        const track = parseCollectionTrack(row?.musicResponsiveListItemRenderer, '', '');
        if (track) {
          if (!track.artist) track.artist = name;
          topTracks.push(track);
        }
      }
      continue;
    }

    const carousel = section?.musicCarouselShelfRenderer;
    const cards = carousel?.contents;
    if (Array.isArray(cards)) {
      let kind: SearchResult['type'] | null = null;
      for (const card of cards) {
        const release = parseCarouselCard(card, name, id);
        if (!release) continue;
        kind = kind ?? release.type;
        // Carousels overlap — a record appears under Albums and again under
        // Featured on — so the same release is not listed twice.
        if (!seen.has(release.id)) {
          seen.add(release.id);
          releases.push(release);
        }
      }

      const link =
        carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint
          ?.browseEndpoint;
      if (link?.browseId && (kind === 'album' || kind === 'playlist')) {
        const target = {browseId: String(link.browseId), params: link.params ? String(link.params) : undefined};
        /* Albums and singles are separate shelves with separate links; both
           are kept so neither half of a discography is lost. */
        const bucket = kind === 'album' ? 'albums' : 'playlists';
        more[bucket] = [...(more[bucket] ?? []), target];
      }
    }
  }

  return {
    id,
    name,
    cover: thumbnailOf(header) || thumbnailOf(header?.thumbnail?.musicThumbnailRenderer ? header.thumbnail : null),
    subscribers: runsOf(header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText).join(''),
    topTracks,
    releases,
    more,
  };
};

// ── Home and genre feeds ─────────────────────────────────────────────────────

/** One of YouTube Music's own genre or mood chips. */
export interface YtMusicGenre {
  /** The `params` blob the category page is fetched with; there is no plain id. */
  id: string;
  name: string;
  /** Which grid it came from — "Moods & moments" or "Genres". */
  section: string;
}

/**
 * The moods-and-genres page.
 *
 * These are YouTube Music's own categories, which is the point: the genre list
 * shown under YouTube Music used to fall through to Deezer's, so people were
 * browsing one service's taxonomy while believing they were in another's.
 *
 * A category is addressed by an opaque `params` value rather than an id, so
 * that is what gets carried around as the identifier.
 */
export const parseGenres = (response: any): YtMusicGenre[] => {
  const sections =
    response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ?? [];

  const genres: YtMusicGenre[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const grid = section?.gridRenderer;
    if (!grid) continue;

    const sectionName = runsOf(grid?.header?.gridHeaderRenderer?.title).join('').trim();
    for (const item of grid.items ?? []) {
      const button = item?.musicNavigationButtonRenderer;
      if (!button) continue;

      const name = runsOf(button.buttonText).join('').trim();
      const params = String(button?.clickCommand?.browseEndpoint?.params ?? '');
      if (!name || !params) continue;

      genres.push({id: params, name, section: sectionName});
    }
  }
  return genres;
};

/** A row on the home page, or on a genre page. */
export interface YtMusicShelf {
  title: string;
  items: SearchResult[];
}

/**
 * Carousel rows from a home or category page.
 *
 * Cards are a mix of albums, playlists and videos. A card that plays a single
 * track carries a videoId; one that opens a page carries a browseId. Both are
 * kept, typed by which they had, because a home row genuinely contains both
 * and dropping either leaves visible gaps.
 */
export const parseShelves = (response: any, limitPerShelf = 20): YtMusicShelf[] => {
  /*
   * A home page arrives a few shelves at a time.
   *
   * The first response carries two or three and a token for the next, which is
   * what the website follows as you scroll. A continuation puts them under
   * `sectionListContinuation` rather than where the first page put them, so
   * reading only the first shape found nothing in them and the home page
   * stopped at whatever the first response happened to include.
   */
  const sections =
    response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
      ?.contents ??
    response?.continuationContents?.sectionListContinuation?.contents ??
    [];

  const shelves: YtMusicShelf[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const carousel = section?.musicCarouselShelfRenderer;
    if (!carousel) continue;

    const title = runsOf(carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title).join('').trim();
    const items: SearchResult[] = [];

    for (const card of carousel.contents ?? []) {
      const item = card?.musicTwoRowItemRenderer;
      if (!item) continue;

      const name = runsOf(item.title).join('').trim();
      if (!name) continue;

      const browseId = String(item?.navigationEndpoint?.browseEndpoint?.browseId ?? '');
      const videoId = String(item?.navigationEndpoint?.watchEndpoint?.videoId ?? '');
      const id = browseId || videoId;
      if (!id) continue;

      const subtitle = runsOf(item.subtitle).join('').trim();
      /* A playlist browse id is prefixed VL; an album's is MPRE. */
      const type = videoId ? 'track' : browseId.startsWith('MPRE') ? 'album' : 'playlist';

      items.push({
        id,
        title: name,
        artist: subtitle,
        album: type === 'album' ? name : '',
        duration: '',
        type,
        rawData: {ytmusic: true, cover: thumbnailOf(item), subtitle, ...(videoId ? {videoId} : {browseId})},
      });

      if (items.length >= limitPerShelf) break;
    }

    if (items.length > 0) shelves.push({title, items});
  }
  return shelves;
};
