import PQueue from 'p-queue';
import {getUrlParts, qobuz, tidal, youtube} from '../core';
import {requestPublicApi} from '../core/deezer';
import type {trackType as deezerTrackType} from '../core/deezer/types/tracks';
import * as qobuzParser from '../parsers/qobuz';
import {parseQobuzUrl} from '../core';

const queue = new PQueue({concurrency: 2});

type qobuzConversionProgressType = {
  phase: string;
  message: string;
  current?: number;
  total?: number;
  percentage?: number;
};

const emitProgress = (
  onProgress: ((progress: qobuzConversionProgressType) => void) | undefined,
  payload: qobuzConversionProgressType,
): void => {
  if (onProgress) {
    onProgress(payload);
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isQobuzRateLimitError = (error: any) => {
  const message = String(error?.message || '');
  return message.includes('(code: 429)') || message.includes('protective search limit');
};

const withQobuzRetry = async <T>(operation: () => Promise<T>, maxAttempts = 6): Promise<T> => {
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (!isQobuzRateLimitError(error) || attempt === maxAttempts) {
        throw error;
      }

      await wait(1000 * attempt);
    }
  }

  throw lastError;
};

const convertDeezerTrackToQobuz = async (track: deezerTrackType): Promise<qobuz.types.trackType> => {
  const durationSeconds = track.DURATION ? Number(track.DURATION) : undefined;
  return await withQobuzRetry(() =>
    qobuzParser.isrc2qobuz(track.SNG_TITLE, track.ISRC, track.ART_NAME, track.ALB_TITLE, durationSeconds),
  );
};

const convertTidalTrackToQobuz = async (track: any): Promise<qobuz.types.trackType> => {
  const title = String(track?.title || 'Unknown Track');
  const artist = String(track?.artist?.name || track?.artists?.[0]?.name || '');
  const album = String(track?.album?.title || '');
  const durationSeconds = track?.duration ? Number(track.duration) : undefined;
  const isrc = track?.isrc ? String(track.isrc) : undefined;

  try {
    return await withQobuzRetry(() => qobuzParser.isrc2qobuz(title, isrc, artist, album, durationSeconds));
  } catch (_) {
    // Fall through to a metadata-enriched Deezer lookup.
  }

  try {
    const deezerTrack = await tidal.track2deezer(String(track?.id || ''));
    return await convertDeezerTrackToQobuz(deezerTrack as deezerTrackType);
  } catch (_) {
    // Last resort below.
  }

  return await withQobuzRetry(() => qobuzParser.searchQobuzTrack(title, artist, album, durationSeconds));
};

const convertDeezerTrackListToQobuz = async (
  tracks: deezerTrackType[],
  onProgress?: (progress: qobuzConversionProgressType) => void,
): Promise<qobuz.types.trackType[]> => {
  const converted: qobuz.types.trackType[] = [];
  let processed = 0;
  let failures = 0;
  const total = tracks.length;

  await queue.addAll(
    tracks.map((track, index) => async () => {
      try {
        const convertedTrack = await convertDeezerTrackToQobuz(track);
        convertedTrack.track_number = index + 1;
        converted.push(convertedTrack);
      } catch (error) {
        failures++;
      } finally {
        processed++;
        emitProgress(onProgress, {
          phase: 'matching',
          message: `Matching tracks on Qobuz... ${processed}/${total}`,
          current: processed,
          total,
          percentage: total > 0 ? Math.round((processed / total) * 100) : 100,
        });
      }
    }),
  );

  emitProgress(onProgress, {
    phase: 'matching',
    message: `Matched ${converted.length}/${total} tracks on Qobuz${failures > 0 ? ` (${failures} not found)` : ''}.`,
    current: total,
    total,
    percentage: 100,
  });

  return converted;
};

const convertTidalTrackListToQobuz = async (
  tracks: any[],
  onProgress?: (progress: qobuzConversionProgressType) => void,
): Promise<qobuz.types.trackType[]> => {
  const converted: qobuz.types.trackType[] = [];
  let processed = 0;
  let failures = 0;
  const total = tracks.length;

  await queue.addAll(
    tracks.map((track, index) => async () => {
      try {
        const convertedTrack = await convertTidalTrackToQobuz(track);
        convertedTrack.track_number = index + 1;
        converted.push(convertedTrack);
      } catch (_) {
        failures++;
      } finally {
        processed++;
        emitProgress(onProgress, {
          phase: 'matching',
          message: `Matching tracks on Qobuz... ${processed}/${total}`,
          current: processed,
          total,
          percentage: total > 0 ? Math.round((processed / total) * 100) : 100,
        });
      }
    }),
  );

  emitProgress(onProgress, {
    phase: 'matching',
    message: `Matched ${converted.length}/${total} tracks on Qobuz${failures > 0 ? ` (${failures} not found)` : ''}.`,
    current: total,
    total,
    percentage: 100,
  });

  return converted;
};

const buildPlaylistInfo = (source: {
  id: string;
  title: string;
  description?: string;
  ownerId?: string;
  ownerName?: string;
  totalTracks: number;
  imageUrl?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
}) => ({
  id: source.id,
  name: source.title,
  title: source.title,
  owner: {
    name: source.ownerName || source.ownerId || 'Unknown',
    id: source.ownerId || source.ownerName || 'unknown',
  },
  tracks_count: source.totalTracks,
  duration: 0,
  created_at:
    typeof source.createdAt === 'number'
      ? source.createdAt
      : source.createdAt
      ? Math.floor(new Date(source.createdAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
  updated_at:
    typeof source.updatedAt === 'number'
      ? source.updatedAt
      : source.updatedAt
      ? Math.floor(new Date(source.updatedAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
  description: source.description || '',
  image: {
    large: source.imageUrl || '',
    small: source.imageUrl || '',
    thumbnail: source.imageUrl || '',
  },
});

const getPublicDeezerTrack = async (trackId: string): Promise<any> => requestPublicApi(`/track/${trackId}`);

const getPublicDeezerAlbum = async (albumId: string): Promise<any> => requestPublicApi(`/album/${albumId}`);

const getPublicDeezerArtist = async (artistId: string): Promise<any> => requestPublicApi(`/artist/${artistId}`);

const getAllPublicDeezerPages = async (initialPath: string): Promise<any[]> => {
  const items: any[] = [];
  let pageUrl: string | null = initialPath;

  while (pageUrl) {
    const normalizedPageUrl: string = pageUrl.replace(/^https?:\/\/api\.deezer\.com/i, '');
    const page: any = await requestPublicApi(normalizedPageUrl);
    items.push(...((page?.data as any[]) || []));
    pageUrl = page?.next || null;
  }

  return items;
};

const getPublicDeezerAlbumTracks = async (albumId: string): Promise<any[]> =>
  await getAllPublicDeezerPages(`/album/${albumId}/tracks?limit=100`);

const getPublicDeezerArtistAlbums = async (artistId: string): Promise<any[]> =>
  await getAllPublicDeezerPages(`/artist/${artistId}/albums?limit=100`);

const getPublicDeezerPlaylist = async (playlistId: string) => {
  const playlistInfo = await requestPublicApi(`/playlist/${playlistId}`);
  const tracks = await getAllPublicDeezerPages(`/playlist/${playlistId}/tracks?limit=100`);
  return {playlistInfo, tracks};
};

export const parseToQobuz = async (
  url: string,
  onProgress?: (progress: qobuzConversionProgressType) => void,
): Promise<{
  info: {type: string; id: string};
  linktype: string;
  linkinfo: any;
  tracks: qobuz.types.trackType[];
}> => {
  const info = await getUrlParts(url, true);
  if (!info.id) {
    throw new Error('Unable to parse id');
  }

  let linktype = 'qobuz-track';
  let linkinfo: any = {};
  let tracks: qobuz.types.trackType[] = [];

  switch (info.type) {
    case 'qobuz-track':
    case 'qobuz-album':
    case 'qobuz-playlist':
    case 'qobuz-artist':
      return await parseQobuzUrl(url);

    case 'spotify-track': {
      emitProgress(onProgress, {
        phase: 'auth',
        message: 'Authorizing with Spotify...',
        percentage: 5,
      });
      tracks.push(await qobuzParser.track2qobuz(info.id));
      linktype = 'qobuz-track';
      break;
    }

    case 'spotify-album': {
      emitProgress(onProgress, {
        phase: 'fetch',
        message: 'Fetching Spotify album...',
        percentage: 10,
      });
      const [albumInfo, albumTracks] = await qobuzParser.album2qobuz(info.id);
      tracks = albumTracks;
      linkinfo = albumInfo;
      linktype = 'qobuz-album';
      break;
    }

    case 'spotify-playlist': {
      emitProgress(onProgress, {
        phase: 'fetch',
        message: 'Fetching Spotify playlist...',
        percentage: 10,
      });
      const [playlistInfo, playlistTracks] = await qobuzParser.playlist2Qobuz(info.id, undefined, onProgress);
      tracks = playlistTracks;
      linkinfo = playlistInfo;
      linktype = 'qobuz-playlist';
      break;
    }

    case 'spotify-artist': {
      emitProgress(onProgress, {
        phase: 'fetch',
        message: 'Fetching Spotify artist...',
        percentage: 10,
      });
      tracks = await qobuzParser.artist2Qobuz(info.id);
      linktype = 'qobuz-artist';
      break;
    }

    case 'track': {
      const deezerTrack = await getPublicDeezerTrack(info.id);
      tracks.push(
        await qobuzParser.isrc2qobuz(
          deezerTrack.title,
          deezerTrack.isrc,
          deezerTrack.artist?.name,
          deezerTrack.album?.title,
          deezerTrack.duration,
        ),
      );
      linktype = 'qobuz-track';
      break;
    }

    case 'album':
    case 'audiobook': {
      const deezerAlbum = await getPublicDeezerAlbum(info.id);
      try {
        const [albumInfo, albumTracks] = await qobuzParser.upc2qobuz(deezerAlbum.title, deezerAlbum.upc);
        tracks = albumTracks;
        linkinfo = albumInfo;
      } catch {
        const deezerAlbumTracks = await getPublicDeezerAlbumTracks(info.id);
        const deezerLikeTracks = deezerAlbumTracks.map((item: any, index) => ({
          SNG_TITLE: item.title_version ? `${item.title} ${item.title_version}`.trim() : item.title,
          ISRC: item.isrc,
          ART_NAME: item.artist?.name,
          ALB_TITLE: item.album?.title,
          DURATION: String(item.duration || 0),
          TRACK_POSITION: index + 1,
        })) as deezerTrackType[];
        tracks = await convertDeezerTrackListToQobuz(deezerLikeTracks, onProgress);
        linkinfo = {
          id: deezerAlbum.id,
          title: deezerAlbum.title,
          name: deezerAlbum.title,
          artist: deezerAlbum.artist?.name,
        };
      }
      linktype = 'qobuz-album';
      break;
    }

    case 'playlist': {
      const {playlistInfo: deezerPlaylist, tracks: deezerPlaylistTracks} = await getPublicDeezerPlaylist(info.id);
      const deezerLikeTracks = deezerPlaylistTracks.map((item: any, index) => ({
        SNG_TITLE: item.title_version ? `${item.title} ${item.title_version}`.trim() : item.title,
        ISRC: item.isrc,
        ART_NAME: item.artist?.name,
        ALB_TITLE: item.album?.title,
        DURATION: String(item.duration || 0),
        TRACK_POSITION: index + 1,
      })) as deezerTrackType[];
      tracks = await convertDeezerTrackListToQobuz(deezerLikeTracks, onProgress);
      linkinfo = buildPlaylistInfo({
        id: String(deezerPlaylist.id),
        title: deezerPlaylist.title,
        description: deezerPlaylist.description,
        ownerId: String(deezerPlaylist.creator?.id || ''),
        ownerName: deezerPlaylist.creator?.name,
        totalTracks: Number(deezerPlaylist.nb_tracks || deezerLikeTracks.length || 0),
        imageUrl: deezerPlaylist.picture_xl || deezerPlaylist.picture_big || deezerPlaylist.picture_medium,
        createdAt: deezerPlaylist.creation_date,
        updatedAt: deezerPlaylist.mod_date,
      });
      linktype = 'qobuz-playlist';
      break;
    }

    case 'artist': {
      const deezerArtist = await getPublicDeezerArtist(info.id);
      const deezerArtistAlbums = await getPublicDeezerArtistAlbums(info.id);
      const deezerTracks: deezerTrackType[] = [];

      await queue.addAll(
        deezerArtistAlbums.map((album: any) => async () => {
          if (String(album.artist?.id) === String(info.id)) {
            const albumTracks = await getPublicDeezerAlbumTracks(String(album.id));
            deezerTracks.push(
              ...(albumTracks
                .filter((track: any) => String(track.artist?.id) === String(info.id))
                .map((track: any, index) => ({
                  SNG_TITLE: track.title_version ? `${track.title} ${track.title_version}`.trim() : track.title,
                  ISRC: track.isrc,
                  ART_NAME: track.artist?.name,
                  ALB_TITLE: track.album?.title,
                  DURATION: String(track.duration || 0),
                  TRACK_POSITION: index + 1,
                })) as deezerTrackType[]),
            );
          }
        }),
      );

      tracks = await convertDeezerTrackListToQobuz(deezerTracks, onProgress);
      linkinfo = deezerArtist;
      linktype = 'qobuz-artist';
      break;
    }

    case 'tidal-track': {
      const tidalTrack = await tidal.getTrack(info.id);
      tracks.push(await convertTidalTrackToQobuz(tidalTrack));
      linktype = 'qobuz-track';
      break;
    }

    case 'tidal-album': {
      const tidalAlbum = await tidal.getAlbum(info.id);
      try {
        const [albumInfo, albumTracks] = await qobuzParser.upc2qobuz(tidalAlbum.title, tidalAlbum.upc);
        tracks = albumTracks;
        linkinfo = albumInfo;
      } catch {
        const tidalAlbumTracks = await tidal.getAlbumTracks(info.id);
        tracks = await convertTidalTrackListToQobuz(tidalAlbumTracks.items, onProgress);
        linkinfo = {
          id: tidalAlbum.id,
          title: tidalAlbum.title,
          name: tidalAlbum.title,
          artist: tidalAlbum.artist?.name,
        };
      }
      linktype = 'qobuz-album';
      break;
    }

    case 'tidal-playlist': {
      const tidalPlaylist = await tidal.getPlaylist(info.id);
      const tidalPlaylistTracks = await tidal.getPlaylistTracks(info.id);
      const tidalPlaylistImage = tidalPlaylist.image ? tidal.albumArtToUrl(String(tidalPlaylist.image)) : null;
      tracks = await convertTidalTrackListToQobuz(tidalPlaylistTracks.items, onProgress);
      linkinfo = buildPlaylistInfo({
        id: tidalPlaylist.uuid,
        title: tidalPlaylist.title,
        description: tidalPlaylist.description,
        ownerId: String(tidalPlaylist.creator?.id || ''),
        ownerName: String(tidalPlaylist.creator?.id || 'TIDAL'),
        totalTracks: tidalPlaylist.numberOfTracks,
        imageUrl: tidalPlaylistImage?.xl || tidalPlaylistImage?.lg || tidalPlaylistImage?.md || tidalPlaylistImage?.sm,
        createdAt: tidalPlaylist.created,
        updatedAt: tidalPlaylist.lastUpdated,
      });
      linktype = 'qobuz-playlist';
      break;
    }

    case 'tidal-artist': {
      const tidalTracks = await tidal.getArtistTopTracks(info.id);
      tracks = await convertTidalTrackListToQobuz(tidalTracks.items, onProgress);
      linktype = 'qobuz-artist';
      break;
    }

    case 'youtube-track': {
      const deezerTrack = await youtube.track2deezer(info.id);
      tracks.push(await convertDeezerTrackToQobuz(deezerTrack as deezerTrackType));
      linktype = 'qobuz-track';
      break;
    }

    default:
      throw new Error(`Unsupported URL type for Qobuz conversion: ${info.type}`);
  }

  return {
    info,
    linktype,
    linkinfo,
    tracks: tracks.map((track) => {
      if (track.version && !track.title.includes(track.version)) {
        track.title += ` (${track.version})`;
      }
      return track;
    }),
  };
};
