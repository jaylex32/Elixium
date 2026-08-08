import type {Express} from 'express';
import type {SearchResult} from '../../interactive-types';
import {ApiError, parsePaging, parseService, requireString, route, sendData} from '../respond';
import {parseMediaUrl, type ParseUrlDependencies} from '../url-parse';
import {qualitiesFor} from '../quality';

export interface CatalogRouteDependencies extends ParseUrlDependencies {
  app: Express;
  basePath: string;
  performDeezerSearch: (query: string, type: string, limit?: number, offset?: number) => Promise<SearchResult[]>;
  performQobuzSearch: (query: string, type: string, limit?: number, offset?: number) => Promise<SearchResult[]>;
  getDiscoveryContentRest: (service: string, type: string, limit: number) => Promise<any[]>;
  getItemTracksRest: (
    service: string,
    itemType: string,
    id: string,
    limit: number,
    offset: number,
  ) => Promise<{tracks: any[]; metadata: any}>;
  getAvailableGenres?: () => Promise<any[]> | any[];
}

const SEARCH_TYPES = ['track', 'album', 'artist', 'playlist'] as const;

/** Catalog reads: search, discovery, item expansion, link resolution. */
export const registerCatalogRoutes = ({
  app,
  basePath,
  performDeezerSearch,
  performQobuzSearch,
  getDiscoveryContentRest,
  getItemTracksRest,
  getAvailableGenres,
  parseToQobuz,
  parseDeezerUrl,
  ensureQobuzSearchReady,
}: CatalogRouteDependencies): void => {
  /**
   * GET /search?q=&service=&type=&limit=&offset=
   *
   * GET rather than POST (the legacy route used POST) so Android clients can
   * cache responses and retry idempotently.
   */
  app.get(
    `${basePath}/search`,
    route(async (req, res) => {
      const service = parseService(req.query.service);
      const query = requireString(req.query.q ?? req.query.query, 'q');
      const type = String(req.query.type ?? 'track').toLowerCase();
      const {limit, offset} = parsePaging(req.query as Record<string, unknown>, 50, 200);

      if (!SEARCH_TYPES.includes(type as (typeof SEARCH_TYPES)[number])) {
        throw ApiError.badRequest(`Unsupported search type: ${type}`, {supported: SEARCH_TYPES});
      }

      const search = service === 'deezer' ? performDeezerSearch : performQobuzSearch;
      const results = await search(query, type, limit, offset);

      return sendData(res, results, {
        service,
        type,
        query,
        limit,
        offset,
        count: results.length,
        hasMore: results.length === limit,
      });
    }),
  );

  /** GET /discovery?service=&type=&limit= — editorial rows for the home screen. */
  app.get(
    `${basePath}/discovery`,
    route(async (req, res) => {
      const service = parseService(req.query.service);
      const type = requireString(req.query.type, 'type').toLowerCase();
      const {limit} = parsePaging(req.query as Record<string, unknown>, 18, 100);

      const items = await getDiscoveryContentRest(service, type, limit);
      return sendData(res, items, {service, type, limit, count: items.length});
    }),
  );

  /**
   * Item expansion. One handler backs three REST-shaped aliases so clients can
   * use whichever reads better at the call site.
   */
  const expandItem = (itemType: 'album' | 'artist' | 'playlist', defaultLimit: number) =>
    route(async (req, res) => {
      const service = parseService(req.query.service);
      const id = requireString(req.params.id, 'id');
      const {limit, offset} = parsePaging(req.query as Record<string, unknown>, defaultLimit, 500);

      const {tracks, metadata} = await getItemTracksRest(service, itemType, id, limit, offset);
      return sendData(res, {tracks, metadata}, {service, itemType, id, limit, offset, count: tracks?.length ?? 0});
    });

  app.get(`${basePath}/albums/:id/tracks`, expandItem('album', 100));
  app.get(`${basePath}/playlists/:id/tracks`, expandItem('playlist', 200));

  // Expanding an artist yields their top tracks on both services (Deezer's
  // /artist/:id/top, Qobuz's artist/get?extra=tracks) — not their albums. The
  // route is named for what it actually returns.
  app.get(`${basePath}/artists/:id/top-tracks`, expandItem('artist', 50));

  /** Generic form, for clients that build the type dynamically. */
  app.get(
    `${basePath}/items/:itemType/:id`,
    route(async (req, res) => {
      const service = parseService(req.query.service);
      const itemType = String(req.params.itemType || '').toLowerCase();
      const id = requireString(req.params.id, 'id');
      const {limit, offset} = parsePaging(req.query as Record<string, unknown>, 100, 500);

      if (!['album', 'artist', 'playlist'].includes(itemType)) {
        throw ApiError.badRequest(`Unsupported item type: ${itemType}`, {
          supported: ['album', 'artist', 'playlist'],
        });
      }

      const {tracks, metadata} = await getItemTracksRest(service, itemType, id, limit, offset);
      return sendData(res, {tracks, metadata}, {service, itemType, id, limit, offset, count: tracks?.length ?? 0});
    }),
  );

  /** POST /parse-url — resolve any supported share link into a track list. */
  app.post(
    `${basePath}/parse-url`,
    route(async (req, res) => {
      const url = requireString(req.body?.url, 'url');
      const preferred = typeof req.body?.service === 'string' ? req.body.service : undefined;

      const parsed = await parseMediaUrl(url, preferred, {parseToQobuz, parseDeezerUrl, ensureQobuzSearchReady});
      return sendData(res, parsed, parsed.metadata);
    }),
  );

  /** GET /qualities?service= — lets a client render a quality picker without hardcoding. */
  app.get(
    `${basePath}/qualities`,
    route(async (req, res) => {
      const service = parseService(req.query.service);
      return sendData(res, qualitiesFor(service), {service});
    }),
  );

  /** GET /genres — genre list backing the Genres screen. */
  app.get(
    `${basePath}/genres`,
    route(async (req, res) => {
      if (!getAvailableGenres) {
        throw new ApiError('service_unavailable', 'Genre listing is not available on this server');
      }
      const genres = await getAvailableGenres();
      return sendData(res, genres, {count: Array.isArray(genres) ? genres.length : 0});
    }),
  );
};
