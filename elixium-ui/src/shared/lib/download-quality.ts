import type {Service} from '@/types';

/**
 * What quality a download can be asked for, per service.
 *
 * Separated from the menu that renders it so the choices can be read without
 * pulling in a component — and so the menu file exports only components.
 */

export interface QualityChoice {
  /** What goes on the wire: the engine's own spelling. */
  value: string;
  label: string;
  /** The shorthand under the name, e.g. "1411 kbps". */
  note: string;
}

/**
 * What a service can actually deliver.
 *
 * Deezer's three tiers are the whole set it serves — asked directly, it
 * reports nothing for MP3_64, MP3_256, AAC_64 or its 360 Reality Audio
 * formats. Qobuz's ladder is its own, and YouTube Music has two containers
 * rather than bitrates.
 */
export const qualityChoicesFor = (service: Service): QualityChoice[] => {
  if (service === 'deezer') {
    return [
      {value: 'FLAC', label: 'FLAC', note: 'lossless, ~1411 kbps'},
      {value: 'MP3_320', label: 'MP3 320', note: '320 kbps'},
      {value: 'MP3_128', label: 'MP3 128', note: '128 kbps'},
    ];
  }
  if (service === 'qobuz') {
    return [
      {value: '27', label: 'Hi-Res 24-bit', note: 'up to 192 kHz'},
      {value: '7', label: 'Hi-Res 24-bit', note: 'up to 96 kHz'},
      {value: '6', label: 'CD quality', note: '16-bit / 44.1 kHz'},
      {value: '5', label: 'MP3 320', note: '320 kbps'},
    ];
  }
  return [
    {value: 'opus', label: 'Opus', note: 'best available, ~147 kbps'},
    {value: 'aac', label: 'AAC', note: '~131 kbps, plays anywhere'},
  ];
};

/** The quality this service would use if nobody chose one. */
export const defaultQualityFor = (service: Service, settings: {deezerQuality: string; qobuzQuality: string; ytmusicFormat: string}): string =>
  service === 'deezer' ? settings.deezerQuality : service === 'qobuz' ? settings.qobuzQuality : settings.ytmusicFormat;

