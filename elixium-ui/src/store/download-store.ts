import {create} from 'zustand';

export interface ActiveDownload {
  itemId: string;
  title: string;
  artist?: string;
  cover?: string;
  status: 'starting' | 'converting' | 'downloading' | 'done' | 'error';
  percentage: number;
  currentTrack?: string;
  current: number;
  total: number;
  startedAt: number;
  error?: string;
}

export interface HistoryEntry {
  id: string;
  title: string;
  count: number;
  completedAt: number;
}

interface DownloadState {
  active: Record<string, ActiveDownload>;
  history: HistoryEntry[];
  isRunning: boolean;

  // Called when directUrlDownload is emitted — creates a placeholder
  trackDownload: (itemId: string, meta: {title: string; artist?: string; cover?: string}) => void;
  // Called on downloadProgress events from backend
  onProgress: (data: {
    itemId?: string;
    percentage?: number;
    currentTrack?: string;
    current?: number;
    total?: number;
    itemStatus?: string;
    itemProgress?: number;
  }) => void;
  // Called on directUrlConversionProgress (pre-download phase)
  onConversionProgress: (data: {phase: string; message: string; percentage: number; itemId?: string}) => void;
  onComplete: (itemId: string, count: number) => void;
  onError: (itemId: string, message: string) => void;
  clear: (itemId: string) => void;
  clearDone: () => void;
  setRunning: (v: boolean) => void;

  // Legacy: simple add for URL-download queuing before download starts
  pendingUrls: Array<{url: string; title: string; artist?: string; cover?: string; service: 'deezer' | 'qobuz'}>;
  addPending: (item: DownloadState['pendingUrls'][number]) => void;
  removePending: (url: string) => void;
  clearPending: () => void;
}

export const useDownloadStore = create<DownloadState>()((set) => ({
  active: {},
  history: [],
  isRunning: false,
  pendingUrls: [],

  trackDownload: (itemId, meta) =>
    set((s) => ({
      active: {
        ...s.active,
        [itemId]: {
          itemId,
          ...meta,
          status: 'starting',
          percentage: 0,
          current: 0,
          total: 1,
          startedAt: Date.now(),
        },
      },
      isRunning: true,
    })),

  onProgress: (data) => {
    const id = data.itemId;
    if (!id) return;
    set((s) => {
      const existing = s.active[id];
      return {
        active: {
          ...s.active,
          [id]: {
            ...existing,
            itemId: id,
            title: existing?.title ?? data.currentTrack ?? 'Downloading…',
            status: 'downloading',
            percentage: Math.round(data.percentage ?? existing?.percentage ?? 0),
            currentTrack: data.currentTrack ?? existing?.currentTrack,
            current: data.current ?? existing?.current ?? 0,
            total: data.total ?? existing?.total ?? 1,
            startedAt: existing?.startedAt ?? Date.now(),
          },
        },
        isRunning: true,
      };
    });
  },

  onConversionProgress: (data) => {
    const id = data.itemId ?? '__conversion__';
    set((s) => ({
      active: {
        ...s.active,
        [id]: {
          ...(s.active[id] ?? {
            itemId: id,
            title: data.message,
            status: 'converting',
            current: 0,
            total: 100,
            startedAt: Date.now(),
          }),
          status: 'converting',
          percentage: data.percentage,
          currentTrack: data.message,
        },
      },
      isRunning: true,
    }));
  },

  onComplete: (itemId, count) =>
    set((s) => {
      const entry = s.active[itemId];
      const updated = {...s.active};
      if (entry) {
        updated[itemId] = {...entry, status: 'done', percentage: 100};
      }
      return {
        active: updated,
        history: [
          {id: itemId, title: entry?.title ?? 'Download', count, completedAt: Date.now()},
          ...s.history.slice(0, 49),
        ],
        isRunning: Object.values(updated).some((d) => d.status !== 'done' && d.status !== 'error'),
      };
    }),

  onError: (itemId, message) =>
    set((s) => ({
      active: {
        ...s.active,
        [itemId]: {
          ...(s.active[itemId] ?? {
            itemId,
            title: 'Download',
            status: 'error',
            current: 0,
            total: 1,
            startedAt: Date.now(),
            percentage: 0,
          }),
          status: 'error',
          error: message,
        },
      },
      isRunning: false,
    })),

  clear: (itemId) =>
    set((s) => {
      const updated = {...s.active};
      delete updated[itemId];
      return {active: updated};
    }),

  clearDone: () =>
    set((s) => ({
      active: Object.fromEntries(
        Object.entries(s.active).filter(([, d]) => d.status !== 'done' && d.status !== 'error'),
      ),
    })),

  setRunning: (isRunning) => set({isRunning}),

  addPending: (item) =>
    set((s) => ({
      pendingUrls: s.pendingUrls.some((p) => p.url === item.url) ? s.pendingUrls : [...s.pendingUrls, item],
    })),

  removePending: (url) => set((s) => ({pendingUrls: s.pendingUrls.filter((p) => p.url !== url)})),

  clearPending: () => set({pendingUrls: []}),
}));
