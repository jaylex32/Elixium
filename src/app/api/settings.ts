/**
 * Single source of truth for the settings document exposed to clients.
 *
 * The Socket.IO `getSettings` / `saveSettings` handlers and the REST
 * `GET|PATCH /api/v1/settings` routes both delegate here so the two transports
 * always agree on field names, defaults, and which changes invalidate a
 * service session.
 */

import {resolveCoverSize} from '../../lib/cover-art';

export interface SettingsInvalidationHooks {
  setIsDeezerDownloadReady: (value: boolean) => void;
  setIsQobuzInitialized: (value: boolean) => void;
  setIsQobuzDownloadReady: (value: boolean) => void;
  setConcurrency?: (value: number) => void;
}

export interface ElixiumSettings {
  concurrency: unknown;
  trackNumber: unknown;
  fallbackTrack: unknown;
  fallbackQuality: unknown;
  deezerDownloadCover: unknown;
  qobuzDownloadCover: unknown;
  embedLyrics: unknown;
  saveLrcFile: unknown;
  createPlaylist: unknown;
  cookies: {arl: unknown; sp_dc: unknown};
  qobuz: {app_id: unknown; secrets: unknown; token: unknown};
  saveLayout: unknown;
  coverSize: unknown;
  playlist: unknown;
  paths: {deezer: string; qobuz: string};
  quality: {deezer: string; qobuz: string};
  /** The token itself is never included here — see GET /auth/token. */
  auth: {enabled: boolean; allowedOrigins: string[]};
}

/** Fields that carry credentials and must never appear in a shared response. */
const SECRET_PATHS = ['cookies.arl', 'cookies.sp_dc', 'qobuz.token', 'qobuz.secrets'] as const;

export const readSettings = (conf: any): ElixiumSettings => ({
  concurrency: conf.get('concurrency'),
  trackNumber: conf.get('trackNumber'),
  fallbackTrack: conf.get('fallbackTrack'),
  fallbackQuality: conf.get('fallbackQuality'),
  deezerDownloadCover: conf.get('deezerDownloadCover'),
  qobuzDownloadCover: conf.get('qobuzDownloadCover'),
  // Default on: an embedded lyric is inert if a player ignores it.
  embedLyrics: conf.get('embedLyrics') !== false,
  saveLrcFile: Boolean(conf.get('saveLrcFile')),
  createPlaylist: conf.get('playlist.createPlaylist'),
  cookies: {
    arl: conf.get('cookies.arl'),
    sp_dc: conf.get('cookies.sp_dc'),
  },
  qobuz: {
    app_id: conf.get('qobuz.app_id'),
    secrets: conf.get('qobuz.secrets'),
    token: conf.get('qobuz.token'),
  },
  saveLayout: conf.get('saveLayout'),
  // Flattened to a single width: the config keeps one per quality tier, but
  // clients offer one control and would render "[object Object]".
  coverSize: resolveCoverSize(conf.get('coverSize')),
  playlist: conf.get('playlist'),
  paths: {
    deezer: conf.get('paths.deezer') || './Music/Deezer',
    qobuz: conf.get('paths.qobuz') || './Music/Qobuz',
  },
  quality: {
    deezer: conf.get('quality.deezer') || '320',
    qobuz: conf.get('quality.qobuz') || '44khz',
  },
  auth: {
    enabled: conf.get('auth.enabled') !== false,
    allowedOrigins: Array.isArray(conf.get('auth.allowedOrigins')) ? conf.get('auth.allowedOrigins') : [],
  },
});

/**
 * Settings with credentials replaced by a presence flag.
 *
 * The REST API is reachable from a phone over the network, so it returns this
 * form: a client can tell whether a token is configured and prompt for a new
 * one, without the secret itself crossing the wire on every settings fetch.
 */
export const readRedactedSettings = (conf: any): ElixiumSettings & {configured: Record<string, boolean>} => {
  const settings = readSettings(conf);
  const present = (value: unknown) => Boolean(value && String(value).trim());

  return {
    ...settings,
    cookies: {arl: present(settings.cookies.arl), sp_dc: present(settings.cookies.sp_dc)},
    qobuz: {
      app_id: settings.qobuz.app_id,
      secrets: present(settings.qobuz.secrets),
      token: present(settings.qobuz.token),
    },
    configured: {
      deezer: present(settings.cookies.arl),
      qobuz: present(settings.qobuz.token) && present(settings.qobuz.app_id),
      spotify: present(settings.cookies.sp_dc),
    },
  };
};

export const SECRET_SETTING_PATHS: readonly string[] = SECRET_PATHS;

/**
 * Should this incoming value be written to a credential field?
 *
 * An empty string is a deliberate "clear this" — previously credentials were
 * only written when truthy, so a token that was wrong or corrupted could not be
 * removed through the UI at all; blanking the field silently kept the old
 * value.
 *
 * Booleans are rejected because `readRedactedSettings` reports credentials as
 * presence flags: a client that GETs the redacted document and PATCHes it back
 * wholesale would otherwise overwrite real tokens with the string "true".
 */
const isCredentialUpdate = (value: unknown): boolean =>
  value !== undefined && value !== null && typeof value !== 'boolean';

/**
 * Apply a partial settings update.
 *
 * Only keys present in `data` are written, so this is safe to call from a PATCH
 * with a sparse body. Credential changes reset the matching service session so
 * the next request re-authenticates.
 */
export const applySettings = (conf: any, data: any, hooks: SettingsInvalidationHooks): string[] => {
  const changed: string[] = [];
  if (!data || typeof data !== 'object') return changed;

  const setIfPresent = (key: string, value: unknown, path = key) => {
    if (value === undefined) return;
    conf.set(path, value);
    changed.push(path);
  };

  if (data.concurrency !== undefined && data.concurrency !== null) {
    const concurrency = Number(data.concurrency);
    if (Number.isFinite(concurrency) && concurrency > 0) {
      conf.set('concurrency', concurrency);
      hooks.setConcurrency?.(concurrency);
      changed.push('concurrency');
    }
  }

  setIfPresent('trackNumber', data.trackNumber);
  setIfPresent('fallbackTrack', data.fallbackTrack);
  setIfPresent('fallbackQuality', data.fallbackQuality);
  setIfPresent('deezerDownloadCover', data.deezerDownloadCover);
  setIfPresent('qobuzDownloadCover', data.qobuzDownloadCover);
  setIfPresent('embedLyrics', data.embedLyrics);
  setIfPresent('saveLrcFile', data.saveLrcFile);
  setIfPresent('saveLayout', data.saveLayout);
  /*
   * `coverSize` is stored per quality tier, but the UI offers one control.
   * A bare number used to be written straight over the object, after which
   * coverSizes['flac'] was undefined and covers silently downloaded at the
   * wrong size (or not at all). Expand a scalar across all three tiers so both
   * shapes stay valid on disk.
   */
  if (data.coverSize !== undefined && data.coverSize !== null) {
    const scalar = Number(data.coverSize);
    if (Number.isFinite(scalar) && scalar > 0) {
      conf.set('coverSize', {'128': scalar, '320': scalar, flac: scalar});
      changed.push('coverSize');
    } else if (typeof data.coverSize === 'object') {
      conf.set('coverSize', data.coverSize);
      changed.push('coverSize');
    }
  }
  setIfPresent('createPlaylist', data.createPlaylist, 'playlist.createPlaylist');

  if (data.cookies) {
    if (isCredentialUpdate(data.cookies.arl)) {
      conf.set('cookies.arl', String(data.cookies.arl).trim());
      hooks.setIsDeezerDownloadReady(false);
      changed.push('cookies.arl');
    }
    if (isCredentialUpdate(data.cookies.sp_dc)) {
      conf.set('cookies.sp_dc', String(data.cookies.sp_dc).trim());
      changed.push('cookies.sp_dc');
    }
  }

  if (data.qobuz) {
    if (isCredentialUpdate(data.qobuz.token)) {
      conf.set('qobuz.token', String(data.qobuz.token).trim());
      hooks.setIsQobuzDownloadReady(false);
      changed.push('qobuz.token');
    }
    if (data.qobuz.app_id !== undefined && data.qobuz.app_id !== null && String(data.qobuz.app_id).trim() !== '') {
      const appId = Number(data.qobuz.app_id);
      conf.set('qobuz.app_id', Number.isNaN(appId) ? data.qobuz.app_id : appId);
      hooks.setIsQobuzInitialized(false);
      hooks.setIsQobuzDownloadReady(false);
      changed.push('qobuz.app_id');
    }
    if (data.qobuz.secrets !== undefined) {
      conf.set('qobuz.secrets', String(data.qobuz.secrets || '').trim());
      hooks.setIsQobuzInitialized(false);
      hooks.setIsQobuzDownloadReady(false);
      changed.push('qobuz.secrets');
    }
  }

  if (data.auth && typeof data.auth === 'object') {
    if (typeof data.auth.enabled === 'boolean') {
      conf.set('auth.enabled', data.auth.enabled);
      changed.push('auth.enabled');
    }
    if (Array.isArray(data.auth.allowedOrigins)) {
      // Normalised to bare origins: a trailing slash or a path never matches
      // the Origin header a browser actually sends.
      const origins = data.auth.allowedOrigins
        .filter((entry: unknown): entry is string => typeof entry === 'string')
        .map((entry: string) => entry.trim().replace(/\/+$/, ''))
        .filter((entry: string) => entry.length > 0);
      conf.set('auth.allowedOrigins', origins);
      changed.push('auth.allowedOrigins');
    }
  }

  if (data.paths) {
    conf.set('paths', data.paths);
    changed.push('paths');
  }

  if (data.quality) {
    if (data.quality.deezer) {
      conf.set('quality.deezer', data.quality.deezer);
      changed.push('quality.deezer');
    }
    if (data.quality.qobuz) {
      conf.set('quality.qobuz', data.quality.qobuz);
      changed.push('quality.qobuz');
    }
  }

  return changed;
};
