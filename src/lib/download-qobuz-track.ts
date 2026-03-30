import got from 'got';
import stream from 'stream';
import {existsSync, mkdirSync, writeFileSync, createWriteStream, readFileSync, statSync, unlinkSync} from 'fs';
import {promisify} from 'util';
import {dirname, isAbsolute, join, resolve} from 'path';
import {qobuz} from '../core';
import logUpdate from 'log-update';
import Config from './config';
import chalk from 'chalk';
import signale from '../lib/signale';
import {qobuzSaveLayout} from './util';
import {terminalProgress} from './terminal-progress';

const pipeline = promisify(stream.pipeline);
const simulate = process.env.SIMULATE;
const config = new Config();

interface downloadTrackProps {
  track: qobuz.types.trackType;
  quality: string | number;
  info: {[key: string]: any};
  coverSizes: {
    '128': number;
    '320': number;
    flac: number;
  };
  path: string;
  totalTracks: number;
  trackNumber?: boolean;
  fallbackTrack?: boolean;
  fallbackQuality?: boolean;
  isFallback?: boolean;
  isQualityFallback?: boolean;
  message?: string;
  album?: qobuz.types.albumType | null; // Allow album to be null
  qobuzDownloadCover: boolean;
  listTitle?: string; // Make sure this is included
  progressKey?: string;
}

const downloadedQobuzCovers = new Set<string>();
let progressSequence = 0;

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/(^\s+|\s+$)|(^\.+|\.+$)/g, '');
}

const buildProgressIndex = (track: qobuz.types.trackType, totalTracks: number) => {
  const position = track.track_number || track.media_number;
  const width = totalTracks >= 100 ? 3 : 2;
  return position ? `${String(position).padStart(width, '0')}/${String(totalTracks).padStart(width, '0')}` : '--';
};

async function downloadQobuzCover(album: qobuz.types.albumType, coverSize: number, savePath: string) {
  if (!album || downloadedQobuzCovers.has(album.title)) return;

  const coverArtDirectory = dirname(savePath);
  const coverArtFileName = safeFileName(album.title) + '.jpg';
  const coverArtPath = join(coverArtDirectory, coverArtFileName);

  if (!existsSync(coverArtDirectory)) {
    mkdirSync(coverArtDirectory, {recursive: true});
  }

  if (!existsSync(coverArtPath)) {
    try {
      const coverArtUrl = album.image.large; // Ensure correct URL property
      const response = await got(coverArtUrl, {responseType: 'buffer'});
      writeFileSync(coverArtPath, response.body);
      downloadedQobuzCovers.add(album.title); // Add to cache
    } catch (err) {
      console.error(`Failed to download cover art for '${album.title}':`, err);
    }
  }
}

const downloadTrack = async ({
  track,
  quality,
  info,
  coverSizes,
  path,
  totalTracks,
  trackNumber = true,
  fallbackTrack = true,
  fallbackQuality = true,
  isFallback = false,
  isQualityFallback = false,
  message = '',
  album,
  qobuzDownloadCover,
  listTitle,
  progressKey = `qobuz-${track.id}-${++progressSequence}`,
}: downloadTrackProps): Promise<string | undefined> => {
  const richProgress = terminalProgress.isEnabled();
  const artistName = track.performer?.name || track.album?.artist?.name || 'Unknown Artist';
  const progressLabel = track.title;
  const progressIndex = buildProgressIndex(track, totalTracks);
  if (richProgress) {
    terminalProgress.start(progressKey, progressLabel, 1, artistName, progressIndex);
  } else {
    logUpdate(signale.pending(track.title + ' by ' + artistName + ' from ' + track.album?.title));
  }
  try {
    let ext = '.flac',
      fileSize = 0,
      downloaded = 0,
      coverSize = 600;

    switch (quality) {
      case 5:
      case '5':
      case 'mp3':
      case '320kbps':
        quality = 5;
        ext = '.mp3';
        break;
      case 6:
      case '6':
      case 'cd':
      case '44khz':
        quality = 6;
        break;
      case 7:
      case '7':
      case '96khz':
        quality = 7;
        break;
      default:
        quality = 27;
        break;
    }

    if (track.streamable !== true) {
      if (richProgress) {
        terminalProgress.log(signale.warn(`Track "${track.title}" isn't streamable, downloading`));
      } else {
        logUpdate(signale.warn(`Track "${track.title}" isn't streamable, downloading`));
        logUpdate.done();
      }
    }

    const safeFileName = (name: string) => {
      return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/(^\s+|\s+$)|(^\.+|\.+$)/g, '');
    };

    const savePath =
      qobuzSaveLayout({
        track,
        qobuzDownloadCover: qobuzDownloadCover,
        listTitle: listTitle,
        album: info,
        path,
        trackNumber,
        minimumIntegerDigits: totalTracks >= 100 ? 3 : 2,
      }) + ext;
    if (existsSync(savePath)) {
      if (richProgress) {
        terminalProgress.complete(progressKey, 'SKIP');
      } else {
        logUpdate(signale.info(`Skipped "${track.title}", track already exists.`));
        logUpdate.done();
        logUpdate(signale.note(savePath));
        logUpdate.done();
      }
      return savePath;
    }

    // Conditional album cover download
    if (album && qobuzDownloadCover) {
      // Call the function for cover download
      await downloadQobuzCover(album, coverSize, savePath);
    }

    const trackData = await qobuz.getTrackDownloadUrl(track.id, quality);
    if (!trackData) {
      if (richProgress) {
        terminalProgress.complete(progressKey, 'SKIP');
      } else {
        logUpdate(signale.warn(`Skipped "${track.title}", track not available.`));
        logUpdate.done();
      }
      return;
    }
    if (trackData.format_id !== quality && !fallbackQuality) {
      if (richProgress) {
        terminalProgress.complete(progressKey, 'SKIP');
      } else {
        logUpdate(signale.warn(`Skipped "${track.title}", quality not met.`));
        logUpdate.done();
      }
      return;
    }

    const headers: {[key: string]: string} = {};
    // Get the current working directory (should be the project root if that's where you run the script from)
    const projectRoot = process.cwd();
    const configuredTempDirValue = config.get('tempDirectory', 'temp');
    const configuredTempDir = typeof configuredTempDirValue === 'string' ? configuredTempDirValue : 'temp';
    const tempFolderPath = isAbsolute(configuredTempDir) ? configuredTempDir : resolve(projectRoot, configuredTempDir);

    if (!existsSync(tempFolderPath)) {
      mkdirSync(tempFolderPath, {recursive: true});
    }
    const tmpfile = join(tempFolderPath, `elixium_${quality}_${track.id}_${simulate ? 'simulate' : track.id}`);

    if (simulate) {
      coverSize = 56;
      headers.range = 'bytes=0-1023';
    } else if (existsSync(tmpfile)) {
      const tmpfilestat = statSync(tmpfile);
      downloaded = tmpfilestat.size;
      headers.range = 'bytes=' + tmpfilestat.size + '-';
    }

    fileSize = trackData.file_size;
    if (richProgress) {
      terminalProgress.start(progressKey, progressLabel, fileSize, artistName, progressIndex);
      terminalProgress.update(progressKey, downloaded, {stage: 'DOWN'});
    }
    if (downloaded != fileSize) {
      let transferredLast = downloaded;
      let transferredClock = Date.now();
      await pipeline(
        got.stream(trackData.url, {responseType: 'buffer', headers}).on('downloadProgress', ({transferred}) => {
          // Report download progress
          transferred += downloaded;
          if (transferred - transferredLast > 50000) {
            const now = Date.now();
            const deltaBytes = transferred - transferredLast;
            const deltaTime = Math.max(1, now - transferredClock);
            const bytesPerSecond = (deltaBytes / deltaTime) * 1000;
            const etaSeconds = bytesPerSecond > 0 ? (fileSize - transferred) / bytesPerSecond : 0;
            transferredLast = transferred;
            transferredClock = now;
            if (richProgress) {
              terminalProgress.update(progressKey, transferred, {stage: 'DOWN'});
            } else {
              logUpdate(signale.info(`Downloading ${track.title} ${message}`));
            }
          }
        }),
        createWriteStream(tmpfile, {flags: 'a', autoClose: true}),
      );
    }

    const outFile = readFileSync(tmpfile);

    if (richProgress) {
      terminalProgress.update(progressKey, fileSize, {stage: 'TAG'});
    } else {
      logUpdate(signale.pending('Tagging ' + track.title + ' by ' + artistName));
    }
    const trackWithMetadata = await qobuz.addTrackTags(outFile, track, coverSize);

    // Delete temporary file now
    unlinkSync(tmpfile);

    if (richProgress) {
      terminalProgress.update(progressKey, fileSize, {stage: 'SAVE'});
    } else {
      logUpdate(signale.pending('Saving ' + track.title + ' by ' + artistName));
    }
    if (!simulate) {
      // Create directory if not exists
      const dir = dirname(savePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, {recursive: true});
      }
      // Save file to disk
      writeFileSync(savePath, trackWithMetadata);
    }

    // Print sucess info
    if (richProgress) {
      terminalProgress.complete(progressKey, 'DONE');
    } else {
      logUpdate(signale.success(`${isFallback ? chalk.yellow('[Fallback] ') : ''}${track.title} by ${artistName}`));
      logUpdate.done();
    }
    if (isQualityFallback) {
      if (richProgress) {
        terminalProgress.log(
          signale.note(`Used ${quality === 3 ? '320kbps' : '128kbps'} as other formats were unavailable`),
        );
      } else {
        logUpdate(signale.note(`Used ${quality === 3 ? '320kbps' : '128kbps'} as other formats were unavailable`));
        logUpdate.done();
      }
    }
    return savePath;
  } catch (err: any) {
    if (richProgress) {
      terminalProgress.complete(progressKey, 'FAIL');
      terminalProgress.log(signale.error(track.title));
      terminalProgress.log(signale.note(err.message));
    } else {
      logUpdate(signale.error(track.title));
      logUpdate.done();
      logUpdate(signale.note(err.message));
      logUpdate.done();
    }
  }
};

export default downloadTrack;
