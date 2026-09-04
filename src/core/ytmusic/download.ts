/**
 * Downloading a YouTube Music track to a tagged file.
 *
 * The aim is a file indistinguishable from a Deezer or Qobuz download in
 * everything except the audio itself: same naming, same tags, same embedded
 * artwork at full size. YouTube supplies almost none of that — a stream and a
 * video title — so the metadata comes from the browse pages, which do know the
 * album, the track number and the year.
 *
 * Audio is AAC in an MP4 container. See `bestAudioFormat` for why that is
 * chosen over the slightly higher-bitrate Opus: WebM cannot be tagged, and an
 * untagged file is a permanent defect in a library.
 */
import fs from 'fs';
import path from 'path';
import axios, {AxiosInstance} from 'axios';
import {getAudioStream, PlayerError, type AudioStream} from './player';
import {remuxWebmToOgg} from './ogg-opus';
import {ensureMetadataBox} from './mp4-udta';

/** What a finished download produced. */
export interface DownloadedTrack {
  path: string;
  bytes: number;
  itag: number;
  codec: AudioStream['codec'];
  bitrate: number;
  /** False when the container could not carry tags, which is worth reporting. */
  tagged: boolean;
}

/** Everything worth writing into the file. */
export interface TrackMetadata {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  /** The collection this came from, when it came from a playlist. */
  playlist?: string;
  year?: number | null;
  trackNumber?: number | null;
  trackTotal?: number | null;
  /** Full-size artwork, fetched and embedded. */
  coverUrl?: string;
  comment?: string;
  /**
   * The words, written into the file's tag.
   *
   * Deezer and Qobuz downloads have carried these for a while; YouTube Music's
   * tagger simply never wrote them, so the lyrics setting did nothing here.
   */
  lyrics?: string;
  /**
   * What kind of upload the row was: album audio or a music video.
   *
   * Carried from the listing that produced it so the album-audio swap does not
   * have to ask YouTube again for something the row already said — on a
   * hundred-track playlist that is a hundred requests saved.
   */
  musicVideoType?: string;
  /** Write the line saying where this came from. Absent means yes, as before. */
  provenance?: boolean;
}

export interface DownloadOptions {
  cookie?: string;
  preferOpus?: boolean;
  http?: AxiosInstance;
  /** Bytes so far and total, for the queue's progress bar. */
  onProgress?: (received: number, total: number | null) => void;
}

/** The extension a codec should be saved under, so players recognise it. */
export const extensionFor = (codec: AudioStream['codec']): string => {
  if (codec === 'aac') return '.m4a';
  if (codec === 'opus') return '.opus';
  return '.bin';
};

const newClient = (): AxiosInstance => axios.create({timeout: 60_000, validateStatus: () => true});

/**
 * Fetch the artwork, if there is any.
 *
 * A missing cover is not a failed download — the track is still what was
 * asked for — so this returns null rather than throwing.
 */
export const fetchCover = async (url: string | undefined, http: AxiosInstance): Promise<Buffer | null> => {
  if (!url) return null;
  try {
    const response = await http.get(url, {responseType: 'arraybuffer', timeout: 30_000});
    if (response.status !== 200) return null;
    const buffer = Buffer.from(response.data as ArrayBuffer);
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
};

/**
 * Write tags into a downloaded file.
 *
 * Returns whether it worked. Matroska has no writer, so an Opus download is
 * saved untagged rather than failing — the caller reports that honestly rather
 * than pretending the file is complete.
 */
export const tagFile = (filePath: string, metadata: TrackMetadata, cover: Buffer | null, report = true): boolean => {
  /* eslint-disable @typescript-eslint/no-var-requires -- loaded lazily so a
     tagging problem cannot stop the engine from starting. */
  let taglib: any;
  try {
    taglib = require('node-taglib-sharp');
  } catch (error) {
    console.log('Tagging unavailable: ' + ((error as Error)?.message ?? error));
    return false;
  }

  try {
    const file = taglib.File.createFromPath(filePath);
    try {
      file.tag.title = metadata.title;
      file.tag.performers = metadata.artist ? [metadata.artist] : [];
      if (metadata.album) file.tag.album = metadata.album;
      if (metadata.albumArtist) file.tag.albumArtists = [metadata.albumArtist];
      if (metadata.year) file.tag.year = metadata.year;
      if (metadata.trackNumber) file.tag.track = metadata.trackNumber;
      if (metadata.trackTotal) file.tag.trackCount = metadata.trackTotal;
      /*
       * The provenance line — where the file came from — is the only tag here
       * the metadata switches apply to. YouTube Music sends no ISRC, barcode,
       * label or loudness figure, so there is nothing else to turn off.
       */
      if (metadata.comment && metadata.provenance !== false) file.tag.comment = metadata.comment;
      if (metadata.lyrics) file.tag.lyrics = metadata.lyrics;

      if (cover && cover.length > 0) {
        const picture = taglib.Picture.fromData(taglib.ByteVector.fromByteArray(cover));
        picture.type = taglib.PictureType.FrontCover;
        picture.mimeType = cover[0] === 0x89 ? 'image/png' : 'image/jpeg';
        file.tag.pictures = [picture];
      }

      file.save();
      return true;
    } finally {
      file.dispose();
    }
  } catch (error) {
    /*
     * Say why.
     *
     * This used to swallow the reason, and a download that arrived with no
     * tags at all looked identical to one the container simply cannot carry
     * tags for. The audio is still correct either way, so this is not fatal,
     * but silence here cost an afternoon.
     */
    if (report) console.log('Could not tag ' + filePath + ': ' + ((error as Error)?.message ?? error));
    return false;
  }
};

/** Sleep, for the retry below. */
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Tag the file once the filesystem will let us open it.
 *
 * Retries rather than assuming: the first attempt frequently fails on Windows
 * while a scanner holds the freshly-closed file, and one failed open used to
 * mean a permanently untagged download.
 */
const tagWhenReady = async (
  filePath: string,
  metadata: TrackMetadata,
  cover: Buffer | null,
  attempts = 6,
): Promise<boolean> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (fs.existsSync(filePath) && tagFile(filePath, metadata, cover, attempt === attempts - 1)) return true;
    await pause(250 * (attempt + 1));
  }
  return false;
};

/**
 * Download one track and tag it.
 *
 * `outputBase` is the path without an extension: the codec decides that, and
 * the caller cannot know it until the stream has been chosen.
 */
export const downloadTrack = async (
  videoId: string,
  metadata: TrackMetadata,
  outputBase: string,
  options: DownloadOptions = {},
): Promise<DownloadedTrack> => {
  const http = options.http ?? newClient();

  const stream = await getAudioStream(videoId, {
    cookie: options.cookie,
    preferOpus: options.preferOpus,
    http,
  });

  const filePath = outputBase + extensionFor(stream.codec);
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  /*
   * Fetched in ranged chunks, then written in one call.
   *
   * Two separate problems are solved here, and both were expensive to find.
   *
   * Speed: YouTube throttles a single long-lived request on these URLs hard —
   * measured at 32 KB/s, close to two minutes for a four-minute track — while
   * serving the very same URL by byte range at full rate. The same file that
   * took 106 seconds as one request took 0.8 seconds fetched as ranges. There
   * is no signature or `n` parameter involved; the URLs carry neither.
   *
   * Correctness: piping to disk resolved on the wrong event whichever was
   * chosen. `finish` fired before the file could be opened, so tagging failed
   * with ENOENT; `close` never fired at all, so tagging was never reached and
   * every download arrived with no title, artist or artwork. Assembling in
   * memory and writing once removes the stream lifecycle from the problem:
   * when the write returns the file is complete and closed.
   */
  const CHUNK_SIZE = 1024 * 1024;
  /* Modest: the gain is in ranging at all, not in flooding their edge. */
  const MAX_PARALLEL = 4;

  /*
   * Introduce ourselves as the client the URL was issued to.
   *
   * googlevideo binds a stream URL to the client that requested it: fetch it
   * with a different User-Agent and every range comes back 403, even though
   * the URL is perfectly valid and was issued seconds earlier.
   */
  const headers = {
    ...(stream.userAgent ? {'User-Agent': stream.userAgent} : {}),
    ...(options.cookie ? {Cookie: options.cookie} : {}),
  };
  const expected = stream.contentLength ?? 0;

  let audio: Buffer;

  if (!expected) {
    /* No declared length, so ranges cannot be planned — take it in one go. */
    const whole = await http.get(stream.url, {responseType: 'arraybuffer', timeout: 180_000, headers});
    if (whole.status !== 200 && whole.status !== 206) {
      throw new PlayerError('network', `YouTube refused the audio stream (${whole.status})`);
    }
    audio = Buffer.from(whole.data as ArrayBuffer);
  } else {
    const ranges: Array<{start: number; end: number}> = [];
    for (let start = 0; start < expected; start += CHUNK_SIZE) {
      ranges.push({start, end: Math.min(start + CHUNK_SIZE - 1, expected - 1)});
    }

    const parts: Buffer[] = new Array(ranges.length);
    let received = 0;
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= ranges.length) return;
        const {start, end} = ranges[index];

        const part = await http.get(stream.url, {
          responseType: 'arraybuffer',
          timeout: 60_000,
          headers: {...headers, Range: `bytes=${start}-${end}`},
        });

        if (part.status !== 206 && part.status !== 200) {
          throw new PlayerError('network', `YouTube refused a chunk of the audio (${part.status})`);
        }

        const body = Buffer.from(part.data as ArrayBuffer);
        /*
         * A server that ignores Range answers 200 with the whole file. Taking
         * it as one chunk is correct and stops the other workers duplicating
         * the download.
         */
        if (part.status === 200 && body.length >= expected) {
          parts.length = 1;
          parts[0] = body;
          cursor = ranges.length;
          received = body.length;
          options.onProgress?.(received, expected);
          return;
        }

        parts[index] = body;
        received += body.length;
        options.onProgress?.(received, expected);
      }
    };

    await Promise.all(Array.from({length: Math.min(MAX_PARALLEL, ranges.length)}, worker));
    audio = Buffer.concat(parts.filter(Boolean));
  }

  const received = audio.length;
  const total = expected || received;

  /*
   * A truncated file is worse than a failed one: it plays, badly, and looks
   * like it worked. YouTube reports the exact length, so it is checked before
   * anything is written.
   */
  if (total && received < total * 0.98) {
    throw new PlayerError('network', `The download stopped early — ${received} of ${total} bytes`);
  }

  const cover = await fetchCover(metadata.coverUrl, http);

  /*
   * Opus arrives wrapped in WebM, which has no tag writer.
   *
   * That used to mean choosing between the better-sounding file and the one
   * that was usable in a library — Opus downloads landed with no title, artist
   * or cover. Ogg is Opus's native container, carries both, and holds exactly
   * the packets WebM was already carrying, so the wrapper is rewritten and
   * every audio byte is left alone. Nothing is re-encoded.
   *
   * If the rewrap fails the original is written unchanged: a WebM that plays
   * beats an Ogg that might not.
   */
  if (stream.codec === 'opus') {
    const ogg = remuxWebmToOgg(audio, {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      albumArtist: metadata.albumArtist,
      year: metadata.year,
      trackNumber: metadata.trackNumber,
      trackTotal: metadata.trackTotal,
      comment: metadata.comment,
      cover,
    });
    if (ogg) {
      fs.writeFileSync(filePath, ogg);
      options.onProgress?.(received, total);
      return {
        path: filePath,
        bytes: received,
        itag: stream.itag,
        codec: stream.codec,
        bitrate: stream.bitrate,
        tagged: true,
      };
    }
  }

  /*
   * Give an MP4 the metadata box before the tagger sees it.
   *
   * YouTube's audio has none, and node-taglib-sharp cannot create one — it
   * throws instead, and the file is written untagged. Most of an album came
   * out untitled that way; the exceptions were the tracks where YouTube had
   * already embedded artwork.
   */
  const prepared = stream.codec === 'aac' ? ensureMetadataBox(audio) : audio;

  fs.writeFileSync(filePath, prepared);
  options.onProgress?.(received, total);

  /*
   * Wait for the file to become openable before tagging it.
   *
   * On Windows a file that has just been closed is routinely unavailable for
   * a moment — a scanner opens it exclusively the instant the handle is
   * released — and an open during that window fails with ENOENT even though
   * the file is there and complete. Tagging then silently did nothing and
   * every download arrived with no title, artist or artwork.
   */
  const tagged = await tagWhenReady(filePath, metadata, cover);

  return {
    path: filePath,
    bytes: received,
    itag: stream.itag,
    codec: stream.codec,
    bitrate: stream.bitrate,
    tagged,
  };
};
