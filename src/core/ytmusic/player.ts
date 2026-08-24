/**
 * Getting a playable audio stream out of YouTube.
 *
 * This is the part YouTube actively defends, and the defence is why the
 * approach here looks the way it does.
 *
 * A stream URL comes from the `player` endpoint, and which clients that
 * endpoint will serve changes constantly. Most now demand an attestation token
 * minted by an obfuscated challenge; the ones that do not are a shrinking set,
 * and even those refuse most requests from a signed-out caller. Measured
 * against six well-known videos with four clients tried in turn and no
 * cookies, exactly one produced audio.
 *
 * So the design is:
 *
 *  - Try several clients in order, cheapest and least encumbered first.
 *  - Send the user's cookies when they have supplied them. Signed in, the same
 *    endpoints answer normally; this is what makes the feature usable rather
 *    than a lottery.
 *  - Descramble whatever needs descrambling, ourselves, in `signature.ts`.
 *  - Fail with a reason that says which of those went wrong, because "could
 *    not download" is useless to somebody deciding whether to paste a cookie.
 */
import crypto from 'crypto';
import axios, {AxiosInstance} from 'axios';
import {parseCipher, solverFor, resolveCipher, resolveThrottle} from './signature';

/** Upper bound for one player call. */
export const PLAYER_TIMEOUT_MS = 20_000;

export interface AudioStream {
  url: string;
  itag: number;
  mimeType: string;
  /** Bits per second, as YouTube reports it. */
  bitrate: number;
  /** Bytes, when reported — used to verify a download arrived whole. */
  contentLength: number | null;
  /** `opus` or `mp4a`, which decides the container the file is saved in. */
  codec: 'opus' | 'aac' | 'other';
  /** Which client produced this, for diagnostics. */
  client: string;
  /**
   * The User-Agent the URL was issued to.
   *
   * Not decoration: googlevideo ties a stream URL to the client that asked for
   * it and answers 403 to anyone else, so the download has to introduce itself
   * the same way the player call did.
   */
  userAgent: string;
  /**
   * Set when the URL arrived scrambled and still needs descrambling.
   *
   * Kept separate from `url` deliberately. These used to share one field, so a
   * cipher was handed to the HTTP client as though it were an address — which
   * failed as a refused connection to localhost and said nothing about
   * signatures at all.
   */
  cipher?: string;
}

export type PlayerFailureKind =
  | 'login-required'
  | 'unavailable'
  | 'no-audio'
  | 'network'
  | 'cipher'
  | 'rate-limited'
  | 'partial'
  | 'unknown';

export class PlayerError extends Error {
  readonly kind: PlayerFailureKind;
  /** What each client said, so a report explains itself. */
  readonly attempts: Array<{client: string; status: string}>;
  constructor(kind: PlayerFailureKind, message: string, attempts: Array<{client: string; status: string}> = []) {
    super(message);
    this.name = 'PlayerError';
    this.kind = kind;
    this.attempts = attempts;
  }
}

interface ClientProfile {
  name: string;
  userAgent: string;
  context: Record<string, unknown>;
  /** True when this client's URLs arrive ready to use, with no signature to undo. */
  directUrls: boolean;
  /** The number YouTube expects in `X-YouTube-Client-Name`. */
  clientNumber: number;
  /**
   * Whether this client can be given the viewer's cookies.
   *
   * The app clients cannot. Sent a session they answer with no playability
   * status at all — which reads as a mysterious failure and cost several
   * rounds of debugging, because the fastest and most useful clients were
   * being broken by the very thing meant to help them. Only the web and TV
   * clients take a session; the rest are anonymous by design and work best
   * left that way.
   */
  supportsCookies: boolean;
}

/**
 * Clients, in the order they are tried.
 *
 * Two things about this list matter more than anything else in this file.
 *
 * The versions must be current. YouTube checks them, and a stale one is not
 * politely ignored — it is answered with `LOGIN_REQUIRED` and "sign in to
 * confirm you're not a bot", which reads exactly like a missing session and
 * sends whoever is debugging it hunting for a cookie problem that does not
 * exist. This list sat two years out of date and cost a full day on that
 * misreading. Measured directly: the same track, same connection, no cookies —
 * ANDROID_VR 1.60.19 was refused as a bot, ANDROID_VR 1.65.10 returned four
 * direct audio streams. When YouTube starts refusing everything, check these
 * against yt-dlp's INNERTUBE_CLIENTS before suspecting anything else.
 *
 * ANDROID_VR leads because it needs no session and its URLs arrive
 * unencumbered — no signature to undo, no throttling parameter. The web
 * clients are last: they answer for a signed-in caller but hand back scrambled
 * URLs that have to be run through the player to be usable.
 */
const CLIENTS: ClientProfile[] = [
  {
    /*
     * Apple Vision Pro's client, and the one yt-dlp reaches for first.
     *
     * It is the best-behaved client available to a caller with no session: it
     * needs no attestation token, its URLs arrive with nothing to descramble,
     * and — the part that matters — they serve the whole file rather than the
     * first megabyte. Verified against a real track with no cookies at all:
     * five direct formats, and a request for the final bytes answered 206.
     *
     * It leads because everything after it is a compromise of some kind.
     */
    name: 'VISIONOS',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    directUrls: true,
    clientNumber: 101,
    supportsCookies: false,
    context: {
      clientName: 'VISIONOS',
      clientVersion: '1.02',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'TV_DOWNGRADED',
    userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
    directUrls: true,
    clientNumber: 7,
    supportsCookies: true,
    /* Deliberately an older TV build; the current one is refused far more. */
    context: {clientName: 'TVHTML5', clientVersion: '5.20260707', hl: 'en', gl: 'US'},
  },
  {
    /*
     * The older VR build leads, and the newer one follows it, because they
     * fail in opposite directions.
     *
     * 1.60.19 is refused outright for a lot of music — `LOGIN_REQUIRED`, "sign
     * in to confirm you're not a bot" — but when it does answer, its URLs
     * serve the whole file. 1.65.10 is admitted far more often and then serves
     * only the first megabyte and answers 403 for every byte after it.
     *
     * Upgrading to the newer one alone looked like an improvement, because
     * more tracks reached `OK`, and broke downloads that had been working.
     * That is the trap this ordering exists to avoid: a playable answer and a
     * downloadable URL are not the same thing, which is why `servesWholeFile`
     * checks rather than assumes.
     */
    name: 'ANDROID_VR',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip',
    directUrls: true,
    clientNumber: 28,
    supportsCookies: false,
    context: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'ANDROID_VR_CURRENT',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; GB) gzip',
    directUrls: true,
    clientNumber: 28,
    supportsCookies: false,
    context: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.65.10',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'IOS',
    userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
    directUrls: true,
    clientNumber: 5,
    supportsCookies: false,
    context: {
      clientName: 'IOS',
      clientVersion: '21.26.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'TVHTML5',
    userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
    directUrls: false,
    clientNumber: 7,
    supportsCookies: true,
    context: {clientName: 'TVHTML5', clientVersion: '7.20260707.07.00', hl: 'en', gl: 'US'},
  },
  {
    name: 'MWEB',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
    directUrls: false,
    clientNumber: 2,
    supportsCookies: true,
    context: {clientName: 'MWEB', clientVersion: '2.20260708.05.00', hl: 'en', gl: 'US'},
  },
  {
    name: 'WEB',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    directUrls: false,
    clientNumber: 1,
    supportsCookies: true,
    context: {clientName: 'WEB', clientVersion: '2.20260708.00.00', hl: 'en', gl: 'US'},
  },
  /*
   * The 2024 web builds, kept as a last resort.
   *
   * They are not here out of nostalgia. Signed in, these answered and served
   * whole files when the current builds returned "the page needs to be
   * reloaded" for the same track on the same session. Which build YouTube
   * favours moves around, so both are tried rather than guessed between, and
   * `servesWholeFile` decides which one actually delivers.
   */
  {
    name: 'MWEB_2024',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    directUrls: false,
    clientNumber: 2,
    supportsCookies: true,
    context: {clientName: 'MWEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US'},
  },
  {
    name: 'WEB_2024',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    directUrls: false,
    clientNumber: 1,
    supportsCookies: true,
    context: {clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US'},
  },
];

const newClient = (): AxiosInstance => axios.create({timeout: PLAYER_TIMEOUT_MS, validateStatus: () => true});

/**
 * The smallest gap between two player requests.
 *
 * This was a second and a half, chosen when a long refusal looked like YouTube
 * throttling us. It was not: the session had expired, and the gap was solving
 * a problem that did not exist. What it did do was make every track cost the
 * gap once per client tried — ten clients, fifteen seconds of deliberate
 * waiting before a note of audio, on a resolve whose real work takes under a
 * second.
 *
 * A courtesy gap is still worth keeping so a hundred-track queue does not
 * arrive as one burst, but it belongs at a scale nobody waits on.
 */
const MINIMUM_REQUEST_GAP_MS = 150;

let lastRequestAt = 0;
let pending: Promise<void> = Promise.resolve();

/**
 * The client that last produced a usable stream.
 *
 * Which client YouTube favours is a property of the moment, not of the track,
 * and the list is tried in a fixed order — so once the answer is known, the
 * clients before it are pure latency. Leading with the last one that worked
 * turns the common case from ten attempts into one.
 */
let preferredClient: string | null = null;

/**
 * Resolved streams, briefly.
 *
 * Playing a track and then downloading it resolved it twice, and the second
 * resolve was as slow as the first. The URLs carry their own expiry, so this
 * holds them for well under it.
 */
const RESOLVED_TTL_MS = 20 * 60 * 1000;
const resolved = new Map<string, {stream: AudioStream; at: number}>();

/** Forget resolved streams, for tests and after a session change. */
export const clearStreamCache = (): void => {
  resolved.clear();
  preferredClient = null;
};

/**
 * Space player requests out, however many callers there are.
 *
 * Serialised through one promise chain so that parallel downloads queue behind
 * each other instead of each independently deciding it has waited long enough.
 */
const paced = <T>(work: () => Promise<T>): Promise<T> => {
  const turn = pending.then(async () => {
    const wait = MINIMUM_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  pending = turn.catch(() => undefined);
  return turn.then(work);
};

const YOUTUBE_ORIGIN = 'https://www.youtube.com';

/** Pull one cookie's value out of a Cookie header. */
export const cookieValue = (cookie: string | undefined, name: string): string | null => {
  if (!cookie) return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie);
  return match ? match[1] : null;
};

/**
 * The signature Google's own pages send alongside their cookies.
 *
 * Sending the cookies alone is not enough: an authenticated innertube request
 * is rejected without an `Authorization` header derived from `SAPISID`, the
 * timestamp and the origin. This is the same construction the YouTube web
 * player performs on every request it makes, and without it a perfectly valid
 * session looks signed-out.
 */
export const sapisidHashHeader = (cookie: string | undefined, now: () => number = Date.now): string | null => {
  const sapisid = cookieValue(cookie, 'SAPISID') ?? cookieValue(cookie, '__Secure-3PAPISID');
  if (!sapisid) return null;
  const timestamp = Math.floor(now() / 1000);
  const digest = crypto.createHash('sha1').update(`${timestamp} ${sapisid} ${YOUTUBE_ORIGIN}`).digest('hex');
  return `SAPISIDHASH ${timestamp}_${digest}`;
};

/** Which codec family an itag belongs to, from its MIME type. */
const codecOf = (mimeType: string): AudioStream['codec'] => {
  if (/opus/i.test(mimeType)) return 'opus';
  if (/mp4a/i.test(mimeType)) return 'aac';
  return 'other';
};

/**
 * Pick the best audio format on offer.
 *
 * YouTube offers the same track as AAC in MP4 and as Opus in WebM. Opus is
 * marginally higher bitrate — around 137kbps against 131 — and is the better
 * codec at equal rate, so on audio quality alone it would win.
 *
 * AAC is chosen anyway, because a WebM file cannot be tagged. There is no
 * writer for matroska, so an Opus download would arrive with no title, no
 * artist and no cover, and would stay that way in the library forever. Six
 * kilobits per second is a smaller loss than every tag on the file, and both
 * formats are lossy regardless.
 *
 * `preferOpus` exists for a caller that would rather have the bitrate and does
 * not care about tags.
 */
export const bestAudioFormat = (
  formats: any[],
  client: string,
  preferOpus = false,
  userAgent = '',
): AudioStream | null => {
  const audio = (Array.isArray(formats) ? formats : []).filter((format) =>
    String(format?.mimeType ?? '').startsWith('audio'),
  );
  if (audio.length === 0) return null;

  const taggable = (format: any) => codecOf(String(format?.mimeType ?? '')) === 'aac';

  const ranked = [...audio].sort((a, b) => {
    if (!preferOpus) {
      // A taggable container first, whatever its bitrate.
      const byContainer = Number(taggable(b)) - Number(taggable(a));
      if (byContainer !== 0) return byContainer;
    }
    const byBitrate = (b?.bitrate ?? 0) - (a?.bitrate ?? 0);
    if (byBitrate !== 0) return byBitrate;
    return codecOf(String(b?.mimeType ?? '')) === 'opus' ? 1 : -1;
  });

  const best = ranked[0];
  const mimeType = String(best?.mimeType ?? '');
  const url = String(best?.url ?? '');
  const cipher = String(best?.signatureCipher ?? best?.cipher ?? '');

  return {
    url,
    ...(url ? {} : {cipher}),
    itag: Number(best?.itag ?? 0),
    mimeType,
    bitrate: Number(best?.bitrate ?? 0),
    contentLength: best?.contentLength ? Number(best.contentLength) : null,
    codec: codecOf(mimeType),
    client,
    userAgent,
  };
};

export interface PlayerOptions {
  /** The viewer's YouTube cookies. Without them most requests are refused. */
  cookie?: string;
  /** Take the higher-bitrate Opus stream, accepting that it cannot be tagged. */
  preferOpus?: boolean;
  http?: AxiosInstance;
  /** Overridden in tests; otherwise scraped from the watch page. */
  apiKey?: string;
}

/** Read the innertube key from the watch page, which is where it is published. */
export const fetchPlayerApiKey = async (http: AxiosInstance): Promise<string> => {
  return (await fetchPlayerSession(http)).apiKey;
};

/**
 * The API key and visitor identity, read from YouTube's own page.
 *
 * The visitor id is not optional dressing. A caller with no session and no
 * visitor identity looks like a script to YouTube, and gets refused as one;
 * sending a freshly scraped one is what a browser on its first visit does.
 */
export const fetchPlayerSession = async (
  http: AxiosInstance,
): Promise<{apiKey: string; visitorData: string | undefined}> => {
  const {data} = await http.get('https://www.youtube.com/', {
    headers: {'User-Agent': CLIENTS[CLIENTS.length - 1].userAgent},
  });
  const page = typeof data === 'string' ? data : '';
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(page)?.[1];
  if (!apiKey) throw new PlayerError('unknown', 'Could not read YouTube’s API key from their page');
  return {apiKey, visitorData: /"visitorData":"([^"]+)"/.exec(page)?.[1]};
};

/**
 * Ask one client for a video's streaming data.
 *
 * Returns the raw player response; interpreting it is the caller's job because
 * the failure modes need to be told apart.
 */
const askClient = async (
  http: AxiosInstance,
  apiKey: string,
  profile: ClientProfile,
  videoId: string,
  cookie?: string,
  visitorData?: string,
): Promise<any> => {
  const authorization = sapisidHashHeader(cookie);
  const response = await paced(() =>
    http.post(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
      {
        context: {client: {...profile.context, ...(visitorData ? {visitorData} : {})}},
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': profile.userAgent,
          Origin: YOUTUBE_ORIGIN,
          Referer: YOUTUBE_ORIGIN + '/',
          'X-YouTube-Client-Name': String(profile.clientNumber),
          'X-YouTube-Client-Version': String(profile.context.clientVersion ?? ''),
          ...(visitorData ? {'X-Goog-Visitor-Id': visitorData} : {}),
          ...(cookie ? {Cookie: cookie} : {}),
          ...(authorization ? {Authorization: authorization, 'X-Origin': YOUTUBE_ORIGIN} : {}),
        },
      },
    ),
  );
  return response.data;
};

/**
 * Will this URL serve the end of the file, or only the start of it?
 *
 * Some clients are admitted by the player and then handed a URL that serves
 * bytes zero to one megabyte and answers 403 for everything after — every
 * time, on a freshly issued URL, whatever order the ranges are asked for. A
 * download only finds out partway through, by which point the other clients
 * have been discarded.
 *
 * The probe deliberately asks for the last few bytes rather than the first
 * byte past the cap. An earlier version asked for sixteen bytes at the one
 * megabyte mark, and those sixteen bytes were served — the limit is a window
 * over the file, so a tiny read just inside it passes while the megabyte-sized
 * reads a real download makes are refused. Asking for the tail cannot be
 * satisfied by a URL that only carries the opening.
 *
 * A failure to ask is not a failure of the URL: if the probe cannot be made at
 * all, the stream is accepted and the download reports the truth if it goes
 * wrong.
 */
export const servesWholeFile = async (stream: AudioStream, http: AxiosInstance): Promise<boolean> => {
  const total = stream.contentLength ?? 0;
  // Small enough that the opening is the whole thing.
  if (total <= FIRST_CHUNK_BYTES) return true;
  try {
    const response = await http.get(stream.url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      validateStatus: () => true,
      headers: {
        Range: `bytes=${total - 16}-${total - 1}`,
        ...(stream.userAgent ? {'User-Agent': stream.userAgent} : {}),
      },
    });
    return response.status === 206 || response.status === 200;
  } catch {
    return true;
  }
};

/** The size of the window a capped URL will serve. */
const FIRST_CHUNK_BYTES = 1024 * 1024;

/**
 * Find a playable audio stream for a video.
 *
 * Tries each client until one yields audio. Throws a PlayerError naming the
 * reason and what every client said, so the caller can tell "you need to sign
 * in" apart from "this video does not exist".
 */
export const getAudioStream = async (videoId: string, options: PlayerOptions = {}): Promise<AudioStream> => {
  if (!/^[\w-]{11}$/.test(videoId)) throw new PlayerError('unknown', `Not a YouTube video id: ${videoId}`);

  /*
   * A stream resolved moments ago is still good, and resolving is the slow
   * part of both playing and downloading.
   */
  const cacheKey = `${videoId}:${options.preferOpus ? 'opus' : 'aac'}:${options.cookie ? 'auth' : 'anon'}`;
  const cached = resolved.get(cacheKey);
  if (cached && Date.now() - cached.at < RESOLVED_TTL_MS) return cached.stream;

  const http = options.http ?? newClient();
  const session = options.apiKey ? {apiKey: options.apiKey, visitorData: undefined} : await fetchPlayerSession(http);
  const apiKey = session.apiKey;
  const attempts: Array<{client: string; status: string}> = [];

  /* Read lazily: most responses need no descrambling, and the player is a
     couple of megabytes. */
  let solverOnce: Promise<import('./signature').PlayerSolver | null> | undefined;
  const solver = () => {
    solverOnce ??= (async () => {
      const watch = await http.get(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {'User-Agent': CLIENTS[3].userAgent, ...(options.cookie ? {Cookie: options.cookie} : {})},
      });
      return solverFor(http, typeof watch.data === 'string' ? watch.data : '');
    })();
    return solverOnce;
  };

  /* The one that worked last time first; the rest in their usual order. */
  const order = preferredClient
    ? [...CLIENTS].sort((a, b) => Number(b.name === preferredClient) - Number(a.name === preferredClient))
    : CLIENTS;

  for (const profile of order) {
    let data: any;
    try {
      /*
       * The visitor id goes to the app clients only.
       *
       * It is what gets ANDROID_VR past "sign in to confirm you're not a bot".
       * Sent to the web builds alongside a real session it has the opposite
       * effect — they answer "the page needs to be reloaded" for a track they
       * serve perfectly well without it.
       */
      const visitor = profile.supportsCookies ? undefined : session.visitorData;
      const withCookie = profile.supportsCookies ? options.cookie : undefined;
      data = await askClient(http, apiKey, profile, videoId, withCookie, visitor);
    } catch (error) {
      attempts.push({client: profile.name, status: `network: ${(error as Error)?.message ?? 'failed'}`});
      continue;
    }

    const status = String(data?.playabilityStatus?.status ?? 'UNKNOWN');
    const reason = String(data?.playabilityStatus?.reason ?? '');
    const stream = bestAudioFormat(
      data?.streamingData?.adaptiveFormats,
      profile.name,
      options.preferOpus,
      profile.userAgent,
    );

    /*
     * Even a ready-made URL usually carries an `n` parameter, and leaving it
     * alone is what throttles a download to tens of kilobytes a second.
     */
    if (stream?.url) {
      const ready = {...stream, url: resolveThrottle(stream.url, await solver())};
      if (await servesWholeFile(ready, http)) {
        preferredClient = profile.name;
        resolved.set(cacheKey, {stream: ready, at: Date.now()});
        return ready;
      }
      attempts.push({client: profile.name, status: 'served only the first megabyte'});
      continue;
    }

    /*
     * A scrambled URL is descrambled with the player's own transform. If that
     * cannot be read, this falls through to the next client rather than
     * returning a stream whose URL would be refused.
     */
    if (stream?.cipher) {
      const cipher = parseCipher(stream.cipher);
      if (cipher) {
        const descrambled = resolveCipher(cipher, await solver());
        if (descrambled) {
          const ready = {...stream, url: descrambled, cipher: undefined};
          if (await servesWholeFile(ready, http)) {
            preferredClient = profile.name;
            resolved.set(cacheKey, {stream: ready, at: Date.now()});
            return ready;
          }
          attempts.push({client: profile.name, status: 'served only the first megabyte'});
          continue;
        }
      }
      attempts.push({client: profile.name, status: 'signature could not be descrambled'});
      continue;
    }

    attempts.push({client: profile.name, status: status + (reason ? ': ' + reason : '')});
  }

  /*
   * Every client refused. Which refusal it was decides what the user should be
   * told: a sign-in wall is fixable by pasting a cookie, and a removed video
   * is not, and telling somebody to check their cookie for a deleted video
   * wastes their time.
   */
  /*
   * Being throttled looks nothing like being signed out, and telling somebody
   * to fix their cookie when the cookie is fine sends them in a circle. YouTube
   * answers a rate-limited caller with UNPLAYABLE and "the page needs to be
   * reloaded", including for requests that succeeded minutes earlier with the
   * very same session — measured directly, by replaying an identical call.
   */
  const throttled = attempts.some((attempt) => /too many|try again later|rate/i.test(attempt.status));
  if (throttled) {
    throw new PlayerError(
      'rate-limited',
      'YouTube is temporarily refusing requests from this connection. Wait a few minutes and try a smaller batch.',
      attempts,
    );
  }

  const sawLoginWall = attempts.some((attempt) => /LOGIN_REQUIRED|AGE|BOT/i.test(attempt.status));
  if (sawLoginWall) {
    throw new PlayerError(
      'login-required',
      'YouTube refused this download without a signed-in session. Add your YouTube cookie in Settings.',
      attempts,
    );
  }

  const sawPartial = attempts.some((attempt) => /first megabyte/i.test(attempt.status));
  if (sawPartial) {
    throw new PlayerError(
      'partial',
      'YouTube would only serve the first part of this track. A signed-in session usually lifts that.',
      attempts,
    );
  }

  const sawCipher = attempts.some((attempt) => /descrambled/i.test(attempt.status));
  if (sawCipher) {
    throw new PlayerError(
      'cipher',
      'YouTube scrambled this stream in a way Elixium cannot yet undo. This needs a code update, not a setting change.',
      attempts,
    );
  }

  const sawUnavailable = attempts.some((attempt) => /UNPLAYABLE|ERROR|NOT_FOUND/i.test(attempt.status));
  throw new PlayerError(
    sawUnavailable ? 'unavailable' : 'no-audio',
    sawUnavailable ? 'YouTube says this track is not available' : 'YouTube returned no audio for this track',
    attempts,
  );
};
