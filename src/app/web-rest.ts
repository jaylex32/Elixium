import type {Express} from 'express';
import type {Server as SocketIOServer} from 'socket.io';
import got from 'got';
import AdmZip from 'adm-zip';
import type {SearchResult} from './interactive-types';

interface WebRestDependencies {
  app: Express;
  io: SocketIOServer;
  deezer: any;
  qobuz: any;
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
  performDeezerSearch,
  performQobuzSearch,
  getDiscoveryContentRest,
  getItemTracksRest,
  initDeezerForDownload,
  initQobuzForSearch,
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
