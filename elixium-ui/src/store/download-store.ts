import type {DownloadProgressPayload} from '@shared/socket-events';
import {create} from 'zustand';
import {persist} from 'zustand/middleware';

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
  artist?: string;
  cover?: string;
  count: number;
  completedAt: number;
  /**
   * Whether the job actually produced files.
   *
   * History recorded only a count, so every finished job looked alike: a batch
   * that ended "complete — 0 files saved" was filed with the same green tick as
   * a real success. That left the Done and Failed tabs nothing to select on,
   * which is why picking one changed the header but never the list.
   */
  status: 'done' | 'error';
  error?: string;
}

/** A source track the conversion could not match on the target service. */
export interface UnmatchedTrack {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  reason: string;
}

/**
 * Conversion outcome for one job.
 *
 * Kept separate from the download rows because a conversion can succeed
 * partially: 83 of 95 tracks matched is a completed download *and* twelve
 * tracks the user never asked to lose.
 */
export interface ConversionReport {
  itemId: string;
  title?: string;
  matched: number;
  unmatched: UnmatchedTrack[];
  at: number;
}

interface DownloadState {
  active: Record<string, ActiveDownload>;
  history: HistoryEntry[];
  reports: ConversionReport[];
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
  /**
   * Takes the shared payload rather than restating it. The old inline type
   * required `phase`, `message` and `percentage`, none of which every emit
   * site actually sends — `phase` was not even read.
   */
  onConversionProgress: (data: DownloadProgressPayload) => void;
  onComplete: (itemId: string, count: number) => void;
  onBatchComplete: (count: number) => void;
  onError: (itemId: string, message: string) => void;
  clear: (itemId: string) => void;
  clearDone: () => void;
  clearHistory: () => void;
  addReport: (report: Omit<ConversionReport, 'at'>) => void;
  dismissReport: (itemId: string) => void;
  setRunning: (v: boolean) => void;

  // Legacy: simple add for URL-download queuing before download starts
  pendingUrls: Array<{url: string; title: string; artist?: string; cover?: string; service: 'deezer' | 'qobuz'}>;
  addPending: (item: DownloadState['pendingUrls'][number]) => void;
  removePending: (url: string) => void;
  clearPending: () => void;
}

export const useDownloadStore = create<DownloadState>()(
  persist<DownloadState>(
    (set) => ({
  active: {},
  history: [],
  reports: [],
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

    // The server reports per-item lifecycle through itemStatus. This used to
    // hardcode 'downloading', so an item that finished, failed, or was
    // cancelled stayed in the downloading state forever with a live spinner —
    // even at 12/12 and 100%.
    const status: ActiveDownload['status'] =
      data.itemStatus === 'completed'
        ? 'done'
        : data.itemStatus === 'error'
          ? 'error'
          : data.itemStatus === 'cancelled'
            ? 'error'
            : 'downloading';

    set((s) => {
      const existing = s.active[id];
      // itemProgress is the per-item figure; percentage is queue-wide. Prefer
      // the per-item one, and pin a completed item to 100.
      const percentage =
        status === 'done'
          ? 100
          : Math.round(data.itemProgress ?? data.percentage ?? existing?.percentage ?? 0);

      const updated = {
        ...s.active,
        [id]: {
          ...existing,
          itemId: id,
          title: existing?.title ?? data.currentTrack ?? 'Downloading…',
          status,
          percentage,
          currentTrack: data.currentTrack ?? existing?.currentTrack,
          current: data.current ?? existing?.current ?? 0,
          total: data.total ?? existing?.total ?? 1,
          startedAt: existing?.startedAt ?? Date.now(),
        },
      };

      /*
       * Record history on the per-item transition too.
       *
       * onBatchComplete only files entries for rows still in flight when the
       * queue-wide event lands — so an item the server marked completed
       * individually finished correctly but left no trace in history.
       */
      const justSettled = (status === 'done' || status === 'error') && existing?.status !== status;
      const history = justSettled
        ? [
            {
              id,
              title: updated[id].title,
              artist: updated[id].artist,
              cover: updated[id].cover,
              // A failed item saved nothing; claiming its track total would put
              // "13 tracks" beside a job that produced no files.
              count: status === 'done' ? updated[id].total || 1 : 0,
              completedAt: Date.now(),
              status,
            },
            ...s.history.filter((h) => h.id !== id),
          ].slice(0, 100)
        : s.history;

      return {
        active: updated,
        history,
        isRunning: Object.values(updated).some((d) => d.status !== 'done' && d.status !== 'error'),
      };
    });
  },

  /**
   * Batch completion.
   *
   * The server's `downloadComplete` is queue-wide and carries no itemId — only
   * {count, files}. The client was reading `data.itemId ?? '__conversion__'`,
   * which created a phantom entry and left every real download running. Any
   * item still in flight when the batch reports done is finished.
   */
  onBatchComplete: (count) =>
    set((s) => {
      const updated = {...s.active};
      const finished: string[] = [];

      /*
       * "Complete" with nothing saved is a failure.
       *
       * The server emits downloadComplete queue-wide whether or not any track
       * survived, so a whole album refused by Deezer arrived here as a success
       * and was filed with a green tick. The file count is the honest signal.
       */
      const succeeded = count > 0;
      const settled: HistoryEntry['status'] = succeeded ? 'done' : 'error';

      for (const [id, entry] of Object.entries(updated)) {
        if (entry.status !== 'done' && entry.status !== 'error') {
          updated[id] = {
            ...entry,
            status: settled,
            percentage: succeeded ? 100 : entry.percentage,
            error: succeeded ? entry.error : entry.error ?? 'No tracks were saved',
          };
          finished.push(id);
        }
      }

      const newHistory: HistoryEntry[] = finished.map((id) => ({
        id,
        title: updated[id].title,
        artist: updated[id].artist,
        cover: updated[id].cover,
        count,
        completedAt: Date.now(),
        status: settled,
      }));

      /*
       * Repair rows a per-item event already filed as done.
       *
       * Deezer reports each track of a refused album as "completed" before the
       * queue-wide result lands, so those entries were written optimistically.
       * The batch result is the authority on whether files reached disk.
       */
      const batchIds = new Set(Object.keys(updated));
      const previous = succeeded
        ? s.history
        : s.history.map((h) => (batchIds.has(h.id) && h.status === 'done' ? {...h, status: settled, count: 0} : h));

      // onProgress may already have filed some of these; keep one per id.
      const merged = [...newHistory, ...previous].filter(
        (entry, index, list) => list.findIndex((e) => e.id === entry.id) === index,
      );

      return {
        active: updated,
        history: merged.slice(0, 100),
        isRunning: false,
      };
    }),

  onConversionProgress: (data) => {
    const id = data.itemId ?? '__conversion__';
    // Every field here is optional on the wire; falling back keeps a partial
    // emit from blanking a row that already had a label or a percentage.
    const label = data.message ?? data.currentTrack ?? 'Converting…';
    set((s) => ({
      active: {
        ...s.active,
        [id]: {
          ...(s.active[id] ?? {
            itemId: id,
            title: label,
            status: 'converting',
            current: 0,
            total: 100,
            startedAt: Date.now(),
          }),
          status: 'converting',
          percentage: data.percentage ?? s.active[id]?.percentage ?? 0,
          currentTrack: label,
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
          {
            id: itemId,
            title: entry?.title ?? 'Download',
            count,
            completedAt: Date.now(),
            status: count > 0 ? 'done' : 'error',
          } as HistoryEntry,
          ...s.history.slice(0, 49),
        ],
        isRunning: Object.values(updated).some((d) => d.status !== 'done' && d.status !== 'error'),
      };
    }),

  onError: (itemId, message) =>
    set((s) => {
      const row: ActiveDownload = {
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
      };

      return {
        active: {...s.active, [itemId]: row},
        /*
         * A failure that leaves no trace cannot be reviewed later, and the
         * Failed tab exists precisely to review them. Errors were only ever
         * held in `active`, so dismissing a row erased the fact it happened.
         */
        history: [
          {
            id: itemId,
            title: row.title,
            artist: row.artist,
            cover: row.cover,
            count: 0,
            completedAt: Date.now(),
            status: 'error',
            error: message,
          } as HistoryEntry,
          ...s.history.filter((h) => h.id !== itemId),
        ].slice(0, 100),
        isRunning: false,
      };
    }),

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

  clearHistory: () => set({history: [], reports: []}),

  addReport: (report) =>
    set((s) => ({
      // Newest first, and only one report per job.
      reports: [{...report, at: Date.now()}, ...s.reports.filter((r) => r.itemId !== report.itemId)].slice(0, 25),
    })),

  dismissReport: (itemId) => set((s) => ({reports: s.reports.filter((r) => r.itemId !== itemId)})),

  setRunning: (isRunning) => set({isRunning}),

  addPending: (item) =>
    set((s) => ({
      pendingUrls: s.pendingUrls.some((p) => p.url === item.url) ? s.pendingUrls : [...s.pendingUrls, item],
    })),

  removePending: (url) => set((s) => ({pendingUrls: s.pendingUrls.filter((p) => p.url !== url)})),

  clearPending: () => set({pendingUrls: []}),
    }),
    {
      name: 'elixium-downloads',
      version: 1,
      /*
       * Stamp a status onto history saved before this field existed.
       *
       * Without it every stored entry reads as neither done nor failed and
       * disappears from both tabs. A saved job that produced no files was a
       * failure, whatever the tick beside it used to suggest.
       */
      migrate: ((persisted: {history?: HistoryEntry[]} | undefined, version: number) => {
        if (!persisted || version >= 1) return persisted as DownloadState;
        return {
          ...persisted,
          history: (persisted.history ?? []).map((h) => ({
            ...h,
            status: h.status ?? ((h.count ?? 0) > 0 ? 'done' : 'error'),
          })),
        } as DownloadState;
      }) as never,
      /*
       * Only completed work survives a reload. In-flight rows are tied to a
       * server process that will not resume them, so restoring them would show
       * downloads that are not running.
       */
      /*
       * Finished work and the rows still on screen both survive a reload.
       *
       * In-flight rows used to be dropped, on the grounds that the server will
       * not resume them — but dropping them also erased the record that they
       * were ever started, so reopening showed nothing where a half-finished
       * album had been. They are kept and marked instead.
       */
      partialize: (s) => ({history: s.history, reports: s.reports, active: s.active} as DownloadState),

      onRehydrateStorage: () => (state?: DownloadState) => {
        if (!state?.active) return;
        for (const [id, entry] of Object.entries(state.active)) {
          if (entry.status !== 'done' && entry.status !== 'error') {
            state.active[id] = {
              ...entry,
              status: 'error',
              error: 'Interrupted — Elixium was closed before this finished',
            };
          }
        }
        // Nothing can still be running in a process that just started.
        state.isRunning = false;
      },
    },
  ),
);
