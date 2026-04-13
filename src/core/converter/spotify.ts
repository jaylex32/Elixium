import axios from 'axios';
import SpotifyWebApi from 'spotify-web-api-node';
import PQueue from 'p-queue';
import {TOTP} from 'otpauth';
import {base32} from '@scure/base';
import {isrc2deezer, upc2deezer} from './deezer';
import type {playlistInfo, trackType} from '../deezer/types';
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';

type tokensType = {
  clientId: string;
  accessToken: string;
  accessTokenExpirationTimestampMs: number;
  isAnonymous: true;
};

// Global cache for tokens
let cachedToken: tokensType | null = null;
let tokenExpiresAt = 0;
let cachedUserAgent = '';
let cachedPublicToken: {token: string; expiresAt: number} | null = null;
let cachedOAuthAppToken: {token: string; expiresAt: number} | null = null;
let lastSpotifyApiRequestTime = 0;
const SPOTIFY_SCRAPE_USER_AGENT = 'Mozilla/5.0';

const SPOTIFY_REQUEST_MIN_INTERVAL_MS = 500;
const DEFAULT_SP_APP_CLIENT_ID = '880ca2262b0447bd82e4ea0b17febc16';
const DEFAULT_SP_APP_CLIENT_SECRET = 'c91c4b70b6e0482ebec5b91bf869c420';

/**
 * Limit process concurrency
 */
const queue = new PQueue({concurrency: 25});

/**
 * Export core spotify module
 */
export let spotifyApi = new SpotifyWebApi();

/**
 * Secret cipher dictionary from Python implementation
 */
const SECRET_CIPHER_DICT: Record<string, number[]> = {
  '61': [44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78],
};

const DEFAULT_SECRET_DICT_URL =
  'https://raw.githubusercontent.com/xyloflake/spot-secrets-go/main/secrets/secretDict.json';
const SECRET_DICT_SOURCE = (process.env.SPOTIFY_SECRET_DICT_URL || DEFAULT_SECRET_DICT_URL).trim();
const TOKEN_MAX_RETRIES = 3;
const TOKEN_RETRY_DELAY_MS = 500;
const SECRET_FETCH_TIMEOUT_MS = 15000;
const SERVER_TIME_TIMEOUT_MS = 15000;
const TOTP_VER = 0; // Auto-select highest version like Python
const DEFAULT_CONFIG_FILE = 'elixium.config.json';

/**
 * Load sp_dc cookie from Elixium config.
 */
const getSpDcFromConfig = (): string | null => {
  try {
    const configPath = path.join(process.cwd(), DEFAULT_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.cookies?.sp_dc || null;
    }
  } catch (error: unknown) {
    console.warn('Failed to read config file:', (error as Error).message);
  }
  return null;
};

const getSpotifyOAuthAppCredentials = (): {clientId: string; clientSecret: string} => {
  let configClientId = '';
  let configClientSecret = '';

  try {
    const configPath = path.join(process.cwd(), DEFAULT_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      configClientId = String(config.sp_app_client_id || '').trim();
      configClientSecret = String(config.sp_app_client_secret || '').trim();
    }
  } catch (error: unknown) {
    console.warn('Failed to read Spotify OAuth app credentials from config:', (error as Error).message);
  }

  const clientId = (process.env.SP_APP_CLIENT_ID || configClientId || DEFAULT_SP_APP_CLIENT_ID).trim();
  const clientSecret = (process.env.SP_APP_CLIENT_SECRET || configClientSecret || DEFAULT_SP_APP_CLIENT_SECRET).trim();
  return {clientId, clientSecret};
};

/**
 * Show instructions for getting sp_dc cookie
 */
const showCookieInstructions = (): void => {
  console.log(`\n❌ Spotify sp_dc cookie not found in ${DEFAULT_CONFIG_FILE}`);
  console.log('\n🔧 How to get your Spotify sp_dc cookie:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1. Open https://open.spotify.com in your browser');
  console.log('2. Login to your Spotify account');
  console.log('3. Press F12 to open Developer Tools');
  console.log('4. Go to Application tab → Cookies → https://open.spotify.com');
  console.log('5. Find the "sp_dc" cookie and copy its value');
  console.log(`6. Add it to your ${DEFAULT_CONFIG_FILE} file:`);
  console.log('');
  console.log('   {');
  console.log('     "cookies": {');
  console.log('       "arl": "your_deezer_arl_cookie",');
  console.log('       "sp_dc": "paste_your_sp_dc_cookie_here"');
  console.log('     }');
  console.log('   }');
  console.log('');
  console.log('💡 The sp_dc cookie is required for reliable Spotify authentication.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
};

/**
 * Generate random hex string
 */
const generateRandomHex = (length = 8): string => {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const pickRandom = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const generateUserAgent = (): string => {
  const choice = pickRandom(['chrome', 'edge', 'safari']);
  if (choice === 'chrome') {
    const major = randomInt(124, 128);
    const build = `${major}.0.${randomInt(0, 5000)}.${randomInt(0, 200)}`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36`;
  }
  if (choice === 'edge') {
    const major = randomInt(122, 127);
    const build = `${major}.0.${randomInt(1000, 6000)}.${randomInt(0, 200)}`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${build} Safari/537.36 Edg/${build}`;
  }

  const safariVersion = randomInt(15, 17);
  const macMajor = randomInt(11, 15);
  const macMinor = randomInt(0, 7);

  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_${macMajor}_${macMinor}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariVersion}.0 Safari/605.1.15`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

type spclientPlaylistResponseType = {
  attributes?: {
    name?: string;
    description?: string;
    picture?: string;
    owner_name?: string;
    owner_username?: string;
  };
  length?: number;
  contents?: {
    items?: Array<{
      uri?: string;
    }>;
  };
};

export type spotifyPlaylistBundleType = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  ownerId: string;
  ownerName: string;
  totalTracks: number;
  tracks: SpotifyApi.TrackObjectFull[];
};

export type spotifyConversionProgressType = {
  phase: 'playlist' | 'metadata' | 'auth';
  message: string;
  current?: number;
  total?: number;
  percentage?: number;
};

const emitSpotifyProgress = (
  onProgress: ((progress: spotifyConversionProgressType) => void) | undefined,
  payload: spotifyConversionProgressType,
): void => {
  if (!onProgress) {
    return;
  }
  onProgress(payload);
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const parseMetaContent = (html: string, attribute: 'property' | 'name', key: string): string | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\b[^>]*\\b${attribute}=["']${escapedKey}["'][^>]*\\bcontent=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attribute}=["']${escapedKey}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return null;
};

const parseSpotifyJsonLd = (
  html: string,
): {title: string | null; description: string | null; datePublished: string | null} => {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    return {title: null, description: null, datePublished: null};
  }

  try {
    const parsed = JSON.parse(match[1]);
    const data = Array.isArray(parsed)
      ? parsed.find((entry) => entry && typeof entry === 'object') || {}
      : parsed || {};
    return {
      title: typeof data.name === 'string' ? decodeHtmlEntities(data.name) : null,
      description: typeof data.description === 'string' ? decodeHtmlEntities(data.description) : null,
      datePublished: typeof data.datePublished === 'string' ? data.datePublished : null,
    };
  } catch {
    return {title: null, description: null, datePublished: null};
  }
};

const scrapeSpotifyTrackPageMetadata = async (
  id: string,
  userAgent = SPOTIFY_SCRAPE_USER_AGENT,
): Promise<SpotifyApi.TrackObjectFull | null> => {
  try {
    const response = await withTimeout(
      axios.get<string>(`https://open.spotify.com/track/${id}`, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: 20000,
      }),
      25000,
      `Spotify track page request timed out for ${id}`,
    );

    const html = String(response.data || '');
    const jsonLd = parseSpotifyJsonLd(html);
    const title = parseMetaContent(html, 'property', 'og:title') || jsonLd.title;
    const description =
      parseMetaContent(html, 'property', 'og:description') ||
      parseMetaContent(html, 'name', 'description') ||
      jsonLd.description;
    const durationRaw = parseMetaContent(html, 'name', 'music:duration');
    const releaseDate = parseMetaContent(html, 'name', 'music:release_date') || jsonLd.datePublished;
    const musiciansRaw = parseMetaContent(html, 'name', 'music:musician_description');

    if (!title || !description) {
      return null;
    }

    const parts = description
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean);

    const artistText = musiciansRaw || (description.startsWith('Listen to ') ? parts[1] : parts[0]) || 'Unknown Artist';
    const artistNames = artistText
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const primaryArtist = artistNames[0] || 'Unknown Artist';
    const albumName = !description.startsWith('Listen to ') && parts[1] ? parts[1] : 'Unknown Album';
    const durationSeconds = Number(durationRaw || 0);

    return {
      id,
      name: title,
      duration_ms: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds * 1000 : 0,
      artists: artistNames.length
        ? artistNames.map((name) => ({name} as SpotifyApi.ArtistObjectSimplified))
        : [{name: primaryArtist} as SpotifyApi.ArtistObjectSimplified],
      album: {name: albumName, release_date: releaseDate || undefined} as SpotifyApi.AlbumObjectSimplified,
      external_ids: {},
    } as SpotifyApi.TrackObjectFull;
  } catch (error: any) {
    console.warn(`⚠️ Spotify track page fallback could not fetch ${id}: ${error.message}`);
    return null;
  }
};
const fetchSpotifyTracksFromPages = async (
  ids: string[],
  onProgress?: (progress: spotifyConversionProgressType) => void,
): Promise<SpotifyApi.TrackObjectFull[]> => {
  const pageQueue = new PQueue({concurrency: 6});
  const total = ids.length;
  let processed = 0;
  const tracksById = new Map<string, SpotifyApi.TrackObjectFull>();

  await Promise.all(
    ids.map((id) =>
      pageQueue.add(async () => {
        const track = await scrapeSpotifyTrackPageMetadata(id);
        processed++;

        emitSpotifyProgress(onProgress, {
          phase: 'metadata',
          message: `Loading Spotify track pages... ${processed}/${total}`,
          current: processed,
          total,
          percentage: total > 0 ? Math.round((processed / total) * 100) : 100,
        });

        if (track) {
          tracksById.set(id, track);
        } else {
          console.warn(`⚠️ Spotify track page metadata could not be parsed for ${id}`);
        }
      }),
    ),
  );

  const orderedTracks = ids
    .map((id) => tracksById.get(id))
    .filter((track): track is SpotifyApi.TrackObjectFull => Boolean(track));

  if (orderedTracks.length === 0 && ids.length > 0) {
    throw new Error('Spotify track page metadata extraction returned no playable tracks.');
  }

  return orderedTracks;
};

const getSpotifyErrorStatus = (error: any): number | undefined =>
  error?.statusCode ?? error?.status ?? error?.body?.error?.status ?? error?.response?.status;

const getRetryAfterMs = (headers: Record<string, unknown> | undefined, fallbackMs: number, maxMs = 15000): number => {
  const retryAfterHeader = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (typeof retryAfterHeader === 'string') {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed * 1000, maxMs);
    }
  }
  if (typeof retryAfterHeader === 'number' && Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
    return Math.min(retryAfterHeader * 1000, maxMs);
  }
  return Math.min(fallbackMs, maxMs);
};

const extractTrackIdFromUri = (uri: string | undefined): string | null => {
  if (!uri || !uri.startsWith('spotify:track:')) {
    return null;
  }
  const parts = uri.split(':');
  const id = parts[parts.length - 1];
  return id || null;
};

const getPublicSpotifyToken = async (): Promise<string | null> => {
  const now = Date.now();
  if (cachedPublicToken && cachedPublicToken.expiresAt > now) {
    return cachedPublicToken.token;
  }

  try {
    const response = await axios.get<{tokens?: Array<{access_token?: string}>}>(
      'https://raw.githubusercontent.com/itzzzme/spotify-key/refs/heads/main/token.json',
      {
        timeout: 10000,
      },
    );

    const token = response.data?.tokens?.[0]?.access_token;
    if (token && token.length > 50) {
      cachedPublicToken = {token, expiresAt: Date.now() + 10 * 60 * 1000};
      return token;
    }
  } catch (error) {
    console.warn('Failed to fetch public Spotify fallback token:', (error as Error).message);
  }

  return null;
};

const forceRefreshSpotifyToken = async (): Promise<tokensType> => {
  cachedToken = null;
  tokenExpiresAt = 0;
  return await setSpotifyAnonymousToken();
};

const respectSpotifyRateLimit = async (): Promise<void> => {
  const now = Date.now();
  const elapsed = now - lastSpotifyApiRequestTime;
  if (elapsed < SPOTIFY_REQUEST_MIN_INTERVAL_MS) {
    await sleep(SPOTIFY_REQUEST_MIN_INTERVAL_MS - elapsed);
  }
  lastSpotifyApiRequestTime = Date.now();
};

const getSpotifyOAuthAppToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedOAuthAppToken && cachedOAuthAppToken.expiresAt > now + 10000) {
    const isValid = await validateToken(
      cachedOAuthAppToken.token,
      undefined,
      cachedUserAgent || generateUserAgent(),
      true,
    );
    if (isValid) {
      return cachedOAuthAppToken.token;
    }
    cachedOAuthAppToken = null;
  }

  const {clientId, clientSecret} = getSpotifyOAuthAppCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Missing Spotify OAuth app credentials (SP_APP_CLIENT_ID / SP_APP_CLIENT_SECRET).');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({grant_type: 'client_credentials'}).toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    },
  );

  const accessToken = response.data?.access_token as string | undefined;
  const expiresIn = Number(response.data?.expires_in || 3600);
  if (!accessToken) {
    throw new Error('Spotify OAuth app token response missing access_token.');
  }

  const validationUserAgent = cachedUserAgent || generateUserAgent();
  const isValid = await validateToken(accessToken, undefined, validationUserAgent, true);
  if (!isValid) {
    throw new Error('Spotify OAuth app token validation failed.');
  }

  cachedOAuthAppToken = {
    token: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
  };

  return accessToken;
};

const fetchTracksIndividuallyWithOAuthApp = async (
  ids: string[],
  userAgent: string,
  onProgress?: (progress: spotifyConversionProgressType) => void,
): Promise<SpotifyApi.TrackObjectFull[]> => {
  let token = '';
  let tokenSource: 'oauth-app' | 'cookie' | 'public' = 'oauth-app';
  let tokenClientId: string | undefined;
  try {
    token = await getSpotifyOAuthAppToken();
  } catch (error: any) {
    console.warn(`⚠️ Spotify OAuth app fallback unavailable: ${error.message}`);
    try {
      const refreshedToken = await ensureValidToken();
      token = refreshedToken.accessToken;
      tokenSource = 'cookie';
      tokenClientId = refreshedToken.clientId;
      console.log('🔁 Falling back to Spotify cookie token for per-track metadata fetch');
    } catch {
      const publicToken = await getPublicSpotifyToken();
      if (!publicToken) {
        throw error;
      }
      token = publicToken;
      tokenSource = 'public';
      console.log('🔁 Falling back to public Spotify token for per-track metadata fetch');
    }
  }
  const tracks: SpotifyApi.TrackObjectFull[] = [];

  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    let fetched = false;
    emitSpotifyProgress(onProgress, {
      phase: 'metadata',
      message: `Fetching Spotify metadata ${index + 1}/${ids.length}...`,
      current: index + 1,
      total: ids.length,
      percentage: Math.round(((index + 1) / ids.length) * 100),
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await respectSpotifyRateLimit();
        const response = await withTimeout(
          axios.get<SpotifyApi.TrackObjectFull>(`https://api.spotify.com/v1/tracks/${id}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': userAgent,
              Accept: 'application/json',
              ...(tokenSource === 'cookie' && tokenClientId ? {'Client-Id': tokenClientId} : {}),
            },
            timeout: 25000,
          }),
          30000,
          `Spotify OAuth track request timed out for ${id}`,
        );

        if (response.data?.id && response.data?.name) {
          tracks.push(response.data);
        }
        fetched = true;
        break;
      } catch (error: any) {
        const status = getSpotifyErrorStatus(error);
        if (status === 429) {
          const waitMs = getRetryAfterMs(
            (error?.headers || error?.response?.headers) as Record<string, unknown>,
            2000 * attempt,
            10000,
          );
          await sleep(waitMs);
          continue;
        }
        if (status === 401 && attempt === 1) {
          if (token === cachedOAuthAppToken?.token) {
            cachedOAuthAppToken = null;
          } else if (tokenSource === 'cookie') {
            const refreshedToken = await forceRefreshSpotifyToken();
            token = refreshedToken.accessToken;
            tokenClientId = refreshedToken.clientId;
            continue;
          } else if (token === cachedPublicToken?.token) {
            cachedPublicToken = null;
            const refreshedPublicToken = await getPublicSpotifyToken();
            if (refreshedPublicToken) {
              token = refreshedPublicToken;
              continue;
            }
          }
          continue;
        }
        if (status === 403 && token === cachedOAuthAppToken?.token) {
          console.warn(`⚠️ Spotify OAuth app token blocked for track ${id}, trying cookie token fallback`);
          cachedOAuthAppToken = null;
          try {
            const refreshedToken = await ensureValidToken();
            token = refreshedToken.accessToken;
            tokenSource = 'cookie';
            tokenClientId = refreshedToken.clientId;
            continue;
          } catch {
            const publicToken = await getPublicSpotifyToken();
            if (publicToken) {
              token = publicToken;
              tokenSource = 'public';
              continue;
            }
          }
        }
        break;
      }
    }

    if (!fetched) {
      const pageTrack = await scrapeSpotifyTrackPageMetadata(id, userAgent);
      if (pageTrack) {
        console.log(`🔁 Using Spotify track page fallback for ${id}`);
        tracks.push(pageTrack);
        fetched = true;
      }
    }

    if (!fetched) {
      console.warn(`⚠️ OAuth fallback could not fetch Spotify track ${id}`);
    }
  }

  return tracks;
};

type spotifyTracksResponseType = {
  tracks?: Array<SpotifyApi.TrackObjectFull | null>;
};

const fetchTracksWithBearer = async (
  ids: string[],
  accessToken: string,
  userAgent: string,
): Promise<SpotifyApi.TrackObjectFull[]> => {
  const response = await withTimeout(
    axios.get<spotifyTracksResponseType>('https://api.spotify.com/v1/tracks', {
      params: {
        ids: ids.join(','),
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': userAgent,
        Accept: 'application/json',
      },
      timeout: 30000,
    }),
    35000,
    'Spotify track metadata request timed out',
  );

  return (response.data?.tracks || []).filter((track): track is SpotifyApi.TrackObjectFull => {
    return Boolean(track && (track as any).id && (track as any).name);
  });
};

const fetchSpotifyTracksChunk = async (
  ids: string[],
  onProgress?: (progress: spotifyConversionProgressType) => void,
): Promise<SpotifyApi.TrackObjectFull[]> => {
  const maxRetries = 5;
  let publicFallbackToken: string | null = null;
  const userAgent = cachedUserAgent || generateUserAgent();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const token =
        publicFallbackToken ||
        (() => {
          if (!cachedToken || tokenExpiresAt <= Date.now()) {
            return '';
          }
          return cachedToken.accessToken;
        })();

      if (!token) {
        const refreshedToken = await ensureValidToken();
        console.log(`🔑 Spotify metadata auth refresh (attempt ${attempt}/${maxRetries})`);
        return await fetchTracksWithBearer(ids, refreshedToken.accessToken, userAgent);
      }

      return await fetchTracksWithBearer(ids, token, userAgent);
    } catch (error: any) {
      lastError = error as Error;
      const status = getSpotifyErrorStatus(error);
      console.warn(
        `⚠️ Spotify metadata chunk attempt ${attempt}/${maxRetries} failed (status: ${status || 'unknown'})`,
      );

      if (status === 401) {
        if (!publicFallbackToken) {
          publicFallbackToken = await getPublicSpotifyToken();
          if (publicFallbackToken) {
            console.log('🔁 Falling back to public Spotify token for metadata fetch');
            continue;
          }
        }
        await forceRefreshSpotifyToken();
        continue;
      }

      if (status === 429) {
        if (attempt >= 2) {
          console.log('🔁 Switching to OAuth fallback for Spotify metadata chunk');
          emitSpotifyProgress(onProgress, {
            phase: 'metadata',
            message: 'Rate limited on Spotify metadata. Switching to fallback mode...',
          });
          const fallbackTracks = await fetchTracksIndividuallyWithOAuthApp(ids, userAgent, onProgress);
          if (fallbackTracks.length > 0) {
            return fallbackTracks;
          }
        }

        const waitMs = getRetryAfterMs(
          (error?.headers || error?.response?.headers) as Record<string, unknown>,
          1500 * attempt,
          10000,
        );
        console.warn(`⏳ Spotify rate limited while fetching metadata, waiting ${Math.ceil(waitMs / 1000)}s`);
        emitSpotifyProgress(onProgress, {
          phase: 'metadata',
          message: `Spotify rate limit reached. Waiting ${Math.ceil(waitMs / 1000)}s...`,
        });
        await sleep(waitMs);
        continue;
      }

      if (attempt < maxRetries && (!status || status >= 500 || status === 403)) {
        await sleep(600 * attempt);
        continue;
      }

      throw error;
    }
  }
  console.log('🔁 Switching to OAuth fallback for Spotify metadata chunk');
  emitSpotifyProgress(onProgress, {
    phase: 'metadata',
    message: 'Using fallback mode for Spotify metadata...',
  });
  const fallbackTracks = await fetchTracksIndividuallyWithOAuthApp(ids, userAgent, onProgress);
  if (fallbackTracks.length > 0) {
    return fallbackTracks;
  }

  throw new Error(
    `Failed to fetch Spotify track metadata after multiple attempts.${
      lastError ? ` Last error: ${lastError.message}` : ''
    }`,
  );
};

const fetchSpotifyTracksByIds = async (
  ids: string[],
  onProgress?: (progress: spotifyConversionProgressType) => void,
): Promise<SpotifyApi.TrackObjectFull[]> => {
  const tracks: SpotifyApi.TrackObjectFull[] = [];
  const chunkSize = 50;
  const totalChunks = Math.ceil(ids.length / chunkSize) || 1;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const chunkNumber = Math.floor(index / chunkSize) + 1;
    console.log(`🎧 Fetching Spotify track metadata chunk ${chunkNumber}/${totalChunks} (${chunk.length} tracks)`);
    emitSpotifyProgress(onProgress, {
      phase: 'metadata',
      message: `Fetching Spotify metadata chunk ${chunkNumber}/${totalChunks}...`,
      current: chunkNumber,
      total: totalChunks,
      percentage: Math.round((chunkNumber / totalChunks) * 100),
    });
    const chunkTracks = await fetchSpotifyTracksChunk(chunk, onProgress);
    if (chunkTracks.length === 0 && chunk.length > 0) {
      throw new Error(
        `Spotify metadata chunk ${chunkNumber}/${totalChunks} returned no tracks for ${chunk.length} IDs.`,
      );
    }
    tracks.push(...chunkTracks);
  }

  return tracks;
};

const fetchSpclientPage = async (
  playlistId: string,
  offset: number,
  limit: number,
  token: string,
  clientId: string,
  userAgent: string,
): Promise<spclientPlaylistResponseType> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    Accept: 'application/json',
    Referer: 'https://open.spotify.com/',
  };

  if (clientId) {
    headers['Client-Id'] = clientId;
  }

  const response = await axios.get<spclientPlaylistResponseType>(
    `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}`,
    {
      headers,
      params: {offset, limit},
      timeout: 30000,
    },
  );

  return response.data;
};

const fetchSpclientPlaylistSnapshot = async (
  playlistId: string,
  onProgress?: (progress: spotifyConversionProgressType) => void,
) => {
  const tokenData = await ensureValidToken();
  let token = tokenData.accessToken;
  let clientId = tokenData.clientId;
  let userAgent = cachedUserAgent || generateUserAgent();
  let usePublicToken = false;

  const limit = 100;
  let offset = 0;
  let totalTracks = 0;
  let name = 'Unknown Playlist';
  let description = '';
  let imageUrl = '';
  let ownerId = 'spotify';
  let ownerName = 'Spotify';
  const seenTrackIds = new Set<string>();
  const maxPages = 1000;
  let pageCount = 0;

  let hasMorePages = true;
  while (hasMorePages) {
    pageCount++;
    if (pageCount > maxPages) {
      throw new Error(`Spotify playlist pagination exceeded ${maxPages} pages. Aborting to avoid infinite loop.`);
    }

    const maxRetries = 5;
    let pageData: spclientPlaylistResponseType | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        pageData = await fetchSpclientPage(playlistId, offset, limit, token, clientId, userAgent);
        break;
      } catch (error: any) {
        const status = getSpotifyErrorStatus(error);

        if (status === 401) {
          usePublicToken = false;
          const refreshed = await forceRefreshSpotifyToken();
          token = refreshed.accessToken;
          clientId = refreshed.clientId;
          userAgent = cachedUserAgent || userAgent;
          continue;
        }

        if (status === 429) {
          if (!usePublicToken) {
            const publicToken = await getPublicSpotifyToken();
            if (publicToken) {
              token = publicToken;
              usePublicToken = true;
              await sleep(1000);
              continue;
            }
          }

          const waitMs = getRetryAfterMs(
            (error?.response?.headers || error?.headers) as Record<string, unknown>,
            2000 * attempt,
          );
          await sleep(waitMs);
          continue;
        }

        if (status === 403) {
          throw new Error('Access denied. Playlist may be private or unavailable.');
        }

        if (status === 404) {
          throw new Error('Playlist not found. Please verify the Spotify URL or ID.');
        }

        if (attempt < maxRetries && (!status || status >= 500)) {
          await sleep(1000 * attempt);
          continue;
        }

        throw error;
      }
    }

    if (!pageData) {
      throw new Error('Failed to fetch Spotify playlist data after multiple attempts.');
    }

    if (offset === 0) {
      name = pageData.attributes?.name || name;
      description = pageData.attributes?.description || description;
      imageUrl = pageData.attributes?.picture || imageUrl;
      ownerName = pageData.attributes?.owner_name || ownerName;
      ownerId = pageData.attributes?.owner_username || ownerId;
      totalTracks = Number(pageData.length || 0);
    }

    const items = pageData.contents?.items || [];
    let newTrackIds = 0;
    for (const item of items) {
      const id = extractTrackIdFromUri(item.uri);
      if (id && !seenTrackIds.has(id)) {
        seenTrackIds.add(id);
        newTrackIds++;
      }
    }

    console.log(
      `🎼 Spotify playlist page ${pageCount}: offset=${offset}, items=${items.length}, unique_ids=${
        seenTrackIds.size
      }, total=${totalTracks || 'unknown'}`,
    );
    emitSpotifyProgress(onProgress, {
      phase: 'playlist',
      message:
        totalTracks > 0
          ? `Reading playlist tracks ${Math.min(seenTrackIds.size, totalTracks)}/${totalTracks}...`
          : `Reading playlist tracks... (${seenTrackIds.size} found)`,
      current: totalTracks > 0 ? Math.min(seenTrackIds.size, totalTracks) : seenTrackIds.size,
      total: totalTracks > 0 ? totalTracks : undefined,
      percentage:
        totalTracks > 0 ? Math.round((Math.min(seenTrackIds.size, totalTracks) / totalTracks) * 100) : undefined,
    });

    if (items.length > 0 && newTrackIds === 0) {
      console.warn('⚠️ Spotify pagination returned no new track IDs; stopping pagination to avoid loop.');
      hasMorePages = false;
      continue;
    }

    if (items.length === 0) {
      hasMorePages = false;
    } else if (totalTracks > 0 && seenTrackIds.size >= totalTracks) {
      hasMorePages = false;
    } else if (totalTracks === 0 && items.length < limit) {
      hasMorePages = false;
    } else {
      offset += limit;
    }
  }

  return {
    id: playlistId,
    name,
    description,
    imageUrl,
    ownerId,
    ownerName,
    totalTracks: totalTracks > 0 ? totalTracks : seenTrackIds.size,
    trackIds: Array.from(seenTrackIds),
  };
};

export const getSpotifyPlaylistBundle = async (
  id: string,
  onProgress?: (progress: spotifyConversionProgressType) => void,
): Promise<spotifyPlaylistBundleType> => {
  emitSpotifyProgress(onProgress, {
    phase: 'playlist',
    message: 'Fetching Spotify playlist details...',
    percentage: 0,
  });
  const snapshot = await fetchSpclientPlaylistSnapshot(id, onProgress);
  emitSpotifyProgress(onProgress, {
    phase: 'metadata',
    message: `Resolving ${snapshot.trackIds.length} Spotify tracks...`,
    current: 0,
    total: snapshot.trackIds.length,
    percentage: 0,
  });
  const tracks = await fetchSpotifyTracksFromPages(snapshot.trackIds, onProgress);
  emitSpotifyProgress(onProgress, {
    phase: 'metadata',
    message: `Resolved ${tracks.length} Spotify tracks.`,
    current: tracks.length,
    total: snapshot.trackIds.length,
    percentage: 100,
  });

  return {
    ...snapshot,
    tracks,
  };
};

/**
 * Fetch server time from Spotify
 */
const fetchServerTime = async (userAgent: string): Promise<number> => {
  try {
    const response = await axios.head('https://open.spotify.com/', {
      headers: {
        'User-Agent': userAgent,
        Accept: '*/*',
      },
      timeout: SERVER_TIME_TIMEOUT_MS,
    });

    const headers = response.headers as Record<string, string | undefined>;
    const dateHeader = headers?.date || headers?.Date;
    if (dateHeader) {
      return Math.floor(new Date(dateHeader).getTime() / 1000);
    }

    throw new Error('No Date header in response');
  } catch (error) {
    console.warn('Failed to fetch server time, using local time:', (error as Error).message);
    return Math.floor(Date.now() / 1000);
  }
};

/**
 * Fetch updated secrets from remote URL (matching Python implementation)
 */
const fetchUpdatedSecrets = async (userAgent: string): Promise<Record<string, number[]> | null> => {
  const source = SECRET_DICT_SOURCE;
  if (!source) {
    return null;
  }

  try {
    console.log('?? Fetching updated secrets...');
    let payload: unknown;

    if (/^https?:\/\//i.test(source)) {
      const response = await axios.get(source, {
        timeout: SECRET_FETCH_TIMEOUT_MS,
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      });
      payload = response.data;
    } else {
      let localPath = source;

      if (source.startsWith('file:')) {
        try {
          localPath = fileURLToPath(new URL(source));
        } catch {
          localPath = source.replace(/^file:\/\//, '');
        }
      }

      const resolvedPath = path.isAbsolute(localPath) ? localPath : path.resolve(process.cwd(), localPath);
      const fileContents = await fs.promises.readFile(resolvedPath, 'utf8');
      payload = JSON.parse(fileContents);
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid secrets payload');
    }

    const secrets = payload as Record<string, unknown>;
    for (const [key, value] of Object.entries(secrets)) {
      if (!/^\d+$/.test(key) || !Array.isArray(value) || !value.every((item) => typeof item === 'number')) {
        throw new Error(`Invalid secret format for key ${key}`);
      }
    }

    console.log('? Updated secrets loaded');
    return secrets as Record<string, number[]>;
  } catch (error) {
    console.warn('?? Failed to get updated secrets:', (error as Error).message);
    return null;
  }
};

/**
 * Generate TOTP using custom secret dictionary
 */
const generateTotpWithSecrets = (secretDict: Record<string, number[]>, serverTime: number): string => {
  // Auto-select highest version
  const ver = TOTP_VER || Math.max(...Object.keys(secretDict).map((k) => parseInt(k)));
  const verStr = ver.toString();

  if (!(verStr in secretDict)) {
    throw new Error(`TOTP version ${ver} not found in secret dictionary`);
  }

  const secretCipherBytes = secretDict[verStr];

  // Transform bytes: e ^ ((t % 33) + 9) - exactly like Python
  const transformed = secretCipherBytes.map((e, t) => e ^ ((t % 33) + 9));

  // Join as string and create secret - exactly like Python
  const joined = transformed.join('');
  const secretBytes = new TextEncoder().encode(joined);
  const hexStr = Array.from(secretBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const secret = base32.encode(new Uint8Array(Buffer.from(hexStr, 'hex'))).replace(/=/g, '');

  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: secret,
  });

  return totp.generate({timestamp: serverTime * 1000});
};

/**
 * Test if token is valid
 */
const validateToken = async (
  accessToken: string,
  clientId: string | undefined,
  userAgent: string,
  oauthApp = false,
): Promise<boolean> => {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': userAgent,
    };

    if (!oauthApp && clientId) {
      headers['Client-Id'] = clientId;
    }

    const response = await axios.get(
      oauthApp
        ? 'https://api.spotify.com/v1/tracks/7tFiyTwD0nx5a1eklYtX2J'
        : 'https://guc-spclient.spotify.com/presence-view/v1/buddylist',
      {
        headers,
        timeout: 10000,
      },
    );

    return response.status === 200;
  } catch {
    return false;
  }
};

/**
 * Generate TOTP using default secret dictionary
 */
const generateTotp = async (): Promise<string> => {
  const userAgent = generateUserAgent();
  const serverTime = await fetchServerTime(userAgent);
  return generateTotpWithSecrets(SECRET_CIPHER_DICT, serverTime);
};

/**
 * Refresh access token from Spotify - matching Python implementation exactly
 */
const refreshAccessToken = async (
  mode: 'transport' | 'init',
  spDc: string,
  secretDict: Record<string, number[]>,
  userAgent: string,
): Promise<tokensType> => {
  const serverTime = await fetchServerTime(userAgent);
  const clientTime = Date.now();
  const otp = generateTotpWithSecrets(secretDict, serverTime);

  const totpVer = TOTP_VER || Math.max(...Object.keys(secretDict).map((k) => parseInt(k)));

  const params: Record<string, any> = {
    reason: mode,
    productType: 'web-player',
    totp: otp,
    totpServer: otp,
    totpVer,
  };

  if (totpVer < 10) {
    const buildDate = new Date(serverTime * 1000).toISOString().split('T')[0];
    params.sTime = serverTime;
    params.cTime = clientTime;
    params.buildDate = buildDate;
    params.buildVer = `web-player_${buildDate}_${serverTime * 1000}_${generateRandomHex(8)}`;
  }

  const headers = {
    'User-Agent': userAgent,
    Accept: 'application/json',
    Referer: 'https://open.spotify.com/',
    'App-Platform': 'WebPlayer',
    Origin: 'https://open.spotify.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    Cookie: `sp_dc=${spDc}`,
  };

  try {
    const response = await axios.get<tokensType>('https://open.spotify.com/api/token', {
      params,
      headers,
      timeout: 15000,
    });

    if (!response.data || !response.data.accessToken) {
      throw new Error(`No access token in ${mode} mode response`);
    }

    return response.data;
  } catch (error: any) {
    console.log(
      `[spotify] Token request failed (mode=${mode}, totpVer=${params.totpVer}, status=${error.response?.status})`,
    );
    throw new Error(`Failed to get token in ${mode} mode: ${error.message}`);
  }
};

/**
 * Set spotify tokens with proper error handling - matching Python implementation
 */
export const setSpotifyAnonymousToken = async (): Promise<tokensType> => {
  const now = Date.now();

  if (cachedToken && tokenExpiresAt > now) {
    console.log('[spotify] Using cached token');
    spotifyApi = new SpotifyWebApi({clientId: cachedToken.clientId});
    spotifyApi.setAccessToken(cachedToken.accessToken);
    return cachedToken;
  }

  const spDc = getSpDcFromConfig();

  if (!spDc) {
    showCookieInstructions();
    throw new Error(`Spotify sp_dc cookie not found. Please add it to ${DEFAULT_CONFIG_FILE} (see instructions above)`);
  }

  console.log('[spotify] Found sp_dc cookie in config');

  let lastError: Error | null = null;
  const updatedSecrets = await fetchUpdatedSecrets(generateUserAgent());
  const primarySecrets = updatedSecrets || SECRET_CIPHER_DICT;
  const fallbackSecrets = updatedSecrets ? SECRET_CIPHER_DICT : null;

  const attemptWithSecrets = async (secrets: Record<string, number[]>, label: string): Promise<tokensType> => {
    const userAgent = generateUserAgent();
    let attemptError: Error | null = null;

    for (const mode of ['transport', 'init'] as const) {
      for (let attempt = 1; attempt <= TOKEN_MAX_RETRIES; attempt++) {
        try {
          const tokenData = await refreshAccessToken(mode, spDc, secrets, userAgent);
          const isValid = await validateToken(tokenData.accessToken, tokenData.clientId, userAgent, false);

          if (isValid) {
            console.log('[spotify] Token validation passed');
          } else {
            console.log('[spotify] Token validation failed; continuing with anonymous token');
          }

          cachedToken = tokenData;
          tokenExpiresAt = tokenData.accessTokenExpirationTimestampMs;
          cachedUserAgent = userAgent;

          spotifyApi = new SpotifyWebApi({clientId: tokenData.clientId});
          spotifyApi.setAccessToken(tokenData.accessToken);

          console.log(`[spotify] Authentication successful via ${label} (${mode})`);
          return tokenData;
        } catch (error) {
          attemptError = error as Error;
          console.log(`[spotify] ${label} ${mode} attempt ${attempt} failed: ${attemptError.message}`);
          if (attempt < TOKEN_MAX_RETRIES) {
            await sleep(TOKEN_RETRY_DELAY_MS * attempt);
          }
        }
      }
    }

    throw attemptError ?? new Error('Unknown authentication error');
  };

  try {
    return await attemptWithSecrets(primarySecrets, updatedSecrets ? 'updated secrets' : 'default secrets');
  } catch (error) {
    lastError = error as Error;
  }

  if (fallbackSecrets) {
    try {
      return await attemptWithSecrets(fallbackSecrets, 'default secrets fallback');
    } catch (error) {
      lastError = error as Error;
    }
  }

  console.log('\n[spotify] All authentication attempts failed.');
  console.log('[spotify] Troubleshooting:');
  console.log('  - Your sp_dc cookie might be expired - get a fresh one');
  console.log('  - Check your internet connection');
  console.log('  - Try again in a few minutes (rate limiting)');

  throw new Error(`Failed to authenticate with Spotify. Last error: ${lastError?.message || 'Unknown error'}`);
};

/**
 * Ensure we have a valid token before making API calls
 */
const ensureValidToken = async (): Promise<tokensType> => {
  if (!cachedToken || tokenExpiresAt <= Date.now()) {
    console.log('🔄 No valid token found, generating new one...');
    return await setSpotifyAnonymousToken();
  }
  spotifyApi = new SpotifyWebApi({clientId: cachedToken.clientId});
  spotifyApi.setAccessToken(cachedToken.accessToken);
  return cachedToken;
};

/**
 * Convert spotify songs to deezer
 */
export const track2deezer = async (id: string) => {
  await ensureValidToken();
  const {body} = await spotifyApi.getTrack(id);
  const artistName = body.artists[0]?.name || '';
  const albumName = body.album?.name;
  const durationSeconds = body.duration_ms ? Math.round(body.duration_ms / 1000) : undefined;
  return await isrc2deezer(body.name, body.external_ids.isrc, artistName, albumName, durationSeconds);
};

/**
 * Convert spotify albums to deezer
 */
export const album2deezer = async (id: string) => {
  await ensureValidToken();
  const {body} = await spotifyApi.getAlbum(id);
  return await upc2deezer(body.name, body.external_ids.upc);
};

/**
 * Convert playlist to deezer
 */
export const playlist2Deezer = async (
  id: string,
  onError?: (item: SpotifyApi.PlaylistTrackObject, index: number, err: Error) => void,
): Promise<[playlistInfo, trackType[]]> => {
  console.log('📋 Fetching Spotify playlist data via spclient...');
  const playlistBundle = await getSpotifyPlaylistBundle(id);
  const tracks: trackType[] = [];
  const spotifyTracks = playlistBundle.tracks;

  await queue.addAll(
    spotifyTracks.map((spotifyTrack, index) => {
      return async () => {
        try {
          const artistName = spotifyTrack.artists[0]?.name || '';
          const albumName = spotifyTrack.album?.name;
          const durationSeconds = spotifyTrack.duration_ms ? Math.round(spotifyTrack.duration_ms / 1000) : undefined;
          const track = await isrc2deezer(
            spotifyTrack.name,
            spotifyTrack.external_ids?.isrc,
            artistName,
            albumName,
            durationSeconds,
          );
          track.TRACK_POSITION = index + 1;
          tracks.push(track);
        } catch (err: any) {
          if (onError) {
            onError({track: spotifyTrack} as SpotifyApi.PlaylistTrackObject, index, err);
          }
        }
      };
    }),
  );

  const dateCreated = new Date().toISOString();
  const playlistInfoData: playlistInfo = {
    PLAYLIST_ID: playlistBundle.id,
    PARENT_USERNAME: playlistBundle.ownerName,
    PARENT_USER_ID: playlistBundle.ownerId,
    PICTURE_TYPE: 'cover',
    PLAYLIST_PICTURE: playlistBundle.imageUrl || '',
    TITLE: playlistBundle.name,
    TYPE: '0',
    STATUS: '0',
    USER_ID: playlistBundle.ownerId,
    DATE_ADD: dateCreated,
    DATE_MOD: dateCreated,
    DATE_CREATE: dateCreated,
    NB_SONG: playlistBundle.totalTracks,
    NB_FAN: 0,
    CHECKSUM: playlistBundle.id,
    HAS_ARTIST_LINKED: false,
    IS_SPONSORED: false,
    IS_EDITO: false,
    __TYPE__: 'playlist',
  };

  return [playlistInfoData, tracks];
};

/**
 * Convert artist songs to deezer
 */
export const artist2Deezer = async (
  id: string,
  onError?: (item: SpotifyApi.TrackObjectFull, index: number, err: Error) => void,
): Promise<trackType[]> => {
  await ensureValidToken();
  const {body} = await spotifyApi.getArtistTopTracks(id, 'GB');
  const tracks: trackType[] = [];

  await queue.addAll(
    body.tracks.map((item, index) => {
      return async () => {
        try {
          const artistName = item.artists[0]?.name || '';
          const albumName = item.album?.name;
          const durationSeconds = item.duration_ms ? Math.round(item.duration_ms / 1000) : undefined;
          const track = await isrc2deezer(item.name, item.external_ids.isrc, artistName, albumName, durationSeconds);
          tracks.push(track);
        } catch (err: any) {
          if (onError) {
            onError(item, index, err);
          }
        }
      };
    }),
  );

  return tracks;
};
