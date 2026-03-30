export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  year?: number | null;
  type: string;
  maximum_bit_depth?: number;
  maximum_sampling_rate?: number;
  hires?: boolean;
  hires_streamable?: boolean;
  rawData: any;
}

export type CatalogService = 'deezer' | 'qobuz';
export type CatalogType = 'artist' | 'album' | 'track' | 'playlist';

export interface SearchGroups {
  artist: SearchResult[];
  album: SearchResult[];
  track: SearchResult[];
  playlist: SearchResult[];
}

export interface SearchDirective {
  query: string;
  forcedType?: CatalogType;
}

export interface SessionQueueItem {
  label: string;
  url: string;
  preview?: QueuePreview;
}

export interface QueuePreview {
  status: 'ready' | 'error';
  contentType: string;
  title: string;
  artist: string;
  trackCount: number;
  detail: string;
  errorMessage?: string;
}
