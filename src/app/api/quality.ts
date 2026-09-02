import type {ServiceName} from './respond';

/**
 * Quality handling for both services in one place.
 *
 * The numeric format codes were previously re-derived inline at every call site
 * (stream, single-file download, ZIP), which meant three copies of the same
 * switch that could drift apart. They are centralized here.
 */

export interface QualityOption {
  /** Stable identifier clients send us. */
  id: string;
  /** Human label for UI pickers. */
  label: string;
  /** Container the resulting file will use. */
  format: 'flac' | 'mp3';
  /** Rough bit depth / sample rate description, for display only. */
  detail: string;
}

export const DEEZER_QUALITIES: QualityOption[] = [
  {id: 'flac', label: 'FLAC', format: 'flac', detail: '16-bit / 44.1 kHz lossless'},
  {id: '320', label: 'MP3 320', format: 'mp3', detail: '320 kbps'},
  {id: '128', label: 'MP3 128', format: 'mp3', detail: '128 kbps'},
];

export const QOBUZ_QUALITIES: QualityOption[] = [
  {id: 'hires', label: 'Hi-Res', format: 'flac', detail: 'up to 24-bit / 192 kHz'},
  {id: '96khz', label: 'Hi-Res 96', format: 'flac', detail: '24-bit / 96 kHz'},
  {id: '44khz', label: 'CD', format: 'flac', detail: '16-bit / 44.1 kHz'},
  {id: '320kbps', label: 'MP3 320', format: 'mp3', detail: '320 kbps'},
];

export const qualitiesFor = (service: ServiceName): QualityOption[] =>
  service === 'deezer' ? DEEZER_QUALITIES : QOBUZ_QUALITIES;

/** Default quality id when a client does not specify one. */
export const defaultQualityFor = (service: ServiceName): string => (service === 'deezer' ? 'flac' : '44khz');

/**
 * Map a client-supplied quality id to Deezer's numeric format code.
 * 9 = FLAC, 3 = MP3 320, 1 = MP3 128.
 */
export const deezerFormatCode = (quality: string): number => {
  switch (String(quality || '').toLowerCase()) {
    case 'flac':
    case 'lossless':
      return 9;
    case '128':
    case '128kbps':
    case 'mp3_128':
      return 1;
    case '320':
    case '320kbps':
    case 'mp3_320':
      return 3;
    /*
     * An unrecognised quality stays at 128, as it always has.
     *
     * The bug here was the missing names above, not this default: MP3_320 —
     * what the interface stores and the documented API accepts — was not
     * listed, so a request for the higher tier quietly produced the lower one
     * under a .mp3 name that gave nothing away.
     *
     * Raising this default was tempting and wrong. Two of the routes that call
     * it resolve a single format with no ladder beneath them, and 128 is the
     * one tier Deezer never licence-gates — so guessing upward would turn a
     * working download into a refusal for anybody without an HQ licence.
     */
    default:
      return 1;
  }
};

/**
 * Map a client-supplied quality id to Qobuz's numeric format code.
 * 27 = Hi-Res (up to 24/192), 7 = 24/96, 6 = CD, 5 = MP3 320.
 */
export const qobuzFormatCode = (quality: string): number => {
  switch (String(quality || '').toLowerCase()) {
    case '320kbps':
    case '320':
      return 5;
    case '44khz':
    case 'cd':
      return 6;
    case '96khz':
      return 7;
    default:
      return 27;
  }
};

/** Qobuz format codes to try, in descending preference, starting from the requested one. */
/**
 * Build a fallback chain that only ever steps *down* from what was asked for.
 *
 * `[requested, ...all]` deduped is not enough: asking for Qobuz 44.1kHz (6)
 * produced [6, 7, 5], which retries 96kHz — a higher tier the account has
 * already been refused — before dropping to MP3.
 */
const descendingFrom = (requested: number, ladder: number[]): number[] => [
  requested,
  ...ladder.filter((code) => code < requested),
];

export const qobuzFormatFallbacks = (quality: string): number[] =>
  descendingFrom(qobuzFormatCode(quality), [27, 7, 6, 5]);

/**
 * Deezer formats to try, best first.
 *
 * Deezer refuses FLAC and MP3_320 outright on accounts without the matching
 * licence, so a free account asking for the default FLAC got no stream at all
 * and playback fell back to a 30-second public preview. Downloads already
 * stepped down through the qualities; streaming did not, which is why a track
 * would download fine yet refuse to play.
 *
 * 1 (MP3_128) is last because it is the one format Deezer never licence-gates.
 */
export const deezerFormatFallbacks = (quality: string): number[] =>
  descendingFrom(deezerFormatCode(quality), [9, 3, 1]);

/** File extension implied by a service + quality pair. */
export const extensionFor = (service: ServiceName, quality: string): 'flac' | 'mp3' => {
  if (service === 'deezer') return deezerFormatCode(quality) === 9 ? 'flac' : 'mp3';
  return qobuzFormatCode(quality) === 5 ? 'mp3' : 'flac';
};

/** Strip characters that are illegal in filenames on Windows and POSIX alike. */
export const safeFilename = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown';
