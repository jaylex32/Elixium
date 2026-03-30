import {EOL} from 'os';
import {writeFileSync} from 'fs';
import {dirname, join, resolve, sep} from 'path';
import prompts from 'prompts';
import PQueue from 'p-queue';
import chalk from 'chalk';
import {trueCasePathSync} from 'true-case-path';
import {parseInfo} from '../core';
import type {trackType} from '../core/deezer/types';
import type {trackType as QobuzTrackType} from '../core/qobuz/types';
import qdlt from '../lib/download-qobuz-track';
import {parseToQobuz} from '../lib/to-qobuz-parser';
import signale from '../lib/signale';
import downloadTrack from '../lib/download-track';
import Config from '../lib/config';
import {commonPath, formatSecondsReadable, sanitizeFilename} from '../lib/util';
import {terminalProgress} from '../lib/terminal-progress';
import type {SessionQueueItem} from './interactive-types';

type CliOptions = {
  quality?: string;
  headless?: boolean;
  output?: string;
  createPlaylist?: boolean;
  resolveFullPath?: boolean;
};

interface CliDownloadsDependencies {
  options: CliOptions;
  conf: Config;
  queue: PQueue;
  urlRegex: RegExp;
  normalizeQuality: (quality: string, service: string) => string;
  collectSessionQueue: (
    service: 'deezer' | 'qobuz',
    promptMessage: string,
    resolver: (query: string) => Promise<SessionQueueItem>,
    supportsSpotify?: boolean,
  ) => Promise<SessionQueueItem[]>;
  resolveDeezerQueueItem: (query: string) => Promise<SessionQueueItem>;
  resolveQobuzQueueItem: (query: string) => Promise<SessionQueueItem>;
  promptGroupedSearchSelection: (service: 'deezer' | 'qobuz', query: string) => Promise<any>;
  promptDeezerArtistAlbumSelection: (artist: any) => Promise<SessionQueueItem>;
  promptQobuzArtistAlbumSelection: (artist: any) => Promise<SessionQueueItem>;
  promptTrackSubsetSelection: <T>(
    preview: any,
    tracks: T[],
    buildChoice: (track: T) => {title: string; value: T; description?: string},
  ) => Promise<T[]>;
  buildDeezerQueuePreview: (parsedData: any) => any;
  buildQobuzQueuePreview: (parsedData: any) => any;
  describeQobuzTrack: (track: QobuzTrackType) => string;
  onCancel: () => void;
}

export const createCliDownloads = ({
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
}: CliDownloadsDependencies) => {
  const startDownload = async (saveLayout: any, url: string, skipPrompt: boolean): Promise<void> => {
    try {
      if (!options.quality) {
        const {musicQuality} = await prompts(
          {
            type: 'select',
            name: 'musicQuality',
            message: 'Select music quality:',
            choices: [
              {title: 'MP3  - 128 kbps', value: '128'},
              {title: 'MP3  - 320 kbps', value: '320'},
              {title: 'FLAC - 1411 kbps', value: 'flac'},
            ],
            initial: 1,
          },
          {onCancel},
        );
        options.quality = musicQuality;
      }

      if (!url) {
        const runDeezerExplorerSession = async (): Promise<void> => {
          const queueItems = await collectSessionQueue(
            'deezer',
            'Search Deezer or paste a URL:',
            resolveDeezerQueueItem,
          );
          for (const [index, item] of queueItems.entries()) {
            const itemsLeft = queueItems.length - index - 1;
            console.log(
              signale.info(
                `Starting queue item ${index + 1}/${queueItems.length}: ${item.label}${
                  itemsLeft ? ` (${itemsLeft} left)` : ''
                }`,
              ),
            );
            await startDownload(saveLayout, item.url, true);
          }
          console.log(signale.success('Deezer queue complete. Returning to explorer.'));
          await runDeezerExplorerSession();
        };

        await runDeezerExplorerSession();
        return;
      }

      let searchData: {
        info: {type: 'track'; id: string};
        linktype: 'track';
        linkinfo: Record<string, unknown>;
        tracks: trackType[];
      } | null = null;

      if (!url.match(urlRegex)) {
        if (options.headless) {
          throw new Error('Please provide a valid URL. Unknown URL: ' + url);
        }

        const selectedResult = await promptGroupedSearchSelection('deezer', url);

        if (selectedResult.type === 'artist') {
          url = (await promptDeezerArtistAlbumSelection(selectedResult)).url;
        } else if (selectedResult.type === 'album') {
          url = `https://deezer.com/us/album/${selectedResult.id}`;
        } else if (selectedResult.type === 'playlist') {
          url = `https://deezer.com/us/playlist/${selectedResult.id}`;
        } else {
          const selectedTrack = selectedResult.rawData as trackType;
          if (selectedTrack.VERSION && !selectedTrack.SNG_TITLE.includes(selectedTrack.VERSION)) {
            selectedTrack.SNG_TITLE += ' ' + selectedTrack.VERSION;
          }
          searchData = {
            info: {type: 'track', id: String(selectedTrack.SNG_ID)},
            linktype: 'track',
            linkinfo: {} as Record<string, unknown>,
            tracks: [selectedTrack],
          };
        }
      } else if (url.match(/playlist|artist/)) {
        console.log(signale.info('Fetching data. Please hold on.'));
      }

      const data = searchData ? searchData : await parseInfo(url);

      if (!options.headless && data.tracks.length > 1) {
        data.tracks = await promptTrackSubsetSelection(buildDeezerQueuePreview(data), data.tracks, (t) => ({
          title: t.SNG_TITLE,
          value: t,
          description: `Artist: ${t.ART_NAME}\nAlbum: ${t.ALB_TITLE}\nDuration: ${formatSecondsReadable(
            Number(t.DURATION),
          )}`,
        }));
      }

      if (data && data.tracks.length > 0) {
        console.log(signale.info(`Proceeding to download ${data.tracks.length} tracks. Be patient.`));
        if (data.linktype === 'playlist') {
          const filteredTracks = data.tracks.filter(
            (item, index, self) => index === self.findIndex((t) => t.SNG_ID === item.SNG_ID),
          );
          const duplicateTracks = data.tracks.length - filteredTracks.length;
          if (duplicateTracks > 0) {
            data.tracks = filteredTracks
              .sort((a: any, b: any) => a.TRACK_POSITION - b.TRACK_POSITION)
              .map((t, i) => {
                t.TRACK_POSITION = i + 1;
                return t;
              });
            console.log(
              signale.warn(`Removed ${duplicateTracks} duplicate ${duplicateTracks > 1 ? 'tracks' : 'track'}.`),
            );
          }
        }

        const coverSizes = conf.get('coverSize') as any;
        const trackNumber = conf.get('trackNumber', true) as boolean;
        const fallbackTrack = conf.get('fallbackTrack', true) as boolean;
        const fallbackQuality = conf.get('fallbackQuality', true) as boolean;
        const resolveFullPath = Boolean(options.resolveFullPath ?? conf.get('playlist.resolveFullPath'));
        const selectedQuality = options.quality || '320';
        const savedFiles: string[] = [];
        let m3u8: string[] = [];

        await queue.addAll(
          data.tracks.map((track, index) => {
            return async () => {
              const percentage = ((index + 1) / data.tracks.length) * 100;
              const formattedPercentage = percentage.toFixed(2);

              const savedPath = await downloadTrack({
                track,
                quality: selectedQuality,
                info: data.linkinfo,
                coverSizes,
                path: options.output ? options.output : saveLayout[data.linktype],
                totalTracks: data.tracks.length,
                trackNumber,
                fallbackTrack,
                fallbackQuality,
                message: `(${formattedPercentage}%)`,
              });

              if (savedPath) {
                const absolutePath = resolve(savedPath);
                if (!terminalProgress.isEnabled()) {
                  terminalProgress.log(chalk.green('✔ Path:') + ` ${absolutePath}`);
                }

                m3u8.push(resolve(process.env.SIMULATE ? savedPath : trueCasePathSync(savedPath)));
                savedFiles.push(savedPath);
              }
            };
          }),
        );

        if (savedFiles.length > 0) {
          const uniqueDirs = new Set(savedFiles.map((filePath) => dirname(resolve(filePath))));

          terminalProgress.log(signale.info('Saved in:'));
          uniqueDirs.forEach((dirPath) => {
            terminalProgress.log(chalk.green(dirPath));
          });
        }

        if ((options.createPlaylist || data.linktype === 'playlist') && !process.env.SIMULATE && m3u8.length > 1) {
          const playlistDir = commonPath([...new Set(savedFiles.map(dirname))]);
          const playlistFile = join(
            playlistDir,
            sanitizeFilename((data.linkinfo as any).TITLE || (data.linkinfo as any).ALB_TITLE),
          );
          if (!resolveFullPath) {
            const resolvedPlaylistDir = resolve(playlistDir) + sep;
            m3u8 = m3u8.map((file) => file.replace(resolvedPlaylistDir, ''));
          }
          writeFileSync(playlistFile + '.m3u8', '#EXTM3U' + EOL + m3u8.join(EOL), {encoding: 'utf-8'});
        }
      } else {
        console.log(signale.info('No items to download!'));
      }
    } catch (err: any) {
      console.error(signale.error(err.message));
    }

    if (!options.headless && !skipPrompt) {
      await startDownload(saveLayout, '', skipPrompt);
    }
  };

  const startQobuzDownload = async (saveLayout: any, url: string, skipPrompt: boolean): Promise<void> => {
    try {
      if (!options.quality) {
        const {musicQuality} = await prompts(
          {
            type: 'select',
            name: 'musicQuality',
            message: 'Select maximum music quality:',
            choices: [
              {title: 'MP3  - 320 kbps', value: '320kbps'},
              {title: 'FLAC - CD, 16-bit/44.1 kHz', value: '44khz'},
              {title: 'FLAC - HiFi, 24-bit/96 kHz', value: '96khz'},
              {title: 'FLAC - HiFi, 24-bit/192 kHz', value: '192khz'},
            ],
            initial: 1,
          },
          {onCancel},
        );
        options.quality = musicQuality;
      }

      options.quality = normalizeQuality(options.quality || '320kbps', 'qobuz');

      if (!url) {
        const runQobuzExplorerSession = async (): Promise<void> => {
          const queueItems = await collectSessionQueue(
            'qobuz',
            'Search Qobuz or paste a URL:',
            resolveQobuzQueueItem,
            true,
          );
          for (const [index, item] of queueItems.entries()) {
            const itemsLeft = queueItems.length - index - 1;
            console.log(
              signale.info(
                `Starting queue item ${index + 1}/${queueItems.length}: ${item.label}${
                  itemsLeft ? ` (${itemsLeft} left)` : ''
                }`,
              ),
            );
            await startQobuzDownload(saveLayout, item.url, true);
          }
          console.log(signale.success('Qobuz queue complete. Returning to explorer.'));
          await runQobuzExplorerSession();
        };

        await runQobuzExplorerSession();
        return;
      }

      let data: {
        info: {type: string; id: string};
        linktype: string;
        linkinfo: any;
        tracks: QobuzTrackType[];
      };

      let searchData: typeof data | null = null;

      if (!url.match(urlRegex)) {
        if (options.headless) {
          throw new Error('Please provide a valid URL. Unknown URL: ' + url);
        } else if (url.startsWith('spotify:') || url.includes('spotify.com')) {
          console.log(signale.info('Converting Spotify content to Qobuz...'));
          searchData = await parseToQobuz(url);

          if (!options.headless && searchData.tracks.length > 1) {
            searchData.tracks = await promptTrackSubsetSelection(
              buildQobuzQueuePreview(searchData),
              searchData.tracks,
              (t) => ({
                title: t.title,
                value: t,
                description: describeQobuzTrack(t),
              }),
            );
          }
        } else {
          const selectedResult = await promptGroupedSearchSelection('qobuz', url);

          if (selectedResult.type === 'artist') {
            url = (await promptQobuzArtistAlbumSelection(selectedResult)).url;
          } else if (selectedResult.type === 'album') {
            url = `https://play.qobuz.com/album/${selectedResult.id}`;
          } else if (selectedResult.type === 'playlist') {
            url = `https://play.qobuz.com/playlist/${selectedResult.id}`;
          } else {
            const selectedTrack = selectedResult.rawData as QobuzTrackType;
            if (selectedTrack.version && !selectedTrack.title.includes(selectedTrack.version)) {
              selectedTrack.title += ` (${selectedTrack.version})`;
            }
            searchData = {
              info: {type: 'qobuz-track', id: String(selectedTrack.id)},
              linktype: 'qobuz-track',
              linkinfo: {} as Record<string, unknown>,
              tracks: [selectedTrack],
            };
          }
        }
      }

      if (searchData) {
        data = searchData;
      } else {
        data = await parseToQobuz(url);
      }

      if (!options.headless && data.tracks.length > 1 && !searchData) {
        data.tracks = await promptTrackSubsetSelection(buildQobuzQueuePreview(data), data.tracks, (t) => ({
          title: t.title,
          value: t,
          description: describeQobuzTrack(t),
        }));
      }

      if (data && data.tracks.length > 0) {
        console.log(signale.info(`Proceeding download of ${data.tracks.length} tracks. Be patient.`));
        if (data.linktype === 'qobuz-playlist' || data.linktype === 'spotify-playlist') {
          const filteredTracks = data.tracks.filter(
            (item, index, self) => index === self.findIndex((t) => t.id === item.id),
          );
          const duplicateTracks = data.tracks.length - filteredTracks.length;
          if (duplicateTracks > 0) {
            data.tracks = filteredTracks
              .sort((a, b) => a.track_number - b.track_number)
              .map((t, i) => {
                t.track_number = i + 1;
                return t;
              });
            console.log(
              signale.warn(`Removed ${duplicateTracks} duplicate ${duplicateTracks > 1 ? 'tracks' : 'track'}.`),
            );
          }
        }

        const resolveFullPath = Boolean(options.resolveFullPath ?? conf.get('playlist.resolveFullPath'));
        const selectedQuality = options.quality || '320kbps';
        const savedFiles: string[] = [];
        let m3u8Local: string[] = [];

        if (data.tracks && data.tracks.length > 0) {
          await queue.addAll(
            data.tracks.map((track, index) => {
              return async () => {
                if (!track || !track.title || typeof track.title !== 'string') {
                  console.error(signale.error(`Error: Invalid track data. Track: ${JSON.stringify(track)}`));
                  return;
                }

                try {
                  const savedPath = await qdlt({
                    track,
                    quality: selectedQuality,
                    info: data.info,
                    coverSizes: conf.get('coverSize') as any,
                    path: options.output ? options.output : saveLayout[data.linktype],
                    totalTracks: data.tracks.length,
                    message: `(${index + 1}/${data.tracks.length})`,
                    album: track.album,
                    qobuzDownloadCover: conf.get('qobuzDownloadCover', false) as boolean,
                    listTitle: data.linkinfo.title || data.linkinfo.name || 'Unknown Playlist',
                  });

                  if (savedPath) {
                    const absolutePath = resolve(savedPath);
                    if (!terminalProgress.isEnabled()) {
                      terminalProgress.log(chalk.green('✔ Path:') + ` ${absolutePath}`);
                    }

                    m3u8Local.push(resolve(process.env.SIMULATE ? savedPath : trueCasePathSync(savedPath)));
                    savedFiles.push(savedPath);
                  }
                } catch (err) {
                  if (err instanceof Error) {
                    console.error(`Error during track download: ${err.message}`);
                  } else {
                    console.error(`Unexpected error: ${JSON.stringify(err)}`);
                  }
                  console.error(`Track data that caused the error: ${JSON.stringify(track, null, 2)}`);
                  throw err;
                }
              };
            }),
          );
        }

        if (savedFiles.length > 0) {
          const uniqueDirectories = new Set(savedFiles.map((filePath) => resolve(dirname(filePath))));
          terminalProgress.log(signale.info('Saved in:'));
          uniqueDirectories.forEach((dir) => {
            terminalProgress.log(chalk.green(dir));
          });
          terminalProgress.log('');
        }

        if (
          (options.createPlaylist || data.linktype === 'qobuz-playlist' || data.linktype === 'spotify-playlist') &&
          !process.env.SIMULATE &&
          m3u8Local.length > 1
        ) {
          const playlistDir = commonPath([...new Set(savedFiles.map(dirname))]);
          const playlistFile = join(
            playlistDir,
            sanitizeFilename((data.linkinfo.name || data.linkinfo.title || 'Untitled Playlist') + '.m3u8'),
          );
          if (!resolveFullPath) {
            const resolvedPlaylistDir = resolve(playlistDir) + sep;
            m3u8Local = m3u8Local.map((file) => file.replace(resolvedPlaylistDir, ''));
          }
          writeFileSync(playlistFile, '#EXTM3U' + EOL + m3u8Local.join(EOL), {encoding: 'utf-8'});
        }
      } else {
        console.log(signale.info('No items to download!'));
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(signale.error(err.message));
      } else {
        console.error(`Unexpected error: ${JSON.stringify(err)}`);
      }
    }

    if (!options.headless && !skipPrompt) {
      await startQobuzDownload(saveLayout, '', skipPrompt);
    }
  };

  return {startDownload, startQobuzDownload};
};
