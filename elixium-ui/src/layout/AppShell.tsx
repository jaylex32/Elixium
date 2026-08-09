import {useState, useEffect, useCallback, lazy, Suspense} from 'react';
import {AnimatePresence, motion} from 'framer-motion';
import {Toaster} from 'sonner';
import {Sidebar, NavDrawer} from './Sidebar';
import {BottomNav} from './BottomNav';
import {Header} from './Header';
import {PlayerBar} from './PlayerBar';
import {QueuePanel} from './QueuePanel';
import {CommandPalette} from '@/shared/components/CommandPalette';
import {useAppStore} from '@/store/app-store';
import {useTheme} from '@/shared/hooks/useTheme';
import {useSocket} from '@/shared/hooks/useSocket';
import {useIsMobile, usePrefersReducedMotion} from '@/shared/hooks/useMediaQuery';
import {usePlayerStore} from '@/store/player-store';

import {HomePage} from '@/features/discovery/HomePage';
import {PageFallback} from '@/shared/components/PageFallback';
import {ErrorBoundary} from '@/shared/components/ErrorBoundary';
import {PAGE_TITLES} from './nav-items';

/*
 * Home is imported eagerly — it is the landing page, and lazy-loading it would
 * put a network round-trip in front of first paint. Every other page is split
 * out, so a cold visit parses one page instead of eight.
 */
const SearchPage = lazy(() => import('@/features/search/SearchPage').then((m) => ({default: m.SearchPage})));
const DownloadsPage = lazy(() => import('@/features/downloads/DownloadsPage').then((m) => ({default: m.DownloadsPage})));
const WatchlistPage = lazy(() => import('@/features/watchlist/WatchlistPage').then((m) => ({default: m.WatchlistPage})));
const LibraryPage = lazy(() => import('@/features/library/LibraryPage').then((m) => ({default: m.LibraryPage})));
const GenresPage = lazy(() => import('@/features/genres/GenresPage').then((m) => ({default: m.GenresPage})));
const UrlDownloadPage = lazy(() =>
  import('@/features/url-download/UrlDownloadPage').then((m) => ({default: m.UrlDownloadPage})),
);
const PlaylistsPage = lazy(() => import('@/features/playlists/PlaylistsPage').then((m) => ({default: m.PlaylistsPage})));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({default: m.SettingsPage})));

const PAGE_MAP = {
  home: HomePage,
  search: SearchPage,
  downloads: DownloadsPage,
  watchlist: WatchlistPage,
  library: LibraryPage,
  genres: GenresPage,
  'url-download': UrlDownloadPage,
  playlists: PlaylistsPage,
  settings: SettingsPage,
} as const;

export function AppShell() {
  useTheme();
  useSocket();

  const currentPage = useAppStore((s) => s.currentPage);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();

  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Owned here, not in PlayerBar: PlayerBar only mounts once a track is
  // playing, which left no way to reach the queue from a cold start.
  const [queueOpen, setQueueOpen] = useState(false);

  // Leaving mobile with the drawer open would strand an invisible dialog that
  // still traps Escape and holds the body scroll lock.
  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  // Route changes come from many places (nav, palette, cards) — close here so
  // every one of them dismisses the drawer.
  useEffect(() => {
    setNavOpen(false);
  }, [currentPage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openPalette = useCallback(() => setCmdOpen(true), []);
  const PageComponent = PAGE_MAP[currentPage];

  return (
    <div className="flex h-dvh overflow-hidden bg-primary-bg">
      <Sidebar />
      <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenPalette={openPalette} onOpenNav={() => setNavOpen(true)} onOpenQueue={() => setQueueOpen(true)} />

        {/*
          The only scroll container in the app. `.pb-shell` reserves the exact
          height of the fixed player plus bottom nav plus safe-area inset, so
          the last row of content is always reachable instead of sitting under
          the player — the overlap this layout previously had on mobile.
        */}
        <main className="scroll-container min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-shell">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentPage}
              initial={reducedMotion ? false : {opacity: 0, y: 6}}
              animate={{opacity: 1, y: 0}}
              exit={reducedMotion ? undefined : {opacity: 0, y: -6}}
              transition={{duration: 0.18, ease: [0.22, 1, 0.36, 1]}}
              className="mx-auto w-full max-w-content"
            >
              {/* Scoped per page and reset on navigation: a page that throws
                  during render takes only itself down, leaving the player,
                  nav and socket connection intact. */}
              <ErrorBoundary resetKey={currentPage} label={PAGE_TITLES[currentPage]}>
                <Suspense fallback={<PageFallback />}>
                  <PageComponent />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {hasTrack && <PlayerBar onOpenQueue={() => setQueueOpen(true)} />}
      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
      {isMobile && <BottomNav onOpenMore={() => setNavOpen(true)} moreOpen={navOpen} />}

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <Toaster
        position={isMobile ? 'top-center' : 'bottom-right'}
        // Clear the fixed furniture so toasts never cover the player controls.
        offset={isMobile ? 12 : 24}
        toastOptions={{
          style: {
            background: 'var(--card-bg)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
          },
        }}
      />
    </div>
  );
}
