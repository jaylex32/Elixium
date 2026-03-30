import type {albumType} from './album';
import type {trackType} from './track';
import type {ArtistType} from './artist';

export interface searchTypeCommon {
  limit: number;
  offset: number;
  total: number;
}

export interface albumSearchType extends searchTypeCommon {
  items: albumType[];
}

export interface trackSearchType extends searchTypeCommon {
  items: trackType[];
}

export interface artistSearchType extends searchTypeCommon {
  items: ArtistType[];
}

export interface playlistSearchType extends searchTypeCommon {
  // TODO: implement playlist type
  items: any[];
}

export interface searchType {
  query: string;
  albums: albumSearchType;
  tracks: trackSearchType;
  artists: artistSearchType;
  playlists: playlistSearchType;
  // TODO: implement these types
  // focus:
  // articles:
  // most_popular:
}
