import {qobuzRequest} from './request';
import type {searchType, trackSearchType, artistSearchType, playlistSearchType} from '../types';

export const getAlbumInfo = async (album_id: string) => qobuzRequest('album/get', {album_id});

export const getTrackInfo = async (track_id: number) => qobuzRequest('track/get', {track_id});

export const getArtistInfo = async (artist_id: string) => {
  return qobuzRequest('artist/get', {artist_id: artist_id, extra: 'albums'});
};

export const getArtistAlbums = async (artist_id: string, options: {offset?: number; limit?: number} = {}) => {
  return qobuzRequest('artist/get', {
    artist_id: artist_id,
    extra: 'albums',
    offset: options.offset || 0,
    limit: options.limit || 25,
  });
};

export const getPlaylistTracks = async (playlist_id: string, options: {offset?: number; limit?: number} = {}) => {
  return qobuzRequest('playlist/get', {
    playlist_id: playlist_id,
    extra: 'tracks',
    offset: options.offset || 0, // default offset to 0 if not provided
    limit: options.limit || 50, // default limit to 50 if not provided
  });
};

type searchTypesProp = 'catalog' | 'album' | 'artist' | 'track' | 'playlist';

export const searchMusic = async (
  query: string,
  type: searchTypesProp = 'track',
  limit = 28,
  offset = 0,
): Promise<searchType> => qobuzRequest(`${type}/search`, {query, limit, offset});
// https://www.qobuz.com/api.json/0.2/catalog/search?query=eminem #ByMainArtist&offset=0&limit=10
// Parameters:
// #ByMainArtist
// #ByComposer
// #ByPerformer
// #ByReleaseName
// #ByLabel
