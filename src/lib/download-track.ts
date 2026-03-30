import got from 'got';
import stream from 'stream';
import {existsSync, mkdirSync, writeFileSync, createWriteStream, readFileSync, statSync, unlinkSync} from 'fs';
import {promisify} from 'util';
import {dirname, isAbsolute, join, resolve} from 'path';
import {deezer} from '../core';
import logUpdate from 'log-update';
import chalk from 'chalk';
import signale from '../lib/signale';
import {saveLayout} from './util';
import type {trackType} from '../core/deezer/types';
import {GeoBlocked} from '../core/deezer/lib/get-url';
import Config from './config';
import {terminalProgress} from './terminal-progress';

const pipeline = promisify(stream.pipeline);
const simulate = process.env.SIMULATE;
const config = new Config();

interface downloadTrackProps {
  track: trackType;
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
  deezerDownloadCover?: boolean;
  progressKey?: string;
}

const downloadedAlbumCovers = new Set<string>();
let progressSequence = 0;

const buildProgressIndex = (track: trackType, totalTracks: number) => {
  const position = track.TRACK_POSITION || track.TRACK_NUMBER;
  const width = totalTracks >= 100 ? 3 : 2;
  return position ? `${String(position).padStart(width, '0')}/${String(totalTracks).padStart(width, '0')}` : '--';
};

async function downloadAlbumCover(track: trackType, coverSize: number, savePath: string) {
  if (downloadedAlbumCovers.has(track.ALB_TITLE)) {
    return;
  }

  // Define the safeFileName function if it's not imported
  const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*]+/g, '_').replace(/(^\s+|\s+$)|(^\.+|\.+$)/g, '');

  const coverArtUrl = `https://e-cdns-images.dzcdn.net/images/cover/${track.ALB_PICTURE}/${coverSize}x${coverSize}-000000-80-0-0.jpg`;
  const coverArtDirectory = dirname(savePath);
  const coverArtFileName = `${safeFileName(track.ALB_TITLE)}.jpg`;
  const coverArtPath = join(coverArtDirectory, coverArtFileName);

  if (!existsSync(coverArtDirectory)) {
    mkdirSync(coverArtDirectory, {recursive: true});
  }

  if (!existsSync(coverArtPath)) {
    try {
      const response = await got(coverArtUrl, {responseType: 'buffer'});
      writeFileSync(coverArtPath, response.body);
      downloadedAlbumCovers.add(track.ALB_TITLE); // Add to cache
    } catch (err) {
      console.error(`Failed to download cover art for '${track.ALB_TITLE}':`, err);
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
  deezerDownloadCover,
  progressKey = `deezer-${track.SNG_ID}-${++progressSequence}`,
}: downloadTrackProps): Promise<string | undefined> => {
  const richProgress = terminalProgress.isEnabled();
  const progressLabel = track.SNG_TITLE;
  const progressIndex = buildProgressIndex(track, totalTracks);
  if (richProgress) {
    terminalProgress.start(progressKey, progressLabel, 1, track.ART_NAME, progressIndex);
  } else {
    logUpdate(signale.pending(track.SNG_TITLE + ' by ' + track.ART_NAME + ' from ' + track.ALB_TITLE));
  }
  try {
    let ext = '.mp3',
      fileSize = 0,
      downloaded = 0,
      coverSize = 500;
    switch (quality) {
      case 1:
      case '1':
      case '128':
      case 'MP3_128':
      case '128kbps':
        quality = 1;
        fileSize = Number(track.FILESIZE_MP3_128);
        coverSize = coverSizes['128'];
        break;
      case 9:
      case '9':
      case 'flac':
      case 'Flac':
      case 'FLAC':
        quality = 9;
        ext = '.flac';
        fileSize = Number(track.FILESIZE_FLAC);
        coverSize = coverSizes['flac'];
        break;
      default:
        quality = 3;
        fileSize = Number(track.FILESIZE_MP3_320);
        coverSize = coverSizes['320'];
    }

    const qobuzDownloadCover = false;

    const safeFileName = (name: string) => {
      return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/(^\s+|\s+$)|(^\.+|\.+$)/g, '');
    };

    const savePath =
      saveLayout({
        track,
        album: info,
        path,
        trackNumber,
        qobuzDownloadCover: qobuzDownloadCover,
        minimumIntegerDigits: totalTracks >= 100 ? 3 : 2,
      }) + ext;
    if (existsSync(savePath)) {
      if (richProgress) {
        terminalProgress.complete(progressKey, 'SKIP');
      } else {
        logUpdate(signale.info(`Skipped "${track.SNG_TITLE}", track already exists.`));
        logUpdate.done();
        logUpdate(signale.note(savePath));
        logUpdate.done();
      }
      return savePath;
    }

    const deezerDownloadCover = config.get('deezerDownloadCover', false);
    if (deezerDownloadCover) {
      await downloadAlbumCover(track, coverSize, savePath);
    }

    let trackData;
    try {
      trackData = await deezer.getTrackDownloadUrl(track, quality);
    } catch (err) {
      if (!(err instanceof GeoBlocked) || !track.FALLBACK) {
        throw err;
      }
    }

    if (!trackData) {
      if (fallbackTrack && track.FALLBACK && !isFallback && track.ART_ID === track.FALLBACK.ART_ID) {
        const {FALLBACK, ...CURRENT_TRACK} = track;
        return await downloadTrack({
          track: {...CURRENT_TRACK, ...FALLBACK},
          quality,
          info,
          coverSizes,
          path,
          totalTracks,
          trackNumber,
          fallbackTrack: false,
          isFallback: true,
          message,
          progressKey,
        });
      } else if (fallbackQuality && quality !== 1) {
        return await downloadTrack({
          track,
          quality: quality === 9 ? 3 : 1,
          info,
          coverSizes,
          path,
          totalTracks,
          trackNumber,
          fallbackTrack,
          isFallback,
          isQualityFallback: true,
          message,
          progressKey,
        });
      }
      if (richProgress) {
        terminalProgress.complete(progressKey, 'SKIP');
      } else {
        logUpdate(signale.warn(`Skipped "${track.SNG_TITLE}", track not available.`));
        logUpdate.done();
      }
      return;
    }

    const headers: {[key: string]: string} = {};
    const projectRoot = process.cwd();
    const configuredTempDirValue = config.get('tempDirectory', 'temp');
    const configuredTempDir = typeof configuredTempDirValue === 'string' ? configuredTempDirValue : 'temp';
    const tempFolderPath = isAbsolute(configuredTempDir) ? configuredTempDir : resolve(projectRoot, configuredTempDir);

    if (!existsSync(tempFolderPath)) {
      mkdirSync(tempFolderPath, {recursive: true});
    }
    const tmpfile = join(
      tempFolderPath,
      `elixium_${quality}_${track.SNG_ID}_${simulate ? 'simulate' : track.MD5_ORIGIN}`,
    );
    if (simulate) {
      coverSize = 56;
      headers.range = 'bytes=0-1023';
    } else if (existsSync(tmpfile)) {
      const tmpfilestat = statSync(tmpfile);
      downloaded = tmpfilestat.size;
      headers.range = 'bytes=' + tmpfilestat.size + '-';
    }

    fileSize = trackData.fileSize;
    if (richProgress) {
      terminalProgress.start(progressKey, progressLabel, fileSize, track.ART_NAME, progressIndex);
      terminalProgress.update(progressKey, downloaded, {stage: 'DOWN'});
    }
    let transferredLast = downloaded;
    let transferredClock = Date.now();
    await pipeline(
      got.stream(trackData.trackUrl, {responseType: 'buffer', headers}).on('downloadProgress', ({transferred}) => {
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
            logUpdate(signale.info(`Downloading ${track.SNG_TITLE} ${message}`));
          }
        }
      }),
      createWriteStream(tmpfile, {flags: 'a', autoClose: true}),
    );

    let outFile;
    if (trackData.isEncrypted) {
      if (richProgress) {
        terminalProgress.update(progressKey, fileSize, {stage: 'DECRYPT'});
      } else {
        logUpdate(signale.pending('Decrypting ' + track.SNG_TITLE + ' by ' + track.ART_NAME));
      }
      outFile = deezer.decryptDownload(readFileSync(tmpfile), track.SNG_ID);
    } else {
      outFile = readFileSync(tmpfile);
    }

    if (richProgress) {
      terminalProgress.update(progressKey, fileSize, {stage: 'TAG'});
    } else {
      logUpdate(signale.pending('Tagging ' + track.SNG_TITLE + ' by ' + track.ART_NAME));
    }
    const trackWithMetadata = await deezer.addTrackTags(outFile, track, coverSize);

    // Delete temporary file now
    unlinkSync(tmpfile);

    if (richProgress) {
      terminalProgress.update(progressKey, fileSize, {stage: 'SAVE'});
    } else {
      logUpdate(signale.pending('Saving ' + track.SNG_TITLE + ' by ' + track.ART_NAME));
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
      logUpdate(
        signale.success(`${isFallback ? chalk.yellow('[Fallback] ') : ''}${track.SNG_TITLE} by ${track.ART_NAME}`),
      );
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
      terminalProgress.log(signale.error(track.SNG_TITLE));
      terminalProgress.log(signale.note(err.message));
    } else {
      logUpdate(signale.error(track.SNG_TITLE));
      logUpdate.done();
      logUpdate(signale.note(err.message));
      logUpdate.done();
    }
  }
};

export default downloadTrack;
