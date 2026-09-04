import {downloadAlbumCover} from './abumCover';
import {getTrackLyrics} from './getTrackLyrics';
import {writeMetadataMp3} from './id3';
import {writeMetadataFlac} from './flacmetata';
import {getAlbumInfoPublicApi, getTrackInfoPublicApi} from '../api';
import type {trackType} from '../types';
import {DEFAULT_METADATA_OPTIONS, type MetadataOptions} from '../../../lib/metadata-options';

// Re-exported so the web API can serve lyrics. Previously these were reachable
// only from inside the tagging pipeline, which is why the UI had no way to
// display lyrics despite the implementation existing.
export {getTrackLyrics} from './getTrackLyrics';
export {getLyricsMusixmatch} from './musixmatchLyrics';

const albumInfo = async (track: trackType) => {
  try {
    return await getAlbumInfoPublicApi(track.ALB_ID);
  } catch (err) {
    return null;
  }
};

/**
 * The tempo, which costs a request of its own.
 *
 * Deezer does not send BPM with the track it returns for a download, and it
 * leaves the field out when listing an album's tracks — it is only on the
 * per-track endpoint. So it is fetched only when somebody has asked for it,
 * rather than adding a request per track to every download for a tag most
 * people do not want. It reports 0 for a fair part of the catalogue, and 0 is
 * not written.
 */
const trackTempo = async (track: trackType): Promise<number> => {
  try {
    const info = (await getTrackInfoPublicApi(String(track.SNG_ID))) as {bpm?: number};
    const bpm = Number(info?.bpm ?? 0);
    return Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
  } catch {
    return 0;
  }
};

/**
 * Add metdata to the mp3
 * @param {Buffer} trackBuffer decrypted track buffer
 * @param {Object} track json containing track infos
 * @param {Number} albumCoverSize album cover size in pixel
 */
export const addTrackTags = async (
  trackBuffer: Buffer,
  track: trackType,
  albumCoverSize = 1000,
  /* Which tags to write. Absent means the defaults, so any caller that does
     not care is tagged exactly as before. */
  options: MetadataOptions = DEFAULT_METADATA_OPTIONS,
): Promise<Buffer> => {
  const [cover, lyrics, album, bpm] = await Promise.all([
    downloadAlbumCover(track, albumCoverSize),
    getTrackLyrics(track),
    albumInfo(track),
    options.bpm ? trackTempo(track) : Promise.resolve(0),
  ]);

  /* Carried on the track so both writers read it the same way. */
  if (bpm > 0) (track as trackType & {BPM?: number}).BPM = bpm;

  if (lyrics) {
    track.LYRICS = lyrics;
  }

  if (track.ART_NAME.toLowerCase() === 'various') {
    track.ART_NAME = 'Various Artists';
  }
  if (album && album.record_type) {
    album.record_type =
      album.record_type === 'ep' ? 'EP' : album.record_type.charAt(0).toUpperCase() + album.record_type.slice(1);
  }

  const isFlac = trackBuffer.slice(0, 4).toString('ascii') === 'fLaC';
  return isFlac
    ? writeMetadataFlac(trackBuffer, track, album, albumCoverSize, cover, options)
    : writeMetadataMp3(trackBuffer, track, album, cover, options);
};
