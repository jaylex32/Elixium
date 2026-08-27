#!/usr/bin/env node

import {readFileSync, existsSync} from 'fs';
import {deezer, qobuz, spotify} from './core';
import {parseInfo, parseQobuzUrl} from './core';
import qdlt from './lib/download-qobuz-track';
import {parseToQobuz} from './lib/to-qobuz-parser';
import PQueue from 'p-queue';
import {trueCasePathSync} from 'true-case-path';
import signale from './lib/signale';
import downloadTrack from './lib/download-track';
import Config from './lib/config';
import updateCheck from './lib/update-check';
import autoUpdater from './lib/auto-updater';
import {commonPath, formatSecondsReadable, sanitizeFilename} from './lib/util';
import {terminalProgress} from './lib/terminal-progress';
import pkg from '../package.json';
import {buildCommand, ensureLegacyNodeOptions, printBanner} from './app/cli';
import {APP_BRAND, APP_COMMAND, DEFAULT_CONFIG_FILE, FAVORITES_DATA_FILE} from './app/brand';
import {createCatalogSearch} from './app/catalog-search';
import {createCliDownloads} from './app/cli-downloads';
import {createExplorer} from './app/explorer';
import {createSessionQueue} from './app/session-queue';
import {createServiceRuntime} from './app/service-runtime';
import {ProviderRegistry} from './app/provider-readiness';
import {createYtMusicService} from './app/ytmusic-service';
import {createDownloadQueueRuntime} from './app/download-queue-runtime';
import {createWebData} from './app/web-data';
import {createWebDownloads} from './app/web-downloads';
import {registerWebRestRoutes} from './app/web-rest';
import {createArtistContent} from './app/artist-content';
import {createCharts} from './app/charts';
import {createGenreContent} from './app/genre-content';
import {createFavoritesStore} from './app/favorites-store';
import {createPlaylistSearch} from './app/playlist-search';
import {installLogCapture, attachLogBroadcast} from './app/log-buffer';
import {registerApiV1} from './app/api/v1';
import {installProcessGuard} from './app/process-guard';
import {
  authorize,
  buildCorsOptions,
  createAuthMiddleware,
  getOrCreateToken,
  isAuthEnabled,
  LOOPBACK_ADDRESSES,
} from './app/api/auth';
import {registerCatalogSocketHandlers} from './app/web-socket-catalog';
import {registerDirectDownloadSocketHandler} from './app/web-socket-direct-download';
import {registerDiscoverySocketHandler} from './app/web-socket-discovery';
import {registerMediaSocketHandlers} from './app/web-socket-media';
import {registerOperationsSocketHandlers} from './app/web-socket-operations';
import {createQobuzWatchlistService} from './app/qobuz-watchlist';
import {registerWatchlistSocketHandlers} from './app/web-socket-watchlist';
import {getDefaultWebShell} from './app/web-shell';
import type {CatalogService, CatalogType, SearchResult} from './app/interactive-types';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Web server imports
import express from 'express';
import {createServer} from 'http';
import {Server as SocketIOServer} from 'socket.io';
import cors from 'cors';

/*
 * Load a .env sitting next to the app before anything reads process.env.
 *
 * This is the file people expect to find a port in, and it is the one thing a
 * non-technical user can be told to create without explaining flags or JSON.
 * `path` is resolved against the executable's own directory rather than the
 * shell's working directory, so double-clicking the launcher from Finder or
 * Explorer picks it up.
 *
 * Existing environment variables win — a value set by a container or a service
 * manager should not be overridden by a file that shipped in the archive.
 */
dotenv.config({path: path.join(path.dirname(process.execPath), '.env'), override: false});
dotenv.config({override: false});

installProcessGuard();

/* Tee console output into a ring buffer so the Logs page can show what the
 * engine is doing. Installed before anything else logs, or the first lines -
 * the ones that explain a bad start - are the ones that get missed. */
installLogCapture();
ensureLegacyNodeOptions();
printBanner(pkg.version);

const cmd = buildCommand();

const options = cmd.parse(process.argv).opts();
if (!options.url && cmd.args[0]) {
  options.url = cmd.args[0];
}

// Validation for CLI mode
if (!options.web) {
  if (options.headless && !options.quality) {
    console.error(signale.error('Missing parameters --quality'));
    console.error(signale.note('Quality must be provided with headless mode'));
    process.exit(1);
  }
  if (options.headless && !options.url && !options.inputFile) {
    console.error(signale.error('Missing parameters --url'));
    console.error(signale.note('URL must be provided with headless mode'));
    process.exit(1);
  }
}

const conf = new Config(options.configFile);
if (conf.userConfigLocation) {
  console.log(signale.info('Configuration loaded'));
  console.log(signale.note(conf.userConfigLocation));
}

const shouldUseVariousArtists = (settings?: any): boolean => {
  const candidateKeys = [
    'useVariousArtists',
    'useVariousArtist',
    'playlistUseVariousArtists',
    'playlistUseVarious',
    'groupAsVariousArtists',
    'groupAsVarious',
  ];

  if (settings) {
    for (const key of candidateKeys) {
      if (Object.prototype.hasOwnProperty.call(settings, key) && settings[key] !== undefined) {
        const value = settings[key];
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          if (['false', '0', 'no', 'off'].includes(normalized)) {
            return false;
          }
          if (['true', '1', 'yes', 'on'].includes(normalized)) {
            return true;
          }
        }
        return Boolean(value);
      }
    }
  }

  const configValue = (conf as any).get?.('playlist.useVariousArtists');
  if (configValue !== undefined) {
    if (typeof configValue === 'string') {
      const normalized = configValue.trim().toLowerCase();
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
    }
    return Boolean(configValue);
  }

  return false;
};

function getQobuzConfig() {
  try {
    const configPath = path.join(process.cwd(), DEFAULT_CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
      console.log(signale.warn(`No ${DEFAULT_CONFIG_FILE} found. Using default settings.`));
      return null;
    }

    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    return config.qobuz;
  } catch (error) {
    console.log(signale.warn("Config file found but couldn't be read. Using defaults."));
    return null;
  }
}

// Global variables for web interface
let io: SocketIOServer;
let currentDownloadQueue: any[] = [];
let isDownloading = false;
let downloadProgress = 0;
const activeDownloads = new Map();

const queue = new PQueue({concurrency: Number(options.concurrency || conf.get('concurrency'))});
const urlRegex = /https?:\/\/.*\w+\.\w+\/\w+/;

const onCancel = () => {
  console.info(signale.note('Aborted!'));
  process.exit();
};

// Global service state tracking
let isDeezerInitialized = false;
let isQobuzInitialized = false;
let isDeezerDownloadReady = false;
let isQobuzDownloadReady = false;

interface DownloadItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  type: string;
  status: 'queued' | 'downloading' | 'completed' | 'error' | 'cancelled';
  startTime?: Date;
  endTime?: Date;
  errorMessage?: string;
  progress?: number;
  rawData: any;
}

/**
 * Accept the quality names the clients actually send.
 *
 * The web UI stores Deezer quality as MP3_128 / MP3_320 / FLAC and Qobuz as
 * 5 / 6 / 7 / 27 — the identifiers each service's own API uses — while this
 * function only recognised 128 / 320 / flac and 320kbps / 44khz / 96khz /
 * 192khz. Every value the UI saved was therefore rejected and silently
 * replaced with the lowest common default: 320 for Deezer, 320kbps for Qobuz.
 *
 * The effect was invisible on a paid Deezer account, where 320 always
 * succeeds, so the quality selector appeared to work while doing nothing. It
 * was not invisible on a free account: 320 is not licensed there, every track
 * failed, and a download finished with "0 files saved". Qobuz was quietly
 * worse — hi-res selections were downloaded as MP3.
 *
 * Aliases are mapped rather than rejected, and anything genuinely unknown
 * still falls back, so old configs keep working without a migration.
 */
const DEEZER_QUALITY_ALIASES: Record<string, string> = {
  '128': '128',
  mp3_128: '128',
  '128kbps': '128',
  '320': '320',
  mp3_320: '320',
  '320kbps': '320',
  flac: 'flac',
  lossless: 'flac',
};

const QOBUZ_QUALITY_ALIASES: Record<string, string> = {
  '5': '320kbps',
  '320': '320kbps',
  '320kbps': '320kbps',
  mp3: '320kbps',
  '6': '44khz',
  '44khz': '44khz',
  cd: '44khz',
  flac: '44khz',
  '7': '96khz',
  '96khz': '96khz',
  hifi: '96khz',
  '27': '192khz',
  '192khz': '192khz',
  studio: '192khz',
  hires: '192khz',
};

const normalizeQuality = (quality: string, service: string): string => {
  const key = String(quality ?? '')
    .trim()
    .toLowerCase();

  if (service === 'deezer') {
    const mapped = DEEZER_QUALITY_ALIASES[key];
    if (mapped) return mapped;
    console.log(signale.warn(`Unrecognised Deezer quality "${quality}". Using 320.`));
    return '320';
  }

  if (service === 'qobuz') {
    const mapped = QOBUZ_QUALITY_ALIASES[key];
    if (mapped) return mapped;
    console.log(signale.warn(`Unrecognised Qobuz quality "${quality}". Using 320kbps.`));
    return '320kbps';
  }

  return quality;
};

const toStandardTrack = (track: any, service: 'deezer' | 'qobuz'): SearchResult => {
  if (service === 'deezer') {
    return {
      id: String(track.SNG_ID || track.id),
      title: String(track.SNG_TITLE || track.title || 'Unknown Track') + (track.VERSION ? ` ${track.VERSION}` : ''),
      artist: String(track.ART_NAME || track.artist?.name || 'Unknown Artist'),
      album: String(track.ALB_TITLE || track.album?.title || ''),
      duration: formatSecondsReadable(Number(track.DURATION || track.duration || 0)),
      year: track.PHYSICAL_RELEASE_DATE ? new Date(track.PHYSICAL_RELEASE_DATE).getFullYear() : null,
      type: 'track',
      rawData: track,
    };
  }

  return {
    id: String(track.id),
    title: String(track.title || 'Unknown Track') + (track.version ? ` (${track.version})` : ''),
    artist: String(track.performer?.name || track.artist?.name || 'Unknown Artist'),
    album: String(track.album?.title || ''),
    duration: formatSecondsReadable(Number(track.duration || 0)),
    year: track.album?.release_date_original ? new Date(track.album.release_date_original).getFullYear() : null,
    type: 'track',
    maximum_bit_depth: track.maximum_bit_depth,
    maximum_sampling_rate: track.maximum_sampling_rate,
    hires: track.hires,
    hires_streamable: track.hires_streamable,
    rawData: track,
  };
};

// Web Server Setup
const setupWebServer = () => {
  const app = express();
  const server = createServer(app);

  /*
   * Socket.IO carries the same privileges as the REST API — downloads,
   * settings, the watchlist — so it is authenticated identically. Guarding
   * only HTTP would leave the whole thing reachable through the socket.
   */
  io = new SocketIOServer(server, {
    cors: buildCorsOptions(conf),
  });
  // Stream new log lines to every connected client.
  attachLogBroadcast(io);

  io.use((socket, next) => {
    const handshake = socket.handshake;
    const presented =
      (typeof handshake.auth?.token === 'string' && handshake.auth.token) ||
      (typeof handshake.query?.token === 'string' && handshake.query.token) ||
      '';
    const loopback = LOOPBACK_ADDRESSES.has(handshake.address);

    const decision = authorize(conf, presented, loopback);
    if (decision.ok) {
      next();
      return;
    }
    // The client checks this message to decide between prompting for a token
    // and reporting a genuine connection failure.
    next(new Error(decision.reason === 'missing_token' ? 'auth_required' : 'auth_invalid'));
  });

  app.use(cors(buildCorsOptions(conf)));
  app.use(express.json());

  /*
   * Guard the whole API surface, before any API route is registered.
   *
   * Two things were wrong. It was mounted on /api/v1, which left the older
   * /api/* routes — search, discovery, item-tracks, stream, download,
   * download-zip — completely unauthenticated, so anything on the network
   * could stream the library and queue downloads without a token. And it was
   * registered *after* those routes: Express matches handlers in registration
   * order, so even mounting it at /api would have run too late to stop them.
   *
   * Mounted at /api rather than per-route so a route added later cannot sit
   * outside the check. Static assets are not under /api, so an unpaired
   * browser can still load the web UI shell — without that it could never
   * fetch the pairing screen it needs to show. Loopback stays exempt, and
   * /api/v1/health stays public for address discovery.
   */
  app.use('/api', createAuthMiddleware(conf, '/api'));

  const staticRootCandidates = [
    path.join(process.cwd(), 'public'),
    path.join(__dirname, 'public'),
    path.join(__dirname, '..', '..', 'public'),
  ].filter((candidate, index, list) => list.indexOf(candidate) === index);

  /*
   * Found on demand, not once at startup.
   *
   * The Windows portable build unpacks itself into a temporary folder as it
   * launches, and the engine can be serving before that finishes. Resolving
   * this once meant a single early miss was permanent: `existsSync` said no,
   * the path stayed null for the life of the process, and every page load
   * afterwards returned the fallback — so the desktop window opened on a
   * blank page and the app quit with no error anywhere.
   *
   * That race widened when the listener was moved ahead of provider
   * initialisation, which is worth knowing: binding earlier is right, but
   * it means nothing may assume the filesystem has settled.
   */
  let cachedIndexHtmlPath: string | undefined;
  const findIndexHtml = (): string | undefined => {
    if (cachedIndexHtmlPath && existsSync(cachedIndexHtmlPath)) return cachedIndexHtmlPath;
    cachedIndexHtmlPath = staticRootCandidates
      .map((rootDir) => path.join(rootDir, 'index.html'))
      .find((candidate) => existsSync(candidate));
    return cachedIndexHtmlPath;
  };

  app.get('/', (req, res) => {
    try {
      const indexHtmlPath = findIndexHtml();
      if (!indexHtmlPath) {
        throw new Error('No public/index.html found');
      }

      const htmlContent = readFileSync(indexHtmlPath, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(htmlContent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log('Failed to read bundled HTML file:', errorMessage);
      res.send(getDefaultWebShell(APP_BRAND));
    }
  });

  /*
   * Every candidate is mounted, existing or not.
   *
   * `express.static` looks for the file when a request arrives rather than
   * when it is mounted, so a directory that does not exist yet costs
   * nothing and begins working the moment it appears. Filtering by
   * `existsSync` here had the same flaw as the index lookup above: on the
   * portable build the interface files are still being unpacked, so the
   * only real root was dropped and no asset was ever served.
   */
  staticRootCandidates.forEach((rootDir) => {
    app.use(express.static(rootDir));
  });
  registerWebRestRoutes({
    app,
    io,
    deezer,
    qobuz,
    ytmusic: ytmusicService,
    artistContent,
    charts,
    genreContent,
    makeHttpRequest,
    favorites,
    playlistSearch,
    performDeezerSearch,
    performQobuzSearch,
    getDiscoveryContentRest,
    getItemTracksRest,
    initDeezerForDownload,
    initQobuzForSearch,
    initQobuzForDownload,
    startDownloadProcess,
  });

  // Versioned API. The unversioned routes above stay for the existing web UI;
  // external clients (the Android app) target /api/v1, which has a stable
  // response envelope, Range-aware streaming, and a discovery/health endpoint.
  registerApiV1({
    app,
    io,
    conf,
    appVersion: pkg.version,
    appBrand: APP_BRAND,
    resolveYtMusicStream: (videoId: string) => ytmusicService.streamUrl(videoId),
    resolveYtMusicLyrics: (videoId: string) => ytmusicService.lyrics(videoId),
    readiness: () => providers.snapshot(),
    retryProvider: (name: string) => providers.retry(name),
    deezer,
    qobuz,
    performDeezerSearch,
    performQobuzSearch,
    getDiscoveryContentRest,
    getItemTracksRest,
    getAvailableGenres: () => qobuzWatchlist.getAvailableGenres(),
    initDeezerForDownload,
    refreshDeezerSession,
    initQobuzForSearch,
    initQobuzForDownload,
    startDownloadProcess,
    normalizeQuality,
    watchlist: qobuzWatchlist,
    activeDownloads,
    getCurrentDownloadQueue: () => currentDownloadQueue,
    getIsDownloading: () => isDownloading,
    parseToQobuz,
    parseDeezerUrl: parseInfo,
    ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
    settingsHooks: {
      setIsDeezerDownloadReady: (value) => {
        isDeezerDownloadReady = value;
      },
      setIsQobuzInitialized: (value) => {
        isQobuzInitialized = value;
      },
      setIsQobuzDownloadReady: (value) => {
        isQobuzDownloadReady = value;
      },
      setConcurrency: (value) => {
        queue.concurrency = value;
      },
    },
  });

  // Socket.IO handlers
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    registerCatalogSocketHandlers({
      socket,
      artistContent,
      performDeezerSearch,
      performQobuzSearch,
      ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
      parseToQobuz,
      parseDeezerUrl: parseInfo,
      /* A YouTube link is served by YouTube Music, not sent to the matcher. */
      resolveYtMusicUrl: (url: string) => ytmusicService.resolveUrl(url),
    });

    registerOperationsSocketHandlers({
      socket,
      conf,
      queue,
      signale,
      normalizeQuality,
      startDownloadProcess,
      getCurrentDownloadQueue: () => currentDownloadQueue,
      activeDownloads,
      getIsDownloading: () => isDownloading,
      setIsDeezerDownloadReady: (value) => {
        isDeezerDownloadReady = value;
      },
      setIsQobuzInitialized: (value) => {
        isQobuzInitialized = value;
      },
      setIsQobuzDownloadReady: (value) => {
        isQobuzDownloadReady = value;
      },
    });

    registerMediaSocketHandlers({
      socket,
      deezer,
      qobuz,
      parseDeezerUrl: parseInfo,
      parseQobuzUrl,
      parseToQobuz,
      ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
      ensureDeezerDownloadReady: () => providers.ensure('deezer-download'),
    });

    registerDirectDownloadSocketHandler({
      socket,
      parseToQobuz,
      parseDeezerUrl: parseInfo,
      ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
      ensureQobuzDownloadReady: () => providers.ensure('qobuz-download'),
      ensureDeezerDownloadReady: () => providers.ensure('deezer-download'),
      shouldUseVariousArtists,
      downloadQobuzTracks,
      downloadDeezerTracks,

      /* A YouTube link on YouTube Music downloads from YouTube Music. */
      resolveYtMusicUrl: (url: string) => ytmusicService.resolveUrl(url),
      downloadYtMusicTrack: (videoId: string, metadata: any, onProgress?: any) =>
        ytmusicService.downloadToLibrary(videoId, metadata, onProgress),
      /* Converting a YouTube link into the selected catalogue. */
      matchYtMusicTracks: (tracks: any[], preferred: 'deezer' | 'qobuz') =>
        ytmusicService.resolveTracks(tracks, preferred),
      /* And the other direction: a Spotify or Deezer link onto YouTube Music. */
      matchIntoYtMusic: (sources: any[]) => ytmusicService.matchToYtMusic(sources),
      createPlaylistFile,
    });
    registerDiscoverySocketHandler({
      socket,
      getDiscoveryContent: getDiscoveryContentRest,
    });
    registerWatchlistSocketHandlers({
      socket,
      io,
      watchlist: qobuzWatchlist,
    });
  });

  /*
   * Never let a single request hold a socket indefinitely.
   *
   * A request that somehow never gets a response — a handler that throws after
   * returning, an upstream that stalls — otherwise occupies its connection
   * until the client gives up. Behind a reverse proxy those accumulate in the
   * origin pool and every endpoint starts timing out while the process sits
   * near idle, which reads as "the server is dead" and is very hard to tell
   * apart from a real crash.
   *
   * Generous rather than tight, because audio streaming is legitimately long:
   * these bound a stuck request, they are not a latency budget.
   */
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 70 * 1000;
  // 0 disables Node's 5s default, which is far too short for a paused stream.
  server.keepAliveTimeout = 65 * 1000;

  /*
   * Port resolution, most explicit first.
   *
   *   --port            someone typed it, so it wins
   *   PORT              the usual convention for containers and hosts
   *   config `port`     the file people already edit for paths and credentials
   *   3000              fallback
   *
   * commander gives --port a default, so the flag alone cannot tell "the user
   * asked for 3000" from "nobody asked". getOptionValueSource distinguishes
   * them; without it the config value could never take effect.
   */
  const portFromFlag = cmd.getOptionValueSource?.('port') === 'cli' ? Number(options.port) : NaN;
  const portFromEnv = Number(process.env.PORT);
  const portFromConfig = Number(conf.get('port'));
  const port = [portFromFlag, portFromEnv, portFromConfig].find((value) => Number.isFinite(value) && value > 0) ?? 3000;
  /*
   * Bind address. Unset means every interface, which is what a LAN server or
   * one behind a reverse proxy needs, so the default is unchanged. Passing
   * 127.0.0.1 makes the server genuinely local-only — the desktop app does
   * that, because an app on someone's laptop has no business listening on
   * their network.
   */
  const host = typeof options.host === 'string' && options.host.trim() ? options.host.trim() : undefined;

  const onListening = () => {
    /*
     * Core readiness. Deliberately the moment the socket is bound and before
     * any optional provider has been attempted: this is what `/api/v1/health`
     * answers on, and what the desktop launcher is waiting for.
     */
    providers.markCoreReady();
    console.log(signale.success(`Web interface available at http://localhost:${port}`));
    if (host) {
      console.log(signale.info(`Bound to ${host} only — not reachable from other devices`));
    }
    console.log(signale.info('Open this URL in your browser to use the GUI'));
  };

  if (host) server.listen(port, host, onListening);
  else server.listen(port, onListening);

  return server;
};

const {performDeezerSearch, performQobuzSearch} = createCatalogSearch({
  deezer,
  qobuz,
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
});

/*
 * YouTube Music browses; Deezer and Qobuz supply the files.
 *
 * The search function handed over is the same one the rest of the app uses, so
 * a resolved match is exactly the item that would have been found by searching
 * for it directly — same ids, same tags, same download path.
 */
const ytmusicService = createYtMusicService({
  search: (service, query, type, limit) =>
    service === 'qobuz' ? performQobuzSearch(query, type, limit) : performDeezerSearch(query, type, limit),
  getCookie: () => (conf.get('ytmusic.cookie') as string) || undefined,
  setCookie: (cookie: string) => conf.set('ytmusic.cookie', cookie),
  getDownloadPath: () => (conf.get('paths.ytmusic') as string) || './Music/YouTube Music',
  /*
   * YouTube Music files itself by its own template, not Deezer's.
   *
   * `saveLayout.track` is written in Deezer's placeholder language —
   * `{ART_NAME}`, `{SNG_TITLE}` and so on — which means nothing here. Handing
   * it over produced paths with every field blank: a four megabyte track
   * landed at "Deezer/Tracks/1.m4a", correctly downloaded and tagged and
   * impossible to find. A YouTube Music download uses `saveLayout.ytmusic`
   * when one is set, and otherwise the layout below.
   */
  getLayout: () => (conf.get('saveLayout.ytmusic') as string) || undefined,
  /*
   * `trackNumber` is a boolean setting — whether to number files at all — so
   * reading it as a width yields 1 from `Number(true)`, and every track is
   * numbered "1" instead of "01".
   */
  getNumberWidth: () => 2,
  /*
   * YouTube offers the same track as AAC in MP4 and as Opus in WebM. Opus is
   * a few kbps higher and the better codec at equal rate, but WebM cannot be
   * tagged — an Opus download arrives with no title, artist or cover and stays
   * that way. AAC is the default for that reason; this is the way out for
   * somebody who would rather have the bitrate.
   */
  preferOpus: () => String(conf.get('quality.ytmusic') || 'aac') === 'opus',
  /*
   * Default on. A music video's audio is not the record it claims to be —
   * label idents, crowd noise, a different mix and a length that disagrees
   * with the release — and somebody downloading from a music service is asking
   * for the song, not the upload that happens to carry it.
   */
  preferAlbumAudio: () => conf.get('ytmusic.preferAlbumAudio') !== false,
  /*
   * Default off. Some tracks exist only as a video — singles, live cuts,
   * anything unreleased — and refusing those outright means a file that could
   * have existed does not.
   */
  strictAlbumAudio: () => conf.get('ytmusic.strictAlbumAudio') === true,
  /*
   * The same two lyric settings the other services obey. They were global
   * already; YouTube Music's tagger simply never read them, so turning them on
   * did nothing to a YouTube Music download.
   */
  embedLyrics: () => conf.get('embedLyrics') !== false,
  saveLrcFile: () => Boolean(conf.get('saveLrcFile')),
});

const searchCatalog = (
  service: CatalogService,
  query: string,
  type: CatalogType,
  limit = 50,
  offset = 0,
): Promise<SearchResult[]> =>
  service === 'deezer'
    ? performDeezerSearch(query, type, limit, offset)
    : performQobuzSearch(query, type, limit, offset);

const {
  promptGroupedSearchSelection,
  promptDeezerArtistAlbumSelection,
  promptQobuzArtistAlbumSelection,
  printExplorerIntro,
  describeQobuzTrack,
  promptTrackSubsetSelection,
} = createExplorer({
  onCancel,
  searchCatalog,
  getDeezerArtistAlbums: async (artistId) => (await deezer.getDiscography(String(artistId), 200)).data,
  getQobuzArtistAlbums: async (artistId) => (await qobuz.getArtistAlbums(String(artistId))).albums.items,
});

const {
  buildDeezerQueuePreview,
  buildQobuzQueuePreview,
  collectSessionQueue,
  resolveDeezerQueueItem,
  resolveQobuzQueueItem,
} = createSessionQueue({
  onCancel,
  urlRegex,
  printExplorerIntro,
  promptGroupedSearchSelection,
  promptDeezerArtistAlbumSelection,
  promptQobuzArtistAlbumSelection,
  parseDeezerUrl: parseInfo,
  parseToQobuz,
});

const {startDownload, startQobuzDownload} = createCliDownloads({
  options,
  conf,
  queue,
  urlRegex,
  normalizeQuality,
  collectSessionQueue,
  resolveDeezerQueueItem,
  resolveQobuzQueueItem,
  promptGroupedSearchSelection,
  promptDeezerArtistAlbumSelection,
  promptQobuzArtistAlbumSelection,
  promptTrackSubsetSelection,
  buildDeezerQueuePreview,
  buildQobuzQueuePreview,
  describeQobuzTrack,
  onCancel,
});

const {downloadQobuzTracks, downloadDeezerTracks, createPlaylistFile} = createWebDownloads({
  conf,
  qobuzDownloadTrack: qdlt,
  deezerDownloadTrack: downloadTrack,
  commonPath,
  sanitizeFilename,
  trueCasePathSync,
});

const {getDiscoveryContentRest, getItemTracksRest, makeHttpRequest} = createWebData({
  deezer,
  qobuz,
  parseDeezerUrl: parseInfo,
  parseQobuzUrl,
  ensureDeezerDownloadReady: () => providers.ensure('deezer-download'),
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
  toStandardTrack,
  getQobuzConfig,
});

/** Artist albums, top tracks and related playlists, shared by REST and sockets. */
const artistContent = createArtistContent({
  deezer,
  qobuz,
  makeHttpRequest,
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
});

/** Ranked charts per genre; separate from the editorial Discover lists. */
const charts = createCharts({
  qobuz,
  makeHttpRequest,
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
});

/** A genre's own albums, tracks, artists and playlists — not its chart. */
const genreContent = createGenreContent({
  qobuz,
  makeHttpRequest,
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
});

/** Playlist search across Deezer, Qobuz and Spotify. */
const playlistSearch = createPlaylistSearch({
  deezer,
  qobuz,
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
  setSpotifyAnonymousToken: () => spotify.setSpotifyAnonymousToken(),
  getSpotifyApi: () => spotify.spotifyApi,
  getSpotifyCredentials: () => {
    /* Read from disk each time rather than caching: Settings rewrites this
     * file, and credentials entered mid-session should take effect without a
     * restart. `cookies` is not part of the typed config key set, which is why
     * this reads the file instead of going through conf.get. */
    try {
      const raw = fs.readFileSync(path.resolve(options.configFile), 'utf8');
      const cookies = JSON.parse(raw)?.cookies ?? {};
      return {clientId: cookies.spotifyClientId, clientSecret: cookies.spotifyClientSecret};
    } catch {
      return {};
    }
  },
});

/*
 * Favourites live beside the config file, not in the working directory. The
 * desktop app runs the engine with its cwd in app data while the config is
 * passed explicitly, so resolving against cwd would put them in different
 * places depending on how the engine was started.
 */
const favorites = createFavoritesStore(path.join(path.dirname(path.resolve(options.configFile)), FAVORITES_DATA_FILE));

const {startDownloadProcess} = createDownloadQueueRuntime({
  conf,
  qobuz,
  parseDeezerUrl: parseInfo,
  parseQobuzUrl,
  deezerDownloadTrack: downloadTrack,
  qobuzDownloadTrack: qdlt,
  initDeezerForDownload: () => providers.ensure('deezer-download'),
  initQobuzForDownload: () => providers.ensure('qobuz-download'),
  shouldUseVariousArtists,
  commonPath,
  sanitizeFilename,
  trueCasePathSync,
  activeDownloads,
  getIsDeezerDownloadReady: () => isDeezerDownloadReady,
  getIsQobuzDownloadReady: () => isQobuzDownloadReady,
  setIsDownloading: (value) => {
    isDownloading = value;
  },
  setCurrentDownloadQueue: (value) => {
    currentDownloadQueue = value;
  },
  setDownloadProgress: (value) => {
    downloadProgress = value;
  },
  clearActiveDownloads: () => {
    activeDownloads.clear();
  },
});

const qobuzWatchlist = createQobuzWatchlistService({
  conf,
  qobuz,
  ensureQobuzSearchReady: () => providers.ensure('qobuz-search'),
  // Lets the watchlist follow Deezer artists, not just Qobuz ones. Reuses the
  // same paged fetch the artist view uses rather than a second implementation.
  fetchDeezerArtistAlbums: async (artistId: string) => {
    const collected: any[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const page = await artistContent.getArtistAlbums('deezer', artistId, 100, offset);
      collected.push(...page);
      if (page.length < 100) break;
    }
    return collected;
  },
  dispatchQueueItems: async (queueItems, options) => {
    if (!Array.isArray(queueItems) || !queueItems.length) return;

    const shouldAutoStart = Boolean(options?.autoStart);
    const canStartServerSide = shouldAutoStart && !isDownloading;

    if (io) {
      io.emit('watchlistQueueItems', {
        queueItems,
        autoStart: false,
      });
    }

    if (canStartServerSide) {
      const broadcastSocket = io
        ? {
            emit: (event: string, payload: any) => {
              io.emit(event, payload);
            },
          }
        : undefined;

      /*
       * Dispatch per service, not as one Qobuz batch.
       *
       * This forced every watchlist download through Qobuz, so a watched Deezer
       * artist produced Deezer album ids that Qobuz was then asked to fetch —
       * answering "No result matching given argument" for every release. Each
       * item now goes to the service it actually came from, with that service's
       * quality and download path.
       */
      const byService = new Map<string, any[]>();
      for (const item of queueItems) {
        const service = String(item?.service || '').toLowerCase() === 'deezer' ? 'deezer' : 'qobuz';
        if (!byService.has(service)) byService.set(service, []);
        (byService.get(service) as any[]).push(item);
      }

      for (const [service, items] of byService) {
        if (service === 'deezer') {
          await providers.ensure('deezer-download');
          const quality = normalizeQuality(((conf as any).get?.('quality.deezer') || 'flac') as string, 'deezer');
          await startDownloadProcess(
            items,
            quality,
            'deezer',
            {
              deezerPath: (conf as any).get?.('paths.deezer') || './Music/Deezer',
              deezerDownloadCover: (conf as any).get?.('deezerDownloadCover'),
            },
            broadcastSocket as any,
          );
        } else {
          await providers.ensure('qobuz-download');
          const quality = normalizeQuality(((conf as any).get?.('quality.qobuz') || '44khz') as string, 'qobuz');
          await startDownloadProcess(
            items,
            quality,
            'qobuz',
            {
              qobuzPath: (conf as any).get?.('paths.qobuz') || './Music/Qobuz',
              qobuzDownloadCover: (conf as any).get?.('qobuzDownloadCover'),
            },
            broadcastSocket as any,
          );
        }
      }
    }
  },
  broadcastState: (state) => {
    if (!io) return;
    io.emit('watchlistState', state);
    io.emit('monitorSchedules', qobuzWatchlist.getMonitorSchedules());
    io.emit('monitorHistory', {items: qobuzWatchlist.getMonitorHistory()});
  },
});

/**
 * Startup dependencies and their readiness.
 *
 * Everything optional goes through here so that no provider — however slow,
 * unreachable or misconfigured — can hold up the HTTP listener the desktop
 * launcher waits on.
 */
const providers = new ProviderRegistry({
  onEvent: ({provider, state, failure}) => {
    if (state === 'ready') {
      console.log(signale.success(`${provider} ready`));
    } else if (state === 'unavailable' || state === 'failed') {
      console.log(signale.warn(`${provider} unavailable (${failure?.kind ?? 'unknown'}): ${failure?.message ?? ''}`));
    }
  },
});

const {initDeezerForSearch, initDeezerForDownload, refreshDeezerSession, initQobuzForSearch, initQobuzForDownload} =
  createServiceRuntime({
    options,
    conf,
    deezer,
    qobuz,
    appCommand: APP_COMMAND,
    getIsDeezerInitialized: () => isDeezerInitialized,
    setIsDeezerInitialized: (value) => {
      isDeezerInitialized = value;
    },
    getIsQobuzInitialized: () => isQobuzInitialized,
    setIsQobuzInitialized: (value) => {
      isQobuzInitialized = value;
    },
    getIsDeezerDownloadReady: () => isDeezerDownloadReady,
    setIsDeezerDownloadReady: (value) => {
      isDeezerDownloadReady = value;
    },
    getIsQobuzDownloadReady: () => isQobuzDownloadReady,
    setIsQobuzDownloadReady: (value) => {
      isQobuzDownloadReady = value;
    },
  });

/*
 * Optional dependencies.
 *
 * Qobuz browsing scrapes an app id and secrets from Qobuz's web bundle, which
 * means two network round trips — one of them several megabytes — before it
 * can answer anything. That is a perfectly reasonable thing for a provider to
 * need and a completely unreasonable thing to put in front of the application
 * opening, which is exactly where it used to sit.
 *
 * The bound below is per attempt. It is generous, because a slow connection
 * downloading the bundle is a working case, not a broken one; what matters is
 * that it ends.
 */
const QOBUZ_INIT_TIMEOUT_MS = 45_000;

providers.register({
  name: 'qobuz-search',
  optional: true,
  timeoutMs: QOBUZ_INIT_TIMEOUT_MS,
  init: () => initQobuzForSearch(),
});

providers.register({
  name: 'qobuz-download',
  optional: true,
  timeoutMs: QOBUZ_INIT_TIMEOUT_MS,
  init: () => initQobuzForDownload(),
});

providers.register({
  name: 'deezer-download',
  optional: true,
  timeoutMs: 30_000,
  init: () => initDeezerForDownload(),
});

/*
 * YouTube Music. Optional like the rest: it scrapes a page for its client
 * configuration, so a layout change there degrades this one provider instead
 * of doing anything to the app around it.
 */
providers.register({
  name: 'ytmusic',
  optional: true,
  timeoutMs: 20_000,
  init: () => ytmusicService.check(),
});

const initApp = async () => {
  if (options.web) {
    console.log(signale.info('Initializing services for web interface...'));

    /*
     * Deezer browsing is a flag, not a network call — nothing to wait on.
     */
    await initDeezerForSearch();

    /*
     * Bind the listener before touching any provider.
     *
     * This ordering is the fix for a startup failure that came back across
     * several releases. `/api/v1/health` is how the desktop launcher decides
     * the engine is alive, and it cannot answer until this call has run. When
     * an optional provider was initialised first, a slow or unreachable one
     * meant nothing ever listened, and the only thing the user saw was the
     * launcher's own timeout — which was then raised, twice, without ever
     * addressing why the wait was unbounded.
     *
     * Optional providers warm up behind the open port. Every route that needs
     * one already asks for it on demand, so nothing is lost by not waiting:
     * the first Qobuz request initialises Qobuz, bounded, and says so if it
     * cannot.
     */
    setupWebServer();
    console.log(signale.info('Web interface ready - authentication only required for downloads'));
    providers.warmUpOptional();
    return;
  }

  if (options.setArl) {
    const configPath = conf.set('cookies.arl', options.setArl);
    console.log(signale.info('cookies.arl set to --> ' + options.setArl));
    console.log(signale.note(configPath));
    process.exit();
  }

  if (options.qobuz) {
    await initQobuzForSearch();
    await initQobuzForDownload();
  } else {
    await initDeezerForDownload();
  }

  const saveLayout: any = conf.get('saveLayout');
  if (options.inputFile) {
    const lines = readFileSync(options.inputFile, 'utf-8').split(/\r?\n/);
    for await (const line of lines) {
      if (line && line.match(urlRegex)) {
        console.log(signale.info('Starting download: ' + line));
        if (options.qobuz) {
          await startQobuzDownload(saveLayout, line.trim(), true);
        } else {
          await startDownload(saveLayout, line.trim(), true);
        }
      }
    }
  } else {
    if (options.qobuz) {
      startQobuzDownload(saveLayout, options.url, false);
    } else {
      startDownload(saveLayout, options.url, false);
    }
  }
};

if (options.update) {
  autoUpdater(pkg).catch((err) => {
    console.error(signale.error(err.message));
    process.exit(1);
  });
} else {
  updateCheck(pkg);

  initApp().catch((err) => {
    console.error(signale.error(err.message));
    process.exit(1);
  });
}
