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
  qobuzInstance.defaults.headers.common['X-App-Id'] = app_id.toString();
  for (const s of secrets) {
    if (await test_secret(s)) {
      secret = s;
      break;
    }
  }
  if (!secret) {
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
    const errorMessage = (error as any).response?.data || {};
    // Only map to InvalidSecret for the specific invalid-secret case
    if (
      method === 'track/getFileUrl' &&
      String(errorMessage.message || '')
        .toLowerCase()
        .includes('invalid api secret')
    ) {
      throw new InvalidSecret(errorMessage.message);
    }
    throw new QobuzError(errorMessage.code ?? 0, errorMessage.message ?? 'Qobuz request failed');
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

const test_secret = async (secret: string) => {
  try {
    await getTrackDownloadUrl(122528702, 5, secret);
    return true;
  } catch (_e) {
    if (process.env.DEBUG_QOBUZ) {
      console.error('Secret test failed:', (_e as Error).message || _e);
    }
    return false;
  }
};
