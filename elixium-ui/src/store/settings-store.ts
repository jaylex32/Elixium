import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export interface Settings {
  deezerArl: string;
  spotifySpDc: string;
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
  createPlaylists: boolean;
  fallbackTrack: boolean;
  fallbackQuality: boolean;
  fileTemplate: string;
  coverSize: string;
}

const defaults: Settings = {
  deezerArl: '',
  spotifySpDc: '',
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
  createPlaylists: false,
  fallbackTrack: true,
  fallbackQuality: true,
  fileTemplate: '{ART_NAME}/{ALB_TITLE}/{TRACK_NUMBER} - {SNG_TITLE}',
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
    {name: 'elixium-settings'},
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
