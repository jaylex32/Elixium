import axios from 'axios';
import {DEFAULT_METADATA_OPTIONS, type MetadataOptions} from '../../lib/metadata-options';
import Metaflac from '../lib/metaflac-js';
import FastLRU from '../lib/fast-lru';
import {trackType, albumType} from './types';
import {getTrackInfo} from './index';
import NodeID3 from 'node-id3';
import {qobuzCoverUrl} from '../../lib/cover-art';
import {formatGain, formatPeak, cleanVersion, isCompilation, ENCODED_BY} from '../../lib/metadata-extra';

interface ID3Tags {
  title: string;
  artist: string;
  album?: string;
  year: string; // Change this to string
  originalReleaseTime?: string;
  trackNumber: string;
  genre?: string;
  performerInfo?: string;
  mediaType: string;
  copyright?: string;
  date?: string;
  length: string;
  involvedPeopleList?: string;
  musicianCreditsList: string;
  composer: string;
  /** TPUB — the record label, previously misfiled into `copyright`. */
  publisher?: string;
  /** TSRC. */
  ISRC?: string;
  /** TPOS — disc number within a multi-disc release. */
  partOfSet?: string;
  /** TENC. */
  encodedBy?: string;
  /** TIT3 — the release version, e.g. "Extended Club Mix". */
  subtitle?: string;
  TXXX?: Array<{description: string; value: string}>;
  image?: {
    mime: string;
    type: {
      id: number;
      name: string;
    };
    description: string;
    imageBuffer: Buffer;
  };
}

async function writeMetadataMp3(buffer: Buffer, track: trackType, cover: Buffer | null): Promise<Buffer> {
  const performerName = track.performer?.name || 'Unknown Artist';
  const albumArtistName = track.album?.artist?.name || performerName;
  const genreName = track.album?.genre?.name;
  const labelName = track.album?.label?.name;
  const composerName = track.composer?.name || '';
  const releaseDate = track.album?.release_date_original || track.release_date_original;
  const releaseYear = releaseDate ? new Date(releaseDate).getFullYear().toString() : '';

  const tags: ID3Tags = {
    title: track.title,
    artist: performerName,
    album: track.album?.title,
    year: releaseYear,
    originalReleaseTime: track.album?.release_date_original,
    trackNumber: track.track_number.toString(),
    genre: genreName,
    performerInfo: albumArtistName,
    mediaType: 'Digital Media', // Assuming all tracks are digital media
    /*
     * copyright was set to the record label, which is a different thing —
     * Qobuz returns the real copyright line on the track. The label belongs in
     * publisher (TPUB), where it was not being written at all.
     */
    copyright: track.copyright || undefined,
    publisher: labelName,
    date: track.album?.release_date_original,
    length: track.duration.toString(),
    /*
     * involvedPeopleList (TIPL) previously held "1"/"0" — the compilation flag
     * had been written into the credits frame, which corrupted it for any
     * player that displays credits. The flag now lives in a TXXX below.
     */
    musicianCreditsList: track.performers,
    composer: composerName,
    ISRC: track.isrc,
    partOfSet: track.media_number ? String(track.media_number) : undefined,
    encodedBy: ENCODED_BY,
    // Distinguishes a remix or edit from the original recording.
    subtitle: cleanVersion(track.version) ?? undefined,
    TXXX: [
      {
        description: 'Explicit',
        value: track.parental_warning ? '1' : '0',
      },
      {
        description: 'Track Total',
        value: track.album?.tracks_count
          ? track.album.tracks_count.toLocaleString('en-US', {minimumIntegerDigits: 2})
          : '0',
      },
      {
        description: 'Release Type',
        value: track.album?.release_type || 'Unknown',
      },
      {
        description: 'COMPILATION',
        value: isCompilation(albumArtistName) ? '1' : '0',
      },
      // Lowercase descriptions: players match ReplayGain keys case-sensitively.
      ...(formatGain(track.audio_info?.replaygain_track_gain)
        ? [{description: 'replaygain_track_gain', value: formatGain(track.audio_info.replaygain_track_gain) as string}]
        : []),
      ...(formatPeak(track.audio_info?.replaygain_track_peak)
        ? [{description: 'replaygain_track_peak', value: formatPeak(track.audio_info.replaygain_track_peak) as string}]
        : []),
    ],
  };

  if (cover) {
    tags.image = {
      mime: 'image/jpeg',
      type: {id: 3, name: 'front cover'},
      description: 'Cover',
      imageBuffer: cover,
    };
  }

  // Write the ID3 tags to the buffer
  const taggedBuffer = NodeID3.write(tags, buffer);

  if (!taggedBuffer) {
    throw new Error('Failed to write ID3 tags to the buffer');
  }

  return taggedBuffer;
}

export const addTrackTags = async (
  trackBuffer: Buffer,
  og_track: trackType,
  albumCoverSize = 1000,
  /* Which tags to write. Absent means the defaults, so any caller that does
     not pass them is tagged exactly as before. */
  options: MetadataOptions = DEFAULT_METADATA_OPTIONS,
): Promise<Buffer> => {
  const track = og_track;
  if (!track.album) {
    const fullData = await getTrackInfo(og_track.id);
    track.album = fullData.album;
  }

  let cover: Buffer | null = null;
  // Ensure that we call downloadAlbumCover only if track.album is not null
  if (track.album) {
    cover = await downloadAlbumCover(track.album, albumCoverSize);
  }

  const isFlac = trackBuffer.slice(0, 4).toString('ascii') === 'fLaC';
  if (isFlac) {
    return writeMetadataFlac(trackBuffer, track, albumCoverSize, cover, options);
  } else {
    return writeMetadataMp3(trackBuffer, track, cover);
  }
};

type coverSize = 50 | 230 | 600 | number;

// expire cache in 30 minutes
const lru = new FastLRU({
  maxSize: 50,
  ttl: 30 * 60000,
});

export const downloadAlbumCover = async (album: albumType, albumCoverSize: coverSize): Promise<Buffer | null> => {
  const cache = lru.get(album.id + albumCoverSize);
  if (cache) {
    return cache;
  }

  try {
    /*
     * Previously this topped out at image.large (600px), so an embedded cover
     * could never exceed 600 however the size was configured. Qobuz hosts a
     * _max rung at 4000px that the album payload never links to; the URL has
     * to be rebuilt to reach it.
     */
    const url = qobuzCoverUrl(album.image, albumCoverSize) ?? album.image.large;
    const {data} = await axios.get<any>(url, {responseType: 'arraybuffer'});
    lru.set(album.id + albumCoverSize, data);
    return data;
  } catch (err) {
    return null;
  }
};

export const writeMetadataFlac = (
  buffer: Buffer,
  track: trackType,
  dimension: number,
  cover?: Buffer | null,
  options: MetadataOptions = DEFAULT_METADATA_OPTIONS,
): Buffer => {
  const flac = new Metaflac(buffer);
  const albumArtistName = track.album?.artist?.name || track.performer?.name || 'Unknown Artist';
  const releaseDate = track.album?.release_date_original || track.release_date_original;
  const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
  const genreName = track.album?.genre?.name;
  const labelName = track.album?.label?.name;
  const composerName = track.composer?.name;

  flac.setTag('TITLE=' + track.title);
  flac.setTag('ARTIST=' + (track.performer?.name || 'Unknown Artist'));
  flac.setTag('TRACKNUMBER=' + track.track_number.toLocaleString('en-US', {minimumIntegerDigits: 2}));

  if (track.album) {
    flac.setTag('ALBUM=' + track.album.title);
    const TOTALTRACKS = track.album.tracks_count.toLocaleString('en-US', {minimumIntegerDigits: 2});
    if (genreName) {
      flac.setTag('GENRE=' + genreName);
    }
    flac.setTag('TRACKTOTAL=' + TOTALTRACKS);
    flac.setTag('TOTALTRACKS=' + TOTALTRACKS);
    if (options.releaseType) flac.setTag('RELEASETYPE=' + track.album.release_type);
    flac.setTag('ALBUMARTIST=' + albumArtistName);
    if (options.barcode) flac.setTag('BARCODE=' + track.album.upc);
    if (labelName) {
      if (options.label) flac.setTag('LABEL=' + labelName);
    }
    if (track.album.release_date_original) {
      flac.setTag('DATE=' + track.album.release_date_original);
    }
    if (releaseYear) {
      flac.setTag('YEAR=' + releaseYear);
    }
    flac.setTag(`COMPILATION=${isCompilation(albumArtistName) ? '1' : '0'}`);
    flac.setTag(`UPC=${track.album.upc}`);
  }

  if (track.album?.media_count) {
    flac.setTag('TOTALDISCS=' + track.album.media_count);
    flac.setTag('DISCNUMBER=' + track.media_number);
  }

  if (options.isrc) flac.setTag('ISRC=' + track.isrc);
  flac.setTag('LENGTH=' + track.duration);
  if (options.media) flac.setTag('MEDIA=Digital Media');

  /*
   * ReplayGain. Qobuz returns both a gain and a peak per track and neither was
   * written, so a mixed-source library had no consistent playback level.
   */
  const gain = formatGain(track.audio_info?.replaygain_track_gain);
  if (gain) {
    if (options.replayGain) flac.setTag('REPLAYGAIN_TRACK_GAIN=' + gain);
  }
  const peak = formatPeak(track.audio_info?.replaygain_track_peak);
  if (peak) {
    if (options.replayGain) flac.setTag('REPLAYGAIN_TRACK_PEAK=' + peak);
  }

  // The real copyright line, which Qobuz provides per track and was unused.
  if (track.copyright) {
    if (options.copyright) flac.setTag('COPYRIGHT=' + track.copyright);
  }

  // Keeps a remix or edit distinct from the original recording.
  const version = cleanVersion(track.version);
  if (version) {
    flac.setTag('VERSION=' + version);
    flac.setTag('SUBTITLE=' + version);
  }

  // Populated by applyLyrics before tagging. UNSYNCEDLYRICS is what most
  // players read from a FLAC; LYRICS is kept for the ones that only know it.
  if (track.LYRICS?.LYRICS_TEXT) {
    flac.setTag('LYRICS=' + track.LYRICS.LYRICS_TEXT);
    flac.setTag('UNSYNCEDLYRICS=' + track.LYRICS.LYRICS_TEXT);
  }

  if (track.parental_warning) {
    if (options.explicit) flac.setTag('EXPLICIT=1');
  }

  if (composerName) {
    if (options.credits) flac.setTag('COMPOSER=' + composerName);
  }

  if (track.performers) {
    flac.setTag('DESCRIPTION=' + track.performers);
  }
  // TODO
  // if (track.SNG_CONTRIBUTORS && !Array.isArray(track.SNG_CONTRIBUTORS)) {
  //   if (track.SNG_CONTRIBUTORS.main_artist) {
  //     flac.setTag(`COPYRIGHT=${RELEASE_YEAR ? RELEASE_YEAR + ' ' : ''}${track.SNG_CONTRIBUTORS.main_artist[0]}`);
  //   }
  //   if (track.SNG_CONTRIBUTORS.publisher) {
  //     flac.setTag('ORGANIZATION=' + track.SNG_CONTRIBUTORS.publisher.join(', '));
  //   }
  //   if (track.SNG_CONTRIBUTORS.publisher) {
  //     flac.setTag('ORGANIZATION=' + track.SNG_CONTRIBUTORS.publisher.join(', '));
  //   }
  //   if (track.SNG_CONTRIBUTORS.producer) {
  //     flac.setTag('PRODUCER=' + track.SNG_CONTRIBUTORS.producer.join(', '));
  //   }
  //   if (track.SNG_CONTRIBUTORS.engineer) {
  //     flac.setTag('ENGINEER=' + track.SNG_CONTRIBUTORS.engineer.join(', '));
  //   }
  //   if (track.SNG_CONTRIBUTORS.writer) {
  //     flac.setTag('WRITER=' + track.SNG_CONTRIBUTORS.writer.join(', '));
  //   }
  //   if (track.SNG_CONTRIBUTORS.author) {
  //     flac.setTag('AUTHOR=' + track.SNG_CONTRIBUTORS.author.join(', '));
  //   }
  //   if (track.SNG_CONTRIBUTORS.mixer) {
  //     flac.setTag('MIXER=' + track.SNG_CONTRIBUTORS.mixer.join(', '));
  //   }
  // }

  if (cover) {
    flac.importPicture(cover, dimension, 'image/jpeg');
  }

  if (options.provenance) {
    flac.setTag('SOURCE=Qobuz');
    flac.setTag('SOURCEID=' + track.id);
    flac.setTag('ENCODEDBY=' + ENCODED_BY);
  }

  return flac.getBuffer();
};
