/**
 * Signing in with an email address and password.
 *
 * Both services are configured today by pasting a long opaque string — a
 * Deezer ARL cookie, or a Qobuz user auth token — that the user has to dig out
 * of their browser's developer tools. That is a miserable first five minutes,
 * and it is the single most common reason downloads do not work.
 *
 * Neither service offers a public "give me a token" API, so both flows below
 * use the same endpoints their own apps use. Two consequences worth being
 * honest about:
 *
 *  - They can break when either service changes, exactly as the Qobuz bundle
 *    scrape did. Everything here is therefore injectable and tested, and the
 *    errors say which step failed rather than "login failed".
 *  - Accounts that sign in through Google, Facebook or Apple have no password
 *    to give, and Deezer sometimes challenges a login it does not recognise.
 *    Those cases cannot succeed, so they are reported as needing the manual
 *    value rather than as a mistyped password.
 *
 * Credentials are used for the single request that exchanges them and are
 * never stored; only the resulting ARL or token is saved.
 */
import axios, {AxiosInstance} from 'axios';
import crypto from 'crypto';

/** How long any single login request may take. */
export const LOGIN_TIMEOUT_MS = 20_000;

const md5 = (value: string) => crypto.createHash('md5').update(value, 'utf8').digest('hex');

/**
 * Public constants from Deezer's own mobile client.
 *
 * These are not secrets — they ship inside a downloadable app and are the same
 * for every user. They identify the client to the auth endpoint; the account
 * credentials are what actually authenticate.
 */
const DEEZER_CLIENT_ID = '447462';
const DEEZER_CLIENT_SECRET = 'a83bf7f38ad2f137e444727cfc3775cf';

export class LoginError extends Error {
  /** Which step failed, so the message can say something useful. */
  readonly stage: 'network' | 'credentials' | 'unsupported' | 'service';
  constructor(stage: LoginError['stage'], message: string) {
    super(message);
    this.name = 'LoginError';
    this.stage = stage;
  }
}

const isTransport = (error: unknown) => {
  const code = (error as {code?: string} | undefined)?.code;
  return typeof code === 'string' && !(error as {response?: unknown})?.response;
};

const newClient = (): AxiosInstance =>
  axios.create({
    timeout: LOGIN_TIMEOUT_MS,
    // Deezer's auth endpoint answers 200 with an error body, and some steps
    // answer 4xx that we want to read rather than throw on.
    validateStatus: () => true,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });

// ── Deezer ───────────────────────────────────────────────────────────────────

export interface DeezerLoginResult {
  arl: string;
}

/**
 * Exchange a Deezer email and password for an ARL cookie.
 *
 * Three steps, because Deezer has no endpoint that does it in one:
 *
 *  1. `auth.deezer.com/login/email` trades the credentials for an access
 *     token. The request is signed with an MD5 over the client id, the email,
 *     the hashed password and the client secret — Deezer rejects it otherwise.
 *  2. That access token opens a session on `api.deezer.com`, which answers
 *     with the session cookie the next step needs.
 *  3. The private gw-light endpoint `user.getArl` returns the ARL for that
 *     session.
 */
export const loginToDeezer = async (
  email: string,
  password: string,
  http: AxiosInstance = newClient(),
): Promise<DeezerLoginResult> => {
  if (!email.trim() || !password) {
    throw new LoginError('credentials', 'Enter both your Deezer email address and password');
  }

  const hashedPassword = md5(password);
  const signature = md5(`${DEEZER_CLIENT_ID}${email}${hashedPassword}${DEEZER_CLIENT_SECRET}`);

  let tokenResponse;
  try {
    tokenResponse = await http.get('https://auth.deezer.com/login/email', {
      params: {
        i: DEEZER_CLIENT_ID,
        mail: email,
        password: hashedPassword,
        hash: signature,
      },
    });
  } catch (error) {
    if (isTransport(error)) throw new LoginError('network', 'Could not reach Deezer to sign in');
    throw error;
  }

  const accessToken = tokenResponse.data?.access_token;
  if (!accessToken) {
    /*
     * Deezer answers 200 with an error object rather than a status code. The
     * distinction that matters to the reader is whether the password was
     * wrong, or whether this account simply cannot be signed into this way.
     */
    const reason = String(tokenResponse.data?.error?.type ?? tokenResponse.data?.error ?? '').toLowerCase();
    if (reason.includes('captcha') || reason.includes('challenge')) {
      throw new LoginError(
        'unsupported',
        'Deezer asked for a captcha, which cannot be answered here — paste your ARL in Settings instead',
      );
    }
    if (reason.includes('social') || reason.includes('unknown user') || reason.includes('not_found')) {
      throw new LoginError(
        'unsupported',
        'This Deezer account has no password (it signs in with Google, Facebook or Apple) — paste your ARL in Settings instead',
      );
    }
    throw new LoginError('credentials', 'Deezer did not accept that email address and password');
  }

  // 2. Trade the access token for a session on the main API.
  const session = await http.get('https://api.deezer.com/platform/generic/track/3135556', {
    headers: {Authorization: `Bearer ${accessToken}`},
  });

  const cookies: string[] = (session.headers?.['set-cookie'] as string[] | undefined) ?? [];
  const sid = cookies
    .map((cookie) => /(?:^|;\s*)sid=([^;]+)/.exec(cookie)?.[1])
    .find((value): value is string => Boolean(value));

  if (!sid) {
    throw new LoginError('service', 'Deezer signed in but did not return a session — try again, or paste your ARL');
  }

  // 3. Ask the private API for the ARL belonging to that session.
  const arlResponse = await http.get('https://www.deezer.com/ajax/gw-light.php', {
    params: {method: 'user.getArl', input: '3', api_version: '1.0', api_token: 'null'},
    headers: {Cookie: `sid=${sid}`},
  });

  const arl = arlResponse.data?.results;
  if (typeof arl !== 'string' || !arl) {
    throw new LoginError('service', 'Deezer signed in but did not return an ARL — paste it in Settings instead');
  }

  return {arl};
};

// ── Qobuz ────────────────────────────────────────────────────────────────────

export interface QobuzLoginResult {
  token: string;
  appId: number;
}

/**
 * Exchange a Qobuz email and password for a user auth token.
 *
 * Qobuz expects the password as an MD5 digest, not in plain text — sending it
 * raw is rejected as bad credentials, which reads as a typo rather than a
 * client bug.
 *
 * The app id matters: Qobuz binds the returned token to the id that was used
 * to obtain it, and the token is refused by every other id. Both are returned
 * together so they are always stored as a pair.
 */
export const loginToQobuz = async (
  email: string,
  password: string,
  appId: number,
  http: AxiosInstance = newClient(),
): Promise<QobuzLoginResult> => {
  if (!email.trim() || !password) {
    throw new LoginError('credentials', 'Enter both your Qobuz email address and password');
  }
  if (!Number.isFinite(appId) || appId <= 0) {
    throw new LoginError('service', 'No Qobuz app id is available, so signing in is not possible right now');
  }

  let response;
  try {
    response = await http.get('https://www.qobuz.com/api.json/0.2/user/login', {
      params: {email, password: md5(password), app_id: appId},
    });
  } catch (error) {
    if (isTransport(error)) throw new LoginError('network', 'Could not reach Qobuz to sign in');
    throw error;
  }

  if (response.status === 401 || response.status === 400) {
    throw new LoginError('credentials', 'Qobuz did not accept that email address and password');
  }

  const token = response.data?.user_auth_token;
  if (!token) {
    throw new LoginError('service', 'Qobuz signed in but did not return a token');
  }

  /*
   * A Qobuz account without streaming credentials is a free account. It can
   * sign in and browse, but no download will ever succeed, and finding that
   * out one failed download at a time is worse than being told now.
   */
  if (!response.data?.user?.credential?.parameters) {
    throw new LoginError(
      'unsupported',
      'That Qobuz account has no streaming subscription, so downloads will not work — browsing will',
    );
  }

  return {token, appId};
};
