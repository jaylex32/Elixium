/**
 * Single source of truth for the settings document exposed to clients.
 *
 * The Socket.IO `getSettings` / `saveSettings` handlers and the REST
 * `GET|PATCH /api/v1/settings` routes both delegate here so the two transports
 * always agree on field names, defaults, and which changes invalidate a
 * service session.
 */

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
  createPlaylist: unknown;
  cookies: {arl: unknown; sp_dc: unknown};
  qobuz: {app_id: unknown; secrets: unknown; token: unknown};
  saveLayout: unknown;
  coverSize: unknown;
  playlist: unknown;
  paths: {deezer: string; qobuz: string};
  quality: {deezer: string; qobuz: string};
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
  coverSize: conf.get('coverSize'),
  playlist: conf.get('playlist'),
  paths: {
    deezer: conf.get('paths.deezer') || './Music/Deezer',
    qobuz: conf.get('paths.qobuz') || './Music/Qobuz',
  },
  quality: {
    deezer: conf.get('quality.deezer') || '320',
    qobuz: conf.get('quality.qobuz') || '44khz',
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
  setIfPresent('saveLayout', data.saveLayout);
  setIfPresent('coverSize', data.coverSize);
  setIfPresent('createPlaylist', data.createPlaylist, 'playlist.createPlaylist');

  if (data.cookies) {
    if (data.cookies.arl) {
      conf.set('cookies.arl', data.cookies.arl);
      hooks.setIsDeezerDownloadReady(false);
      changed.push('cookies.arl');
    }
    if (data.cookies.sp_dc) {
      conf.set('cookies.sp_dc', data.cookies.sp_dc);
      changed.push('cookies.sp_dc');
    }
  }

  if (data.qobuz) {
    if (data.qobuz.token) {
      conf.set('qobuz.token', data.qobuz.token);
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
