import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export type Page = 'home' | 'search' | 'downloads' | 'watchlist' | 'genres' | 'url-download' | 'playlists' | 'settings';

export type Service = 'deezer' | 'qobuz';

export const THEMES = [
  {id: 'ember-signal', label: 'Ember Signal'},
  {id: 'nocturne-pulse', label: 'Nocturne Pulse'},
  {id: 'sterling-deck', label: 'Sterling Deck'},
  {id: 'verdant-luxe', label: 'Verdant Luxe'},
  {id: 'crimson-noir', label: 'Crimson Noir'},
  {id: 'hifi-current', label: 'Hi-Fi Current'},
  {id: 'daylight-modern', label: 'Daylight Modern'},
] as const;

interface AppState {
  currentPage: Page;
  /** One-shot query handed to the Search page, e.g. from an unmatched track. */
  pendingSearch?: string;
  service: Service;
  theme: string;
  sidebarCollapsed: boolean;
  connected: boolean;
  searchQuery: string;
  setPage: (page: Page) => void;
  setService: (service: Service) => void;
  setTheme: (theme: string) => void;
  toggleSidebar: () => void;
  setConnected: (connected: boolean) => void;
  setSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppState>()(
  persist<AppState>(
    (set) => ({
      currentPage: 'home',
      service: 'deezer',
      theme: 'ember-signal',
      sidebarCollapsed: false,
      connected: false,
      searchQuery: '',
      setPage: (page) => set({currentPage: page}),
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
