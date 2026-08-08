import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import type {Track, Service} from '@/types';

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isFullscreen: boolean;
  isMuted: boolean;

  setTrack: (track: Track, queue?: Track[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  addToQueue: (track: Track) => void;
  clearQueue: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  toggleFullscreen: () => void;
  setPlaying: (playing: boolean) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist<PlayerState>(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      queueIndex: 0,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.8,
      isFullscreen: false,
      isMuted: false,

      setTrack: (track, queue) =>
        set({
          currentTrack: track,
          queue: queue ?? get().queue,
          queueIndex: queue
            ? Math.max(
                0,
                queue.findIndex((t) => t.id === track.id),
              )
            : 0,
          isPlaying: true,
          currentTime: 0,
        }),

      pause: () => set({isPlaying: false}),
      resume: () => set({isPlaying: true}),

      next: () => {
        const {queue, queueIndex} = get();
        const next = queueIndex + 1;
        if (next < queue.length) set({currentTrack: queue[next], queueIndex: next, currentTime: 0});
      },

      prev: () => {
        const {queue, queueIndex, currentTime} = get();
        if (currentTime > 3) {
          set({currentTime: 0});
          return;
        }
        const prev = queueIndex - 1;
        if (prev >= 0) set({currentTrack: queue[prev], queueIndex: prev, currentTime: 0});
      },

      seek: (time) => set({currentTime: time}),
      setVolume: (volume) => set({volume}),
      toggleMute: () => set((s) => ({isMuted: !s.isMuted})),
      addToQueue: (track) => set((s) => ({queue: [...s.queue, track]})),
      clearQueue: () => set({queue: [], queueIndex: 0}),
      setCurrentTime: (currentTime) => set({currentTime}),
      setDuration: (duration) => set({duration}),
      toggleFullscreen: () => set((s) => ({isFullscreen: !s.isFullscreen})),
      setPlaying: (isPlaying) => set({isPlaying}),
    }),
    {name: 'elixium-player', partialize: (s) => ({volume: s.volume} as PlayerState)},
  ),
);

/** Helper used across the app to build a playable Track from a raw search result */
export function makeTrack(params: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  trackNumber?: number;
  service: Service;
  previewUrl?: string;
}): Track {
  return params;
}
