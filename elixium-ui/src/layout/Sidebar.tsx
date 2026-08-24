import {useEffect, useRef} from 'react';
import {motion, AnimatePresence} from 'framer-motion';
import {ChevronLeft, ChevronRight, Disc3, X} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {usePlayerStore} from '@/store/player-store';
import {useAppStore, type Page} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';
import {Tooltip, TooltipProvider} from '@/shared/components/ui/Tooltip';
import {Badge} from '@/shared/components/ui/Badge';
import {NAV_ITEMS, SERVICE_ITEMS, type NavItem} from './nav-items';

/** Shared row rendering so the desktop rail and the mobile drawer stay identical. */
function NavButton({
  item,
  collapsed,
  badge,
  onSelect,
}: {
  item: NavItem;
  collapsed: boolean;
  badge: number | null;
  onSelect: (id: Page) => void;
}) {
  const currentPage = useAppStore((s) => s.currentPage);
  const isActive = currentPage === item.id;
  const Icon = item.icon;

  return (
    <button
      onClick={() => onSelect(item.id)}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative mx-2 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-fast',
        isActive ? 'text-accent' : 'text-text-secondary hover:bg-surface-bg hover:text-text-primary',
        collapsed ? 'w-12 justify-center' : 'w-[calc(100%-1rem)]',
      )}
    >
      {isActive && (
        <motion.span
          layoutId="nav-indicator"
          className="absolute inset-0 rounded-md border border-accent/25 bg-accent/12"
          transition={{type: 'spring', stiffness: 380, damping: 32}}
        />
      )}
      <Icon size={18} className="relative shrink-0" strokeWidth={isActive ? 2.3 : 2} />
      {!collapsed && <span className="relative flex-1 truncate text-left">{item.label}</span>}
      {badge !== null && !collapsed && (
        <Badge variant="warning" className="relative">
          {badge}
        </Badge>
      )}
      {badge !== null && collapsed && (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning" aria-hidden />
      )}
    </button>
  );
}

function SidebarContent({collapsed, onNavigate}: {collapsed: boolean; onNavigate: (id: Page) => void}) {
  const {service, setService} = useAppStore();
  const active = useDownloadStore((s) => s.active);
  const downloading = Object.values(active).filter((d) => d.status === 'downloading').length;
  const pending = Object.values(active).filter((d) => d.status === 'starting' || d.status === 'converting').length;

  return (
    <>
      {!collapsed && (
        <div className="flex shrink-0 gap-1.5 border-b border-border px-3 py-2.5">
          {SERVICE_ITEMS.map((s) => (
            <button
              key={s.id}
              onClick={() => setService(s.id)}
              aria-pressed={service === s.id}
              className={cn(
                'flex-1 rounded-sm py-2 text-xs font-semibold transition-all duration-fast',
                service === s.id ? 'text-white shadow-sm' : 'text-text-muted hover:bg-surface-bg hover:text-text-primary',
              )}
              style={service === s.id ? {backgroundColor: s.color} : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto py-2" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const count = downloading > 0 ? downloading : pending;
          const badge = item.id === 'downloads' && count > 0 ? count : null;

          return collapsed ? (
            <Tooltip key={item.id} content={item.label} side="right">
              <NavButton item={item} collapsed badge={badge} onSelect={onNavigate} />
            </Tooltip>
          ) : (
            <NavButton key={item.id} item={item} collapsed={false} badge={badge} onSelect={onNavigate} />
          );
        })}
      </nav>
    </>
  );
}

/** Persistent rail. Desktop only — below 1024px the drawer takes over. */
export function Sidebar() {
  const {sidebarCollapsed, toggleSidebar, setPage} = useAppStore();
  /*
   * The player is fixed across the full width of the window, and the collapse
   * button is the last thing in this column — so while something was playing
   * the player sat directly on top of it and the sidebar could not be opened
   * at all. The rail reserves the same height the scroll container does.
   */
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);

  return (
    <TooltipProvider>
      <motion.aside
        animate={{width: sidebarCollapsed ? 68 : 264}}
        transition={{duration: 0.24, ease: [0.22, 1, 0.36, 1]}}
        style={hasTrack ? {paddingBottom: 'calc(var(--player-height) + var(--safe-bottom))'} : undefined}
        className="relative hidden h-full shrink-0 flex-col overflow-hidden border-r border-border bg-secondary-bg lg:flex"
      >
        {/* Centred, then nudged slightly left — the extra right padding shifts
            the block ~10px off true centre, which reads better against the
            left-aligned nav labels below. */}
        <div className="flex h-header shrink-0 items-center justify-center border-b border-border pl-4 pr-9">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-accent/20">
              <Disc3 size={18} className="text-accent" />
            </div>
            {!sidebarCollapsed && (
              <span className="truncate text-base font-bold tracking-tight text-text-primary">Elixium</span>
            )}
          </div>
        </div>

        <SidebarContent collapsed={sidebarCollapsed} onNavigate={setPage} />

        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-10 w-full shrink-0 items-center justify-center border-t border-border text-text-muted transition-colors hover:bg-surface-bg hover:text-text-primary"
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </motion.aside>
    </TooltipProvider>
  );
}

/** Off-canvas navigation for mobile, opened from the header or the More button. */
export function NavDrawer({open, onClose}: {open: boolean; onClose: () => void}) {
  const setPage = useAppStore((s) => s.setPage);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind must not scroll while the drawer is up.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;

    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.2}}
            onClick={onClose}
            className="fixed inset-0 z-drawer bg-black/60 backdrop-blur-sm lg:hidden"
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{x: '-100%'}}
            animate={{x: 0}}
            exit={{x: '-100%'}}
            transition={{type: 'spring', stiffness: 400, damping: 40}}
            className="fixed inset-y-0 left-0 z-drawer-panel flex w-[min(84vw,320px)] flex-col border-r border-border bg-secondary-bg pt-safe outline-none lg:hidden"
          >
            <div className="flex h-header shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent/20">
                  <Disc3 size={18} className="text-accent" />
                </div>
                <span className="text-base font-bold text-text-primary">Elixium</span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close navigation"
                className="touch-target -mr-2 flex items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-primary"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col pb-safe">
              <SidebarContent
                collapsed={false}
                onNavigate={(id) => {
                  setPage(id);
                  onClose();
                }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
