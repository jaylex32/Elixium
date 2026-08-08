import {Home, Search, Download, Eye, Music2, Link2, ListMusic, Settings} from 'lucide-react';
import type {Page, Service} from '@/store/app-store';

export interface NavItem {
  id: Page;
  icon: React.ElementType;
  label: string;
  /** Shorter label for the mobile bottom bar, where width is scarce. */
  shortLabel?: string;
}

/** Every destination, in sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  {id: 'home', icon: Home, label: 'Home'},
  {id: 'search', icon: Search, label: 'Search'},
  {id: 'downloads', icon: Download, label: 'Downloads', shortLabel: 'Files'},
  {id: 'watchlist', icon: Eye, label: 'Watchlist', shortLabel: 'Watch'},
  {id: 'genres', icon: Music2, label: 'Genres'},
  {id: 'url-download', icon: Link2, label: 'URL Download', shortLabel: 'Link'},
  {id: 'playlists', icon: ListMusic, label: 'Playlists', shortLabel: 'Lists'},
  {id: 'settings', icon: Settings, label: 'Settings'},
];

/**
 * The four destinations that get a permanent slot in the mobile bottom bar.
 * Four plus a "More" button is the practical ceiling: five 44px targets plus
 * gaps still fit a 320px viewport, six do not.
 */
export const PRIMARY_MOBILE_PAGES: Page[] = ['home', 'search', 'downloads', 'watchlist'];

export const PRIMARY_NAV_ITEMS: NavItem[] = PRIMARY_MOBILE_PAGES.map(
  (id) => NAV_ITEMS.find((item) => item.id === id) as NavItem,
);

export const SECONDARY_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => !PRIMARY_MOBILE_PAGES.includes(item.id));

export const SERVICE_ITEMS: {id: Service; label: string; color: string}[] = [
  {id: 'deezer', label: 'Deezer', color: '#a259ff'},
  {id: 'qobuz', label: 'Qobuz', color: '#0067b3'},
];
