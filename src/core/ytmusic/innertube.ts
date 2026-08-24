/**
 * A client for YouTube Music's internal API.
 *
 * The public YouTube Data API does not expose the music catalogue — no album
 * pages, no artist discographies, no editorial playlists — so the browsing
 * side of YouTube Music has to speak the same protocol its own web player
 * speaks: `youtubei/v1`, keyed by values embedded in the page it serves.
 *
 * Browsing needs no account. That is worth stating because the *download* side
 * emphatically does: YouTube gates stream URLs behind an attestation token
 * that this module deliberately has nothing to do with. Search, albums,
 * artists and playlists all work from a cold start with no credentials, and
 * that is the half this file covers.
 *
 * Every request is bounded and the client is injectable, because an optional
 * provider that can hang is exactly what took the whole application down
 * before — see `provider-readiness.ts`.
 */
import axios, {AxiosInstance} from 'axios';

/** Upper bound for one innertube call. Generous, but finite. */
export const YTMUSIC_TIMEOUT_MS = 15_000;

const MUSIC_ORIGIN = 'https://music.youtube.com';

/*
 * A desktop browser user agent.
 *
 * The response shape depends on which client YouTube believes it is talking
 * to; a mismatched agent gets a mobile layout whose renderers are named
 * differently, and every parser below would silently find nothing.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Search filters, as the web client sends them.
 *
 * These are base64 protobuf blobs. They are opaque by design and there is no
 * documented way to build them; they come from watching what the player sends
 * when a filter chip is clicked. Without one, a search returns a mixed shelf
 * of everything and the type asked for cannot be told apart reliably.
 */
export const SEARCH_FILTERS = {
  track: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  album: 'EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D',
  artist: 'EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D',
  playlist: 'EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D',
} as const;

export type YtMusicSearchType = keyof typeof SEARCH_FILTERS;

/** The values a request has to carry, scraped from the player page. */
export interface InnertubeSession {
  apiKey: string;
  clientVersion: string;
  visitorData: string;
  /** When this was established, so it can be refreshed rather than trusted forever. */
  fetchedAt: number;
}

export class YtMusicError extends Error {
  readonly stage: 'session' | 'request' | 'parse';
  constructor(stage: 'session' | 'request' | 'parse', message: string) {
    super(message);
    this.name = 'YtMusicError';
    this.stage = stage;
  }
}

const newClient = (): AxiosInstance =>
  axios.create({
    timeout: YTMUSIC_TIMEOUT_MS,
    headers: {'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9'},
  });

/** How long a scraped session is trusted before it is fetched again. */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Read the three values a request needs out of the player page.
 *
 * They are embedded in the HTML as JSON rather than served by an endpoint, so
 * this is a scrape and will break the day YouTube renames them. It fails with
 * a stage of its own so that a change here is distinguishable from the network
 * being down — the two need completely different responses from whoever reads
 * the report.
 */
export const fetchSession = async (http: AxiosInstance = newClient()): Promise<InnertubeSession> => {
  const {data} = await http.get<string>(MUSIC_ORIGIN + '/');
  const page = typeof data === 'string' ? data : '';

  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(page)?.[1];
  const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(page)?.[1];
  const visitorData = /"VISITOR_DATA":"([^"]+)"/.exec(page)?.[1];

  if (!apiKey || !clientVersion) {
    throw new YtMusicError(
      'session',
      'Could not read YouTube Music’s client configuration — they have changed their player and this needs an update',
    );
  }

  return {apiKey, clientVersion, visitorData: visitorData ?? '', fetchedAt: Date.now()};
};

/**
 * A YouTube Music client that keeps one session and reuses it.
 *
 * Not a singleton: the tests build their own with a fake transport, which is
 * the only way any of this is checkable without the network.
 */
export class YtMusicClient {
  private session: InnertubeSession | null = null;
  private inFlight: Promise<InnertubeSession> | null = null;

  constructor(
    private readonly http: AxiosInstance = newClient(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The current session, fetching or refreshing it when necessary. */
  async ensureSession(force = false): Promise<InnertubeSession> {
    if (!force && this.session && this.now() - this.session.fetchedAt < SESSION_TTL_MS) return this.session;
    // One fetch at a time; a burst of searches on a cold start must not each
    // scrape the page.
    if (!this.inFlight) {
      this.inFlight = fetchSession(this.http).finally(() => {
        this.inFlight = null;
      });
    }
    this.session = await this.inFlight;
    return this.session;
  }

  /**
   * One innertube call.
   *
   * A 400 usually means the scraped session has gone stale rather than that
   * the request was wrong, so it is retried once against a fresh one. Beyond
   * that it gives up rather than looping — an unbounded retry against a
   * service that is refusing is how a provider stops being optional.
   */
  async call(endpoint: string, body: Record<string, unknown>, retry = true): Promise<any> {
    const session = await this.ensureSession();

    const response = await this.http.post(
      `${MUSIC_ORIGIN}/youtubei/v1/${endpoint}?key=${encodeURIComponent(session.apiKey)}`,
      {
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: session.clientVersion,
            hl: 'en',
            gl: 'US',
            ...(session.visitorData ? {visitorData: session.visitorData} : {}),
          },
        },
        ...body,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: MUSIC_ORIGIN,
          Referer: MUSIC_ORIGIN + '/',
          ...(session.visitorData ? {'X-Goog-Visitor-Id': session.visitorData} : {}),
        },
        validateStatus: () => true,
      },
    );

    if (response.status === 400 && retry) {
      await this.ensureSession(true);
      return this.call(endpoint, body, false);
    }

    if (response.status !== 200) {
      throw new YtMusicError('request', `YouTube Music answered ${response.status} for ${endpoint}`);
    }

    return response.data;
  }

  /** Search one type. The filter is what makes the results homogeneous. */
  search(query: string, type: YtMusicSearchType): Promise<any> {
    return this.call('search', {query, params: SEARCH_FILTERS[type]});
  }

  /**
   * The next page of a search.
   *
   * YouTube pages by opaque cursor rather than by offset — asking for an
   * offset returns the first rows again — so continuing means handing back the
   * token the previous response carried.
   */
  searchContinuation(token: string): Promise<any> {
    return this.call('search', {continuation: token});
  }

  /** An album, artist or playlist page. */
  browse(browseId: string): Promise<any> {
    return this.call('browse', {browseId});
  }

  /**
   * A browse page reached through a shelf's "more" link.
   *
   * An artist page shows ten of each kind and puts the rest behind one of
   * these; the `params` blob is what selects albums rather than singles, so it
   * has to travel with the id.
   */
  browseMore(browseId: string, params?: string, continuation?: string): Promise<any> {
    if (continuation) return this.call('browse', {continuation});
    return this.call('browse', {browseId, ...(params ? {params} : {})});
  }
}
