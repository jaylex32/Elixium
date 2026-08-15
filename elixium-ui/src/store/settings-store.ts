import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export interface Settings {
  deezerArl: string;
  spotifySpDc: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  qobuzAppId: string;
  qobuzSecrets: string;
  qobuzToken: string;
  deezerQuality: 'MP3_128' | 'MP3_320' | 'FLAC';
  qobuzQuality: '5' | '6' | '7' | '27';
  concurrency: number;
  downloadPath: string;
  qobuzDownloadPath: string;
  trackNumbering: boolean;
  coverArt: boolean;
  embedLyrics: boolean;
  saveLrcFile: boolean;
  createPlaylists: boolean;
  fallbackTrack: boolean;
  fallbackQuality: boolean;
  /**
   * Path templates, one set per service.
   *
   * The server has always kept eight (track/album/artist/playlist for Deezer
   * and the qobuz- prefixed equivalents); the UI exposed a single field that
   * was never saved.
   */
  layout: {
    track: string;
    album: string;
    artist: string;
    playlist: string;
    'qobuz-track': string;
    'qobuz-album': string;
    'qobuz-artist': string;
    'qobuz-playlist': string;
  };
  coverSize: string;
}

const defaults: Settings = {
  deezerArl: '',
  spotifySpDc: '',
  spotifyClientId: '',
  spotifyClientSecret: '',
  qobuzAppId: '',
  qobuzSecrets: '',
  qobuzToken: '',
  deezerQuality: 'FLAC',
  qobuzQuality: '27',
  concurrency: 3,
  downloadPath: '',
  qobuzDownloadPath: '',
  trackNumbering: true,
  coverArt: true,
  embedLyrics: true,
  saveLrcFile: false,
  createPlaylists: false,
  fallbackTrack: true,
  fallbackQuality: true,
  layout: {
    track: '{ALB_TITLE}/{SNG_TITLE}',
    album: '{ART_NAME}/{ALB_TITLE}/{NO_TRACK_NUMBER}{SNG_TITLE}',
    artist: '{ALB_TITLE}/{SNG_TITLE}',
    playlist: '{ART_NAME}/{ART_NAME} - {ALB_TITLE}/{NO_TRACK_NUMBER}{ART_NAME} - {SNG_TITLE}',
    'qobuz-track': '{alb_artist}/{alb_artist} - {alb_title}/{no_track_number}{alb_artist} - {title}',
    'qobuz-album': '{alb_artist}/{alb_artist} - {alb_title}/{no_track_number}{alb_artist} - {title}',
    'qobuz-artist': 'artist/{alb_title}/{no_track_number}{alb_artist} - {title}',
    'qobuz-playlist': 'Playlist/{list_title}/{alb_artist}/{alb_artist} - {alb_title}/{no_track_number}{alb_artist} - {title}',
  },
  coverSize: '1000',
};

interface SettingsState {
  settings: Settings;
  isDirty: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  markClean: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaults,
      isDirty: false,
      update: (patch) => set((s) => ({settings: {...s.settings, ...patch}, isDirty: true})),
      reset: () => set({settings: defaults, isDirty: false}),
      markClean: () => set({isDirty: false}),
    }),
    {
      name: 'elixium-settings',
      /*
       * Merge persisted settings *over* the defaults instead of replacing them.
       *
       * Zustand's default merge is shallow, so a stored `settings` object
       * replaces the whole default one — meaning any field added after a user
       * first saved simply does not exist for them. Adding `layout` crashed
       * Settings on load for exactly this reason: `settings.layout` was
       * undefined and PathTemplates read `layout['track']` off it.
       *
       * `layout` is spread explicitly because it is the one nested object
       * here; a shallow spread would otherwise drop newly added template keys
       * the same way.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...stored,
          settings: {
            ...current.settings,
            ...(stored.settings ?? {}),
            layout: {...current.settings.layout, ...(stored.settings?.layout ?? {})},
          },
          // Never restore a dirty flag: nothing is unsaved on a fresh load.
          isDirty: false,
        };
      },
    },
  ),
);

export const DEEZER_QUALITY_LABELS: Record<Settings['deezerQuality'], string> = {
  MP3_128: 'MP3 128 kbps',
  MP3_320: 'MP3 320 kbps',
  FLAC: 'FLAC Lossless',
};

export const QOBUZ_QUALITY_LABELS: Record<Settings['qobuzQuality'], string> = {
  '5': 'MP3 320 kbps',
  '6': 'FLAC 16-bit / 44.1 kHz',
  '7': 'FLAC 24-bit / 96 kHz',
  '27': 'FLAC 24-bit / 192 kHz',
};
