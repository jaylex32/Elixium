import {create} from 'zustand';
import {persist} from 'zustand/middleware';

const MAX_ENTRIES = 12;

export interface SearchHistoryEntry {
  query: string;
  type: string;
  at: number;
}

interface SearchHistoryState {
  entries: SearchHistoryEntry[];
  record: (query: string, type: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

/**
 * Recent searches, persisted to localStorage.
 *
 * Deduplicated case-insensitively on the query and capped, so repeating a
 * search moves it to the front rather than filling the list with duplicates.
 */
export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist<SearchHistoryState>(
    (set) => ({
      entries: [],

      record: (query, type) => {
        const trimmed = query.trim();
        // Two characters is the threshold below which the app does not search
        // at all, so recording anything shorter would store dead entries.
        if (trimmed.length < 2) return;

        set((s) => {
          const key = trimmed.toLowerCase();
          const withoutDuplicate = s.entries.filter((e) => e.query.toLowerCase() !== key);
          return {entries: [{query: trimmed, type, at: Date.now()}, ...withoutDuplicate].slice(0, MAX_ENTRIES)};
        });
      },

      remove: (query) =>
        set((s) => ({entries: s.entries.filter((e) => e.query.toLowerCase() !== query.trim().toLowerCase())})),

      clear: () => set({entries: []}),
    }),
    {name: 'elixium-search-history'},
  ),
);
