import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import type {Track, Service} from '@/types';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  /**
   * Playback order as indices into `queue`.
   *
   * Shuffle does not reorder `queue` itself — the visible list must stay in
   * its original order so turning shuffle off restores the real sequence, and
   * so the queue panel shows what the user actually queued.
   */
  shuffleOrder: number[];
  shuffle: boolean;
  repeat: RepeatMode;
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
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  playAt: (index: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  toggleFullscreen: () => void;
  setPlaying: (playing: boolean) => void;
}

/** Fisher–Yates over queue indices, keeping `first` at the head. */
const buildShuffleOrder = (length: number, first: number): number[] => {
  const rest = Array.from({length}, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < length ? [first, ...rest] : rest;
};

export const usePlayerStore = create<PlayerState>()(
  persist<PlayerState>(
    (set, get) => {
      /** Position of the current track within the active playback order. */
      const positionInOrder = (): number => {
        const {shuffle, shuffleOrder, queueIndex} = get();
        if (!shuffle) return queueIndex;
        const pos = shuffleOrder.indexOf(queueIndex);
        return pos === -1 ? 0 : pos;
      };

      /** Translate a position in the playback order back to a queue index. */
      const queueIndexAt = (position: number): number => {
        const {shuffle, shuffleOrder} = get();
        return shuffle ? shuffleOrder[position] : position;
      };

      const jumpTo = (queueIdx: number) => {
        const {queue} = get();
        if (queueIdx < 0 || queueIdx >= queue.length) return;
        set({currentTrack: queue[queueIdx], queueIndex: queueIdx, currentTime: 0, isPlaying: true});
      };

      return {
        currentTrack: null,
        queue: [],
        queueIndex: 0,
        shuffleOrder: [],
        shuffle: false,
        repeat: 'off',
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        volume: 0.8,
        isFullscreen: false,
        isMuted: false,

        setTrack: (track, queue) => {
          const nextQueue = queue ?? get().queue;
          const index = Math.max(
            0,
            nextQueue.findIndex((t) => t.id === track.id),
          );
          set({
            currentTrack: track,
            queue: nextQueue,
            queueIndex: index,
            shuffleOrder: get().shuffle ? buildShuffleOrder(nextQueue.length, index) : [],
            isPlaying: true,
            currentTime: 0,
          });
        },

        pause: () => set({isPlaying: false}),
        resume: () => set({isPlaying: true}),

        next: () => {
          const {queue, repeat} = get();
          if (queue.length === 0) return;

          // repeat: 'one' is handled by the player element (it re-seeks to 0)
          // rather than here, so an explicit Next still advances the track.
          const position = positionInOrder();
          const last = queue.length - 1;

          if (position >= last) {
            if (repeat === 'all') jumpTo(queueIndexAt(0));
            else set({isPlaying: false});
            return;
          }
          jumpTo(queueIndexAt(position + 1));
        },

        prev: () => {
          const {currentTime, queue, repeat} = get();
          // Standard transport behaviour: restart the track first, and only
          // step back if the user presses again near the start.
          if (currentTime > 3) {
            set({currentTime: 0});
            return;
          }
          if (queue.length === 0) return;

          const position = positionInOrder();
          if (position <= 0) {
            if (repeat === 'all') jumpTo(queueIndexAt(queue.length - 1));
            else set({currentTime: 0});
            return;
          }
          jumpTo(queueIndexAt(position - 1));
        },

        playAt: (index) => jumpTo(index),

        seek: (time) => set({currentTime: time}),
        setVolume: (volume) => set({volume}),
        toggleMute: () => set((s) => ({isMuted: !s.isMuted})),

        addToQueue: (track) =>
          set((s) => {
            const queue = [...s.queue, track];
            return {queue, shuffleOrder: s.shuffle ? [...s.shuffleOrder, queue.length - 1] : s.shuffleOrder};
          }),

        /** Insert directly after the current track. */
        playNext: (track) =>
          set((s) => {
            const at = s.queueIndex + 1;
            const queue = [...s.queue.slice(0, at), track, ...s.queue.slice(at)];
            return {
              queue,
              // Indices past the insertion point shift by one.
              shuffleOrder: s.shuffle ? buildShuffleOrder(queue.length, s.queueIndex) : s.shuffleOrder,
            };
          }),

        removeFromQueue: (index) =>
          set((s) => {
            if (index < 0 || index >= s.queue.length) return s;
            const queue = s.queue.filter((_, i) => i !== index);
            // Keep the current track pointing at the same item after removal.
            let queueIndex = s.queueIndex;
            if (index < s.queueIndex) queueIndex -= 1;
            else if (index === s.queueIndex) queueIndex = Math.min(s.queueIndex, queue.length - 1);

            return {
              queue,
              queueIndex: Math.max(0, queueIndex),
              shuffleOrder: s.shuffle ? buildShuffleOrder(queue.length, Math.max(0, queueIndex)) : [],
              currentTrack: queue.length ? s.currentTrack : null,
            };
          }),

        moveInQueue: (from, to) =>
          set((s) => {
            if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return s;
            const queue = [...s.queue];
            const [moved] = queue.splice(from, 1);
            queue.splice(to, 0, moved);

            // The current track may have shifted; find it again by identity.
            const currentId = s.currentTrack?.id;
            const queueIndex = currentId ? queue.findIndex((t) => t.id === currentId) : s.queueIndex;

            return {queue, queueIndex: queueIndex === -1 ? s.queueIndex : queueIndex};
          }),

        clearQueue: () => set({queue: [], queueIndex: 0, shuffleOrder: []}),

        toggleShuffle: () =>
          set((s) => {
            const shuffle = !s.shuffle;
            return {shuffle, shuffleOrder: shuffle ? buildShuffleOrder(s.queue.length, s.queueIndex) : []};
          }),

        cycleRepeat: () =>
          set((s) => ({repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off'})),

        setCurrentTime: (currentTime) => set({currentTime}),
        setDuration: (duration) => set({duration}),
        toggleFullscreen: () => set((s) => ({isFullscreen: !s.isFullscreen})),
        setPlaying: (isPlaying) => set({isPlaying}),
      };
    },
    {
      name: 'elixium-player',
      // Preferences persist; playback state does not — restoring a paused
      // track across reloads without its audio loaded is worse than starting
      // clean.
      partialize: (s) => ({volume: s.volume, shuffle: s.shuffle, repeat: s.repeat} as PlayerState),
    },
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
