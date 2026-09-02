import axios from 'axios';
import {getSongFileName} from '../lib/decrypt';
import instance from '../lib/request';
import type {trackType} from '../types';

interface userData {
  license_token: string;
  can_stream_lossless: boolean;
  can_stream_hq: boolean;
  country: string;
}

export class WrongLicense extends Error {
  constructor(format: string) {
    super();
    this.name = 'WrongLicense';
    this.message = `Your account can't stream ${format} tracks`;
  }
}

export class GeoBlocked extends Error {
  constructor(country: string) {
    super();
    this.name = 'GeoBlocked';
    this.message = `This track is not available in your country (${country})`;
  }
}

let user_data: userData | null = null;

/**
 * The session the cached licence describes.
 *
 * The licence was read once per process and kept forever, which is wrong in
 * both directions. The first read can land before the ARL session exists —
 * playing a track moments after launch resolves a URL while the login is still
 * in flight — and an anonymous session reports no HQ and no lossless. Every
 * later request for MP3_320 then threw WrongLicense, the downloader stepped
 * down its ladder, and a premium account received 128kbps files for the rest of
 * the process, labelled 320 because that is what had been asked for. Pasting a
 * fresh ARL did not help either: the stale answer outlived the new session.
 *
 * Holding the session alongside the answer keeps the caching — the licence is
 * still read once per session, not once per track — while making it follow the
 * account it actually belongs to.
 */
let user_data_session: string | null = null;

const currentSession = (): string => String((instance.defaults.params as Record<string, unknown>)?.sid ?? '');

const dzAuthenticate = async (): Promise<userData> => {
  /*
   * Read before the request, not after.
   *
   * Login can complete while this is in flight — that is the whole reason this
   * cache goes stale — and stamping the answer with the session in force when
   * it returns would file a free account's licence under the premium session
   * that replaced it. Recording the session it was actually read under means a
   * change part-way through simply misses the cache next time and is read
   * again, which is the safe direction to be wrong in.
   */
  const readUnder = currentSession();
  const {data} = await instance.get<any>('https://www.deezer.com/ajax/gw-light.php', {
    params: {
      method: 'deezer.getUserData',
      api_version: '1.0',
      api_token: 'null',
    },
  });
  user_data = {
    license_token: data.results.USER.OPTIONS.license_token,
    can_stream_lossless: data.results.USER.OPTIONS.web_lossless || data.results.USER.OPTIONS.mobile_loseless,
    can_stream_hq: data.results.USER.OPTIONS.web_hq || data.results.USER.OPTIONS.mobile_hq,
    country: data.results.COUNTRY,
  };
  user_data_session = readUnder;
  return user_data;
};

/** The licence for the session in force, read once per session. */
const licenceForSession = async (): Promise<userData> => {
  if (user_data && user_data_session === currentSession()) return user_data;
  return dzAuthenticate();
};

const getTrackUrlFromServer = async (track_token: string, format: string): Promise<string | null> => {
  const user = await licenceForSession();
  if ((format === 'FLAC' && !user.can_stream_lossless) || (format === 'MP3_320' && !user.can_stream_hq)) {
    throw new WrongLicense(format);
  }

  const {data} = await instance.post<any>('https://media.deezer.com/v1/get_url', {
    license_token: user.license_token,
    media: [
      {
        type: 'FULL',
        formats: [{format, cipher: 'BF_CBC_STRIPE'}],
      },
    ],
    track_tokens: [track_token],
  });

  if (data.data.length > 0) {
    if (data.data[0].errors) {
      if (data.data[0].errors[0].code === 2002) {
        throw new GeoBlocked(user.country);
      }
      throw new Error(Object.entries(data.data[0].errors[0]).join(', '));
    }
    return data.data[0].media.length > 0 ? data.data[0].media[0].sources[0].url : null;
  }
  return null;
};

/**
 * @param track Track info json returned from `getTrackInfo`
 * @param quality 1 = 128kbps, 3 = 320kbps and 9 = flac (around 1411kbps)
 */
export const getTrackDownloadUrl = async (
  track: trackType,
  quality: number,
): Promise<{trackUrl: string; isEncrypted: boolean; fileSize: number} | null> => {
  let wrongLicense: WrongLicense | null = null;
  let geoBlocked: GeoBlocked | null = null;
  let formatName: string;
  switch (quality) {
    case 9:
      formatName = 'FLAC';
      break;
    case 3:
      formatName = 'MP3_320';
      break;
    case 1:
      formatName = 'MP3_128';
      break;
    default:
      throw new Error(`Unknown quality ${quality}`);
  }

  // Get URL with the official API
  try {
    const url = await getTrackUrlFromServer(track.TRACK_TOKEN, formatName);
    if (url) {
      const fileSize = await testUrl(url);
      if (fileSize > 0) {
        return {
          trackUrl: url,
          isEncrypted: url.includes('/mobile/') || url.includes('/media/'),
          fileSize: fileSize,
        };
      }
    }
  } catch (err) {
    if (err instanceof WrongLicense) {
      wrongLicense = err;
    } else if (err instanceof GeoBlocked) {
      geoBlocked = err;
    } else {
      throw err;
    }
  }

  /*
   * Fallback to the legacy CDN URL, but only when the data for it exists.
   *
   * MD5_ORIGIN is absent from the track payload on some accounts — free ones
   * in particular — and indexing it unguarded threw "Cannot read properties of
   * undefined (reading '0')" for every single track. That surfaced as a whole
   * album failing with an error naming nothing recognisable, hiding whatever
   * the real reason was: the licence refusal or geo-block captured above, or
   * simply that the modern endpoint returned no URL.
   */
  if (typeof track.MD5_ORIGIN === 'string' && track.MD5_ORIGIN.length > 0) {
    const filename = getSongFileName(track, quality); // encrypted file name
    const url = `https://e-cdns-proxy-${track.MD5_ORIGIN[0]}.dzcdn.net/mobile/1/${filename}`;
    const fileSize = await testUrl(url);
    if (fileSize > 0) {
      return {
        trackUrl: url,
        isEncrypted: url.includes('/mobile/') || url.includes('/media/'),
        fileSize: fileSize,
      };
    }
  }

  if (wrongLicense) {
    throw wrongLicense;
  }
  if (geoBlocked) {
    throw geoBlocked;
  }
  return null;
};

const testUrl = async (url: string): Promise<number> => {
  try {
    const {headers} = await axios.head(url);
    return Number(headers['content-length']);
  } catch (err) {
    return 0;
  }
};
