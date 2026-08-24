import type {Settings} from '@/store/settings-store';

/**
 * Resolves a naming template against a sample release.
 *
 * Mirrors the two resolvers in src/lib/util.ts closely enough to be trusted as
 * a preview: the point is that someone editing a template can see the shape of
 * the path before a download proves them wrong.
 *
 * The rules that are easy to get wrong and are reproduced here exactly:
 *  - {NO_TRACK_NUMBER} inserts nothing and switches the automatic "04 - "
 *    prefix off. It reads like a field and is really a instruction.
 *  - {TRACK_NUMBER} and {TRACK_POSITION} insert the padded number and switch
 *    the automatic prefix off as well, so the number is never doubled.
 *  - With no numbering placeholder at all, the prefix is added to the filename
 *    when Track numbering is on.
 */

type Row = 'track' | 'album' | 'artist' | 'playlist';

export type Service = 'deezer' | 'qobuz' | 'ytmusic';

const DEEZER_SAMPLE: Record<string, string> = {
  ART_NAME: 'Daft Punk',
  ALB_TITLE: 'Discovery',
  SNG_TITLE: 'One More Time',
  TITLE: 'Summer Essentials',
  TRACK_NUMBER: '4',
  TRACK_POSITION: '4',
  DISK_NUMBER: '1',
  NUMBER_TRACK: '14',
  NUMBER_DISK: '1',
  YEAR: '2001',
  PHYSICAL_RELEASE_DATE: '2001-03-12',
  ISRC: 'GBDUW0000059',
  UPC: '724384960650',
  COPYRIGHT: '2001 Daft Life Ltd.',
  PRODUCER_LINE: '℗ 2001 Daft Life Ltd.',
  DURATION: '320',
};

const QOBUZ_SAMPLE: Record<string, string> = {
  alb_artist: 'Daft Punk',
  alb_title: 'Discovery',
  title: 'One More Time',
  clean_title: 'One More Time',
  artist: 'Daft Punk',
  album: 'Discovery',
  album_artist: 'Daft Punk',
  composer: 'Thomas Bangalter',
  track_number: '4',
  disc_number: '1',
  total_tracks: '14',
  genre: 'Electronic',
  label: 'Parlophone',
  isrc: 'GBDUW0000059',
  copyright: '2001 Daft Life Ltd.',
  version: 'Remastered',
  release_date: '2001-03-12',
  list_title: 'Summer Essentials',
  playlist: 'Summer Essentials',
  maximum_bit_depth: '24',
  maximum_sampling_rate: '96',
  /*
   * Dotted field paths resolve too.
   *
   * The engine reads straight off the Qobuz payload, so a template written as
   * {album.title} works — and would otherwise sit unresolved in the preview
   * and look broken.
   */
  'album.title': 'Discovery',
  'album.artist.name': 'Daft Punk',
  'album.genre.name': 'Electronic',
  'album.label.name': 'Parlophone',
  'performer.name': 'Daft Punk',
  'composer.name': 'Thomas Bangalter',
  release_date_original: '2001-03-12',
  media_number: '1',
  work: 'Discovery',
};

/**
 * What a YouTube Music download knows about itself.
 *
 * A third vocabulary, because YouTube Music shares neither of the others'.
 * Deezer substitutes SCREAMING_SNAKE names straight off its private payload
 * and Qobuz resolves a lowercase set by name; these are the fields the
 * YouTube Music downloader actually fills in.
 */
const YTMUSIC_SAMPLE: Record<string, string> = {
  title: 'One More Time',
  artist: 'Daft Punk',
  album: 'Discovery',
  album_artist: 'Daft Punk',
  year: '2001',
  track_number: '1',
  total_tracks: '14',
  video_id: 'FGBhQbmPwH8',
};

/** Placeholders that carry the track number, in each service's vocabulary. */
const NUMBER_TOKENS: Record<Service, string[]> = {
  deezer: ['TRACK_NUMBER', 'TRACK_POSITION'],
  qobuz: ['track_number'],
  ytmusic: ['track_number'],
};

const SUPPRESS_TOKEN: Record<Service, string> = {
  deezer: 'NO_TRACK_NUMBER',
  qobuz: 'no_track_number',
  ytmusic: 'no_track_number',
};

const pad = (value: string) => String(Number(value)).padStart(2, '0');

const extensionFor = (service: Service, settings: Settings): string => {
  if (service === 'deezer') return settings.deezerQuality === 'FLAC' ? '.flac' : '.mp3';
  /*
   * Whichever container the chosen format lands in.
   *
   * Opus is written as Ogg rather than the WebM YouTube serves, because WebM
   * has no tag writer and Ogg does — the audio is the same either way.
   */
  if (service === 'ytmusic') return settings.ytmusicFormat === 'opus' ? '.opus' : '.m4a';
  // Qobuz 5 is the lossy tier; 6, 7 and 27 are all FLAC at rising resolutions.
  return settings.qobuzQuality === '5' ? '.mp3' : '.flac';
};

export function renderTemplate(template: string, service: Service, row: Row, settings: Settings): string {
  const sample =
    service === 'deezer' ? {...DEEZER_SAMPLE} : service === 'ytmusic' ? {...YTMUSIC_SAMPLE} : {...QOBUZ_SAMPLE};

  // A playlist is named after the list rather than the album it came from.
  if (row === 'playlist' && service === 'deezer') sample.TITLE = 'Summer Essentials';

  let path = template.trim();
  if (!path) return '';

  let autoNumber = settings.trackNumbering;

  const suppress = SUPPRESS_TOKEN[service];
  if (path.includes(`{${suppress}}`)) {
    path = path.split(`{${suppress}}`).join('');
    autoNumber = false;
  }

  path = path.replace(/\{([^}]+)\}/g, (whole, token: string) => {
    const value = sample[token];
    if (value === undefined) return whole; // Unknown here, may still resolve live.
    if (NUMBER_TOKENS[service].includes(token)) {
      autoNumber = false;
      return pad(value);
    }
    return value;
  });

  // Windows and POSIX both, since a template may be written with either.
  const parts = path.split(/[\/]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '';

  const file = parts.pop() as string;
  const named = autoNumber ? `${pad(sample.TRACK_NUMBER ?? sample.track_number ?? '1')} - ${file}` : file;

  return [...parts, named + extensionFor(service, settings)].join('/');
}
