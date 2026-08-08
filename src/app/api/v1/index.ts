import type {Express} from 'express';
import {route, sendData, sendError, ApiError} from '../respond';
import {DEEZER_QUALITIES, QOBUZ_QUALITIES} from '../quality';
import {readRedactedSettings} from '../settings';
import {registerCatalogRoutes, type CatalogRouteDependencies} from './catalog';
import {registerMediaRoutes, type MediaRouteDependencies} from './media';
import {registerLibraryRoutes, type LibraryRouteDependencies} from './library';

export const API_V1_BASE = '/api/v1';

export type ApiV1Dependencies = Omit<CatalogRouteDependencies, 'basePath'> &
  Omit<MediaRouteDependencies, 'basePath'> &
  Omit<LibraryRouteDependencies, 'basePath'> & {
    appVersion: string;
    appBrand: string;
  };

/**
 * Registers the versioned Elixium API.
 *
 * Design notes for external clients (the Android app in particular):
 *
 *  - Every JSON response uses the {ok, data|error} envelope from `respond.ts`.
 *  - `GET /api/v1/health` is unauthenticated and cheap: it is the endpoint a
 *    client should hit to validate a user-entered IP address or domain.
 *  - Audio routes return raw bytes and support Range + HEAD.
 *  - The legacy unversioned `/api/*` routes remain registered elsewhere for the
 *    existing web UI; new clients should target `/api/v1`.
 */
export const registerApiV1 = (deps: ApiV1Dependencies): void => {
  const {app, appVersion, appBrand, conf} = deps;
  const basePath = API_V1_BASE;

  /**
   * GET /api/v1/health
   *
   * Server discovery + capability handshake. Returns quickly and never throws,
   * so a client can use it as a reachability probe.
   */
  app.get(
    `${basePath}/health`,
    route(async (_req, res) => {
      let configured: Record<string, boolean> = {deezer: false, qobuz: false, spotify: false};
      try {
        configured = readRedactedSettings(conf).configured;
      } catch {
        // A malformed config must not make the probe fail.
      }

      return sendData(res, {
        status: 'ok',
        app: appBrand,
        version: appVersion,
        api: {version: 1, base: basePath},
        services: {
          deezer: {configured: configured.deezer, qualities: DEEZER_QUALITIES.map((q) => q.id)},
          qobuz: {configured: configured.qobuz, qualities: QOBUZ_QUALITIES.map((q) => q.id)},
        },
        capabilities: {
          search: true,
          discovery: true,
          streaming: true,
          rangeRequests: true,
          directDownload: true,
          archiveDownload: true,
          serverSideDownload: true,
          watchlist: Boolean(deps.watchlist),
          realtime: {transport: 'socket.io', path: '/socket.io'},
        },
        serverTime: new Date().toISOString(),
      });
    }),
  );

  /** GET /api/v1 — machine-readable route index, useful while building a client. */
  app.get(
    basePath,
    route(async (_req, res) =>
      sendData(res, {
        name: `${appBrand} API`,
        version: 1,
        endpoints: {
          health: `GET ${basePath}/health`,
          search: `GET ${basePath}/search?service=&q=&type=&limit=&offset=`,
          discovery: `GET ${basePath}/discovery?service=&type=&limit=`,
          albumTracks: `GET ${basePath}/albums/:id/tracks?service=`,
          artistTopTracks: `GET ${basePath}/artists/:id/top-tracks?service=`,
          playlistTracks: `GET ${basePath}/playlists/:id/tracks?service=`,
          item: `GET ${basePath}/items/:itemType/:id?service=`,
          parseUrl: `POST ${basePath}/parse-url`,
          qualities: `GET ${basePath}/qualities?service=`,
          genres: `GET ${basePath}/genres`,
          stream: `GET|HEAD ${basePath}/tracks/:id/stream?service=&quality=`,
          trackFile: `GET ${basePath}/tracks/:id/file?service=&quality=`,
          lyrics: `GET ${basePath}/tracks/:id/lyrics?service=`,
          archive: `POST ${basePath}/downloads/archive`,
          downloads: `GET ${basePath}/downloads`,
          startDownload: `POST ${basePath}/downloads`,
          settings: `GET|PATCH ${basePath}/settings`,
          watchlist: `GET ${basePath}/watchlist`,
          watchlistScan: `POST ${basePath}/watchlist/scan`,
        },
      }),
    ),
  );

  registerCatalogRoutes({...deps, basePath});
  registerMediaRoutes({...deps, basePath});
  registerLibraryRoutes({...deps, basePath});

  /**
   * Terminal 404 for unmatched /api/v1 paths.
   *
   * Registered last so it only sees requests no route claimed. Without it an
   * unknown API path falls through to the SPA static handler and returns
   * index.html with a 200 — which is confusing to debug from a mobile client.
   */
  app.use(`${basePath}/`, (req, res) => {
    sendError(res, ApiError.notFound(`No such endpoint: ${req.method} ${req.baseUrl}${req.path}`));
  });
};
