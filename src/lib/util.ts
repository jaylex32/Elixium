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

    for (const key of file) {
      const value_album: string | undefined = dotProp.get(albumInfo, key);
      const value_track: string | undefined = value_album || dotProp.get(track, key);
      if (key === 'TRACK_NUMBER' || key === 'TRACK_POSITION' || key === 'NO_TRACK_NUMBER') {
        path = path.replace(
          `{${key}}`,
          value_track ? Number(value_track).toLocaleString('en-US', {minimumIntegerDigits}) : '',
        );
        trackNumber = false;
      } else {
        path = path.replace(`{${key}}`, value_track ? sanitizeFilename(value_track) : '');
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

export const commonPath = (paths: string[]) => {
  const A = paths.concat().sort(),
    a1 = A[0],
    a2 = A[A.length - 1],
    L = a1.length;

  let i = 0;
  while (i < L && a1.charAt(i) === a2.charAt(i)) i++;
  return a1.substring(0, i);
};
