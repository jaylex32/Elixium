import type {albumType} from './album';

export interface ImageType {
  small: string;
  thumbnail: string;
  large: string;
  back: string | null;
}

export interface ArtistType {
  id: number;
  name: string;
  albums_as_primary_artist_count: number;
  albums_as_primary_composer_count: number;
  albums_count: number;
  slug: string;
  picture: string | null;
  image: ImageType;
  similar_artist_ids: number[];
  information: string | null;
  biography: BiographyType;
  albums: ArtistAlbumsResponse;
}

export interface BiographyType {
  summary: string;
  content: string;
  source: string;
  language: string;
}

export interface AlbumType {
  maximum_bit_depth: number;
  image: ImageType;
  media_count: number;
  artist: ArtistType;
  artists: ArtistType[];
  upc: string;
  released_at: number;
  label: LabelType;
  title: string;
  qobuz_id: number;
  version: string | null;
  url: string;
  duration: number;
  parental_warning: boolean;
  popularity: number;
  tracks_count: number;
  genre: GenreType;
  maximum_channel_count: number;
  id: string;
  maximum_sampling_rate: number;
  articles: any[];
  release_date_original: string;
  release_date_download: string;
  release_date_stream: string;
  purchasable: boolean;
  streamable: boolean;
  previewable: boolean;
  sampleable: boolean;
  downloadable: boolean;
  displayable: boolean;
  purchasable_at: number | null;
  streamable_at: number;
  hires: boolean;
  hires_streamable: boolean;
}

export interface LabelType {
  id: number;
  name: string;
  albums_count: number;
  supplier_id: number;
  slug: string;
}

export interface GenreType {
  id: number;
  color: string;
  name: string;
  path: number[];
  slug: string;
}

export interface ArtistAlbumsResponse {
  total: number;
  offset: number;
  limit: number;
  items: AlbumType[];
}

export interface ArtistSearchResult {
  query: string;
  albums: ArtistAlbumsResponse;
}
