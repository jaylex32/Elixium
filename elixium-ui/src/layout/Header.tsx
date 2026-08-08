import {Search, Wifi, WifiOff, Menu} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useAppStore, type Page} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';
import {Button} from '@/shared/components/ui/Button';

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
}

export function Header({onOpenPalette}: HeaderProps) {
  const {currentPage, connected, toggleSidebar} = useAppStore();
  const activeDownloads = useDownloadStore(
    (s) => Object.values(s.active).filter((d) => d.status !== 'done' && d.status !== 'error').length,
  );

  return (
    <header className="flex items-center justify-between h-header px-4 bg-primary-bg/80 backdrop-blur-md border-b border-border shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} className="md:hidden">
          <Menu size={18} />
        </Button>
        <h1 className="text-base font-semibold text-text-primary">{PAGE_TITLES[currentPage]}</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Cmd+K trigger */}
        <button
          onClick={onOpenPalette}
          className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-surface-bg px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <Search size={13} />
          <span>Search</span>
          <kbd className="ml-1 flex items-center gap-0.5 rounded border border-border px-1 py-0.5 text-[10px] font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Active downloads indicator */}
        {activeDownloads > 0 && (
          <button
            onClick={() => useAppStore.getState().setPage('downloads')}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            {activeDownloads} downloading
          </button>
        )}

        {/* Connection status */}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border',
            connected ? 'bg-success/10 text-success border-success/20' : 'bg-danger/10 text-danger border-danger/20',
          )}
        >
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span className="hidden sm:block">{connected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
}
