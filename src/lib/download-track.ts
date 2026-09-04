import got from 'got';
import {metadataOptionsFrom, DEFAULT_METADATA_OPTIONS, type MetadataOptions} from './metadata-options';
import stream from 'stream';
import {existsSync, mkdirSync, writeFileSync, createWriteStream, readFileSync, statSync, unlinkSync} from 'fs';
import {applyLyrics, type LyricsOptions} from './lyrics-embed';
import {resolveCoverSize, deezerCoverUrl} from './cover-art';
import {promisify} from 'util';
import {dirname, isAbsolute, join, resolve} from 'path';
import {deezer} from '../core';
import logUpdate from 'log-update';
import chalk from 'chalk';
import signale from '../lib/signale';
import {saveLayout} from './util';
import type {trackType} from '../core/deezer/types';
import {GeoBlocked, WrongLicense} from '../core/deezer/lib/get-url';
import Config from './config';
import {terminalProgress} from './terminal-progress';

const pipeline = promisify(stream.pipeline);
const simulate = process.env.SIMULATE;
const config = new Config();

/**
 * Lyrics preferences, read per call so a change in Settings takes effect
 * without a restart.
 */
const getLyricsOptions = (): LyricsOptions => ({
  embed: config.get('embedLyrics') !== false,
  saveLrc: Boolean(config.get('saveLrcFile')),
});

interface downloadTrackProps {
  track: trackType;
  quality: string | number;
  info: {[key: string]: any};
  /**
   * Either the per-quality object or a single width — the web UI saves a
   * scalar, the CLI config holds the object. resolveCoverSize takes both.
   */
  coverSizes: {'128': number; '320': number; flac: number} | number | string;
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
  /**
   * Stops a transfer that is already running.
   *
   * Optional, and passed only by the web interface's cancel button. The
   * command line passes nothing, so every check below is a no-op there and its
   * behaviour is unchanged.
   */
  abortSignal?: AbortSignal;
  /**
   * Told where the half-finished file is being written.
   *
   * The caller cannot work this out for itself — the path is built here from
   * the quality and the track's own ids — and a cancel needs it to clear up
   * after itself rather than leave a partial file behind for good.
   */
  onPartialFile?: (path: string) => void;
  /**
   * Which tags to write.
   *
   * Passed in rather than read here: this module builds its own Config when it
   * loads, so a setting changed while the engine is running is invisible to
   * it — the file on disk is current and this copy is not. The web interface
   * passes the live values; the command line passes nothing and this falls
   * back to reading them itself, which is correct there because each run is a
   * fresh process.
   */
  metadata?: MetadataOptions;
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

  const coverArtUrl = deezerCoverUrl(track.ALB_PICTURE, coverSize);
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
  abortSignal,
  onPartialFile,
  metadata,
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
        coverSize = resolveCoverSize(coverSizes, '128');
        break;
      case 9:
      case '9':
      case 'flac':
      case 'Flac':
      case 'FLAC':
        quality = 9;
        ext = '.flac';
        fileSize = Number(track.FILESIZE_FLAC);
        coverSize = resolveCoverSize(coverSizes, 'flac');
        break;
      default:
        quality = 3;
        fileSize = Number(track.FILESIZE_MP3_320);
        coverSize = resolveCoverSize(coverSizes, '320');
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
      /*
       * A licence refusal has to reach the quality ladder below.
       *
       * WrongLicense was rethrown straight out of here, so it never got to the
       * `fallbackQuality` branch a few lines down — the one case that branch
       * exists for. On an account without FLAC or 320, every track died with
       * "Your account can't stream MP3_320 tracks" rather than stepping down
       * to a tier the account is licensed for, and a whole album finished with
       * nothing saved. Streaming never showed this because it walks its own
       * ladder, which is why a track could play but not download.
       *
       * Leaving trackData undefined lets the existing fallback take over; it
       * already knows how to walk 9 -> 3 -> 1.
       */
      const licenceRefused = err instanceof WrongLicense;
      if (licenceRefused && fallbackQuality && quality !== 1) {
        // Fall through with no data so the ladder below retries lower.
      } else if (!(err instanceof GeoBlocked) || !track.FALLBACK) {
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
      /*
       * Resume from a partial file, but only when resuming makes sense.
       *
       * A leftover temp file at or beyond the expected size makes the Range
       * header ask for bytes past the end, and the CDN answers 416 — which
       * failed the download permanently, and kept failing on every retry
       * because the same stale file was still there. Restarting is cheap and
       * always correct; resuming past the end never is.
       */
      const tmpfilestat = statSync(tmpfile);
      const expected = Number(trackData.fileSize) || 0;
      if (expected > 0 && tmpfilestat.size >= expected) {
        try {
          unlinkSync(tmpfile);
        } catch {
          // If it cannot be removed the write below will overwrite it anyway.
        }
        downloaded = 0;
      } else {
        downloaded = tmpfilestat.size;
        headers.range = 'bytes=' + tmpfilestat.size + '-';
      }
    }

    fileSize = trackData.fileSize;
    if (richProgress) {
      terminalProgress.start(progressKey, progressLabel, fileSize, track.ART_NAME, progressIndex);
      terminalProgress.update(progressKey, downloaded, {stage: 'DOWN'});
    }
    let transferredLast = downloaded;
    let transferredClock = Date.now();

    /*
     * Nothing below runs unless a caller asked to be able to stop this.
     *
     * got 11 takes no abort signal of its own, but the stream it returns is an
     * ordinary Node stream, so destroying it ends the request — the pipeline
     * then rejects and the existing error handling takes over.
     */
    onPartialFile?.(tmpfile);
    if (abortSignal?.aborted) throw new Error('Download cancelled');

    const transfer = got.stream(trackData.trackUrl, {responseType: 'buffer', headers});
    const stopTransfer = () => transfer.destroy(new Error('Download cancelled'));
    abortSignal?.addEventListener('abort', stopTransfer, {once: true});

    try {
      await pipeline(
        transfer.on('downloadProgress', ({transferred}) => {
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
    } finally {
      abortSignal?.removeEventListener('abort', stopTransfer);
    }

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
    // Lyrics before tagging: the writer emits USLT / LYRICS from track.LYRICS,
    // so they have to be attached before the tags are built.
    await applyLyrics(
      track,
      {
        artist: track.ART_NAME,
        title: track.SNG_TITLE,
        album: track.ALB_TITLE,
        durationSec: Number(track.DURATION) || undefined,
      },
      savePath,
      getLyricsOptions(),
    );

    /*
     * Which tags to write, as configured.
     *
     * Read here rather than inside the writers so the core stays free of the
     * config, and so the command line and the interface get the same answer.
     */
    const trackWithMetadata = await deezer.addTrackTags(
      outFile,
      track,
      coverSize,
      metadata ??
        (config.get('metadataCustom' as never) === true
          ? metadataOptionsFrom((config.get('metadata' as never) as {deezer?: unknown})?.deezer)
          : DEFAULT_METADATA_OPTIONS),
    );

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
