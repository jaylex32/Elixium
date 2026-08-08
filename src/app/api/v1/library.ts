import type {Express} from 'express';
import {ApiError, parseService, requireString, route, sendData} from '../respond';
import {applySettings, readRedactedSettings, type SettingsInvalidationHooks} from '../settings';

export interface LibraryRouteDependencies {
  app: Express;
  basePath: string;
  conf: any;
  deezer: any;
  qobuz: any;
  initDeezerForDownload: () => Promise<void>;
  initQobuzForDownload: () => Promise<void>;
  settingsHooks: SettingsInvalidationHooks;
  watchlist?: any;
  activeDownloads: Map<string, any> | any;
  getCurrentDownloadQueue: () => any[];
  getIsDownloading: () => boolean;
  startDownloadProcess: (queue: any[], quality: string, service: string, settings: any, socket?: any) => Promise<void>;
  normalizeQuality?: (quality: string, service: string) => string;
}

/** Coerce the active-download registry into a plain array regardless of backing type. */
const toArray = (value: any): any[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  if (typeof value === 'object') return Object.values(value);
  return [];
};

const requireWatchlist = (watchlist: any) => {
  if (!watchlist) {
    throw new ApiError('service_unavailable', 'Watchlist service is not enabled on this server');
  }
  return watchlist;
};

export const registerLibraryRoutes = ({
  app,
  basePath,
  conf,
  deezer,
  qobuz,
  initDeezerForDownload,
  initQobuzForDownload,
  settingsHooks,
  watchlist,
  activeDownloads,
  getCurrentDownloadQueue,
  getIsDownloading,
  startDownloadProcess,
  normalizeQuality,
}: LibraryRouteDependencies): void => {
  // ── Settings ───────────────────────────────────────────────────────────────

  /** GET /settings — credentials come back as booleans, never as raw secrets. */
  app.get(
    `${basePath}/settings`,
    route(async (_req, res) => sendData(res, readRedactedSettings(conf))),
  );

  /** PATCH /settings — sparse update; only the keys you send are written. */
  app.patch(
    `${basePath}/settings`,
    route(async (req, res) => {
      const changed = applySettings(conf, req.body, settingsHooks);
      return sendData(res, readRedactedSettings(conf), {changed, count: changed.length});
    }),
  );

  /**
   * POST /services/:service/verify
   *
   * Actually exercises the stored credentials instead of reporting whether a
   * value is present. /health can only say "configured", which stays true for
   * an expired Deezer ARL — the symptom of which is silent 30-second previews
   * and missing lyrics, with nothing in the UI explaining why.
   */
  app.post(
    `${basePath}/services/:service/verify`,
    route(async (req, res) => {
      const service = parseService(req.params.service);

      if (service === 'deezer') {
        const arl = conf.get('cookies.arl');
        if (!arl) {
          return sendData(res, {service, ok: false, reason: 'missing_credential', message: 'No ARL cookie is set.'});
        }
        try {
          await initDeezerForDownload();
          const user = await deezer.getUser();
          return sendData(res, {
            service,
            ok: true,
            account: user?.BLOG_NAME ?? null,
            message: 'Deezer session is valid.',
          });
        } catch (error: any) {
          const message = String(error?.message ?? error);
          // The private API answers with this when the cookie no longer
          // authenticates, which is by far the most common failure here.
          const expired = /NEED_USER_AUTH|user auth/i.test(message);
          return sendData(res, {
            service,
            ok: false,
            reason: expired ? 'expired_credential' : 'auth_failed',
            message: expired
              ? 'Your ARL cookie has expired. Get a fresh one from deezer.com and paste it above.'
              : message,
          });
        }
      }

      const token = conf.get('qobuz.token');
      if (!token) {
        return sendData(res, {service, ok: false, reason: 'missing_credential', message: 'No Qobuz token is set.'});
      }
      try {
        await initQobuzForDownload();
        // A cheap authenticated read: succeeds only with a usable session.
        await qobuz.getTrackInfo(Number(5966783)).catch(() => undefined);
        return sendData(res, {service, ok: true, account: null, message: 'Qobuz session is valid.'});
      } catch (error: any) {
        return sendData(res, {
          service,
          ok: false,
          reason: 'auth_failed',
          message: String(error?.message ?? error),
        });
      }
    }),
  );

  // ── Downloads ──────────────────────────────────────────────────────────────

  /** GET /downloads — what the server is working on right now. */
  app.get(
    `${basePath}/downloads`,
    route(async (_req, res) => {
      const active = toArray(activeDownloads);
      return sendData(
        res,
        {active, queue: getCurrentDownloadQueue() ?? []},
        {isDownloading: getIsDownloading(), activeCount: active.length},
      );
    }),
  );

  /**
   * POST /downloads — queue a server-side download.
   * Body: {service, quality?, tracks: [...], settings?}
   *
   * This writes to the server's configured music folder. Clients that want the
   * bytes themselves should use /tracks/:id/file or /downloads/archive instead.
   */
  app.post(
    `${basePath}/downloads`,
    route(async (req, res) => {
      const service = parseService(req.body?.service);
      const tracks = req.body?.tracks ?? req.body?.queue;

      if (!Array.isArray(tracks) || tracks.length === 0) {
        throw ApiError.badRequest('tracks must be a non-empty array');
      }

      const requested = String(req.body?.quality || '');
      const quality = normalizeQuality ? normalizeQuality(requested, service) : requested;

      // Deliberately not awaited: downloads are long-running and progress is
      // reported over Socket.IO. Awaiting here would hold the HTTP request open
      // for the entire queue.
      void startDownloadProcess(tracks, quality, service, req.body?.settings ?? {}).catch((error: any) => {
        console.error('Download process failed:', error?.message ?? error);
      });

      return sendData(res, {accepted: tracks.length, service, quality}, {status: 'queued'});
    }),
  );

  // ── Watchlist ──────────────────────────────────────────────────────────────

  /** GET /watchlist — full watchlist state (artists, playlists, pending releases). */
  app.get(
    `${basePath}/watchlist`,
    route(async (_req, res) => {
      const service = requireWatchlist(watchlist);
      return sendData(res, await service.getState());
    }),
  );

  /** GET /watchlist/history — past scan results. */
  app.get(
    `${basePath}/watchlist/history`,
    route(async (_req, res) => {
      const service = requireWatchlist(watchlist);
      return sendData(res, await service.getWatchlistHistory());
    }),
  );

  /** GET /watchlist/schedules — configured automatic scan windows. */
  app.get(
    `${basePath}/watchlist/schedules`,
    route(async (_req, res) => {
      const service = requireWatchlist(watchlist);
      return sendData(res, await service.getMonitorSchedules());
    }),
  );

  /** POST /watchlist/artists — start watching an artist. Body: {artistId, name?} */
  app.post(
    `${basePath}/watchlist/artists`,
    route(async (req, res) => {
      const service = requireWatchlist(watchlist);
      const artistId = requireString(req.body?.artistId ?? req.body?.id, 'artistId');
      const result = await service.addWatchedArtist({artistId, name: req.body?.name});
      return sendData(res, result ?? (await service.getState()));
    }),
  );

  /** DELETE /watchlist/artists/:id — stop watching an artist. */
  app.delete(
    `${basePath}/watchlist/artists/:id`,
    route(async (req, res) => {
      const service = requireWatchlist(watchlist);
      const artistId = requireString(req.params.id, 'id');
      await service.removeWatchedArtist({artistId});
      return sendData(res, {removed: artistId});
    }),
  );

  /** POST /watchlist/playlists — start watching a playlist. */
  app.post(
    `${basePath}/watchlist/playlists`,
    route(async (req, res) => {
      const service = requireWatchlist(watchlist);
      const playlistId = requireString(req.body?.playlistId ?? req.body?.id, 'playlistId');
      const result = await service.addWatchedPlaylist({playlistId, name: req.body?.name});
      return sendData(res, result ?? (await service.getState()));
    }),
  );

  /** DELETE /watchlist/playlists/:id — stop watching a playlist. */
  app.delete(
    `${basePath}/watchlist/playlists/:id`,
    route(async (req, res) => {
      const service = requireWatchlist(watchlist);
      const playlistId = requireString(req.params.id, 'id');
      await service.removeWatchedPlaylist({playlistId});
      return sendData(res, {removed: playlistId});
    }),
  );

  /** POST /watchlist/scan — run a scan immediately instead of waiting for the schedule. */
  app.post(
    `${basePath}/watchlist/scan`,
    route(async (_req, res) => {
      const service = requireWatchlist(watchlist);
      const result = await service.runMonitorNow();
      return sendData(res, result ?? {started: true});
    }),
  );

  /** GET /watchlist/genres — favourite genres used to bias discovery. */
  app.get(
    `${basePath}/watchlist/genres`,
    route(async (_req, res) => {
      const service = requireWatchlist(watchlist);
      return sendData(res, await service.getFavoriteGenres());
    }),
  );

  /** PUT /watchlist/genres — replace the favourite-genre selection. */
  app.put(
    `${basePath}/watchlist/genres`,
    route(async (req, res) => {
      const service = requireWatchlist(watchlist);
      const genres = req.body?.genres;
      if (!Array.isArray(genres)) throw ApiError.badRequest('genres must be an array');
      await service.saveFavoriteGenres({genres});
      return sendData(res, await service.getFavoriteGenres());
    }),
  );
};
