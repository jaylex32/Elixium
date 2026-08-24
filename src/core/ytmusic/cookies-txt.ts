/**
 * Reading a Netscape `cookies.txt` export.
 *
 * This is the one way to hand Elixium a YouTube session that works from any
 * browser, and the reason it is the only one is worth recording:
 *
 *  - A sign-in window inside the app is refused outright. Google will not
 *    authenticate anybody from an embedded browser, which is an anti-phishing
 *    measure rather than an obstacle to route around.
 *  - The OAuth device-code flow that briefly served this purpose was withdrawn
 *    by Google within months of appearing.
 *  - Chromium browsers — Chrome, Edge, Brave — have encrypted their cookie
 *    stores with app-bound encryption since Chrome 127, so nothing outside the
 *    browser can read them.
 *
 * What every browser does still offer is an extension that exports cookies in
 * this format, which is also what yt-dlp consumes. So the user exports a file
 * and hands it over, and that works everywhere.
 *
 * Only YouTube's own cookies are kept. A cookies.txt export usually contains
 * every site the person is signed in to, and none of the rest is any of this
 * program's business.
 */

/*
 * Every cookie on a YouTube or Google domain is kept. There is deliberately no
 * list of names here, and that is the whole point.
 *
 * There used to be one, and it cost days. It held the cookies that looked like
 * the session — SID, SAPISID, LOGIN_INFO and so on — and dropped everything
 * else, including `__Secure-1PSIDTS` and `__Secure-3PSIDTS`. Google now binds a
 * session to those timestamp cookies, so SID without them is not a session at
 * all: YouTube answered `LOGGED_IN: false` and cleared the login, and every
 * download failed asking for a cookie the user had already supplied. Measured
 * on one real export: the full jar authenticated, the same jar filtered through
 * the list did not, and adding just those two names fixed it.
 *
 * Any list would have had that bug, because it encodes a guess about which
 * cookies Google considers load-bearing this year. Keeping the whole jar for
 * the domain cannot go stale — it is also what yt-dlp does, and what the
 * browser itself would send.
 *
 * Cookies for other sites are still discarded; that filtering is by domain,
 * which is the part that is actually about privacy.
 */

/** Named only so the summary can report the session cookies it recognised. */
export const YOUTUBE_SESSION_COOKIES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  'LOGIN_INFO',
];

const REQUIRED_COOKIE = 'SAPISID';

export interface CookieImportSummary {
  /** Ready to send as a `Cookie` header. */
  cookie: string;
  /** Which cookies were found, so the interface can say what it got. */
  names: string[];
  /** Cookies seen for other sites and deliberately discarded. */
  ignored: number;
}

export class CookiesTxtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CookiesTxtError';
  }
}

/** Is this line's domain one of YouTube's or Google's? */
const isYouTubeDomain = (domain: string): boolean => {
  const host = domain
    .replace(/^#HttpOnly_/, '')
    .replace(/^\./, '')
    .toLowerCase();
  return (
    host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'google.com' || host.endsWith('.google.com')
  );
};

/**
 * Parse a cookies.txt export into a Cookie header.
 *
 * The format is one cookie per line, tab-separated: domain, whether it covers
 * subdomains, path, secure flag, expiry, name, value. Comment lines start with
 * `#`, except that `#HttpOnly_` is a prefix on the domain rather than a
 * comment — a distinction that silently drops the session cookies if missed,
 * because the ones that matter here are all HttpOnly.
 */
export const cookieHeaderFromCookiesTxt = (text: string): CookieImportSummary => {
  if (!text || !text.trim()) throw new CookiesTxtError('The file was empty');

  const found = new Map<string, string>();
  let ignored = 0;
  let sawAnyCookie = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // A comment, unless it is the HttpOnly marker.
    if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue;

    const fields = line.split('\t');
    // Some exporters pad with spaces instead; fall back to any whitespace run.
    const parts = fields.length >= 7 ? fields : line.split(/\s+/);
    if (parts.length < 7) continue;

    const domain = parts[0];
    const name = parts[parts.length - 2];
    const value = parts[parts.length - 1];
    if (!name || !value) continue;

    sawAnyCookie = true;

    if (!isYouTubeDomain(domain)) {
      ignored += 1;
      continue;
    }
    /*
     * A youtube.com cookie beats a google.com one of the same name. Both
     * domains carry some of these, and the YouTube copy is the one its own
     * API expects.
     */
    const isYouTube = /youtube\.com$/i.test(domain.replace(/^#HttpOnly_/, '').replace(/^\./, ''));
    if (!found.has(name) || isYouTube) found.set(name, value);
  }

  if (!sawAnyCookie) {
    throw new CookiesTxtError(
      'That does not look like a cookies.txt file — no cookie lines were found. Export it with a cookies.txt browser extension.',
    );
  }

  if (!found.get(REQUIRED_COOKIE)) {
    throw new CookiesTxtError(
      'No YouTube session in that file. Sign in to youtube.com first, then export cookies.txt while signed in.',
    );
  }

  const names = [...found.keys()].sort((a, b) => {
    const rank = (name: string) => {
      const index = YOUTUBE_SESSION_COOKIES.indexOf(name);
      return index === -1 ? YOUTUBE_SESSION_COOKIES.length : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return {
    cookie: names.map((name) => `${name}=${found.get(name)}`).join('; '),
    names,
    ignored,
  };
};

/**
 * Ask YouTube whether this session is actually signed in.
 *
 * A cookies.txt can carry every cookie by name — SAPISID included — and still
 * be a signed-out session, because the values rotate and an export taken from
 * a profile that was not signed in looks identical from the outside. Without
 * this check the first sign of trouble is a download failing much later, which
 * sends people looking at the downloader instead of the export.
 *
 * Returns null when the check itself could not run; a network problem is not
 * evidence that the cookie is bad.
 */
export const verifyYouTubeSession = async (
  cookie: string,
  fetchPage?: (cookie: string) => Promise<string>,
): Promise<{signedIn: boolean; account?: string} | null> => {
  const load =
    fetchPage ??
    (async (value: string) => {
      /* eslint-disable-next-line @typescript-eslint/no-var-requires */
      const axios = require('axios');
      const response = await axios.get('https://www.youtube.com/', {
        timeout: 15_000,
        validateStatus: () => true,
        headers: {
          Cookie: value,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      return typeof response.data === 'string' ? response.data : '';
    });

  let page = '';
  try {
    page = await load(cookie);
  } catch {
    return null;
  }
  if (!page) return null;

  if (/"LOGGED_IN":true/.test(page)) {
    const account = /"accountName":"([^"]{1,60})"/.exec(page)?.[1];
    return {signedIn: true, ...(account ? {account} : {})};
  }
  if (/"LOGGED_IN":false/.test(page)) return {signedIn: false};
  return null;
};
