import type {Express} from 'express';
import type {Server as SocketIOServer} from 'socket.io';
import got from 'got';
import AdmZip from 'adm-zip';
import type {SearchResult} from './interactive-types';
import type {ArtistContent, ArtistContentKind} from './artist-content';
import type {Charts, ChartKind} from './charts';
import type {GenreContent, GenreKind} from './genre-content';
import type {FavoritesStore, FavoriteType} from './favorites-store';
import type {PlaylistSearch, PlaylistSearchService} from './playlist-search';
import {getLogEntries, clearLogEntries} from './log-buffer';

interface WebRestDependencies {
  app: Express;
  io: SocketIOServer;
  deezer: any;
  qobuz: any;
  artistContent: ArtistContent;
  charts: Charts;
  genreContent: GenreContent;
  favorites: FavoritesStore;
  playlistSearch: PlaylistSearch;
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
  initDeezerForDownload: () => Promise<void>;
  initQobuzForSearch: () => Promise<void>;
  makeHttpRequest: (url: string) => Promise<any>;
  initQobuzForDownload: () => Promise<void>;
  startDownloadProcess: (
    downloadQueue: any[],
    quality: string,
    service: string,
    settings: any,
    socket?: any,
  ) => Promise<void>;
}

export const registerWebRestRoutes = ({
  app,
  io,
  deezer,
  qobuz,
  artistContent,
  charts,
  genreContent,
  favorites,
  playlistSearch,
  performDeezerSearch,
  performQobuzSearch,
  getDiscoveryContentRest,
  getItemTracksRest,
  initDeezerForDownload,
  initQobuzForSearch,
  makeHttpRequest,
  initQobuzForDownload,
  startDownloadProcess,
}: WebRestDependencies) => {
  app.post('/api/search', async (req, res) => {
    try {
      const {query, service, type, limit = 50, offset = 0} = req.body;
      let results: SearchResult[] = [];

      if (service === 'deezer') {
        results = await performDeezerSearch(query, type, Number(limit), Number(offset));
      } else if (service === 'qobuz') {
        results = await performQobuzSearch(query, type, Number(limit), Number(offset));
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  /**
   * One artist's albums, top tracks or related playlists.
   *
   * Paged, because an artist with a long back catalogue does not fit one
   * response and the artist view loads more as it is scrolled.
   */
  /*
   * An artist's name and picture, by id.
   *
   * An artist reached from a track or album row carries only an id and a name:
   * the payload a track arrives in has no artist artwork, so the view opened
   * with an empty circle where the photograph belongs. One lookup fills it.
   */
  app.get('/api/artist-info', async (req, res) => {
    try {
      const service = String(req.query.service || 'deezer').toLowerCase();
      const artistId = String(req.query.artistId || '');
      if (!artistId) return res.status(400).json({error: 'Missing artistId'});

      if (service === 'qobuz') {
        await initQobuzForSearch();
        const artist = await (qobuz as any).qobuzRequest?.('artist/get', {artist_id: artistId, limit: 1, offset: 0});
        return res.json({
          id: artistId,
          name: artist?.name ?? '',
          picture: artist?.image?.large ?? artist?.image?.medium ?? artist?.picture ?? '',
        });
      }

      const artist = await makeHttpRequest(`https://api.deezer.com/artist/${encodeURIComponent(artistId)}`);
      return res.json({
        id: artistId,
        name: artist?.name ?? '',
        picture: artist?.picture_xl || artist?.picture_big || artist?.picture_medium || artist?.picture || '',
      });
    } catch (error: any) {
      return res.status(500).json({error: error.message});
    }
  });

  app.get('/api/artist-content', async (req, res) => {
    try {
      const service = String(req.query.service || '').toLowerCase();
      const artistId = String(req.query.artistId || '');
      const kind = String(req.query.kind || 'albums').toLowerCase() as ArtistContentKind;
      const artistName = req.query.artistName ? String(req.query.artistName) : undefined;
      const limit = Number(req.query.limit || 30);
      const offset = Number(req.query.offset || 0);

      if (!service || !artistId) {
        return res.status(400).json({error: 'Missing service or artistId'});
      }

      let items: SearchResult[] = [];
      if (kind === 'albums') {
        items = await artistContent.getArtistAlbums(service, artistId, limit, offset, artistName);
      } else if (kind === 'tracks') {
        items = await artistContent.getArtistTracks(service, artistId, limit, offset, artistName);
      } else if (kind === 'playlists') {
        items = await artistContent.getArtistPlaylists(service, artistId, artistName, limit, offset);
      } else {
        return res.status(400).json({error: `Unknown kind: ${kind}`});
      }

      res.json(items);
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  // ── Charts ────────────────────────────────────────────────────────────────
  /*
   * A genre's own content, which the chart endpoints cannot provide.
   *
   * Kept separate from /api/charts because the two answer different questions:
   * a chart is "what is popular", a genre is "what is this music". Deezer's
   * per-genre artist endpoints return the global chart regardless of genre,
   * so asking for Reggae used to return Taylor Swift.
   */
  /*
   * The genre list for the Genres page.
   *
   * Distinct from /api/charts/genres, which for Qobuz lists featured types —
   * best sellers, press awards — because that is the axis Qobuz charts on.
   * They are not genres, and offering them here asked the catalogue for "the
   * best-sellers genre". Deezer's list is unchanged either way.
   */
  app.get('/api/genres', async (req, res) => {
    try {
      const service = String(req.query.service || 'deezer').toLowerCase();
      return res.json(await genreContent.getGenres(service));
    } catch (error: any) {
      return res.status(500).json({error: error.message});
    }
  });

  app.get('/api/genre-content', async (req, res) => {
    try {
      const service = String(req.query.service || 'deezer').toLowerCase();
      const genreId = String(req.query.genreId || '');
      const kind = String(req.query.kind || 'albums').toLowerCase() as GenreKind;
      const limit = Number(req.query.limit || 50);
      const offset = Number(req.query.offset || 0);

      if (!genreId) return res.status(400).json({error: 'Missing genreId'});

      return res.json(await genreContent.getGenreContent(service, genreId, kind, limit, offset));
    } catch (error: any) {
      return res.status(500).json({error: error.message});
    }
  });

  app.get('/api/charts/genres', async (req, res) => {
    try {
      const service = String(req.query.service || 'deezer').toLowerCase();
      res.json(await charts.getChartGenres(service));
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  app.get('/api/charts/countries', async (_req, res) => {
    try {
      res.json(await charts.getChartCountries());
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  app.get('/api/charts/country', async (req, res) => {
    try {
      const playlistId = String(req.query.playlistId || '');
      if (!playlistId) return res.status(400).json({error: 'Missing playlistId'});
      const limit = Number(req.query.limit || 50);
      const offset = Number(req.query.offset || 0);
      res.json(await charts.getCountryChart(playlistId, limit, offset));
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  app.get('/api/charts', async (req, res) => {
    try {
      const service = String(req.query.service || 'deezer').toLowerCase();
      const genreId = String(req.query.genreId || '0');
      const kind = String(req.query.kind || 'tracks').toLowerCase() as ChartKind;
      const limit = Number(req.query.limit || 50);
      const offset = Number(req.query.offset || 0);
      res.json(await charts.getCharts(service, genreId, kind, limit, offset));
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  // ── Playlist search, across services ──────────────────────────────────────
  app.get('/api/playlist-search', async (req, res) => {
    try {
      const service = String(req.query.service || 'deezer').toLowerCase() as PlaylistSearchService;
      const query = String(req.query.query || '');
      const limit = Number(req.query.limit || 30);
      const offset = Number(req.query.offset || 0);
      res.json(await playlistSearch.searchPlaylists(service, query, limit, offset));
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  // ── Favorites ─────────────────────────────────────────────────────────────
  app.get('/api/favorites', (req, res) => {
    const type = req.query.type ? (String(req.query.type) as FavoriteType) : undefined;
    const service = req.query.service ? String(req.query.service) : undefined;
    res.json(favorites.list(type, service));
  });

  app.post('/api/favorites/toggle', (req, res) => {
    try {
      const {id, type, service, title, artist, cover, duration} = req.body || {};
      if (!id || !type || !service || !title) {
        return res.status(400).json({error: 'id, type, service and title are required'});
      }
      res.json(favorites.toggle({id: String(id), type, service, title, artist, cover, duration}));
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });

  app.delete('/api/favorites', (req, res) => {
    const {id, type, service} = req.query;
    if (!id) return res.json(favorites.clear());
    res.json(favorites.remove(String(service || ''), String(type || ''), String(id)));
  });

  // ── Server log ────────────────────────────────────────────────────────────
  app.get('/api/logs', (req, res) => {
    const since = Number(req.query.since || 0);
    res.json(getLogEntries(since));
  });

  app.delete('/api/logs', (_req, res) => {
    clearLogEntries();
    res.json([]);
  });

  app.get('/api/discovery', async (req, res) => {
    try {
      const service = String(req.query.service || '').toLowerCase();
      const type = String(req.query.type || '').toLowerCase();
      const limit = Number(req.query.limit || 18);

      if (!service || !type) {
        return res.status(400).json({error: 'Missing service or type'});
      }

      const items = await getDiscoveryContentRest(service, type, limit);
      return res.json({
        service,
        type,
        items,
      });
    } catch (error: any) {
      return res.status(500).json({error: error.message || 'Internal error'});
    }
  });

  app.get('/api/item-tracks', async (req, res) => {
    try {
      const service = String(req.query.service || '').toLowerCase();
      const itemType = String(req.query.itemType || '').toLowerCase();
      const id = String(req.query.id || '');
      const limit = Number(req.query.limit || 100);
      const offset = Number(req.query.offset || 0);

      if (!service || !itemType || !id) {
        return res.status(400).json({error: 'Missing service, itemType or id'});
      }

      const {tracks, metadata} = await getItemTracksRest(service, itemType, id, limit, offset);
      return res.json({
        service,
        itemType,
        id,
        tracks,
        metadata,
      });
    } catch (error: any) {
      return res.status(500).json({error: error.message || 'Internal error'});
    }
  });

  app.get('/api/stream', async (req, res) => {
    try {
      const service = String(req.query.service || '').toLowerCase();
      const id = String(req.query.id || '');
      const quality = String(req.query.quality || '');

      if (!service || !id) {
        return res.status(400).json({error: 'Missing service or id'});
      }

      if (service === 'deezer') {
        const qNum = quality === 'flac' ? 9 : quality === '320' ? 3 : 1;

        try {
          await initDeezerForDownload();
          const trackInfo = await deezer.getTrackInfo(id);
          const urlInfo = await deezer.getTrackDownloadUrl(trackInfo, qNum);
          if (urlInfo) {
            const buf = await got(urlInfo.trackUrl).buffer();
            const decrypted = urlInfo.isEncrypted ? deezer.decryptDownload(buf, String(trackInfo.SNG_ID)) : buf;
            const ext = qNum === 9 ? 'flac' : 'mp3';
            const total = decrypted.length;
            const range = req.headers.range as string | undefined;
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Type', ext === 'flac' ? 'audio/flac' : 'audio/mpeg');
            if (range) {
              const match = /bytes=(\d+)-(\d+)?/.exec(range);
              const start = match ? Math.max(0, parseInt(match[1], 10)) : 0;
              const end = match && match[2] ? Math.min(total - 1, parseInt(match[2], 10)) : total - 1;
              const chunkSize = end - start + 1;
              res.status(206);
              res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
              res.setHeader('Content-Length', String(chunkSize));
              res.end(decrypted.subarray(start, end + 1));
            } else {
              res.setHeader('Content-Length', String(total));
              res.end(decrypted);
            }
            return;
          }
        } catch (_e) {
          // proceed to preview fallback
        }

        try {
          const info = await deezer.getTrackInfoPublicApi(id);
          const previewUrl = (info as any).preview || (info as any).HREF;
          if (!previewUrl) return res.status(404).json({error: 'Track not available'});
          const range = req.headers.range as string | undefined;
          const upstream = got.stream(previewUrl, range ? {headers: {Range: range}} : {});
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Type', 'audio/mpeg');
          upstream.on('response', (u) => {
            if (u.statusCode) res.status(u.statusCode);
            const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const;
            for (const h of pass) {
              const v = u.headers[h];
              if (v) res.setHeader(h, String(v));
            }
            if (!u.headers['accept-ranges']) res.setHeader('Accept-Ranges', 'bytes');
          });
          upstream.on('error', () => {
            if (!res.headersSent) res.status(502);
            res.end();
          });
          upstream.pipe(res);
          return;
        } catch (_e) {
          return res.status(404).json({error: 'Track not available'});
        }
      }

      if (service === 'qobuz') {
        try {
          await initQobuzForDownload();
        } catch (_e) {
          await initQobuzForSearch();
        }

        let q: number;
        switch (quality) {
          case '320kbps':
          case '320':
            q = 5;
            break;
          case '44khz':
          case 'cd':
            q = 6;
            break;
          case '96khz':
            q = 7;
            break;
          default:
            q = 27;
        }

        let urlInfo = null as any;
        const prefs = [q, 7, 6, 5].filter((v, idx, arr) => arr.indexOf(v) === idx);
        for (const fmt of prefs) {
          try {
            urlInfo = await qobuz.getTrackDownloadUrl(Number(id), fmt);
            if (urlInfo) break;
          } catch (_err) {
            // keep trying lower qualities
          }
        }
        if (!urlInfo) return res.status(404).json({error: 'Track not available'});

        const range = req.headers.range as string | undefined;
        const upstream = got.stream(urlInfo.url, range ? {headers: {Range: range}} : {});
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', urlInfo.mime_type || 'audio/flac');
        if (urlInfo.file_size) res.setHeader('Content-Length', String(urlInfo.file_size));
        upstream.on('response', (u) => {
          if (u.statusCode) res.status(u.statusCode);
          const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const;
          for (const h of pass) {
            const v = u.headers[h];
            if (v) res.setHeader(h, String(v));
          }
          if (!u.headers['accept-ranges']) res.setHeader('Accept-Ranges', 'bytes');
        });
        upstream.on('error', () => {
          if (!res.headersSent) res.status(502);
          res.end();
        });
        upstream.pipe(res);
        return;
      }

      return res.status(400).json({error: 'Unsupported service'});
    } catch (error: any) {
      console.error('Stream error:', error);
      return res.status(500).json({error: error.message || 'Internal error'});
    }
  });

  app.get('/api/download-item', async (req, res) => {
    try {
      const service = String(req.query.service || '').toLowerCase();
      const id = String(req.query.id || '');
      const quality = String(req.query.quality || '');

      if (!service || !id) {
        return res.status(400).json({error: 'Missing service or id'});
      }

      if (service === 'deezer') {
        await initDeezerForDownload();
        const qNum = quality === 'flac' ? 9 : quality === '320' ? 3 : 1;
        const trackInfo = await deezer.getTrackInfo(id);
        const urlInfo = await deezer.getTrackDownloadUrl(trackInfo, qNum);
        if (!urlInfo) return res.status(404).json({error: 'Track not available'});

        const buf = await got(urlInfo.trackUrl).buffer();
        const decrypted = urlInfo.isEncrypted ? deezer.decryptDownload(buf, String(trackInfo.SNG_ID)) : buf;
        const tagged = await deezer.addTrackTags(decrypted, trackInfo, 1000);
        const ext = qNum === 9 ? 'flac' : 'mp3';
        const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');
        const filename = `${safe(trackInfo.ART_NAME)} - ${safe(trackInfo.SNG_TITLE)}.${ext}`;
        res.setHeader('Content-Type', ext === 'flac' ? 'audio/flac' : 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', String(tagged.length));
        return res.send(tagged);
      }

      if (service === 'qobuz') {
        await initQobuzForSearch();
        let q: number;
        switch (quality) {
          case '320kbps':
          case '320':
            q = 5;
            break;
          case '44khz':
          case 'cd':
            q = 6;
            break;
          case '96khz':
            q = 7;
            break;
          default:
            q = 27;
        }
        const urlInfo = await qobuz.getTrackDownloadUrl(Number(id), q);
        if (!urlInfo) return res.status(404).json({error: 'Track not available'});

        const upstream = await got(urlInfo.url, {responseType: 'buffer'});
        const data = upstream.body as Buffer;
        const meta = await qobuz.getTrackInfo(Number(id));
        const tagged = await qobuz.addTrackTags(data, meta, 1000);
        const ext = urlInfo.mime_type?.includes('mpeg') ? 'mp3' : 'flac';
        const artist = meta?.performer?.name || 'Artist';
        const title = meta?.title || 'Track';
        const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');
        const filename = `${safe(artist)} - ${safe(title)}.${ext}`;
        res.setHeader('Content-Type', urlInfo.mime_type || (ext === 'mp3' ? 'audio/mpeg' : 'audio/flac'));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', String(tagged.length));
        return res.send(tagged);
      }

      return res.status(400).json({error: 'Unsupported service'});
    } catch (error: any) {
      console.error('Client download error:', error);
      return res.status(500).json({error: error.message || 'Internal error'});
    }
  });

  app.post('/api/download-zip', async (req, res) => {
    try {
      const {service, itemIds, quality, structure = 'album', zipName, jobId} = req.body || {};
      if (!service || !Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({error: 'Missing service or itemIds'});
      }

      const zip = new AdmZip();
      const safe = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_');
      const pad2 = (n: number) => n.toLocaleString('en-US', {minimumIntegerDigits: 2});

      if (service === 'deezer') {
        await initDeezerForDownload();
        const qNum = quality === 'flac' ? 9 : quality === '320' ? 3 : 1;

        for (let idx = 0; idx < itemIds.length; idx++) {
          const id = itemIds[idx];
          try {
            const trackInfo = await deezer.getTrackInfo(String(id));
            const urlInfo = await deezer.getTrackDownloadUrl(trackInfo, qNum);
            if (!urlInfo) continue;
            const raw = await got(urlInfo.trackUrl).buffer();
            const decrypted = urlInfo.isEncrypted ? deezer.decryptDownload(raw, String(trackInfo.SNG_ID)) : raw;
            const tagged = await deezer.addTrackTags(decrypted, trackInfo, 1000);
            const ext = qNum === 9 ? 'flac' : 'mp3';
            const folder = structure === 'album' ? `${safe(trackInfo.ALB_TITLE)}` : '';
            const name = `${pad2(Number(trackInfo.TRACK_NUMBER) || 0)} ${safe(trackInfo.ART_NAME)} - ${safe(
              trackInfo.SNG_TITLE,
            )}.${ext}`;
            const pathInZip = folder ? `${folder}/${name}` : name;
            zip.addFile(pathInZip, tagged);

            if (jobId) {
              const itemProgress = Math.round(((idx + 1) / itemIds.length) * 100);
              io.emit('downloadProgress', {
                itemId: jobId,
                itemStatus: 'downloading',
                itemProgress,
                currentTrack: `${trackInfo.ART_NAME} - ${trackInfo.SNG_TITLE}`,
                current: idx + 1,
                total: itemIds.length,
              });
            }
          } catch (_e) {
            // Skip failed track
          }
        }
      } else if (service === 'qobuz') {
        await initQobuzForSearch();

        let q: number;
        switch (String(quality)) {
          case '320kbps':
          case '320':
            q = 5;
            break;
          case '44khz':
          case 'cd':
            q = 6;
            break;
          case '96khz':
            q = 7;
            break;
          default:
            q = 27;
        }

        for (let idx = 0; idx < itemIds.length; idx++) {
          const id = itemIds[idx];
          try {
            const meta = await qobuz.getTrackInfo(Number(id));
            const urlInfo = await qobuz.getTrackDownloadUrl(Number(id), q);
            if (!urlInfo) continue;
            const raw = await got(urlInfo.url, {responseType: 'buffer'}).then((r) => r.body as Buffer);
            const tagged = await qobuz.addTrackTags(raw, meta, 1000);
            const isMp3 = urlInfo.mime_type?.includes('mpeg');
            const ext = isMp3 ? 'mp3' : 'flac';
            const folder = structure === 'album' ? `${safe(meta?.album?.title || 'Album')}` : '';
            const name = `${pad2(Number(meta?.track_number) || 0)} ${safe(meta?.performer?.name || 'Artist')} - ${safe(
              meta?.title || 'Track',
            )}.${ext}`;
            const pathInZip = folder ? `${folder}/${name}` : name;
            zip.addFile(pathInZip, tagged);

            if (jobId) {
              const itemProgress = Math.round(((idx + 1) / itemIds.length) * 100);
              io.emit('downloadProgress', {
                itemId: jobId,
                itemStatus: 'downloading',
                itemProgress,
                currentTrack: `${meta?.performer?.name || 'Artist'} - ${meta?.title || 'Track'}`,
                current: idx + 1,
                total: itemIds.length,
              });
            }
          } catch (_e) {
            // Skip failed track
          }
        }
      } else {
        return res.status(400).json({error: 'Unsupported service'});
      }

      const outName = safe(zipName || `${service}-download-${Date.now()}.zip`);
      const buffer = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
      res.setHeader('Content-Length', String(buffer.length));
      const done = res.send(buffer);
      if (jobId) {
        io.emit('downloadProgress', {
          itemId: jobId,
          itemStatus: 'completed',
          itemProgress: 100,
          current: itemIds.length,
          total: itemIds.length,
        });
      }
      return done;
    } catch (error: any) {
      console.error('ZIP download error:', error);
      return res.status(500).json({error: error.message || 'Internal error'});
    }
  });

  app.post('/api/download', async (req, res) => {
    try {
      const {queue, quality, service, settings} = req.body;
      startDownloadProcess(queue, quality, service, settings);
      res.json({success: true, message: 'Download started'});
    } catch (error: any) {
      res.status(500).json({error: error.message});
    }
  });
};
