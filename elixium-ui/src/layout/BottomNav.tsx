import {MoreHorizontal} from 'lucide-react';
import {motion} from 'framer-motion';
import {cn} from '@/shared/lib/utils';
import {useAppStore} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';
import {PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS} from './nav-items';

interface BottomNavProps {
  onOpenMore: () => void;
  moreOpen: boolean;
}

/**
 * Mobile primary navigation.
 *
 * Fixed to the bottom of the viewport, below the player. Its height is
 * --bottom-nav-height, which scroll containers reserve via .pb-shell so
 * content is never hidden behind it.
 */
export function BottomNav({onOpenMore, moreOpen}: BottomNavProps) {
  const {currentPage, setPage} = useAppStore();
  const active = useDownloadStore((s) => s.active);
  const downloadingCount = Object.values(active).filter((d) => d.status === 'downloading').length;

  const isSecondaryActive = SECONDARY_NAV_ITEMS.some((item) => item.id === currentPage);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-bottom-nav glass border-t border-border pb-safe lg:hidden"
      style={{height: 'calc(var(--bottom-nav-height) + var(--safe-bottom))'}}
      aria-label="Primary"
    >
      <div className="flex h-bottom-nav items-stretch">
        {PRIMARY_NAV_ITEMS.map(({id, icon: Icon, label, shortLabel}) => {
          const isActive = currentPage === id;
          const badge = id === 'downloads' && downloadingCount > 0 ? downloadingCount : null;

          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-fast',
                isActive ? 'text-accent' : 'text-text-muted active:text-text-secondary',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-indicator"
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-accent"
                  transition={{type: 'spring', stiffness: 380, damping: 30}}
                />
              )}
              <span className="relative">
                <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                {badge !== null && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-primary-bg">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium leading-none">{shortLabel ?? label}</span>
            </button>
          );
        })}

        <button
          onClick={onOpenMore}
          aria-expanded={moreOpen}
          aria-label="More destinations"
          className={cn(
            'relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-fast',
            moreOpen || isSecondaryActive ? 'text-accent' : 'text-text-muted active:text-text-secondary',
          )}
        >
          <MoreHorizontal size={20} strokeWidth={moreOpen || isSecondaryActive ? 2.4 : 2} />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </div>
    </nav>
  );
}
