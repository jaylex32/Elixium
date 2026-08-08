import {motion, AnimatePresence} from 'framer-motion';
import {
  Home,
  Search,
  Download,
  Eye,
  Music2,
  Link2,
  ListMusic,
  Settings,
  ChevronLeft,
  ChevronRight,
  Disc3,
} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useAppStore, type Page, type Service} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';
import {Tooltip, TooltipProvider} from '@/shared/components/ui/Tooltip';
import {Badge} from '@/shared/components/ui/Badge';

const NAV_ITEMS: {id: Page; icon: React.ElementType; label: string}[] = [
  {id: 'home', icon: Home, label: 'Home'},
  {id: 'search', icon: Search, label: 'Search'},
  {id: 'downloads', icon: Download, label: 'Downloads'},
  {id: 'watchlist', icon: Eye, label: 'Watchlist'},
  {id: 'genres', icon: Music2, label: 'Genres'},
  {id: 'url-download', icon: Link2, label: 'URL Download'},
  {id: 'playlists', icon: ListMusic, label: 'Playlists'},
  {id: 'settings', icon: Settings, label: 'Settings'},
];

const SERVICE_ITEMS: {id: Service; label: string; color: string}[] = [
  {id: 'deezer', label: 'Deezer', color: '#a259ff'},
  {id: 'qobuz', label: 'Qobuz', color: '#0067b3'},
];

export function Sidebar({onOpenPalette: _onOpenPalette}: {onOpenPalette?: () => void}) {
  const {currentPage, setPage, sidebarCollapsed, toggleSidebar, service, setService} = useAppStore();
  const active = useDownloadStore((s) => s.active);
  const activeDownloads = Object.values(active).filter((d) => d.status === 'downloading').length;
  const startingCount = Object.values(active).filter(
    (d) => d.status === 'starting' || d.status === 'converting',
  ).length;
  const queuedCount = startingCount;

  return (
    <TooltipProvider>
      <motion.aside
        animate={{width: sidebarCollapsed ? 64 : 272}}
        transition={{duration: 0.22, ease: [0.4, 0, 0.2, 1]}}
        className="relative flex flex-col h-full bg-secondary-bg border-r border-border overflow-hidden shrink-0"
      >
        {/* Logo */}
        <div className="flex items-center h-header px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 h-8 w-8 rounded-xl bg-accent/20 flex items-center justify-center">
              <Disc3 size={18} className="text-accent" />
            </div>
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span
                  initial={{opacity: 0, x: -8}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: -8}}
                  transition={{duration: 0.15}}
                  className="font-bold text-base text-text-primary whitespace-nowrap"
                >
                  Elixium
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Service switcher */}
        {!sidebarCollapsed && (
          <div className="flex gap-1.5 px-3 py-2.5 border-b border-border shrink-0">
            {SERVICE_ITEMS.map((s) => (
              <button
                key={s.id}
                onClick={() => setService(s.id)}
                className={cn(
                  'flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all',
                  service === s.id ? 'text-white shadow-sm' : 'text-text-muted hover:text-text-primary bg-transparent',
                )}
                style={service === s.id ? {backgroundColor: s.color} : {}}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map(({id, icon: Icon, label}) => {
            const isActive = currentPage === id;
            const badge =
              id === 'downloads' && (activeDownloads > 0 || queuedCount > 0)
                ? activeDownloads > 0
                  ? activeDownloads
                  : queuedCount
                : null;

            const item = (
              <button
                key={id}
                onClick={() => setPage(id)}
                className={cn(
                  'relative flex items-center gap-3 w-full px-3 py-2.5 rounded-xl mx-1 transition-all text-sm font-medium',
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-bg',
                  sidebarCollapsed && 'justify-center mx-1',
                )}
                style={{width: sidebarCollapsed ? 48 : 'calc(100% - 8px)'}}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute inset-0 rounded-xl bg-accent/10 border border-accent/20"
                    transition={{duration: 0.2}}
                  />
                )}
                <Icon size={18} className="relative shrink-0" />
                <AnimatePresence>
                  {!sidebarCollapsed && (
                    <motion.span
                      initial={{opacity: 0}}
                      animate={{opacity: 1}}
                      exit={{opacity: 0}}
                      transition={{duration: 0.12}}
                      className="relative flex-1 text-left whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
                {badge !== null && !sidebarCollapsed && (
                  <Badge variant={activeDownloads > 0 ? 'warning' : 'secondary'} className="relative text-xs">
                    {badge}
                  </Badge>
                )}
                {badge !== null && sidebarCollapsed && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-warning" />
                )}
              </button>
            );

            return sidebarCollapsed ? (
              <Tooltip key={id} content={label} side="right">
                {item}
              </Tooltip>
            ) : (
              item
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center h-10 w-full border-t border-border text-text-muted hover:text-text-primary hover:bg-surface-bg transition-colors shrink-0"
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </motion.aside>
    </TooltipProvider>
  );
}
