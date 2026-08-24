import {useEffect, useState} from 'react';
import {Command} from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {Search, Home, Download, Eye, Music2, Link2, ListMusic, Settings, ArrowRight} from 'lucide-react';
import {useAppStore, type Page, type Service} from '@/store/app-store';
import {cn} from '@/shared/lib/utils';

const NAV_ITEMS: {page: Page; icon: React.ElementType; label: string; description?: string}[] = [
  {page: 'home', icon: Home, label: 'Home', description: 'Discovery & new releases'},
  {page: 'search', icon: Search, label: 'Search', description: 'Find tracks, albums, artists'},
  {page: 'downloads', icon: Download, label: 'Downloads', description: 'Download queue & history'},
  {page: 'watchlist', icon: Eye, label: 'Watchlist', description: 'Monitor Qobuz artists'},
  {page: 'genres', icon: Music2, label: 'Genres', description: 'Browse by genre'},
  {page: 'url-download', icon: Link2, label: 'URL Download', description: 'Paste Deezer, Qobuz, Spotify URLs'},
  {page: 'playlists', icon: ListMusic, label: 'Playlists', description: 'Your playlists'},
  {page: 'settings', icon: Settings, label: 'Settings', description: 'Auth, quality, paths'},
];

/*
 * Every service, including the one already selected.
 *
 * The current service used to be filtered out, which left a lone "Switch to
 * Qobuz" row under a "Service" heading and no way to tell what you were on.
 * Showing all three with the active one marked answers "where am I" as well as
 * "where can I go", and it stops the list changing shape as you switch.
 */
const SERVICE_ITEMS: {service: Service; label: string; description: string; color: string}[] = [
  {service: 'deezer', label: 'Deezer', description: 'Lossless FLAC, wide catalogue', color: '#a259ff'},
  {service: 'qobuz', label: 'Qobuz', description: 'Hi-res up to 24-bit', color: '#0067b3'},
  {service: 'ytmusic', label: 'YouTube Music', description: 'Widest catalogue, AAC audio', color: '#ff0033'},
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({open, onClose}: CommandPaletteProps) {
  const {setPage, setService, setSearchQuery, service} = useAppStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[20%] z-[61] w-full max-w-lg -translate-x-1/2">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command className="rounded-2xl border border-border bg-card-bg shadow-2xl overflow-hidden" shouldFilter loop>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Search size={16} className="text-text-muted shrink-0" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search pages, switch service…"
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-text-muted hover:text-text-primary shrink-0">
                  ×
                </button>
              )}
              <kbd className="hidden sm:flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted shrink-0">
                ESC
              </kbd>
            </div>

            <Command.List className="max-h-80 overflow-y-auto py-2">
              <Command.Empty className="py-8 text-center text-sm text-text-muted">
                No results for "{search}"
              </Command.Empty>

              {/* Search shortcut */}
              {search.trim().length > 0 && (
                <Command.Group heading="Search">
                  <CommandItem
                    icon={Search}
                    label={`Search for "${search}"`}
                    onSelect={() =>
                      run(() => {
                        setPage('search');
                        setSearchQuery(search);
                      })
                    }
                  />
                </Command.Group>
              )}

              <Command.Group heading="Navigate">
                {NAV_ITEMS.map(({page, icon, label, description}) => (
                  <CommandItem
                    key={page}
                    icon={icon}
                    label={label}
                    description={description}
                    onSelect={() => run(() => setPage(page))}
                  />
                ))}
              </Command.Group>

              <Command.Group heading="Service">
                {SERVICE_ITEMS.map(({service: svc, label, description, color}) => (
                  <CommandItem
                    key={svc}
                    label={label}
                    description={description}
                    color={color}
                    active={svc === service}
                    onSelect={() => run(() => setService(svc))}
                  />
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CommandItem({
  icon: Icon,
  label,
  description,
  color,
  active,
  onSelect,
}: {
  icon?: React.ElementType;
  label: string;
  description?: string;
  color?: string;
  /** The service currently selected, marked rather than hidden. */
  active?: boolean;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label + (description ?? '')}
      onSelect={onSelect}
      className={cn(
        'group flex items-center gap-3 mx-1 px-3 py-2.5 rounded-xl cursor-pointer text-sm',
        'data-[selected=true]:bg-surface-bg outline-none transition-colors',
      )}
    >
      {Icon && (
        <div
          className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{background: color ? `${color}22` : 'var(--surface-bg)'}}
        >
          <Icon size={14} style={{color: color ?? 'var(--text-muted)'}} />
        </div>
      )}
      {!Icon && color && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset"
          style={{background: `${color}22`, ['--tw-ring-color' as string]: `${color}55`}}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{background: color}} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-text-primary">{label}</p>
        {description && <p className="truncate text-xs text-text-muted">{description}</p>}
      </div>
      {active ? (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{background: `${color ?? 'var(--accent)'}22`, color: color ?? 'var(--accent)'}}
        >
          Current
        </span>
      ) : (
        <ArrowRight
          size={13}
          className="shrink-0 text-text-muted opacity-0 transition-opacity group-data-[selected=true]:opacity-100"
        />
      )}
    </Command.Item>
  );
}
