import {
  getAlbumInfo,
  getAlbumTracks,
  getArtistInfo,
  getDiscography,
  getPlaylistInfo,
  getPlaylistTracks,
  getTrackInfo,
} from '../deezer';
import {qobuz} from '../';
import * as qobuzTypes from '../qobuz/types';
import spotifyUri from 'spotify-uri';
import axios from 'axios';
import * as spotify from './spotify';
import * as tidal from './tidal';
import * as youtube from './youtube';
import PQueue from 'p-queue';
import type {albumType, artistInfoType, playlistInfo, trackType} from '../deezer/types';

type linkType = 'track' | 'album' | 'artist' | 'playlist';

export type urlPartsType = {
  id: string;
  type:
    | 'track'
    | 'album'
    | 'audiobook'
    | 'artist'
    | 'playlist'
    | 'qobuz-track'
    | 'qobuz-album'
    | 'qobuz-playlist'
    | 'qobuz-artist'
    | 'spotify-track'
    | 'spotify-album'
    | 'spotify-playlist'
    | 'spotify-artist'
    | 'tidal-track'
    | 'tidal-album'
    | 'tidal-playlist'
    | 'tidal-artist'
    | 'youtube-track';
};

const queue = new PQueue({concurrency: 10});

export const getUrlParts = async (url: string, setToken = false): Promise<urlPartsType> => {
  if (url.startsWith('spotify:')) {
    const spotify = url.split(':');
    url = 'https://open.spotify.com/' + spotify[1] + '/' + spotify[2];
  }

  const site = url.match(/deezer|qobuz|spotify|tidal|youtu\.?be/);
  if (!site) {
    throw new Error('Unknown URL: ' + url);
  }

  switch (site[0]) {
    case 'deezer':
      if (url.includes('page.link') || url.includes('link.deezer.com')) {
        const {request} = await axios.head(url);
        url = request.res.responseUrl;
      }
      const deezerUrlParts = url.split(/\/(\w+)\/(\d+)/);
      return {type: deezerUrlParts[1] as any, id: deezerUrlParts[2]};

    case 'qobuz':
      const qobuzUrlParts = url.split(/\/(\w+)\/(\w+)/);
      return {type: ('qobuz-' + qobuzUrlParts[1]) as any, id: qobuzUrlParts[2]};

    case 'spotify':
      const spotifyUrlParts = spotifyUri.parse(url);
      if (setToken) {
        await spotify.setSpotifyAnonymousToken();
      }
      return {type: ('spotify-' + spotifyUrlParts.type) as any, id: (spotifyUrlParts as any).id};

    case 'tidal':
      const tidalUrlParts = url.split(
        /\/(\w+)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d+)/,
      );
      return {type: ('tidal-' + tidalUrlParts[1]) as any, id: tidalUrlParts[2]};

    case 'youtube':
      let yotubeId = url.split('v=')[1];
      if (yotubeId.includes('&')) {
        yotubeId = yotubeId.split('&')[0];
      }
      return {type: 'youtube-track', id: yotubeId};

    case 'youtu.be':
      return {type: 'youtube-track', id: url.split('/').pop() as string};

    default:
      throw new Error('Unable to parse URL: ' + url);
  }
};

/**
 * Deezer, Spotify or Tidal links only
 * @param {String} url
 */
export const parseInfo = async (url: string) => {
  const info = await getUrlParts(url, true);
  if (!info.id) {
    throw new Error('Unable to parse id');
  }

  let linktype: linkType = 'track';
  let linkinfo: trackType | albumType | playlistInfo | artistInfoType | Record<string, any> = {};
  let tracks: trackType[] = [];

  switch (info.type) {
    case 'track': {
      tracks.push(await getTrackInfo(info.id));
      break;
    }

    case 'album':
    case 'audiobook':
      linkinfo = await getAlbumInfo(info.id);
      linktype = 'album';
      const albumTracks = await getAlbumTracks(info.id);
      tracks = albumTracks.data;
      break;

    case 'playlist':
      linkinfo = await getPlaylistInfo(info.id);
      linktype = 'playlist';
      const playlistTracks = await getPlaylistTracks(info.id);
      tracks = playlistTracks.data;
      break;

    case 'artist':
      linkinfo = await getArtistInfo(info.id);
      linktype = 'artist';
      const artistAlbums = await getDiscography(info.id);
      await queue.addAll(
        artistAlbums.data.map((album) => {
          return async () => {
            if (album.ARTISTS.find((a) => a.ART_ID === info.id)) {
              const albumTracks = await getAlbumTracks(album.ALB_ID);
              tracks = [...tracks, ...albumTracks.data.filter((t) => t.ART_ID === info.id)];
            }
          };
        }),
      );
      break;

    case 'spotify-track':
      tracks.push(await spotify.track2deezer(info.id));
      break;

    case 'spotify-album':
      const [spotifyAlbumInfo, spotifyTracks] = await spotify.album2deezer(info.id);
      tracks = spotifyTracks;
      linkinfo = spotifyAlbumInfo;
      linktype = 'album';
      break;

    case 'spotify-playlist':
      const [spotifyPlaylistInfo, spotifyPlaylistTracks] = await spotify.playlist2Deezer(info.id);
      tracks = spotifyPlaylistTracks;
      linkinfo = spotifyPlaylistInfo;
      linktype = 'playlist';
      break;

    case 'spotify-artist':
      tracks = await spotify.artist2Deezer(info.id);
      linktype = 'artist';
      break;

    case 'tidal-track':
      tracks.push(await tidal.track2deezer(info.id));
      break;

    case 'tidal-album':
      const [tidalAlbumInfo, tidalAlbumTracks] = await tidal.album2deezer(info.id);
      tracks = tidalAlbumTracks;
      linkinfo = tidalAlbumInfo;
      linktype = 'album';
      break;

    case 'tidal-playlist':
      const [tidalPlaylistInfo, tidalPlaylistTracks] = await tidal.playlist2Deezer(info.id);
      tracks = tidalPlaylistTracks;
      linkinfo = tidalPlaylistInfo;
      linktype = 'playlist';
      break;

    case 'tidal-artist':
      tracks = await tidal.artist2Deezer(info.id);
      linktype = 'artist';
      break;

    case 'youtube-track':
      tracks.push(await youtube.track2deezer(info.id));
      break;

    default:
      throw new Error('Unknown type: ' + info.type);
  }

  return {
    info,
    linktype,
    linkinfo,
    tracks: tracks.map((t) => {
      if (t.VERSION && !t.SNG_TITLE.includes(t.VERSION)) {
        t.SNG_TITLE += ' ' + t.VERSION;
      }
      return t;
    }),
  };
};

// TODO: merge with parseInfo()
export const parseQobuzUrl = async (url: string) => {
  const info = await getUrlParts(url, true);
  let linktype = 'track';
  let linkinfo: any;
  let tracks: qobuz.types.trackType[] = [];

  switch (info.type) {
    case 'qobuz-track': {
      const trackData = await qobuz.getTrackInfo(+info.id);
      linkinfo = trackData.album;
      linktype = 'qobuz-track';
      tracks.push(trackData);
      break;
    }
    case 'qobuz-album': {
      const albumData = await qobuz.getAlbumInfo(info.id);
      const albumWithoutTracks = {...albumData};
      linktype = 'qobuz-album';
      tracks = albumData.tracks?.items || [];
      albumWithoutTracks.tracks = null as any;
      linkinfo = albumWithoutTracks;
      tracks = tracks.map((t: qobuz.types.trackType) => {
        t.album = albumWithoutTracks;
        return t;
      });
      break;
    }
    case 'qobuz-playlist': {
      let offset = 0;
      const limit = 150;
      let moreTracks = true;

      while (moreTracks) {
        const playlistData = await qobuz.getPlaylistTracks(info.id, {offset, limit});

        if (!playlistData || !playlistData.tracks || !playlistData.tracks.items) {
          throw new Error('Playlist data is malformed or tracks are missing.');
        }

        linkinfo = {
          ...playlistData,
          title: playlistData.name || playlistData.title || 'Unknown Playlist',
        };
        linktype = 'qobuz-playlist';

        tracks = tracks.concat(
          playlistData.tracks.items.map((t: qobuz.types.trackType) => {
            if (!t.title) {
              console.warn(`Warning: Track with ID ${t.id} is missing a title.`);
              t.title = 'Unknown Title'; // Fallback title
            }

            if (t.version && !t.title.includes(t.version)) {
              t.title += ` (${t.version})`;
            }

            // Additional safeguard if title or other string properties are used
            if (!t.title || typeof t.title !== 'string') {
              console.error(`Error: Track with ID ${t.id} has an invalid title.`);
            }

            return t;
          }),
        );

        if (playlistData.tracks.items.length < limit) {
          moreTracks = false;
        } else {
          offset += limit;
        }
      }
      break;
    }
    case 'qobuz-artist': {
      const artistData = await qobuz.getArtistInfo(info.id);
      linkinfo = artistData;
      linktype = 'qobuz-artist';
      const albumsData = await qobuz.getArtistAlbums(info.id);
      const allAlbums = albumsData.albums.items;
      for (const album of allAlbums) {
        const albumData = await qobuz.getAlbumInfo(album.id);
        tracks = tracks.concat(albumData.tracks.items);
      }
      break;
    }
    default:
      throw new Error('Unsupported URL type: ' + info.type);
  }

  return {
    info,
    linktype,
    linkinfo,
    tracks: tracks.map((t) => {
      if (t.version && !t.title.includes(t.version)) {
        t.title += ` (${t.version})`;
      }
      return t;
    }),
  };
};
