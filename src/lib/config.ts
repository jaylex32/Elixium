import {existsSync, readFileSync, writeFileSync} from 'fs';
import dotProp from 'dot-prop';
import signale from './signale';
import {DEFAULT_CONFIG_FILE} from '../app/brand';

type keysType =
  | 'concurrency'
  | 'saveLayout'
  | 'saveLayout.track'
  | 'saveLayout.album'
  | 'saveLayout.artist'
  | 'saveLayout.playlist'
  | 'playlist.resolveFullPath'
  | 'trackNumber'
  | 'fallbackTrack'
  | 'fallbackQuality'
  | 'deezerDownloadCover'
  | 'qobuzDownloadCover'
  | 'coverSize'
  | 'coverSize.128'
  | 'coverSize.320'
  | 'coverSize.flac'
  | 'cookies.arl'
  | 'tempDirectory'
  | 'qobuz.app_id'
  | 'qobuz.secrets'
  | 'qobuz.token';

type configType = {
  concurrency: number;
  saveLayout: {
    track: string;
    album: string;
    artist: string;
    playlist: string;
    'qobuz-album': string;
    'qobuz-track': string;
    'qobuz-artist': string;
    'qobuz-playlist': string;
  };
  playlist: {
    resolveFullPath: boolean;
  };
  trackNumber: boolean;
  fallbackTrack: boolean;
  fallbackQuality: boolean;
  qobuzDownloadCover: boolean;
  deezerDownloadCover: boolean;
  coverSize: {
    '128': number;
    '320': number;
    flac: number;
  };
  cookies: {
    arl: string;
  };
  tempDirectory: string;
};

const old_arl =
  'c911a4ac9f44a52bf23720cc88588557d999b975094068d258e617bf3e9110a2626c2ff7f5d3cb471b435512e0f5a4de4d7d7e3becad4bf80b0a0e230d9001a814124f87833fe772fb6b1327d2be740f65bc5bcfc1de9171926b5ea9aae69db7';

const defaultConfig: configType = {
  concurrency: 4,
  saveLayout: {
    track: 'Music/{ALB_TITLE}/{SNG_TITLE}',
    album: 'Music/{ALB_TITLE}/{SNG_TITLE}',
    artist: 'Music/{ALB_TITLE}/{SNG_TITLE}',
    playlist: 'Playlist/{TITLE}/{SNG_TITLE}',
    'qobuz-album': 'Music/{album.title}/{title}',
    'qobuz-track': 'Music/{album.title}/{title}',
    'qobuz-artist': 'artist/{alb_title}/{no_track_number}{alb_artist} - {title}',
    'qobuz-playlist': 'Playlist/{list_title}/{title}',
  },
  playlist: {
    resolveFullPath: false,
  },
  trackNumber: true,
  fallbackTrack: true,
  fallbackQuality: true,
  qobuzDownloadCover: false,
  deezerDownloadCover: false,
  coverSize: {
    '128': 500,
    '320': 500,
    flac: 1000,
  },
  cookies: {
    arl: 'c973964816688562722418b5200c1515dffaad15a42643ebf87cc72824a54612ec51c2ad42d566743f9e424c774e98ccae7737770acff59251328e6cd598c7bcac38ca269adf78bfb88ec5bbad6cd800db3c0b88b2af645bb22b99e71de26416',
  },
  tempDirectory: 'temp',
};

class Config {
  public userConfigLocation: string | null;
  private configFile: string;
  private store: configType;

  constructor(configFile = DEFAULT_CONFIG_FILE) {
    this.userConfigLocation = null;
    this.configFile = configFile;
    this.store = this.getConfig(configFile);

    // migrate data
    if (this.store.cookies.arl === old_arl) {
      this.set('cookies.arl', defaultConfig.cookies.arl);
    }
  }

  private getConfig(configFile: string): configType {
    if (!existsSync(configFile)) {
      return defaultConfig;
    }

    try {
      const userConfig: configType = JSON.parse(readFileSync(configFile, 'utf-8'));
      if (userConfig.saveLayout) {
        userConfig.saveLayout = {...defaultConfig.saveLayout, ...userConfig.saveLayout};
      }
      if (userConfig.playlist) {
        userConfig.playlist = {...defaultConfig.playlist, ...userConfig.playlist};
      }
      if (userConfig.coverSize) {
        userConfig.coverSize = {...defaultConfig.coverSize, ...userConfig.coverSize};
      }
      if (userConfig.cookies) {
        userConfig.cookies = {...defaultConfig.cookies, ...userConfig.cookies};
      }
      this.userConfigLocation = configFile;
      return {...defaultConfig, ...userConfig};
    } catch (err: any) {
      console.error(signale.error(`Unable to parse config: ${configFile}`));
      console.error(signale.note(err.message));
      console.warn(signale.warn('Falling back to default config'));
      return defaultConfig;
    }
  }

  /**
   * Get an item.
   * @param key - The key of the item to get.
   * @param defaultValue - The default value if the item does not exist.
   */
  get(key: keysType, defaultValue?: string | boolean | number) {
    return dotProp.get(this.store, key, defaultValue);
  }

  /**
   * Set an item or multiple items at once.
   * @param {key|object} - You can use [dot-notation](https://github.com/sindresorhus/dot-prop) in a key to access nested properties. Or a hashmap of items to set at once.
   * @param value - Must be JSON serializable. Trying to set the type `undefined`, `function`, or `symbol` will result in a `TypeError`.
   */
  set(key: keysType, value: string | boolean | number, persist = true) {
    dotProp.set(this.store, key, value);
    if (persist) {
      writeFileSync(this.configFile, JSON.stringify(this.store, null, 2));
    }
    return this.configFile;
  }

  /**
   * Delete an item.
   * @param key - The key of the item to delete.
   */
  delete(key: keysType) {
    dotProp.delete(this.store, key);
  }
}

export default Config;
