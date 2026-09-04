import Metaflac from '../../lib/metaflac-js';
import type {albumTypePublicApi, trackType} from '../types';
import {formatGain, cleanVersion, isCompilation, ENCODED_BY} from '../../../lib/metadata-extra';
import {DEFAULT_METADATA_OPTIONS, type MetadataOptions} from '../../../lib/metadata-options';

export const writeMetadataFlac = (
  buffer: Buffer,
  track: trackType,
  album: albumTypePublicApi | null,
  dimension: number,
  cover?: Buffer | null,
  /* Absent means the defaults, so nothing that does not pass options changes. */
  options: MetadataOptions = DEFAULT_METADATA_OPTIONS,
): Buffer => {
  const flac = new Metaflac(buffer);
  const RELEASE_YEAR = album ? album.release_date.split('-')[0] : null;

  flac.setTag('TITLE=' + track.SNG_TITLE);
  flac.setTag('ALBUM=' + track.ALB_TITLE);
  flac.setTag('ARTIST=' + track.ARTISTS.map((a) => a.ART_NAME).join(', '));
  flac.setTag('TRACKNUMBER=' + track.TRACK_NUMBER.toLocaleString('en-US', {minimumIntegerDigits: 2}));

  if (album) {
    const TOTALTRACKS = album.nb_tracks.toLocaleString('en-US', {minimumIntegerDigits: 2});
    if (album.genres.data.length > 0) {
      for (const genre of album.genres.data) {
        flac.setTag('GENRE=' + genre.name);
      }
    }
    flac.setTag('TRACKTOTAL=' + TOTALTRACKS);
    flac.setTag('TOTALTRACKS=' + TOTALTRACKS);
    if (options.releaseType) flac.setTag('RELEASETYPE=' + album.record_type);
    flac.setTag('ALBUMARTIST=' + album.artist.name);
    if (options.barcode && album.upc) flac.setTag('BARCODE=' + album.upc);
    if (options.label && album.label) flac.setTag('LABEL=' + album.label);
    flac.setTag('DATE=' + album.release_date);
    flac.setTag('YEAR=' + RELEASE_YEAR);
    if (options.compilation) flac.setTag(`COMPILATION=${isCompilation(album.artist.name) ? '1' : '0'}`);
  }

  if (track.DISK_NUMBER) {
    flac.setTag('DISCNUMBER=' + track.DISK_NUMBER);
  }

  if (options.isrc && track.ISRC) flac.setTag('ISRC=' + track.ISRC);
  flac.setTag('LENGTH=' + track.DURATION);
  if (options.media) flac.setTag('MEDIA=Digital Media');

  if (track.LYRICS) {
    flac.setTag('LYRICS=' + track.LYRICS.LYRICS_TEXT);
  }
  if (options.explicit && track.EXPLICIT_LYRICS) {
    flac.setTag('EXPLICIT=' + track.EXPLICIT_LYRICS);
  }

  if (track.SNG_CONTRIBUTORS && !Array.isArray(track.SNG_CONTRIBUTORS)) {
    if (options.copyright && track.SNG_CONTRIBUTORS.main_artist) {
      flac.setTag(`COPYRIGHT=${RELEASE_YEAR ? RELEASE_YEAR + ' ' : ''}${track.SNG_CONTRIBUTORS.main_artist[0]}`);
    }
    if (options.credits && track.SNG_CONTRIBUTORS.publisher) {
      flac.setTag('ORGANIZATION=' + track.SNG_CONTRIBUTORS.publisher.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.composer) {
      flac.setTag('COMPOSER=' + track.SNG_CONTRIBUTORS.composer.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.publisher) {
      flac.setTag('ORGANIZATION=' + track.SNG_CONTRIBUTORS.publisher.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.producer) {
      flac.setTag('PRODUCER=' + track.SNG_CONTRIBUTORS.producer.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.engineer) {
      flac.setTag('ENGINEER=' + track.SNG_CONTRIBUTORS.engineer.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.writer) {
      flac.setTag('WRITER=' + track.SNG_CONTRIBUTORS.writer.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.author) {
      flac.setTag('AUTHOR=' + track.SNG_CONTRIBUTORS.author.join(', '));
    }
    if (options.credits && track.SNG_CONTRIBUTORS.mixer) {
      flac.setTag('MIXER=' + track.SNG_CONTRIBUTORS.mixer.join(', '));
    }
  }

  /*
   * ReplayGain lets a player level tracks without re-encoding. Deezer returns
   * GAIN on every track and it was being discarded; there is no peak, so only
   * the gain is written.
   */
  /*
   * Everything else Deezer credits.
   *
   * Its contributor list runs deeper than the roles read above — mixing
   * engineer, recording engineer, additional producer, drum programmer — and
   * all of it was being discarded. Each becomes a field under its own name.
   */
  if (options.extraCredits && track.SNG_CONTRIBUTORS && !Array.isArray(track.SNG_CONTRIBUTORS)) {
    const alreadyWritten = [
      'main_artist',
      'publisher',
      'composer',
      'producer',
      'engineer',
      'writer',
      'author',
      'mixer',
    ];
    for (const [role, people] of Object.entries(track.SNG_CONTRIBUTORS as Record<string, string[]>)) {
      if (alreadyWritten.includes(role) || !Array.isArray(people) || people.length === 0) continue;
      flac.setTag(role.toUpperCase() + '=' + people.join(', '));
    }
  }

  /*
   * Tempo, where Deezer knows it. It reports 0 across much of the catalogue,
   * and a tag claiming 0 BPM sorts worse than no tag at all.
   */
  const bpm = Number((track as trackType & {BPM?: number}).BPM ?? 0);
  if (options.bpm && Number.isFinite(bpm) && bpm > 0) {
    flac.setTag('BPM=' + Math.round(bpm));
  }

  const gain = options.replayGain ? formatGain(track.GAIN) : null;
  if (gain) {
    flac.setTag('REPLAYGAIN_TRACK_GAIN=' + gain);
  }

  // Distinguishes a remix or edit from the original, which otherwise tag
  // identically and merge into one entry in most libraries.
  const version = cleanVersion(track.VERSION);
  if (version) {
    flac.setTag('VERSION=' + version);
    flac.setTag('SUBTITLE=' + version);
  }

  if (cover) {
    flac.importPicture(cover, dimension, 'image/jpeg');
  }

  if (options.provenance) {
    flac.setTag('SOURCE=Deezer');
    flac.setTag('SOURCEID=' + track.SNG_ID);
    flac.setTag('ENCODEDBY=' + ENCODED_BY);
  }

  return flac.getBuffer();
};
