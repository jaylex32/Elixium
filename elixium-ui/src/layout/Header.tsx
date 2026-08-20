import {Search, Wifi, WifiOff, Menu, ListMusic, Disc3, ArrowLeft} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useAppStore} from '@/store/app-store';
import {PAGE_TITLES} from './nav-items';
import {useDownloadStore} from '@/store/download-store';
import {usePlayerStore} from '@/store/player-store';
import {useNavigationStore} from '@/store/navigation-store';


interface HeaderProps {
  onOpenPalette: () => void;
  onOpenNav: () => void;
  onOpenQueue: () => void;
}

export function Header({onOpenPalette, onOpenNav, onOpenQueue}: HeaderProps) {
  const currentPage = useAppStore((s) => s.currentPage);
  const connected = useAppStore((s) => s.connected);
  const setPage = useAppStore((s) => s.setPage);

  /*
   * One Back control for both kinds of step.
   *
   * A detail view is "deeper" than a page, so it unwinds first: from an album
   * reached inside an artist, Back returns to the artist rather than jumping
   * out to the page behind both.
   */
  const detailDepth = useNavigationStore((s) => s.stack.length);
  const detailBack = useNavigationStore((s) => s.back);
  const historyDepth = useAppStore((s) => s.pageHistory.length);
  const goBackPage = useAppStore((s) => s.goBackPage);
  const canGoBack = detailDepth > 0 || historyDepth > 0;
  const goBack = () => {
    if (detailDepth > 0) detailBack();
    else goBackPage();
  };
  const queueLength = usePlayerStore((s) => s.queue.length);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const toggleFullscreen = usePlayerStore((s) => s.toggleFullscreen);
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
          {canGoBack && (
            <button
              onClick={goBack}
              aria-label="Back"
              title="Back"
              className="touch-target flex shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-bg hover:text-text-primary"
            >
              <ArrowLeft size={19} />
            </button>
          )}
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

          {/* Player + queue are reachable from every page. Previously both
              lived only on the player bar, which is not mounted until
              something is already playing — so from a cold start there was no
              way in. */}
          {hasTrack && (
            <button
              onClick={toggleFullscreen}
              aria-label="Open player"
              title="Open player"
              className="touch-target flex items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-bg hover:text-text-primary"
            >
              <Disc3 size={19} className="text-accent" />
            </button>
          )}

          <button
            onClick={onOpenQueue}
            aria-label={`Open queue (${queueLength} tracks)`}
            title="Queue"
            className="touch-target relative flex items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-bg hover:text-text-primary"
          >
            <ListMusic size={19} />
            {queueLength > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-primary-bg">
                {queueLength > 99 ? '99' : queueLength}
              </span>
            )}
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
