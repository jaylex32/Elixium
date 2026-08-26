import type {Service} from '@/types';

/**
 * The album and artist a result belongs to, read from its raw payload.
 *
 * Every list already carries `rawData`, and the ids needed to reach the rest of
 * the catalogue are sitting in it — they were simply never read, so a track
 * named its album and its artist as plain text with no way to open either.
 *
 * The field names differ per service and, for Deezer, per endpoint: its private
 * API sends ALB_ID / ART_ID while the public one nests `album.id` and
 * `artist.id`. Both are read rather than guessing which endpoint a row came
 * from.
 */
export interface Relations {
  albumId?: string;
  albumTitle?: string;
  albumCover?: string;
  artistId?: string;
  artistName?: string;
  artistPicture?: string;
}

type Raw = Record<string, unknown> | undefined | null;

const str = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const obj = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

/** Deezer builds cover URLs from an md5 hash; the public API sends them whole. */
const deezerCover = (raw: Record<string, unknown>, size = 500): string | undefined => {
  const md5 = str(raw.ALB_PICTURE);
  if (md5) return `https://e-cdns-images.dzcdn.net/images/cover/${md5}/${size}x${size}-000000-80-0-0.jpg`;
  return undefined;
};

const deezerArtistPicture = (raw: Record<string, unknown>, size = 500): string | undefined => {
  const md5 = str(raw.ART_PICTURE);
  if (md5) return `https://e-cdns-images.dzcdn.net/images/artist/${md5}/${size}x${size}-000000-80-0-0.jpg`;
  return undefined;
};

export function relationsOf(rawData: Raw, service: Service): Relations {
  if (!rawData) return {};
  const raw = rawData as Record<string, unknown>;

  /*
   * YouTube Music.
   *
   * This used to return nothing, on the belief that its rows named their album
   * and artist as text only. They do not: every name in a row is a link, and
   * the browse id behind it is tagged by what it points at. An album page names
   * its artist once in the header instead of on every row, so tracks inherit it
   * there — which is why a track linked through from search but not from inside
   * the album it belongs to.
   */
  if (service === 'ytmusic' || raw.ytmusic === true) {
    return {
      artistId: str(raw.artistId),
      artistName: str(raw.artist) ?? (Array.isArray(raw.artists) ? str(raw.artists[0]) : undefined),
      albumId: str(raw.albumId),
      albumTitle: str(raw.album),
      albumCover: str(raw.cover),
      artistPicture: str(raw.cover),
    };
  }

  if (service === 'deezer') {
    const album = obj(raw.album);
    const artist = obj(raw.artist);
    return {
      albumId: str(raw.ALB_ID) ?? str(album?.id),
      albumTitle: str(raw.ALB_TITLE) ?? str(album?.title),
      albumCover: deezerCover(raw) ?? str(album?.cover_medium) ?? str(album?.cover_big) ?? str(album?.cover),
      artistId: str(raw.ART_ID) ?? str(artist?.id),
      artistName: str(raw.ART_NAME) ?? str(artist?.name),
      artistPicture:
        deezerArtistPicture(raw) ?? str(artist?.picture_medium) ?? str(artist?.picture_big) ?? str(artist?.picture),
    };
  }

  // Qobuz. A track's own performer is the credited artist; the album's artist
  // is the one whose page collects the release.
  const album = obj(raw.album);
  const albumArtist = obj(album?.artist);
  const performer = obj(raw.performer);
  const image = obj(album?.image);

  return {
    albumId: str(album?.id) ?? str(raw.id),
    albumTitle: str(album?.title),
    albumCover: str(image?.large) ?? str(image?.small) ?? str(image?.thumbnail),
    artistId: str(albumArtist?.id) ?? str(performer?.id),
    artistName: str(albumArtist?.name) ?? str(performer?.name),
    artistPicture: str(obj(albumArtist?.image)?.large),
  };
}
