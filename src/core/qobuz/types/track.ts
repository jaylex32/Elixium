import type {albumType} from './album';

export interface trackType {
  maximum_bit_depth: number; // 24
  copyright: string; // '2021 Lone et la Lune under exclusive license to 3ème Bureau / Wagram Music 2021 Lone et la Lune under exclusive license to 3ème Bureau / Wagram Music'
  performers: string; // 'Lonepsi, Composer, MainArtist'
  audio_info: {
    replaygain_track_peak: number; // 0.91098
    replaygain_track_gain: number; // -9.04
  };
  performer: {
    name: string; // 'Lonepsi'
    id: number; // 3421267
  };
  album: albumType | null;
  work: null; // ?
  composer: {
    name: string; // 'Lonepsi'
    id: number; // 3421267
  };
  isrc: string; // 'FR6F32101880'
  title: string; // 'En boucle'
  version: string | null; // null
  duration: number; // 117
  parental_warning: boolean; // false
  track_number: number; // 7
  maximum_channel_count: number; // 2
  id: number; // 129094637
  media_number: number; // 1
  maximum_sampling_rate: number; // 44.1
  release_date_original: string; // ?
  release_date_download: null; // ?
  release_date_stream: null; // ?
  purchasable: boolean; // true
  streamable: boolean; // true
  previewable: boolean; // true
  sampleable: boolean; // true
  downloadable: boolean; // true
  displayable: boolean; // true
  purchasable_at: number; // 1635458400
  streamable_at: number; // 1635458400
  hires: boolean; // true
  hires_streamable: boolean; // true
}
