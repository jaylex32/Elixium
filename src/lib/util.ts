import dotProp from 'dot-prop';
import chalk from 'chalk';
import {dirname, basename, join} from 'path';

type saveLayoutProps = {
  track: {[key: string]: any};
  album: {[key: string]: any};
  path: string;
  minimumIntegerDigits: number;
  trackNumber: boolean;
  qobuzDownloadCover: boolean;
};

export const sanitizeFilename = (input: string, replacement = '_'): string => {
  /* eslint-disable-next-line */
  const UNSAFE_CHARS = /[\/\?<>\\:\*\|"\u2215\u2044\u29F8\uFF0F\u29F9]+/g;

  if (typeof input !== 'string') {
    return '';
  }

  if (process.platform === 'win32' && input.endsWith('.')) {
    return (input.slice(0, -1) + replacement).replace(UNSAFE_CHARS, replacement).trim();
  }

  return input.replace(UNSAFE_CHARS, replacement).trim();
};

export const formatSecondsReadable = (time: number) => {
  if (time < 60) {
    return time + 's';
  }
  const minutes = time >= 60 ? Math.floor(time / 60) : 0;
  const seconds = Math.floor(time - minutes * 60);
  return `${minutes >= 10 ? minutes : '0' + minutes}m ${seconds >= 10 ? seconds : '0' + seconds}s`;
};

export const saveLayout = ({track, album, path, minimumIntegerDigits, trackNumber}: saveLayoutProps) => {
  // Clone album info
  const albumInfo = {...album};

  // Use relative path
  if (path.startsWith('{')) {
    path = './' + path;
  }

  // Transform values
  /* eslint-disable-next-line */
  const file = path.match(/(?<=\{)[^\}]*/g);
  if (file) {
    if (
      track.DISK_NUMBER &&
      album.NUMBER_DISK &&
      album.ALB_TITLE &&
      Number(album.NUMBER_DISK) > 1 &&
      !album.ALB_TITLE.includes('Disc')
    ) {
      albumInfo.ALB_TITLE += ` (Disc ${Number(track.DISK_NUMBER).toLocaleString('en-US', {minimumIntegerDigits: 2})})`;
    }

    /*
     * Deezer templates stay in the service's own SCREAMING_SNAKE vocabulary.
     *
     * Any field on the track or album payload is already usable as a tag —
     * {SNG_TITLE}, {ART_NAME}, {ISRC}, {COPYRIGHT} and the rest resolve
     * directly. A lowercase alias layer was briefly added here and removed: it
     * gave one service two names for the same thing, while Qobuz's templates
     * are lowercase because that is what *its* API calls those fields. One
     * vocabulary per service is the thing that makes the placeholders
     * predictable.
     *
     * Only genuinely derived values need mapping — a year is not a field,
     * Deezer stores a full date.
     */
    const RELEASE_DATE_FIELDS = ['PHYSICAL_RELEASE_DATE', 'ORIGINAL_RELEASE_DATE', 'DIGITAL_RELEASE_DATE'];

    for (const rawKey of file) {
      const key = rawKey;
      const value_album: string | undefined = dotProp.get(albumInfo, key);
      let value_track: string | undefined = value_album || dotProp.get(track, key);

      /* {YEAR}: derived, because Deezer only stores full dates and putting
         "2001-03-07" in a folder name is not what anyone means by year. */
      if (rawKey === 'YEAR') {
        const source = RELEASE_DATE_FIELDS.map(
          (field) => dotProp.get(albumInfo, field) ?? dotProp.get(track, field),
        ).find((value) => typeof value === 'string' && value.length > 0) as string | undefined;
        const parsed = source ? new Date(source) : null;
        value_track = parsed && !Number.isNaN(parsed.getTime()) ? String(parsed.getFullYear()) : undefined;
      }
      if (key === 'TRACK_NUMBER' || key === 'TRACK_POSITION' || key === 'NO_TRACK_NUMBER') {
        path = path.replace(
          `{${rawKey}}`,
          value_track ? Number(value_track).toLocaleString('en-US', {minimumIntegerDigits}) : '',
        );
        trackNumber = false;
      } else {
        path = path.replace(`{${rawKey}}`, value_track ? sanitizeFilename(value_track) : '');
      }
    }
  }

  if (trackNumber && (track.TRACK_NUMBER || track.TRACK_POSITION)) {
    const [dir, base] = [dirname(path), basename(path)];
    const position = track.TRACK_POSITION ? track.TRACK_POSITION : Number(track.TRACK_NUMBER);
    path = join(dir, position.toLocaleString('en-US', {minimumIntegerDigits}) + ' - ' + base);
  } else {
    path = join(path);
  }

  return path.replace(/[?%*|"<>]/g, '').trim();
};

export const qobuzSaveLayout = ({
  track,
  album,
  path,
  minimumIntegerDigits,
  trackNumber,
  qobuzDownloadCover,
  listTitle, // New parameter for playlist title
}: saveLayoutProps & {listTitle?: string}) => {
  // Adding listTitle as an optional parameter
  // Clone album info
  const albumInfo = {...album};

  // Use relative path
  if (path.startsWith('{')) {
    path = './' + path;
  }

  // Check for 'no_track_number' in path
  if (path.includes('{no_track_number}')) {
    path = path.replace('{no_track_number}', '');
    trackNumber = false;
  }

  // Transform values
  const file = path.match(/(?<=\{)[^}]*/g);
  if (file) {
    for (const key of file) {
      let value: string | undefined;

      // Check for simplified keys and map them to their actual paths
      let actualKey = key;
      switch (key) {
        case 'alb_title':
          actualKey = 'album.title';
          break;
        case 'genre':
          actualKey = 'album.genre.name';
          break;
        case 'release_date':
          actualKey = 'release_date_original';
          break;
        case 'alb_artist':
          actualKey = 'album.artist.name';
          break;
        case 'disc_number':
          actualKey = 'media_number'; // Key is same as actualKey in this case
          break;
        case 'maximum_bit_depth':
          actualKey = 'maximum_bit_depth'; // Key is same as actualKey in this case
          break;
        case 'maximum_sampling_rate':
          actualKey = 'maximum_sampling_rate'; // Key is same as actualKey in this case
          break;
        // Friendly aliases. Templates should not have to know that Qobuz calls
        // an album's artist `album.artist.name`.
        case 'artist':
          actualKey = 'performer.name';
          break;
        case 'album':
          actualKey = 'album.title';
          break;
        case 'album_artist':
          actualKey = 'album.artist.name';
          break;
        case 'composer':
          actualKey = 'composer.name';
          break;
        case 'label':
          actualKey = 'album.label.name';
          break;
        case 'isrc':
          actualKey = 'isrc';
          break;
        case 'copyright':
          actualKey = 'copyright';
          break;
        case 'total_tracks':
          actualKey = 'album.tracks_count';
          break;
        case 'version':
          actualKey = 'version';
          break;
        case 'playlist':
        case 'list_title': // Adding case for list_title
          value = sanitizeFilename(listTitle || 'Unknown Playlist');
          break;
      }

      if (!value) {
        const value_album = dotProp.get(albumInfo, actualKey);
        const value_track = value_album || dotProp.get(track, actualKey);

        if (typeof value_track === 'number' || typeof value_track === 'string') {
          switch (key) {
            case 'track_number':
              value = trackNumber ? value_track.toLocaleString('en-US', {minimumIntegerDigits}) : '';
              break;
            case 'disc_number':
              value = `Disc ${value_track}`;
              break;
            case 'maximum_bit_depth':
              value = `${value_track}bit`;
              break;
            case 'maximum_sampling_rate':
              value = `${value_track}khz`;
              break;
            case 'maximum_bit_rate':
              value = value_track.toString();
              break;
            default:
              value = sanitizeFilename(value_track.toString());
              break;
          }
        } else {
          value = '';
        }
      }

      path = path.replace(`{${key}}`, value ? value : '');
    }
  }

  if (trackNumber && track.track_number) {
    const [dir, base] = [dirname(path), basename(path)];
    const position = Number(track.track_number);
    path = join(dir, position.toLocaleString('en-US', {minimumIntegerDigits}) + ' - ' + base);
  } else {
    path = join(path);
  }

  return path.replace(/[?%*|"<>]/g, '').trim();
};

/**
 * Fields a YouTube Music download can fill a naming template with.
 *
 * Deliberately small. Deezer and Qobuz templates expose whatever their APIs
 * return, and YouTube returns very little: a title, an uploader, and whatever
 * the album page stated. Offering `{isrc}` or `{composer}` here would be
 * offering placeholders that silently resolve to nothing.
 */
export interface YtMusicLayoutFields {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  year?: number | null;
  trackNumber?: number | null;
  trackTotal?: number | null;
  videoId?: string;
  /** The collection a playlist download came from, for the playlist template. */
  playlist?: string;
}

/**
 * Build a YouTube Music file path from a naming template.
 *
 * Its own vocabulary, like the other two services have theirs — lowercase,
 * because that is the shape Qobuz templates already use and YouTube has no
 * SCREAMING_SNAKE field names of its own to borrow.
 *
 * A template that names nothing usable still produces a filename: an empty
 * placeholder leaves an empty segment, and a path of empty segments would
 * write to a directory rather than a file.
 */
export const ytmusicSaveLayout = ({
  fields,
  path,
  minimumIntegerDigits = 2,
  trackNumber = true,
}: {
  fields: YtMusicLayoutFields;
  path: string;
  minimumIntegerDigits?: number;
  trackNumber?: boolean;
}): string => {
  let result = path;

  if (result.includes('{no_track_number}')) {
    result = result.replace('{no_track_number}', '');
    trackNumber = false;
  }

  const number = fields.trackNumber ? Number(fields.trackNumber).toLocaleString('en-US', {minimumIntegerDigits}) : '';

  const values: Record<string, string> = {
    title: fields.title ?? '',
    artist: fields.artist ?? '',
    album: fields.album ?? '',
    album_artist: fields.albumArtist ?? fields.artist ?? '',
    year: fields.year ? String(fields.year) : '',
    track_number: number,
    total_tracks: fields.trackTotal ? String(fields.trackTotal) : '',
    video_id: fields.videoId ?? '',
    playlist: fields.playlist ?? '',
  };

  for (const key of result.match(/(?<=\{)[^}]*/g) ?? []) {
    const value = values[key];
    result = result.replace(`{${key}}`, value ? sanitizeFilename(value) : '');
  }

  /* Prefix the number when the template did not place one itself. */
  if (trackNumber && number && !path.includes('{track_number}')) {
    const [dir, base] = [dirname(result), basename(result)];
    result = join(dir, `${number} ${base}`);
  }

  /* Collapse the gaps an unfilled placeholder leaves behind. */
  result = result
    .split(/[\/]/)
    .map((segment) => segment.replace(/\s{2,}/g, ' ').replace(/^[\s\-_]+|[\s\-_]+$/g, ''))
    .filter(Boolean)
    .join('/');

  return result.replace(/[?%*|"<>]/g, '').trim();
};

export const progressBar = (total: number, width: number) => {
  const incomplete = Array(width).fill('█').join('');
  const complete = Array(width).fill('█').join('');
  const unit = total / width;

  return (value: number) => {
    let chars = unit === 0 ? width : Math.floor(value / unit);
    if (value >= total) {
      chars = complete.length;
    }
    return chalk.cyanBright(complete.slice(0, chars)) + chalk.gray(incomplete.slice(chars));
  };
};

/**
 * The deepest folder every one of these paths sits inside.
 *
 * Cut at a separator, not at a character. Comparing the strings alone returns
 * the longest shared prefix, which can stop in the middle of a folder name —
 * "Justin Quiles & Lenny Tavárez" and "Justin Quiles" share "Justin Quiles",
 * and a playlist written to that folder fails with ENOENT because no such
 * folder was ever created. It only shows up when a playlist spans folders
 * whose names share a prefix, which is why it went unnoticed.
 */
export const commonPath = (paths: string[]) => {
  if (paths.length === 0) return '';

  const sorted = paths.concat().sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let i = 0;
  while (i < first.length && first.charAt(i) === last.charAt(i)) i++;
  const prefix = first.substring(0, i);

  /* Every path identical: the prefix is that folder, whole. */
  if (first === last) return prefix;

  const cut = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
  return cut >= 0 ? prefix.substring(0, cut) : prefix;
};
