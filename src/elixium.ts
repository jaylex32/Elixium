#!/usr/bin/env node

import {readFileSync, existsSync} from 'fs';
import {deezer, qobuz} from './core';
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
import {APP_BRAND, APP_COMMAND, DEFAULT_CONFIG_FILE} from './app/brand';
import {createCatalogSearch} from './app/catalog-search';
import {createCliDownloads} from './app/cli-downloads';
import {createExplorer} from './app/explorer';
import {createSessionQueue} from './app/session-queue';
import {createServiceRuntime} from './app/service-runtime';
import {createDownloadQueueRuntime} from './app/download-queue-runtime';
import {createWebData} from './app/web-data';
import {createWebDownloads} from './app/web-downloads';
import {registerWebRestRoutes} from './app/web-rest';
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

// Web server imports
import express from 'express';
import {createServer} from 'http';
import {Server as SocketIOServer} from 'socket.io';
import cors from 'cors';

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

// Helper function to validate and normalize quality based on service
const normalizeQuality = (quality: string, service: string): string => {
  if (service === 'deezer') {
    const validDeezerQualities = ['128', '320', 'flac'];
    if (!validDeezerQualities.includes(quality)) {
      console.log(signale.warn(`Invalid Deezer quality "${quality}". Using 320 as default.`));
      return '320';
    }
    return quality;
  } else if (service === 'qobuz') {
    const validQobuzQualities = ['320kbps', '44khz', '96khz', '192khz'];
    if (!validQobuzQualities.includes(quality)) {
      // Try to map common quality names to Qobuz format
      const qualityMap: {[key: string]: string} = {
        '320': '320kbps',
        cd: '44khz',
        hifi: '96khz',
        studio: '192khz',
        flac: '44khz',
      };

      const normalizedQuality = qualityMap[quality.toLowerCase()] || '320kbps';
      console.log(signale.warn(`Invalid Qobuz quality "${quality}". Using ${normalizedQuality} as default.`));
      return normalizedQuality;
    }
    return quality;
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
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  app.use(cors());
  app.use(express.json());

  const staticRoots = [
    path.join(process.cwd(), 'public'),
    path.join(__dirname, 'public'),
    path.join(__dirname, '..', '..', 'public'),
  ].filter((candidate, index, list) => list.indexOf(candidate) === index && existsSync(candidate));

  const indexHtmlPath = staticRoots
    .map((rootDir) => path.join(rootDir, 'index.html'))
    .find((candidate) => existsSync(candidate));

  app.get('/', (req, res) => {
    try {
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

  staticRoots.forEach((rootDir) => {
    app.use(express.static(rootDir));
  });
  registerWebRestRoutes({
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
  });

  // Socket.IO handlers
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    registerCatalogSocketHandlers({
      socket,
      deezer,
      qobuz,
      performDeezerSearch,
      performQobuzSearch,
      makeHttpRequest,
      ensureQobuzSearchReady: () => initQobuzForSearch(),
      parseToQobuz,
      parseDeezerUrl: parseInfo,
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
      ensureQobuzSearchReady: () => initQobuzForSearch(),
      ensureDeezerDownloadReady: () => initDeezerForDownload(),
    });

    registerDirectDownloadSocketHandler({
      socket,
      parseToQobuz,
      parseDeezerUrl: parseInfo,
      ensureQobuzSearchReady: () => initQobuzForSearch(),
      ensureQobuzDownloadReady: () => initQobuzForDownload(),
      ensureDeezerDownloadReady: () => initDeezerForDownload(),
      shouldUseVariousArtists,
      downloadQobuzTracks,
      downloadDeezerTracks,
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

  const port = parseInt(options.port);
  server.listen(port, () => {
    console.log(signale.success(`Web interface available at http://localhost:${port}`));
    console.log(signale.info('Open this URL in your browser to use the GUI'));
  });

  return server;
};

const {performDeezerSearch, performQobuzSearch} = createCatalogSearch({
  deezer,
  qobuz,
  ensureQobuzSearchReady: () => initQobuzForSearch(),
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

const {downloadQobuzTracks, downloadDeezerTracks} = createWebDownloads({
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
  ensureDeezerDownloadReady: () => initDeezerForDownload(),
  ensureQobuzSearchReady: () => initQobuzForSearch(),
  toStandardTrack,
  getQobuzConfig,
});

const {startDownloadProcess} = createDownloadQueueRuntime({
  conf,
  qobuz,
  parseDeezerUrl: parseInfo,
  parseQobuzUrl,
  deezerDownloadTrack: downloadTrack,
  qobuzDownloadTrack: qdlt,
  initDeezerForDownload: () => initDeezerForDownload(),
  initQobuzForDownload: () => initQobuzForDownload(),
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
  ensureQobuzSearchReady: () => initQobuzForSearch(),
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
      await initQobuzForDownload();
      const qobuzQuality = normalizeQuality(((conf as any).get?.('quality.qobuz') || '44khz') as string, 'qobuz');
      const qobuzSettings = {
        qobuzPath: (conf as any).get?.('paths.qobuz') || './Music/Qobuz',
        qobuzDownloadCover: (conf as any).get?.('qobuzDownloadCover'),
      };
      const broadcastSocket = io
        ? {
            emit: (event: string, payload: any) => {
              io.emit(event, payload);
            },
          }
        : undefined;
      await startDownloadProcess(queueItems, qobuzQuality, 'qobuz', qobuzSettings, broadcastSocket as any);
    }
  },
  broadcastState: (state) => {
    if (!io) return;
    io.emit('watchlistState', state);
    io.emit('monitorSchedules', qobuzWatchlist.getMonitorSchedules());
    io.emit('monitorHistory', {items: qobuzWatchlist.getMonitorHistory()});
  },
});

const {initDeezerForSearch, initDeezerForDownload, initQobuzForSearch, initQobuzForDownload} = createServiceRuntime({
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

const initApp = async () => {
  if (options.web) {
    console.log(signale.info('Initializing services for web interface...'));

    await initDeezerForSearch();

    try {
      await initQobuzForSearch();
    } catch (error: any) {
      console.log(signale.warn('Qobuz search initialization failed: ' + error.message));
      console.log(signale.note('Qobuz search may not work, but Deezer will'));
    }

    console.log(signale.info('Web interface ready - authentication only required for downloads'));

    setupWebServer();
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
