import {Search, Wifi, WifiOff, Menu} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useAppStore, type Page} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';

const PAGE_TITLES: Record<Page, string> = {
  home: 'Discover',
  search: 'Search',
  downloads: 'Downloads',
  watchlist: 'Watchlist',
  genres: 'Genres',
  'url-download': 'URL Download',
  playlists: 'Playlists',
  settings: 'Settings',
};

interface HeaderProps {
  onOpenPalette: () => void;
  onOpenNav: () => void;
}

export function Header({onOpenPalette, onOpenNav}: HeaderProps) {
  const currentPage = useAppStore((s) => s.currentPage);
  const connected = useAppStore((s) => s.connected);
  const setPage = useAppStore((s) => s.setPage);
  const activeDownloads = useDownloadStore(
    (s) => Object.values(s.active).filter((d) => d.status !== 'done' && d.status !== 'error').length,
  );

  return (
    <header className="sticky top-0 z-header shrink-0 border-b border-border glass pt-safe">
      <div className="flex h-header items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {/* Opens the drawer. Hidden at lg, where the persistent rail appears —
              this breakpoint must match Sidebar's `lg:flex` or a viewport ends
              up with both or neither. */}
          <button
            onClick={onOpenNav}
            aria-label="Open navigation"
            className="touch-target -ml-2 flex items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-bg hover:text-text-primary lg:hidden"
          >
            <Menu size={20} />
          </button>
          <h1 className="truncate text-base font-semibold text-text-primary sm:text-lg">{PAGE_TITLES[currentPage]}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onOpenPalette}
            aria-label="Search"
            className="hidden items-center gap-2 rounded-sm border border-border bg-surface-bg px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary sm:flex"
          >
            <Search size={13} />
            <span>Search</span>
            <kbd className="ml-1 rounded border border-border px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>

          {/* Compact palette trigger for phones, where the labelled pill does not fit. */}
          <button
            onClick={onOpenPalette}
            aria-label="Search"
            className="touch-target flex items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-bg hover:text-text-primary sm:hidden"
          >
            <Search size={19} />
          </button>

          {activeDownloads > 0 && (
            <button
              onClick={() => setPage('downloads')}
              className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              <span className="hidden sm:inline">{activeDownloads} downloading</span>
              <span className="sm:hidden">{activeDownloads}</span>
            </button>
          )}

          <div
            title={connected ? 'Connected' : 'Offline'}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              connected ? 'border-success/20 bg-success/10 text-success' : 'border-danger/20 bg-danger/10 text-danger',
            )}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="hidden md:inline">{connected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
