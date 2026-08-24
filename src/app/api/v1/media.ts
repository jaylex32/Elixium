import type {Express, Request, Response} from 'express';
import type {Server as SocketIOServer} from 'socket.io';
import got from 'got';
import AdmZip from 'adm-zip';
import {PassThrough} from 'stream';
import {ApiError, parseService, requireString, route, sendData, type ServiceName} from '../respond';
import {
  deezerFormatCode,
  deezerFormatFallbacks,
  defaultQualityFor,
  extensionFor,
  qobuzFormatCode,
  qobuzFormatFallbacks,
  safeFilename,
} from '../quality';
import {parseRange, trackBufferCache} from '../track-cache';
import {fetchLrclib, type LyricsResult} from '../lyrics';

export interface MediaRouteDependencies {
  app: Express;
  io: SocketIOServer;
  basePath: string;
  deezer: any;
  qobuz: any;
  initDeezerForDownload: () => Promise<void>;
  /** Rebuild the Deezer session even when it is believed to be ready. */
  refreshDeezerSession: () => Promise<void>;
  initQobuzForSearch: () => Promise<void>;
  initQobuzForDownload: () => Promise<void>;
  /**
   * A playable URL for a YouTube Music track.
   *
   * Optional: the API is mounted in builds that have no YouTube support, and
   * a missing resolver should answer "not available" rather than crash.
   */
  resolveYtMusicStream?: (videoId: string) => Promise<{url: string; mimeType: string} | null>;
  /** YouTube Music's own lyrics, licensed and usually present. */
  resolveYtMusicLyrics?: (videoId: string) => Promise<{text: string; source: string} | null>;
}

const mimeFor = (extension: 'flac' | 'mp3'): string => (extension === 'flac' ? 'audio/flac' : 'audio/mpeg');

/** Headers every audio response needs so mobile players can seek and cache correctly. */
const setAudioHeaders = (res: Response, contentType: string): void => {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  // Private: responses are user-specific and must not be held by shared proxies.
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  // Cross-origin clients cannot read these unless they are explicitly exposed,
  // and the stream-quality signal is useless if the client cannot see it.
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, X-Elixium-Stream, X-Elixium-Stream-Reason',
  );
};

/** Serve a fully-materialized buffer honouring Range / HEAD semantics. */
const serveBuffer = (req: Request, res: Response, buffer: Buffer, contentType: string): void => {
  const total = buffer.length;
  setAudioHeaders(res, contentType);

  const range = parseRange(req.headers.range as string | undefined, total);

  if (range === null) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${total}`);
    res.end();
    return;
  }

  if (!range) {
    res.setHeader('Content-Length', String(total));
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).end(buffer);
    return;
  }

  const chunkSize = range.end - range.start + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
  res.setHeader('Content-Length', String(chunkSize));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer.subarray(range.start, range.end + 1));
};

/**
 * Pipe an upstream URL through, forwarding Range in and content headers back.
 *
 * The relay PassThrough is load-bearing: when a got stream is piped *directly*
 * into an http.ServerResponse, got copies the entire upstream header set onto
 * it. That leaks the CDN's `Cache-Control: public, max-age=86400` and `ETag`
 * onto a per-user audio stream, and overwrites anything we set first. Piping
 * into a plain PassThrough instead means got sees a non-ServerResponse
 * destination, skips the copy, and leaves us in control of the headers.
 */
const proxyStream = (req: Request, res: Response, url: string, fallbackContentType: string): void => {
  const range = req.headers.range as string | undefined;
  const upstream = got.stream(url, range ? {headers: {Range: range}} : {});
  const relay = new PassThrough();

  upstream.on('response', (upstreamRes: any) => {
    if (upstreamRes.statusCode) res.status(upstreamRes.statusCode);

    setAudioHeaders(res, String(upstreamRes.headers['content-type'] || fallbackContentType));
    for (const header of ['content-length', 'content-range'] as const) {
      const value = upstreamRes.headers[header];
      if (value) res.setHeader(header, String(value));
    }
  });

  const failUpstream = () => {
    if (!res.headersSent) {
      res.status(502).json({ok: false, error: {code: 'upstream_error', message: 'Stream failed'}});
    } else {
      res.end();
    }
  };

  upstream.on('error', failUpstream);
  relay.on('error', failUpstream);

  // Stop pulling bytes we can no longer deliver if the client hangs up mid-track.
  res.on('close', () => {
    upstream.destroy();
    relay.destroy();
  });

  upstream.pipe(relay).pipe(res);
};

export const registerMediaRoutes = ({
  app,
  io,
  basePath,
  deezer,
  qobuz,
  initDeezerForDownload,
  refreshDeezerSession,
  initQobuzForSearch,
  initQobuzForDownload,
  resolveYtMusicStream,
  resolveYtMusicLyrics,
}: MediaRouteDependencies): void => {
  /** Fetch + decrypt a Deezer track in full, reusing the cache when warm. */
  const materializeDeezerTrack = async (id: string, quality: string) => {
    /*
     * Walk down the qualities rather than demanding one.
     *
     * Deezer throws WrongLicense for FLAC and MP3_320 on accounts without the
     * matching licence. This used to request a single format, so a free
     * account — whose only licensed format is MP3_128 — got nothing and
     * playback silently degraded to a 30-second public preview, even though
     * the same track downloaded fine because the download path already
     * stepped down.
     */
    const codes = deezerFormatFallbacks(quality);

    // A warm cache entry at any tier beats re-fetching a lower one.
    for (const formatCode of codes) {
      const cached = trackBufferCache.get(`deezer:${id}:${formatCode}`);
      if (cached) return cached;
    }

    /*
     * One attempt is not enough to conclude a track is unplayable.
     *
     * The first play after launch can land while the Deezer session is still
     * being established, or on a request that simply times out — and because
     * every failure here ends at the same fallback, that produced a silent
     * 30-second preview. Worse, the session flag is sticky: once it succeeds
     * it is never re-established, which is why closing the app and trying
     * again played the full track and looked like a fluke.
     *
     * So: try, and if nothing came back, force a fresh session and try once
     * more. Only then is the preview the honest answer.
     */
    const attempt = async () => {
      const trackInfo = await deezer.getTrackInfo(id);

      for (const formatCode of codes) {
        try {
          const urlInfo = await deezer.getTrackDownloadUrl(trackInfo, formatCode);
          if (!urlInfo) continue;

          const raw = await got(urlInfo.trackUrl).buffer();
          const buffer = urlInfo.isEncrypted ? deezer.decryptDownload(raw, String(trackInfo.SNG_ID)) : raw;
          const contentType = mimeFor(formatCode === 9 ? 'flac' : 'mp3');

          trackBufferCache.set(`deezer:${id}:${formatCode}`, buffer, contentType);
          return {buffer, contentType};
        } catch {
          // WrongLicense or a dead CDN URL: try the next tier down.
        }
      }
      return undefined;
    };

    await initDeezerForDownload();
    const first = await attempt().catch(() => undefined);
    if (first) return first;

    // Nothing at any tier. Re-establish the session and give it one more go,
    // since a stale or half-built session fails exactly like an unlicensed one.
    try {
      await refreshDeezerSession();
    } catch {
      // A refresh that fails leaves the previous session in place; the retry
      // below is still worth making.
    }
    return (await attempt().catch(() => undefined)) ?? undefined;
  };

  /** Resolve a playable Qobuz URL, walking down qualities until one is available. */
  const resolveQobuzUrl = async (id: string, quality: string) => {
    try {
      await initQobuzForDownload();
    } catch {
      await initQobuzForSearch();
    }

    for (const formatCode of qobuzFormatFallbacks(quality)) {
      try {
        const urlInfo = await qobuz.getTrackDownloadUrl(Number(id), formatCode);
        if (urlInfo) return urlInfo;
      } catch {
        // Try the next lower quality.
      }
    }
    return undefined;
  };

  /**
   * GET|HEAD /tracks/:id/stream?service=&quality=
   *
   * Progressive playback endpoint. Supports Range and HEAD so ExoPlayer /
   * AVPlayer style clients can seek and probe duration without a full fetch.
   */
  const streamHandler = route(async (req, res) => {
    /*
     * YouTube Music first, before `parseService`.
     *
     * That helper only accepts the two catalogue services, so a YouTube track
     * was rejected as an unsupported service and never played at all — the
     * same gap that left its albums and artists opening onto empty modals.
     */
    if (String(req.query.service ?? '').toLowerCase() === 'ytmusic') {
      const videoId = requireString(req.params.id ?? req.query.id, 'id');
      if (!resolveYtMusicStream) throw ApiError.notFound('YouTube Music is not available on this server');

      /*
       * Report why, not just that it failed.
       *
       * YouTube refuses most music to a signed-out caller, and "could not be
       * played" sends the reader looking for a broken track when the answer
       * is a missing session. The two need different actions.
       */
      let resolved: {url: string; mimeType: string} | null = null;
      try {
        resolved = await resolveYtMusicStream(videoId);
      } catch (error: any) {
        if (error?.kind === 'login-required') {
          throw new ApiError(
            'unauthorized',
            'YouTube will not play this without a signed-in session. Upload a cookies.txt in Settings.',
          );
        }
        throw ApiError.notFound(error?.message || 'That track could not be played');
      }
      if (!resolved) throw ApiError.notFound('That track could not be played');

      res.setHeader('X-Elixium-Stream', 'full');
      proxyStream(req, res, resolved.url, resolved.mimeType || 'audio/mp4');
      return;
    }

    const service = parseService(req.query.service);
    const id = requireString(req.params.id ?? req.query.id, 'id');
    const quality = String(req.query.quality || defaultQualityFor(service));

    if (service === 'deezer') {
      try {
        const materialized = await materializeDeezerTrack(id, quality);
        if (materialized) {
          res.setHeader('X-Elixium-Stream', 'full');
          serveBuffer(req, res, materialized.buffer, materialized.contentType);
          return;
        }
      } catch {
        // Fall through to the 30-second public preview.
      }

      const info = await deezer.getTrackInfoPublicApi(id).catch(() => undefined);
      const previewUrl = info?.preview || info?.HREF;
      if (!previewUrl) throw ApiError.notFound('Track not available');

      // Signal the degradation explicitly. Without this a client cannot tell a
      // 30-second preview from the real track and will look broken to the user
      // (the usual cause is an expired Deezer ARL cookie).
      res.setHeader('X-Elixium-Stream', 'preview');
      res.setHeader('X-Elixium-Stream-Reason', 'deezer-auth-unavailable');
      proxyStream(req, res, previewUrl, 'audio/mpeg');
      return;
    }

    const urlInfo = await resolveQobuzUrl(id, quality);
    if (!urlInfo) throw ApiError.notFound('Track not available');
    res.setHeader('X-Elixium-Stream', 'full');
    proxyStream(req, res, urlInfo.url, urlInfo.mime_type || 'audio/flac');
  });

  app.get(`${basePath}/tracks/:id/stream`, streamHandler);
  app.head(`${basePath}/tracks/:id/stream`, streamHandler);

  /**
   * GET /tracks/:id/file?service=&quality=
   *
   * Tagged, fully-written file for offline storage — this is what the Android
   * client calls when the user taps download on a single track.
   */
  app.get(
    `${basePath}/tracks/:id/file`,
    route(async (req, res) => {
      const service: ServiceName = parseService(req.query.service);
      const id = requireString(req.params.id, 'id');
      const quality = String(req.query.quality || defaultQualityFor(service));
      const extension = extensionFor(service, quality);

      if (service === 'deezer') {
        await initDeezerForDownload();
        const trackInfo = await deezer.getTrackInfo(id);
        const urlInfo = await deezer.getTrackDownloadUrl(trackInfo, deezerFormatCode(quality));
        if (!urlInfo) throw ApiError.notFound('Track not available');

        const raw = await got(urlInfo.trackUrl).buffer();
        const decrypted = urlInfo.isEncrypted ? deezer.decryptDownload(raw, String(trackInfo.SNG_ID)) : raw;
        const tagged = await deezer.addTrackTags(decrypted, trackInfo, 1000);
        const filename = `${safeFilename(trackInfo.ART_NAME)} - ${safeFilename(trackInfo.SNG_TITLE)}.${extension}`;

        res.setHeader('Content-Type', mimeFor(extension));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', String(tagged.length));
        res.send(tagged);
        return;
      }

      await initQobuzForSearch();
      const urlInfo = await qobuz.getTrackDownloadUrl(Number(id), qobuzFormatCode(quality));
      if (!urlInfo) throw ApiError.notFound('Track not available');

      const raw = await got(urlInfo.url, {responseType: 'buffer'}).then((r) => r.body as Buffer);
      const meta = await qobuz.getTrackInfo(Number(id));
      const tagged = await qobuz.addTrackTags(raw, meta, 1000);
      const actualExt = urlInfo.mime_type?.includes('mpeg') ? 'mp3' : 'flac';
      const filename = `${safeFilename(meta?.performer?.name)} - ${safeFilename(meta?.title)}.${actualExt}`;

      res.setHeader('Content-Type', urlInfo.mime_type || mimeFor(actualExt));
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(tagged.length));
      res.send(tagged);
    }),
  );

  /**
   * POST /downloads/archive — bundle many tracks into one ZIP.
   * Body: {service, trackIds[], quality?, structure?, zipName?, jobId?}
   */
  app.post(
    `${basePath}/downloads/archive`,
    route(async (req, res) => {
      const service: ServiceName = parseService(req.body?.service);
      const trackIds: unknown = req.body?.trackIds ?? req.body?.itemIds;
      const quality = String(req.body?.quality || defaultQualityFor(service));
      const structure = String(req.body?.structure || 'album');
      const jobId = req.body?.jobId ? String(req.body.jobId) : undefined;

      if (!Array.isArray(trackIds) || trackIds.length === 0) {
        throw ApiError.badRequest('trackIds must be a non-empty array');
      }

      const zip = new AdmZip();
      const pad2 = (n: number) => String(Math.max(0, n)).padStart(2, '0');
      let added = 0;
      const failed: string[] = [];

      const reportProgress = (index: number, label: string) => {
        if (!jobId) return;
        io.emit('downloadProgress', {
          itemId: jobId,
          itemStatus: 'downloading',
          itemProgress: Math.round(((index + 1) / trackIds.length) * 100),
          currentTrack: label,
          current: index + 1,
          total: trackIds.length,
        });
      };

      if (service === 'deezer') {
        await initDeezerForDownload();
        const formatCode = deezerFormatCode(quality);
        const extension = formatCode === 9 ? 'flac' : 'mp3';

        for (let index = 0; index < trackIds.length; index++) {
          const id = String(trackIds[index]);
          try {
            const trackInfo = await deezer.getTrackInfo(id);
            const urlInfo = await deezer.getTrackDownloadUrl(trackInfo, formatCode);
            if (!urlInfo) {
              failed.push(id);
              continue;
            }
            const raw = await got(urlInfo.trackUrl).buffer();
            const decrypted = urlInfo.isEncrypted ? deezer.decryptDownload(raw, String(trackInfo.SNG_ID)) : raw;
            const tagged = await deezer.addTrackTags(decrypted, trackInfo, 1000);

            const folder = structure === 'album' ? safeFilename(trackInfo.ALB_TITLE) : '';
            const name = `${pad2(Number(trackInfo.TRACK_NUMBER) || 0)} ${safeFilename(
              trackInfo.ART_NAME,
            )} - ${safeFilename(trackInfo.SNG_TITLE)}.${extension}`;
            zip.addFile(folder ? `${folder}/${name}` : name, tagged);
            added++;

            reportProgress(index, `${trackInfo.ART_NAME} - ${trackInfo.SNG_TITLE}`);
          } catch {
            failed.push(id);
          }
        }
      } else {
        await initQobuzForSearch();
        const formatCode = qobuzFormatCode(quality);

        for (let index = 0; index < trackIds.length; index++) {
          const id = String(trackIds[index]);
          try {
            const meta = await qobuz.getTrackInfo(Number(id));
            const urlInfo = await qobuz.getTrackDownloadUrl(Number(id), formatCode);
            if (!urlInfo) {
              failed.push(id);
              continue;
            }
            const raw = await got(urlInfo.url, {responseType: 'buffer'}).then((r) => r.body as Buffer);
            const tagged = await qobuz.addTrackTags(raw, meta, 1000);
            const extension = urlInfo.mime_type?.includes('mpeg') ? 'mp3' : 'flac';

            const folder = structure === 'album' ? safeFilename(meta?.album?.title) : '';
            const name = `${pad2(Number(meta?.track_number) || 0)} ${safeFilename(
              meta?.performer?.name,
            )} - ${safeFilename(meta?.title)}.${extension}`;
            zip.addFile(folder ? `${folder}/${name}` : name, tagged);
            added++;

            reportProgress(index, `${meta?.performer?.name} - ${meta?.title}`);
          } catch {
            failed.push(id);
          }
        }
      }

      if (added === 0) {
        throw ApiError.notFound('None of the requested tracks could be downloaded', {failed});
      }

      const outName = safeFilename(req.body?.zipName || `${service}-download-${Date.now()}`);
      const buffer = zip.toBuffer();

      if (jobId) {
        io.emit('downloadProgress', {
          itemId: jobId,
          itemStatus: 'completed',
          itemProgress: 100,
          current: trackIds.length,
          total: trackIds.length,
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${outName}.zip"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('X-Elixium-Tracks-Added', String(added));
      res.setHeader('X-Elixium-Tracks-Failed', String(failed.length));
      res.send(buffer);
    }),
  );

  /**
   * GET /tracks/:id/lyrics?service=
   *
   * Returns plain text plus timestamped lines when the source has them.
   *
   * Provider order: Deezer's own lyrics first when available (they are
   * authoritative and already timestamped), then LRCLIB, which needs no
   * credentials and covers both services. The former Musixmatch HTML scraper
   * is no longer reachable — it returns 403 — so it is not consulted.
   */
  app.get(
    `${basePath}/tracks/:id/lyrics`,
    route(async (req, res) => {
      const id = requireString(req.params.id, 'id');

      /*
       * YouTube Music first, before `parseService`.
       *
       * That helper only accepts the two catalogue services, so a YouTube
       * track was rejected as unsupported and never got as far as asking —
       * the same gap that stopped its tracks playing at all.
       */
      if (String(req.query.service ?? '').toLowerCase() === 'ytmusic') {
        const native = resolveYtMusicLyrics ? await resolveYtMusicLyrics(id).catch(() => null) : null;

        /* Falling back to LRCLIB needs a name to search by, which only the
           caller has for a YouTube track. */
        const artist = String(req.query.artist ?? '').trim();
        const title = String(req.query.title ?? '').trim();
        const found = native ?? (artist && title ? await fetchLrclib({artist, title}).catch(() => null) : null);
        if (!found) throw ApiError.notFound('No lyrics available for this track');

        return sendData(res, {
          text: found.text,
          synced: 'synced' in found ? found.synced : [],
          source: found.source,
        });
      }

      const service = parseService(req.query.service);

      let result: LyricsResult | null = null;
      let meta: {artist?: string; title?: string; album?: string; durationSec?: number} = {};

      if (service === 'deezer') {
        await initDeezerForDownload().catch(() => undefined);
        const info = await deezer.getTrackInfo(id).catch(() => undefined);

        if (info) {
          meta = {
            artist: info.ART_NAME,
            title: info.SNG_TITLE,
            album: info.ALB_TITLE,
            durationSec: Number(info.DURATION) || undefined,
          };

          const native = await deezer.getTrackLyrics(info).catch(() => null);
          if (native?.LYRICS_TEXT) {
            const synced = Array.isArray(native.LYRICS_SYNC_JSON)
              ? native.LYRICS_SYNC_JSON.filter((line: any) => line?.line).map((line: any) => ({
                  timeMs: Number(line.milliseconds) || 0,
                  durationMs: Number(line.duration) || 0,
                  text: String(line.line),
                }))
              : [];
            result = {text: native.LYRICS_TEXT, synced, source: 'deezer'};
          }
        } else {
          // Without an authenticated session the private API is unavailable;
          // the public one still gives us enough to query LRCLIB.
          const pub = await deezer.getTrackInfoPublicApi(id).catch(() => undefined);
          if (pub) {
            meta = {
              artist: (pub as any).artist?.name,
              title: (pub as any).title,
              album: (pub as any).album?.title,
              durationSec: Number((pub as any).duration) || undefined,
            };
          }
        }
      } else {
        await initQobuzForSearch();
        const track = await qobuz.getTrackInfo(Number(id)).catch(() => undefined);
        if (!track) throw ApiError.notFound('Track not found');
        meta = {
          artist: track?.performer?.name ?? track?.album?.artist?.name,
          title: track?.title,
          album: track?.album?.title,
          durationSec: Number(track?.duration) || undefined,
        };
      }

      if (!result && meta.artist && meta.title) {
        result = await fetchLrclib({
          artist: meta.artist,
          title: meta.title,
          album: meta.album,
          durationSec: meta.durationSec,
        });
      }

      if (!result) throw ApiError.notFound('No lyrics available for this track');

      return sendData(
        res,
        {text: result.text, synced: result.synced, writers: null, copyright: null},
        {service, id, hasSynced: result.synced.length > 0, source: result.source},
      );
    }),
  );

  /** GET /cache/stats — operational visibility into the stream buffer cache. */
  app.get(
    `${basePath}/cache/stats`,
    route(async (_req, res) => sendData(res, trackBufferCache.stats())),
  );
};
