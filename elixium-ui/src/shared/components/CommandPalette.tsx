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

const SERVICE_ITEMS: {service: Service; label: string; color: string}[] = [
  {service: 'deezer', label: 'Switch to Deezer', color: '#a259ff'},
  {service: 'qobuz', label: 'Switch to Qobuz', color: '#0067b3'},
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
                {SERVICE_ITEMS.filter((s) => s.service !== service).map(({service: svc, label, color}) => (
                  <CommandItem key={svc} label={label} color={color} onSelect={() => run(() => setService(svc))} />
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
  onSelect,
}: {
  icon?: React.ElementType;
  label: string;
  description?: string;
  color?: string;
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
          className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{background: `${color}22`}}
        >
          <span className="h-2 w-2 rounded-full" style={{background: color}} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      <ArrowRight
        size={13}
        className="text-text-muted opacity-0 group-data-[selected=true]:opacity-100 transition-opacity shrink-0"
      />
    </Command.Item>
  );
}
