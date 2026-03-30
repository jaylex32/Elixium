import test from 'ava';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';
import {createDownloadQueueRuntime} from '../src/app/download-queue-runtime';

interface RuntimeState {
  isDownloading: boolean;
  currentDownloadQueue: any[];
  downloadProgress: number;
}

const createConfig = (overrides?: Record<string, any>) => {
  const defaults: Record<string, any> = {
    coverSize: 1200,
    trackNumber: true,
    fallbackTrack: true,
    fallbackQuality: true,
    qobuzDownloadCover: false,
    saveLayout: {
      track: '{ALB_TITLE}/{SNG_TITLE}',
      album: '{ALB_TITLE}/{SNG_TITLE}',
      playlist: 'Playlist/{TITLE}/{SNG_TITLE}',
      artist: '{ALB_TITLE}/{SNG_TITLE}',
      'qobuz-track': '{album.title}/{title}',
      'qobuz-album': '{album.title}/{title}',
      'qobuz-playlist': 'Playlist/{list_title}/{title}',
    },
    'paths.deezer': './Music/Deezer',
    'paths.qobuz': './Music/Qobuz',
    'playlist.createPlaylist': false,
    'playlist.resolveFullPath': false,
  };

  return {
    get(key: string, fallback?: any) {
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
        return overrides[key];
      }
      if (Object.prototype.hasOwnProperty.call(defaults, key)) {
        return defaults[key];
      }
      return fallback;
    },
  };
};

const createRuntimeHarness = (options?: {
  confOverrides?: Record<string, any>;
  deezerDownloadTrack?: any;
  qobuzDownloadTrack?: any;
}) => {
  const state: RuntimeState = {
    isDownloading: false,
    currentDownloadQueue: [],
    downloadProgress: 0,
  };
  const activeDownloads = new Map();
  const socketEvents: Array<{event: string; payload: any}> = [];

  const runtime = createDownloadQueueRuntime({
    conf: createConfig(options?.confOverrides),
    qobuz: {
      getArtistAlbums: async () => ({albums: {items: []}}),
    },
    parseDeezerUrl: async () => ({tracks: [], linkinfo: {}}),
    parseQobuzUrl: async () => ({tracks: [], linkinfo: {}, info: {}}),
    deezerDownloadTrack:
      options?.deezerDownloadTrack ||
      (async () => {
        throw new Error('deezerDownloadTrack not stubbed');
      }),
    qobuzDownloadTrack:
      options?.qobuzDownloadTrack ||
      (async () => {
        throw new Error('qobuzDownloadTrack not stubbed');
      }),
    initDeezerForDownload: async () => undefined,
    initQobuzForDownload: async () => undefined,
    shouldUseVariousArtists: () => false,
    commonPath: (paths: string[]) => (paths.length > 0 ? dirname(paths[0]) : tmpdir()),
    sanitizeFilename: (value: string) => value,
    trueCasePathSync: (value: string) => value,
    activeDownloads,
    getIsDeezerDownloadReady: () => false,
    getIsQobuzDownloadReady: () => false,
    setIsDownloading: (value: boolean) => {
      state.isDownloading = value;
    },
    setCurrentDownloadQueue: (value: any[]) => {
      state.currentDownloadQueue = value;
    },
    setDownloadProgress: (value: number) => {
      state.downloadProgress = value;
    },
    clearActiveDownloads: () => {
      activeDownloads.clear();
    },
  });

  const socket = {
    emit(event: string, payload: any) {
      socketEvents.push({event, payload});
    },
  };

  return {runtime, state, activeDownloads, socket, socketEvents};
};

test('queue runtime completes a Deezer track item and resets session state', async (t) => {
  const {runtime, state, activeDownloads, socket, socketEvents} = createRuntimeHarness({
    deezerDownloadTrack: async () => 'C:\\downloads\\song-one.mp3',
  });

  await runtime.startDownloadProcess(
    [{id: 'track-1', title: 'Song One', type: 'track', rawData: {id: 'track-1'}}],
    '320',
    'deezer',
    {deezerPath: 'C:\\downloads'},
    socket,
  );

  t.false(state.isDownloading);
  t.deepEqual(state.currentDownloadQueue, []);
  t.is(state.downloadProgress, 0);
  t.is(activeDownloads.size, 0);

  const completedEvent = socketEvents.find(
    (entry) => entry.event === 'downloadProgress' && entry.payload.itemStatus === 'completed',
  );
  t.truthy(completedEvent);

  const completePayload = socketEvents.find((entry) => entry.event === 'downloadComplete')?.payload;
  t.truthy(completePayload);
  t.is(completePayload.count, 1);
  t.deepEqual(completePayload.files, ['C:\\downloads\\song-one.mp3']);
});

test('queue runtime emits per-item error state and still completes the session', async (t) => {
  const {runtime, state, activeDownloads, socket, socketEvents} = createRuntimeHarness({
    deezerDownloadTrack: async () => {
      throw new Error('boom');
    },
  });

  await runtime.startDownloadProcess(
    [{id: 'track-err', title: 'Broken Song', type: 'track', rawData: {id: 'track-err'}}],
    '320',
    'deezer',
    {deezerPath: 'C:\\downloads'},
    socket,
  );

  t.false(state.isDownloading);
  t.deepEqual(state.currentDownloadQueue, []);
  t.is(state.downloadProgress, 0);
  t.is(activeDownloads.size, 0);

  const itemError = socketEvents.find(
    (entry) => entry.event === 'downloadProgress' && entry.payload.itemStatus === 'error',
  );
  t.truthy(itemError);
  t.is(itemError?.payload.itemId, 'track-err');
  t.is(itemError?.payload.errorMessage, 'boom');

  const completePayload = socketEvents.find((entry) => entry.event === 'downloadComplete')?.payload;
  t.truthy(completePayload);
  t.is(completePayload.count, 0);
});

test('queue runtime creates a playlist file when playlist creation is enabled', async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'elixium-queue-runtime-'));
  const previousSimulate = process.env.SIMULATE;
  delete process.env.SIMULATE;
  t.teardown(() => {
    if (previousSimulate === undefined) {
      delete process.env.SIMULATE;
    } else {
      process.env.SIMULATE = previousSimulate;
    }
    rmSync(tempRoot, {recursive: true, force: true});
  });

  let sequence = 0;
  const {runtime, socket, socketEvents} = createRuntimeHarness({
    confOverrides: {
      'playlist.createPlaylist': true,
    },
    deezerDownloadTrack: async () => {
      sequence += 1;
      const savedPath = join(tempRoot, `track-${sequence}.mp3`);
      writeFileSync(savedPath, `track-${sequence}`);
      return savedPath;
    },
  });

  await runtime.startDownloadProcess(
    [
      {id: 'track-1', title: 'Song One', type: 'track', rawData: {id: 'track-1'}},
      {id: 'track-2', title: 'Song Two', type: 'track', rawData: {id: 'track-2'}},
    ],
    '320',
    'deezer',
    {deezerPath: tempRoot, resolveFullPath: true},
    socket,
  );

  const playlistEvent = socketEvents.find((entry) => entry.event === 'playlistCreated');
  t.truthy(playlistEvent);
  const playlistPath = playlistEvent?.payload.path as string;
  t.true(existsSync(playlistPath));

  const playlistContent = readFileSync(playlistPath, 'utf8');
  t.true(playlistContent.includes('track-1.mp3'));
  t.true(playlistContent.includes('track-2.mp3'));
});
