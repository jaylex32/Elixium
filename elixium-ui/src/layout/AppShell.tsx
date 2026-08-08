import {useState, useEffect} from 'react';
import {AnimatePresence, motion} from 'framer-motion';
import {Toaster} from 'sonner';
import {Sidebar} from './Sidebar';
import {Header} from './Header';
import {PlayerBar} from './PlayerBar';
import {CommandPalette} from '@/shared/components/CommandPalette';
import {useAppStore} from '@/store/app-store';
import {useTheme} from '@/shared/hooks/useTheme';
import {useSocket} from '@/shared/hooks/useSocket';
import {usePlayerStore} from '@/store/player-store';

import {HomePage} from '@/features/discovery/HomePage';
import {SearchPage} from '@/features/search/SearchPage';
import {DownloadsPage} from '@/features/downloads/DownloadsPage';
import {WatchlistPage} from '@/features/watchlist/WatchlistPage';
import {GenresPage} from '@/features/genres/GenresPage';
import {UrlDownloadPage} from '@/features/url-download/UrlDownloadPage';
import {PlaylistsPage} from '@/features/playlists/PlaylistsPage';
import {SettingsPage} from '@/features/settings/SettingsPage';

const PAGE_MAP = {
  home: HomePage,
  search: SearchPage,
  downloads: DownloadsPage,
  watchlist: WatchlistPage,
  genres: GenresPage,
  'url-download': UrlDownloadPage,
  playlists: PlaylistsPage,
  settings: SettingsPage,
} as const;

export function AppShell() {
  useTheme();
  useSocket();

  const {currentPage} = useAppStore();
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Cmd+K / Ctrl+K to open command palette
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

  const PageComponent = PAGE_MAP[currentPage];

  return (
    <div className="flex h-dvh overflow-hidden bg-primary-bg">
      <Sidebar onOpenPalette={() => setCmdOpen(true)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onOpenPalette={() => setCmdOpen(true)} />

        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{paddingBottom: hasTrack ? 'var(--player-height)' : 0}}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{opacity: 0, y: 6}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -6}}
              transition={{duration: 0.18, ease: 'easeOut'}}
              className="h-full"
            >
              <PageComponent />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <PlayerBar />

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--card-bg)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
          },
        }}
      />
    </div>
  );
}
