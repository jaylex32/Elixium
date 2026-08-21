import axios from 'axios';
import lru from './cache';
import crypto from 'crypto';
import type {trackType} from '../types';

let secret: string | null = null;
const m3u8: string[] = []; // Ensure m3u8 is properly declared

interface trackDownloadData {
  track_id: number;
  duration: number;
  url: string;
  format_id: number;
  mime_type: string;
  sampling_rate: number;
  bit_depth: number;
  file_size: number;
}

export class QobuzError extends Error {
  constructor(code: number, message: string) {
    super();
    this.name = 'Qobuz API error';
    this.message = `${message} (code: ${code})`;
  }
}

export class InvalidSecret extends QobuzError {
  constructor(message: string) {
    super(400, message);
    this.name = 'Invalid secret';
  }
}

export const qobuzInstance = axios.create({
  baseURL: 'https://www.qobuz.com/api.json/0.2/',
  withCredentials: true,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0',
  },
});

export const qobuzLogin = async (email: string, password: string, app_id: number): Promise<string> => {
  const {data} = await qobuzInstance.get<any>('/user/login', {
    params: {
      email,
      password,
      app_id,
    },
  });
  if (!data.user.credential?.parameters) {
    throw new Error('Free accounts are not eligible to download tracks.');
  }
  return data.user_auth_token;
};

export const initQobuzApi = async (token: string, app_id: number, secrets: string[]) => {
  // Only send the auth header when a real token is provided.
  // Sending an empty header can cause Qobuz to reject signed requests
  // (surfacing as "Invalid API secret" on track/getFileUrl).
  if (token) {
    qobuzInstance.defaults.headers.common['X-User-Auth-Token'] = token;
  } else {
    delete qobuzInstance.defaults.headers.common['X-User-Auth-Token'];
  }
  /*
   * An app id that is absent is a broken scrape, not a bad credential. Saying
   * so beats `null.toString()`, which is what used to happen here and read as
   * an internal crash rather than "Qobuz support needs updating".
   */
  if (app_id === null || app_id === undefined || Number.isNaN(Number(app_id))) {
    throw new Error('Qobuz app id is missing — it could not be read from Qobuz and none is configured');
  }

  qobuzInstance.defaults.headers.common['X-App-Id'] = app_id.toString();

  let lastFailure: unknown = null;
  for (const s of secrets) {
    const result = await test_secret(s);
    if (result.ok) {
      secret = s;
      break;
    }
    lastFailure = result.error;
  }

  if (!secret) {
    /*
     * Distinguish "the secrets are wrong" from "nothing could reach Qobuz".
     * They lead the reader to completely different places, and only one of
     * them is worth re-entering credentials over.
     */
    /*
     * A 401/403 means the request was signed and sent, and Qobuz rejected the
     * *user*, not the secret. Reporting that as "no valid app secrets" sends
     * the reader to the wrong field entirely — the usual cause is a token that
     * has expired, or one issued under a different app id, since Qobuz binds
     * each token to the app id it was created with.
     */
    const rejected = (lastFailure as {response?: {status?: number}} | undefined)?.response?.status;
    if (rejected === 401 || rejected === 403) {
      const error = new Error(
        'Qobuz rejected your credentials: the Qobuz Token may have expired, or may not match the Qobuz App ID in Settings',
      ) as Error & {response?: {status?: number}};
      error.response = {status: rejected};
      throw error;
    }

    const transport = transportCodeOf(lastFailure);
    if (transport) {
      const error = new Error(`Could not reach Qobuz to verify its app secret (${transport})`) as Error & {
        code?: string;
      };
      error.code = transport;
      throw error;
    }
    if (secrets.length === 0) {
      throw new Error('No Qobuz app secrets are configured, and none could be read from Qobuz');
    }
    throw new Error("Couldn't find any valid app secrets");
  }
};

export const qobuzRequest = async (method: string, params: object) => {
  const cacheKey = method + ':' + Object.entries(params).join(':');
  const cache = lru.get(cacheKey);
  if (cache) {
    return cache;
  }

  try {
    const {data} = await qobuzInstance.get<any>(method, {params});
    if (Object.keys(data).length > 0) {
      lru.set(cacheKey, data);
      return data;
    }
  } catch (error: unknown) {
    /*
     * No HTTP response at all means the request never reached Qobuz — DNS
     * failure, refused connection, dead proxy, no network. That is not a Qobuz
     * API error, and flattening it into one ("Qobuz request failed") told the
     * reader their credentials were bad when the machine was simply offline.
     * Rethrowing preserves the transport code for whoever classifies it.
     */
    if (!(error as any)?.response) throw error;

    const response = (error as any).response;
    const errorMessage = response?.data || {};
    // Only map to InvalidSecret for the specific invalid-secret case
    if (
      method === 'track/getFileUrl' &&
      String(errorMessage.message || '')
        .toLowerCase()
        .includes('invalid api secret')
    ) {
      throw new InvalidSecret(errorMessage.message);
    }

    /*
     * Carry the HTTP status through. Without it a 401 — Qobuz rejecting the
     * *user* — was indistinguishable from a signing failure, and both ended up
     * reported as "no valid app secrets".
     */
    const qobuzError = new QobuzError(
      errorMessage.code ?? 0,
      errorMessage.message ?? 'Qobuz request failed',
    ) as QobuzError & {response?: {status?: number}};
    qobuzError.response = {status: response?.status};
    throw qobuzError;
  }
};

export const getTrackDownloadUrl = async (
  track_id: number,
  quality: number,
  sec: string | null = null,
): Promise<trackDownloadData | null> => {
  const allowed_formats = [5, 6, 7, 27];
  if (!allowed_formats.includes(quality)) {
    throw new Error(`Invalid format ${quality}`);
  }

  const final_secret = sec ? sec : secret;

  const unix = Math.floor(Date.now() / 1000); // Corrected to use integer seconds
  const r_sig = `trackgetFileUrlformat_id${quality}intentstreamtrack_id${track_id}${unix}${final_secret}`;
  const r_sig_hashed = md5(r_sig);
  const params = {
    request_ts: unix,
    request_sig: r_sig_hashed,
    track_id,
    format_id: quality,
    intent: 'stream',
  };
  try {
    const res = await qobuzRequest('track/getFileUrl', params);
    if (res.url) {
      const fileSize = await testUrl(res.url);
      if (fileSize > 0) {
        return {
          file_size: fileSize,
          ...res,
        };
      }
    }
  } catch (e) {
    if (e instanceof InvalidSecret) {
      throw new Error('Invalid API secret');
    } else {
      throw e;
    }
  }
  return null;
};

const testUrl = async (url: string): Promise<number> => {
  try {
    const response = await axios.head(url);
    return Number(response.headers['content-length']);
  } catch (err) {
    return 0;
  }
};

const md5 = (data: string, type: crypto.Encoding = 'ascii') => {
  const md5sum = crypto.createHash('md5');
  md5sum.update(data.toString(), type);
  return md5sum.digest('hex');
};

/**
 * Does this secret sign a request Qobuz accepts?
 *
 * Returns the failure rather than just `false`. Swallowing it meant a machine
 * with no network reported "Couldn't find any valid app secrets" — sending the
 * reader to check credentials that were fine, when the real answer was that
 * nothing could reach Qobuz at all.
 */
const test_secret = async (secret: string): Promise<{ok: true} | {ok: false; error: unknown}> => {
  try {
    await getTrackDownloadUrl(122528702, 5, secret);
    return {ok: true};
  } catch (error) {
    if (process.env.DEBUG_QOBUZ) {
      console.error('Secret test failed:', (error as Error).message || error);
    }
    return {ok: false, error};
  }
};

/** Network-level codes that mean the request never reached Qobuz. */
const TRANSPORT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ECONNABORTED',
]);

const transportCodeOf = (error: unknown): string | null => {
  const code = (error as {code?: string} | undefined)?.code;
  return typeof code === 'string' && TRANSPORT_CODES.has(code.toUpperCase()) ? code.toUpperCase() : null;
};
