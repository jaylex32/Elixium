import {Download, X, CheckSquare} from 'lucide-react';
import {toast} from 'sonner';
import {useMemo} from 'react';
import {useSelectionStore} from '@/store/selection-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {usePlayerStore} from '@/store/player-store';
import {Button} from '@/shared/components/ui/Button';
import {cn} from '@/shared/lib/utils';

/**
 * Floating bar shown while items are selected, with the bulk actions.
 *
 * Rendered once in the shell rather than per page, so the selection survives
 * moving between Search, Charts and an artist's albums — bulk downloading is
 * most useful when the things being collected come from more than one place.
 *
 * It sits above the player because the player is the only other thing pinned to
 * the bottom, and covering it would hide the controls for whatever is playing.
 */
export function SelectionBar() {
  const active = useSelectionStore((s) => s.active);
  /*
   * Subscribe to the stable record and derive the list here.
   *
   * Selecting with Object.values() built a new array on every call, and zustand
   * reads through React's useSyncExternalStore, which requires the snapshot to
   * be referentially stable. An unstable one makes React abort the render with
   * an infinite-loop error and paint nothing — the whole window went blank.
   */
  const itemMap = useSelectionStore((s) => s.items);
  const items = useMemo(() => Object.values(itemMap), [itemMap]);
  const clear = useSelectionStore((s) => s.clear);
  const setActive = useSelectionStore((s) => s.setActive);

  const {download} = useDownload();
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);

  if (!active || items.length === 0) return null;

  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});

  const summary = Object.entries(counts)
    .map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`)
    .join(' · ');

  const downloadAll = () => {
    for (const item of items) {
      download({
        id: item.id,
        url: item.url,
        type: item.type,
        title: item.title,
        artist: item.artist,
        cover: item.cover,
        service: item.service,
      });
    }
    toast.success(`Queued ${items.length} item${items.length === 1 ? '' : 's'}`, {
      description: 'Track progress on the Downloads page.',
    });
    setActive(false);
  };

  return (
    <div
      className={cn(
        'fixed inset-x-0 z-overlay flex justify-center px-4 pb-safe',
        // Clear the player when something is loaded, and the mobile bottom nav
        // in every case, so the bar never lands on top of either.
        hasTrack ? 'bottom-[calc(var(--player-height)+var(--bottom-nav-height)+12px)]' : 'bottom-[calc(var(--bottom-nav-height)+12px)]',
      )}
    >
      <div className="flex w-full max-w-2xl items-center gap-3 rounded-lg border border-border bg-card-bg/95 p-2.5 shadow-xl backdrop-blur-md">
        <CheckSquare size={16} className="ml-1 shrink-0 text-accent" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            {items.length} selected
          </p>
          <p className="truncate text-xs text-text-muted">{summary}</p>
        </div>

        <Button size="sm" onClick={downloadAll} className="shrink-0">
          <Download size={14} />
          <span className="hidden sm:inline">Download selected</span>
          <span className="sm:hidden">Download</span>
        </Button>

        <Button variant="ghost" size="sm" onClick={clear} className="shrink-0 text-text-muted">
          Clear
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Leave selection mode"
          onClick={() => setActive(false)}
          className="shrink-0 text-text-muted"
        >
          <X size={15} />
        </Button>
      </div>
    </div>
  );
}
