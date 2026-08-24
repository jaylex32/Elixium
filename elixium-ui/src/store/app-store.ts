import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export type Page =
  | 'home'
  | 'search'
  | 'charts'
  | 'downloads'
  | 'favorites'
  | 'watchlist'
  | 'library'
  | 'genres'
  | 'url-download'
  | 'playlists'
  | 'logs'
  | 'settings';

/*
 * Re-exported, not redeclared.
 *
 * There were two `Service` types — this one and the one in `types/index`
 * — and they drifted the moment a third service was added: every component
 * that passed a value from one to the other stopped compiling, while a
 * plain `tsc --noEmit` here reported nothing, because the interface is only
 * checked under `tsconfig.app.json`. One definition cannot drift from
 * itself.
 */
export type {Service} from '@/types';
import type {Service} from '@/types';

export const THEMES = [
  {id: 'ember-signal', label: 'Ember Signal'},
  {id: 'obsidian', label: 'Obsidian (true dark)'},
  {id: 'nocturne-pulse', label: 'Nocturne Pulse'},
  {id: 'sterling-deck', label: 'Sterling Deck'},
  {id: 'verdant-luxe', label: 'Verdant Luxe'},
  {id: 'crimson-noir', label: 'Crimson Noir'},
  {id: 'hifi-current', label: 'Hi-Fi Current'},
  {id: 'daylight-modern', label: 'Daylight Modern'},
] as const;

interface AppState {
  currentPage: Page;
  /**
   * Pages visited before this one, oldest first.
   *
   * Kept so Back can leave a page as well as a detail view — arriving at an
   * artist from Charts and pressing Back should reach Charts, not Home.
   */
  pageHistory: Page[];
  /** One-shot query handed to the Search page, e.g. from an unmatched track. */
  pendingSearch?: string;
  service: Service;
  theme: string;
  sidebarCollapsed: boolean;
  connected: boolean;
  searchQuery: string;
  setPage: (page: Page) => void;
  /** Returns false when there is no earlier page to return to. */
  goBackPage: () => boolean;
  setService: (service: Service) => void;
  setTheme: (theme: string) => void;
  toggleSidebar: () => void;
  setConnected: (connected: boolean) => void;
  setSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppState>()(
  persist<AppState>(
    (set, get) => ({
      currentPage: 'home',
      pageHistory: [],
      service: 'deezer',
      theme: 'ember-signal',
      sidebarCollapsed: false,
      connected: false,
      searchQuery: '',
      setPage: (page) =>
        set((s) =>
          // Re-selecting the current page is not a journey, and would otherwise
          // fill the history with entries Back has to walk through.
          s.currentPage === page
            ? s
            : {currentPage: page, pageHistory: [...s.pageHistory, s.currentPage].slice(-20)},
        ),

      goBackPage: () => {
        const {pageHistory} = get();
        if (pageHistory.length === 0) return false;
        set({currentPage: pageHistory[pageHistory.length - 1], pageHistory: pageHistory.slice(0, -1)});
        return true;
      },
      setService: (service) => set({service}),
      setTheme: (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        set({theme});
      },
      toggleSidebar: () => set((s) => ({sidebarCollapsed: !s.sidebarCollapsed})),
      setConnected: (connected) => set({connected}),
      setSearchQuery: (searchQuery) => set({searchQuery}),
    }),
    {
      name: 'elixium-app',
      partialize: (state) =>
        ({
          theme: state.theme,
          service: state.service,
          sidebarCollapsed: state.sidebarCollapsed,
        } as AppState),
    },
  ),
);
