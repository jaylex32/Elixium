/**
 * YouTube Music as a browsing source, downloading through Deezer or Qobuz.
 *
 * The split is deliberate. YouTube Music has the widest catalogue and the best
 * discovery, and the worst files: lossy Opus, and tags typed by whoever
 * uploaded them. Deezer and Qobuz have the opposite problem — excellent files,
 * narrower catalogues, weaker discovery. Browsing one and downloading from the
 * other gives a library that is better than either service could produce
 * alone, and it means a YouTube Music download arrives with the same tags,
 * covers and bit depth as anything else in this app.
 *
 * When a track genuinely is not on either service, this says so rather than
 * downloading something approximate. A wrong file is worse than a missing one:
 * nobody checks a file that appeared to arrive correctly.
 */
import {YtMusicClient, YtMusicError, USER_AGENT} from '../core/ytmusic/innertube';
import {
  parseSearch,
  parseSearchContinuation,
  parseGrid,
  continuationOf,
  parseCollection,
  parseArtist,
  parseGenres,
  parseShelves,
  shelfContinuationOf,
  type YtMusicCollection,
  type YtMusicArtist,
  type YtMusicGenre,
  type YtMusicShelf,
} from '../core/ytmusic/parse';
import {matchTrack, type MatchOutcome} from './ytmusic-match';
import {downloadTrack, type TrackMetadata, type DownloadedTrack} from '../core/ytmusic/download';
import {getAudioStream} from '../core/ytmusic/player';
import {cookieHeaderFromCookiesTxt, verifyYouTubeSession, type CookieImportSummary} from '../core/ytmusic/cookies-txt';
import axios, {type AxiosInstance} from 'axios';
import {mergeSetCookie} from '../core/ytmusic/cookie-jar';
import path from 'path';
import {sanitizeFilename, ytmusicSaveLayout} from '../lib/util';
import type {SearchResult} from './interactive-types';

export type ResolveTarget = 'deezer' | 'qobuz';

export interface YtMusicServiceDependencies {
  /** Search a lossless service, used to find the same recording. */
  search: (service: ResolveTarget, query: string, type: 'track', limit: number) => Promise<SearchResult[]>;
  client?: YtMusicClient;
  /**
   * The viewer's YouTube cookie, read fresh on every call.
   *
   * A function rather than a value because it is edited in Settings while
   * the engine runs — capturing it once would mean pasting a cookie had no
   * effect until a restart.
   */
  getCookie?: () => string | undefined;
  /** Persist an imported session, so it survives a restart. */
  setCookie?: (cookie: string) => void;
  /** Where YouTube Music downloads should land, read fresh each time. */
  getDownloadPath?: () => string;
  /**
   * The naming template, so YouTube Music files are laid out the way the
   * user asked for in Settings rather than by a rule hardcoded here.
   */
  getLayout?: () => string | undefined;
  /** Zero-padding width for track numbers, as configured. */
  getNumberWidth?: () => number;
  /** Take Opus over AAC, accepting that WebM cannot carry tags. */
  preferOpus?: () => boolean;
}

/** What a resolve attempt produced, per track. */
export interface ResolvedTrack {
  source: SearchResult;
  match: SearchResult | null;
  service: ResolveTarget | null;
  confidence: number | null;
  reason: MatchOutcome['reason'];
}

/** How many candidates to consider from the lossless service. */
const CANDIDATE_LIMIT = 8;

/**
 * Resolve several tracks without hammering the upstream service.
 *
 * Albums run to a couple of dozen tracks and each resolve is one or two
 * searches, so they go in small batches rather than all at once — a burst of
 * forty parallel searches is how an account starts getting rate limited.
 */
const BATCH_SIZE = 4;

export const createYtMusicService = ({
  search,
  client,
  getCookie,
  setCookie,
  getDownloadPath,
  getLayout,
  getNumberWidth,
  preferOpus,
}: YtMusicServiceDependencies) => {
  /*
   * One HTTP client for everything that talks to YouTube, so that rotated
   * cookies are captured wherever they arrive.
   *
   * Google reissues the short-lived half of a session continuously and expects
   * the new values to be stored. Replaying the originally exported ones works
   * for a while and then stops, which presents as YouTube refusing requests
   * rather than as an expired login — an hour went into blaming rate limiting
   * for it. Persisting the rotations is what a browser does, and it is what
   * keeps an imported session alive past the first hour.
   */
  const http: AxiosInstance = axios.create({
    timeout: 60_000,
    validateStatus: () => true,
    /*
     * The same headers the session scrape has always sent.
     *
     * Without them music.youtube.com serves a page with no client
     * configuration in it, and every shelf on the home screen fails with a
     * message about YouTube having changed their player. Sharing one client
     * for cookie rotation meant inheriting that requirement.
     */
    headers: {'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9'},
  });
  http.interceptors.response.use((response) => {
    const current = getCookie?.();
    if (!current) return response;
    const rotated = mergeSetCookie(current, response.headers?.['set-cookie'] as string[] | undefined);
    if (rotated) setCookie?.(rotated);
    return response;
  });

  const yt = client ?? new YtMusicClient(http);

  /** Search YouTube Music itself. */
  const searchCatalog = async (
    query: string,
    type: 'track' | 'album' | 'artist' | 'playlist',
    limit = 25,
  ): Promise<SearchResult[]> => {
    if (!query.trim()) return [];
    const response = await yt.search(query, type);
    return parseSearch(response, type, limit);
  };

  /**
   * A page of search results, with the cursor for the next one.
   *
   * YouTube pages by opaque token rather than by offset, so this hands the
   * cursor back rather than expecting the caller to count. Without it a search
   * stopped at its first twenty results with no way to reach the rest.
   */
  const searchPage = async (
    query: string,
    type: 'track' | 'album' | 'artist' | 'playlist',
    limit = 25,
    cursor?: string,
  ): Promise<{items: SearchResult[]; cursor: string | null}> => {
    if (!query.trim()) return {items: [], cursor: null};
    if (cursor) {
      const response = await yt.searchContinuation(cursor);
      return {items: parseSearchContinuation(response, type, limit), cursor: continuationOf(response)};
    }
    const response = await yt.search(query, type);
    return {items: parseSearch(response, type, limit), cursor: continuationOf(response)};
  };

  /**
   * Everything an artist has of one kind, not just the shelf preview.
   *
   * An artist page shows ten albums and ten playlists and puts the rest behind
   * a "more" link — so a discography of fifty looked like ten, and paging had
   * nothing to page through. Following those links costs one request each and
   * returns the lot, which is simpler than a cursor for a list this size.
   *
   * Tracks have no "more" link at all: YouTube gives five top songs and stops.
   * They are topped up from a search for the artist, which is where the rest of
   * their catalogue actually is.
   */
  const artistContent = async (browseId: string, kind: 'albums' | 'playlists' | 'tracks'): Promise<SearchResult[]> => {
    const page = await artist(browseId);
    if (!page) return [];

    if (kind === 'tracks') {
      const seen = new Set(page.topTracks.map((t) => String(t.id)));
      const found = await searchCatalog(page.name, 'track', 50).catch(() => []);
      return [...page.topTracks, ...found.filter((t) => !seen.has(String(t.id)))];
    }

    const wanted = kind === 'albums' ? 'album' : 'playlist';
    const items = page.releases.filter((item) => item.type === wanted);
    const seen = new Set(items.map((item) => item.id));

    for (const link of page.more[kind] ?? []) {
      try {
        const more = await yt.browseMore(link.browseId, link.params);
        for (const item of parseGrid(more, page.name, 100, browseId)) {
          if (item.type === wanted && !seen.has(item.id)) {
            seen.add(item.id);
            items.push(item);
          }
        }
      } catch {
        /* One shelf failing should not empty the tab. */
      }
    }

    return items;
  };

  const album = async (browseId: string): Promise<YtMusicCollection | null> =>
    parseCollection(await yt.browse(browseId), browseId);

  const playlist = async (browseId: string): Promise<YtMusicCollection | null> =>
    parseCollection(await yt.browse(browseId), browseId);

  const artist = async (browseId: string): Promise<YtMusicArtist | null> =>
    parseArtist(await yt.browse(browseId), browseId);

  /*
   * YouTube Music's own feeds.
   *
   * These exist because the pages behind the service switcher were falling
   * through to Deezer: picking YouTube Music showed Deezer's genres under a
   * YouTube Music heading, and a home page with nothing in it. Browsing one
   * service's catalogue while believing you are in another's is worse than an
   * empty page, so these now come from YouTube Music or not at all.
   */
  /**
   * YouTube Music's home page, followed past its first response.
   *
   * It hands over two or three shelves and a token for the next few — the
   * website follows those as you scroll, which is why its home page is long
   * and ours was not. A handful of pages is plenty for a home screen; the feed
   * goes on well past anything worth rendering at once.
   */
  const home = async (pages = 4): Promise<YtMusicShelf[]> => {
    let response = await yt.browse('FEmusic_home');
    const shelves = parseShelves(response);

    for (let page = 1; page < pages; page += 1) {
      const cursor = shelfContinuationOf(response);
      if (!cursor) break;
      try {
        response = await yt.call('browse', {continuation: cursor});
      } catch {
        break;
      }
      shelves.push(...parseShelves(response));
    }

    return shelves;
  };

  const newReleases = async (): Promise<YtMusicShelf[]> => parseShelves(await yt.browse('FEmusic_new_releases'));

  const charts = async (): Promise<YtMusicShelf[]> => parseShelves(await yt.browse('FEmusic_charts'));

  const genres = async (): Promise<YtMusicGenre[]> => parseGenres(await yt.browse('FEmusic_moods_and_genres'));

  /**
   * Everything YouTube Music puts on its own front page, under its own titles.
   *
   * The home screen used to ask for three fixed rows — Trending, Popular
   * Playlists, Top Artists — which are Deezer's and Qobuz's editorial shape,
   * not YouTube Music's. Two of them resolved to the same feed, so the page
   * showed the same eight cards twice under different headings.
   *
   * YouTube Music names its own shelves, and they are the ones its website
   * shows. Taking them as they come means the rows say what they actually
   * contain, and a shelf YouTube adds appears without a change here.
   *
   * A shelf with nothing in it is dropped rather than rendered as an empty row.
   */
  const shelves = async (): Promise<YtMusicShelf[]> => {
    const groups = await Promise.all([home(), charts(), newReleases()].map((p) => p.catch((): YtMusicShelf[] => [])));

    /* A title appearing in two feeds is one row, not two. */
    const seen = new Set<string>();
    return groups
      .flat()
      .filter((shelf) => shelf.items.length > 0)
      .filter((shelf) => {
        const key = shelf.title.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  /** One genre or mood page. Addressed by `params`, which is its only handle. */
  const genreContent = async (params: string): Promise<YtMusicShelf[]> =>
    parseShelves(await yt.call('browse', {browseId: 'FEmusic_moods_and_genres_category', params}));

  /**
   * One genre's items of a single kind.
   *
   * A genre page comes back as shelves — featured playlists, community
   * playlists, music videos, albums — while the interface asks for one kind at
   * a time. This flattens them and keeps what was asked for.
   *
   * It exists because the genre tabs were being served by Deezer. The shared
   * endpoint dispatches on service and had no branch for YouTube Music, so a
   * YouTube genre id — an opaque protobuf blob — was handed to Deezer's
   * catalogue, which returned whatever it made of it. The genre list was
   * YouTube's and the contents were not.
   *
   * Artists are not among the shelves YouTube publishes for a genre, so that
   * tab is honestly empty rather than filled from somewhere else.
   */
  const genreItems = async (
    params: string,
    kind: 'albums' | 'tracks' | 'artists' | 'playlists',
  ): Promise<SearchResult[]> => {
    const wanted =
      kind === 'albums' ? 'album' : kind === 'tracks' ? 'track' : kind === 'artists' ? 'artist' : 'playlist';
    const shelves = await genreContent(params);

    const items: SearchResult[] = [];
    const seen = new Set<string>();
    for (const shelf of shelves) {
      for (const item of shelf.items) {
        if (item.type !== wanted || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }
    return items;
  };

  /**
   * The album a track belongs to, looked up when the link does not say.
   *
   * A pasted link resolves through `videoDetails`, which carries a title and an
   * author and no album at all — and a music-video link resolves to a different
   * id from the album version, so there is nothing on it to follow.
   *
   * Searching for the track finds what YouTube Music says its album is:
   * "Never Gonna Give You Up" belongs to *Whenever You Need Somebody*, not to
   * an album of its own name. Only a result whose title is the same song is
   * accepted, because a wrong album is worse than none — once written into the
   * file it is indistinguishable from a right one.
   *
   * A genuine single returns its own title, which is what YouTube Music itself
   * reports for one.
   */
  const albumFor = async (title: string, artist: string): Promise<string> => {
    const simplify = (text: string) =>
      text
        .toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    try {
      const found = await searchCatalog(`${title} ${artist}`.trim(), 'track', 5);
      const wanted = simplify(title);
      const hit = found.find((result) => simplify(result.title) === wanted);
      if (hit?.album) return hit.album;
    } catch {
      /* A lookup that cannot run is not worth failing a paste over. */
    }
    return title;
  };

  /**
   * A track with no album named after itself.
   *
   * YouTube supplies an album for most tracks but not for all — a pasted link
   * resolves through `videoDetails`, which has no album field at all, and a
   * standalone single often has none either.
   *
   * A single is released *as* an album holding one track, which is how every
   * catalogue models it, so its own title is the right answer. The alternative
   * is an empty tag and a folder called "Unknown Album" that every unrelated
   * single in the library ends up sharing.
   */
  const withAlbum = (metadata: TrackMetadata): TrackMetadata =>
    metadata.album && metadata.album.trim() ? metadata : {...metadata, album: metadata.title};

  /**
   * Turn a pasted YouTube or YouTube Music link into tracks.
   *
   * Pasting one used to route to Qobuz. That was right when YouTube was only a
   * source to convert from — read the names off the link, find them on Qobuz,
   * the way Spotify and Tidal links still work. Now that YouTube Music is a
   * service of its own, a YouTube link should come from YouTube Music, and
   * routing it elsewhere failed outright for anyone whose Qobuz token had
   * expired: "qobuz-search is unavailable", for a link that has nothing to do
   * with Qobuz.
   *
   * Returns null for a link this cannot resolve, so the caller can fall back to
   * the matcher rather than fail.
   */
  const resolveUrl = async (
    rawUrl: string,
  ): Promise<{kind: 'track' | 'album' | 'playlist' | 'artist'; title: string; tracks: SearchResult[]} | null> => {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return null;
    }

    const host = parsed.hostname.replace(/^www\./, '');
    if (!/(^|\.)youtube\.com$/.test(host) && host !== 'youtu.be' && host !== 'music.youtube.com') return null;

    const path = parsed.pathname;
    const listId = parsed.searchParams.get('list');
    const videoId = host === 'youtu.be' ? path.slice(1).split('/')[0] : parsed.searchParams.get('v');

    /* An album or playlist page, addressed by its browse id or list id. */
    const browseMatch = /\/(?:browse|playlist)\/([\w-]+)/.exec(path);
    const browseId = browseMatch?.[1];

    if (browseId?.startsWith('MPRE')) {
      const found = await album(browseId);
      return found ? {kind: 'album', title: found.title, tracks: found.tracks} : null;
    }

    /* A channel link is an artist; their top tracks are what a paste can act on. */
    const channel = /\/channel\/([\w-]+)/.exec(path)?.[1];
    if (channel) {
      const found = await artist(channel);
      return found ? {kind: 'artist', title: found.name, tracks: found.topTracks} : null;
    }

    /*
     * A playlist wins over a video when both are present: a watch link opened
     * from a playlist carries both, and the paste means the list.
     */
    const list = listId ?? (browseId && !browseId.startsWith('MPRE') ? browseId : undefined);
    if (list) {
      /* Playlist browse ids are the list id behind a `VL`, unless already one. */
      const id = list.startsWith('VL') || list.startsWith('MPRE') ? list : `VL${list}`;
      const found = await playlist(id);
      if (found) return {kind: 'playlist', title: found.title, tracks: found.tracks};
    }

    if (videoId && /^[\w-]{11}$/.test(videoId)) {
      const details = (await yt.call('player', {videoId}))?.videoDetails;
      if (!details) return null;
      const seconds = Number(details.lengthSeconds) || 0;
      const cover = details?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ?? '';
      const name = String(details.title ?? '');
      const by = String(details.author ?? '').replace(/ - Topic$/, '');
      return {
        kind: 'track',
        title: name,
        tracks: [
          {
            id: videoId,
            title: name,
            artist: by,
            album: await albumFor(name, by),
            duration: seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '',
            type: 'track',
            rawData: {ytmusic: true, videoId, cover, durationSeconds: seconds},
          },
        ],
      };
    }

    return null;
  };

  /**
   * Find one YouTube Music track on a lossless service.
   *
   * `preferred` is tried first and the other is the fallback, because a
   * catalogue gap is the common case rather than the exception — plenty of
   * back catalogue sits on one service and not the other.
   */
  const resolveTrack = async (track: SearchResult, preferred: ResolveTarget = 'deezer'): Promise<ResolvedTrack> => {
    const source = {
      title: track.title,
      artist: track.artist,
      durationSeconds: (track.rawData?.durationSeconds as number | undefined) ?? null,
    };

    const order: ResolveTarget[] = preferred === 'deezer' ? ['deezer', 'qobuz'] : ['qobuz', 'deezer'];
    let best: {outcome: MatchOutcome; service: ResolveTarget} | null = null;

    for (const service of order) {
      const outcome = await matchTrack(source, (query) => search(service, query, 'track', CANDIDATE_LIMIT));
      if (outcome.reason === 'matched') {
        return {
          source: track,
          match: outcome.match,
          service,
          confidence: outcome.score?.score ?? null,
          reason: 'matched',
        };
      }
      // Keep the closest near-miss so the caller can explain itself.
      if (!best || (outcome.score?.score ?? 0) > (best.outcome.score?.score ?? 0)) best = {outcome, service};
    }

    return {
      source: track,
      match: null,
      service: null,
      confidence: best?.outcome.score?.score ?? null,
      reason: best?.outcome.reason ?? 'no-results',
    };
  };

  /**
   * Find tracks from another service in YouTube Music's catalogue.
   *
   * The mirror of `resolveTracks`, and the same matcher pointed the other way:
   * pasting a Spotify or Deezer playlist while on YouTube Music should convert
   * it, exactly as pasting a YouTube link while on Deezer converts it there.
   *
   * The source tracks arrive in whichever service's shape they came from, so
   * only a title, an artist and a duration are taken — that is all a match
   * needs, and it saves this from having to know four payload formats.
   */
  const matchToYtMusic = async (
    sources: Array<{title: string; artist: string; durationSeconds?: number | null}>,
  ): Promise<
    Array<{source: {title: string; artist: string}; match: SearchResult | null; reason: MatchOutcome['reason']}>
  > => {
    const matched: Array<{
      source: {title: string; artist: string};
      match: SearchResult | null;
      reason: MatchOutcome['reason'];
    }> = [];

    for (let index = 0; index < sources.length; index += BATCH_SIZE) {
      const batch = sources.slice(index, index + BATCH_SIZE);
      matched.push(
        ...(await Promise.all(
          batch.map(async (source) => {
            const outcome = await matchTrack(
              {title: source.title, artist: source.artist, durationSeconds: source.durationSeconds ?? null},
              (query) => searchCatalog(query, 'track', CANDIDATE_LIMIT),
            );
            return {
              source: {title: source.title, artist: source.artist},
              match: outcome.match,
              reason: outcome.reason,
            };
          }),
        )),
      );
    }

    return matched;
  };

  /** Resolve a whole album or playlist, in batches. */
  const resolveTracks = async (
    tracks: SearchResult[],
    preferred: ResolveTarget = 'deezer',
  ): Promise<ResolvedTrack[]> => {
    const resolved: ResolvedTrack[] = [];
    for (let index = 0; index < tracks.length; index += BATCH_SIZE) {
      const batch = tracks.slice(index, index + BATCH_SIZE);
      resolved.push(...(await Promise.all(batch.map((track) => resolveTrack(track, preferred)))));
    }
    return resolved;
  };

  /**
   * Is YouTube Music reachable and still shaped the way this expects?
   *
   * Registered as an optional provider, so this decides whether the service
   * appears as available — and it must fail rather than hang, which is what
   * the bounded client underneath guarantees.
   */
  const check = async (): Promise<void> => {
    const results = await searchCatalog('daft punk', 'track', 1);
    if (results.length === 0) {
      throw new YtMusicError(
        'parse',
        'YouTube Music returned nothing recognisable — their page layout may have changed',
      );
    }
  };

  /**
   * Download a track from YouTube Music itself.
   *
   * This is the service proper, as opposed to `resolveTrack`, which finds the
   * same recording on Deezer or Qobuz. Both exist because they answer
   * different needs: this one reaches everything YouTube has, including what
   * no catalogue carries, and pays for it in audio quality.
   */
  const download = async (
    videoId: string,
    metadata: TrackMetadata,
    outputBase: string,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<DownloadedTrack> =>
    downloadTrack(videoId, withAlbum(metadata), outputBase, {
      cookie: getCookie?.(),
      preferOpus: preferOpus?.(),
      onProgress,
      http,
    });

  /**
   * Accept a cookies.txt export and keep the YouTube session out of it.
   *
   * Netscape cookies.txt is what every browser's cookie-export extension
   * produces and what yt-dlp consumes, which makes it the one format that
   * works regardless of which browser somebody uses — unlike reading a browser
   * profile directly, where Chromium's encryption rules everything but Firefox
   * out.
   */
  const importCookiesTxt = async (
    text: string,
  ): Promise<CookieImportSummary & {signedIn: boolean | null; account?: string}> => {
    const summary = cookieHeaderFromCookiesTxt(text);
    setCookie?.(summary.cookie);

    /* Say straight away whether YouTube accepts it, rather than letting the
       first failed download be the messenger. */
    const check = await verifyYouTubeSession(summary.cookie);
    return {...summary, signedIn: check ? check.signedIn : null, ...(check?.account ? {account: check.account} : {})};
  };

  /**
   * Download a track into the library, laid out like every other download.
   *
   * Artist and album folders, a track number when the source knew one, and the
   * extension the codec dictates. The point is that a YouTube Music download
   * sits in the library indistinguishably from a Deezer or Qobuz one, apart
   * from the audio itself being lossy — which is a property of the source and
   * not something a file layout can fix.
   */
  const downloadToLibrary = async (
    videoId: string,
    raw: TrackMetadata,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<{path: string; folder: string; tagged: boolean; bitrate: number}> => {
    const metadata = withAlbum(raw);
    const root = getDownloadPath?.() || path.join('Music', 'YouTube Music');

    /*
     * The user's own naming template, when they have one.
     *
     * Falling back to a fixed layout only when no template is configured —
     * a YouTube Music download should file itself the same way a Deezer or
     * Qobuz one does, and that is a setting, not a rule for this module to
     * decide.
     */
    const template = getLayout?.() || '{album_artist}/{album}/{track_number} {title}';
    const relative = ytmusicSaveLayout({
      fields: {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        albumArtist: metadata.albumArtist,
        year: metadata.year ?? null,
        trackNumber: metadata.trackNumber ?? null,
        trackTotal: metadata.trackTotal ?? null,
        videoId,
      },
      path: template,
      minimumIntegerDigits: getNumberWidth?.() || 2,
    });

    const base = path.join(root, relative);
    const folder = path.dirname(base);

    const result = await downloadTrack(videoId, metadata, base, {
      cookie: getCookie?.(),
      preferOpus: preferOpus?.(),
      onProgress,
      http,
    });
    return {path: result.path, folder, tagged: result.tagged, bitrate: result.bitrate};
  };

  /**
   * A playable URL for one track, for the player rather than the downloader.
   *
   * Playback proxies this URL through the engine so the browser sees an
   * ordinary audio response it can seek in — YouTube's own URLs are bound to
   * the requesting session and cannot simply be handed to an <audio> element.
   */
  const streamUrl = async (videoId: string): Promise<{url: string; mimeType: string} | null> => {
    const stream = await getAudioStream(videoId, {cookie: getCookie?.(), http});
    return stream ? {url: stream.url, mimeType: stream.mimeType || 'audio/mp4'} : null;
  };

  /**
   * The lyrics YouTube Music itself shows for a track.
   *
   * They are reached the way the site reaches them: the `next` endpoint
   * returns the tabs sitting beside the player, one of which is Lyrics, and
   * its browse id leads to the text. Licensed from LyricFind and usually
   * present, which makes them a better first answer than a community
   * database — and the attribution comes back with them, because the source
   * is worth showing rather than passing off as ours.
   *
   * Plain text only: YouTube Music serves these unsynced, so there is nothing
   * to highlight line by line. Null when the track has none, which lets the
   * caller fall back rather than show an empty panel.
   */
  const lyrics = async (videoId: string): Promise<{text: string; source: string} | null> => {
    const next = await yt.call('next', {videoId});
    const tabs =
      next?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
    const tab = (Array.isArray(tabs) ? tabs : []).find((entry: any) =>
      /lyric/i.test(String(entry?.tabRenderer?.title ?? '')),
    );
    const browseId = tab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
    if (!browseId) return null;

    const page = await yt.browse(String(browseId));
    const shelf = page?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer;
    const text = (shelf?.description?.runs ?? []).map((run: any) => String(run?.text ?? '')).join('');
    if (!text.trim()) return null;

    const footer = (shelf?.footer?.runs ?? []).map((run: any) => String(run?.text ?? '')).join('');
    return {text, source: footer.replace(/^Source:\s*/i, '').trim() || 'YouTube Music'};
  };

  /** Whether a cookie has been supplied, which the interface reports. */
  const isSignedIn = (): boolean => Boolean(getCookie?.());

  return {
    searchCatalog,
    album,
    playlist,
    artist,
    resolveTrack,
    resolveTracks,
    download,
    downloadToLibrary,
    streamUrl,
    home,
    newReleases,
    charts,
    genres,
    genreContent,
    shelves,
    searchPage,
    artistContent,
    genreItems,
    resolveUrl,
    matchToYtMusic,
    importCookiesTxt,
    lyrics,
    isSignedIn,
    check,
  };
};

export type YtMusicService = ReturnType<typeof createYtMusicService>;
