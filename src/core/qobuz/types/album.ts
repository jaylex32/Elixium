import type {trackType} from './track';

export interface albumType {
  maximum_bit_depth: number; // Maximum bit depth of the album
  image: ImageType; // Image details of the album
  media_count: number; // Number of media in the album
  artist: ArtistType; // Primary artist details
  artists: ArtistType[]; // Array of artists involved
  upc: string; // Universal Product Code
  released_at: number; // Release timestamp
  label: LabelType; // Label details
  title: string; // Album title
  qobuz_id: number; // Qobuz specific ID
  version: string | null; // Version of the album
  url: string; // URL of the album
  duration: number; // Duration of the album
  parental_warning: boolean; // Parental warning flag
  popularity: number; // Popularity score
  tracks_count: number; // Number of tracks
  genre: GenreType; // Genre details
  id: string; // Album ID
  maximum_sampling_rate: number; // Maximum sampling rate
  release_date_original: string; // Original release date
  release_date_download: string; // Download release date
  release_date_stream: string; // Stream release date
  purchasable: boolean; // Purchasable flag
  streamable: boolean; // Streamable flag
  previewable: boolean; // Previewable flag
  sampleable: boolean; // Sampleable flag
  downloadable: boolean; // Downloadable flag
  displayable: boolean; // Displayable flag
  purchasable_at: number; // Timestamp when it becomes purchasable
  streamable_at: number; // Timestamp when it becomes streamable
  hires: boolean; // High-resolution audio available flag
  hires_streamable: boolean; // High-resolution streaming available flag
  awards: string[]; // Array of awards
  description: string; // Album description
  description_language: string | null; // Language of the description
  area: string | null; // Geographical area
  catchline: string; // Catchline of the album
  composer: ComposerType; // Composer details
  created_at: number; // Creation timestamp
  genres_list: string[]; // List of genres
  period: string | null; // Time period
  copyright: string; // Copyright information
  is_official: boolean; // Official release flag
  maximum_technical_specifications: string; // Technical specifications
  product_sales_factors_monthly: number; // Monthly sales factors
  product_sales_factors_weekly: number; // Weekly sales factors
  product_sales_factors_yearly: number; // Yearly sales factors
  product_type: string; // Product type
  product_url: string; // Product URL
  recording_information: string; // Recording information
  relative_url: string; // Relative URL
  release_tags: string[]; // Release tags
  release_type: string; // Release type
  slug: string; // Slug for the album
  subtitle: string; // Subtitle of the album
  tracks: TrackListType; // Tracklist details
}

interface ImageType {
  small: string;
  thumbnail: string;
  large: string;
  back: string | null;
}

interface ArtistType {
  id: number;
  name: string;
  albums_count: number;
  slug: string;
  picture: string | null;
  image: string | null;
  roles?: string[];
}

interface LabelType {
  id: number;
  name: string;
  albums_count: number;
  supplier_id: number;
  slug: string;
}

interface GenreType {
  id: number;
  color: string;
  name: string;
  path: number[];
  slug: string;
}

interface ComposerType {
  id: number;
  name: string;
  slug: string;
  albums_count: number;
  picture: string | null;
  image: string | null;
}

interface TrackListType {
  offset: number;
  limit: number;
  total: number;
  items: TrackType[];
}

interface TrackType {
  maximum_bit_depth: number;
  copyright: string;
  performers: string;
  audio_info: AudioInfoType;
  performer: ArtistType;
  work: string | null;
  composer: ComposerType;
  isrc: string;
  title: string;
  version: string | null;
  duration: number;
  parental_warning: boolean;
  track_number: number;
  maximum_channel_count: number;
  id: number;
  media_number: number;
  maximum_sampling_rate: number;
  release_date_original: string;
  release_date_download: string;
  release_date_stream: string;
  release_date_purchase: string;
  purchasable: boolean;
  streamable: boolean;
  previewable: boolean;
  sampleable: boolean;
  downloadable: boolean;
  displayable: boolean;
  purchasable_at: number;
  streamable_at: number;
  hires: boolean;
  hires_streamable: boolean;
}

interface AudioInfoType {
  replaygain_track_peak: number;
  replaygain_track_gain: number;
}
