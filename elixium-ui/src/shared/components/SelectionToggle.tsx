import {CheckSquare} from 'lucide-react';
import {useSelectionStore, type SelectableItem} from '@/store/selection-store';
import {Button} from '@/shared/components/ui/Button';

interface SelectionToggleProps {
  /** Everything currently on screen, for "Select all". Omit to hide that button. */
  items?: () => SelectableItem[];
  /** Hidden entirely when the list is empty. */
  disabled?: boolean;
  className?: string;
}

/**
 * Turns selection mode on for a page, and selects everything visible.
 *
 * Cards carry a checkbox that only fades in on hover, so on a touchscreen there
 * was no way to start selecting at all, and on a desktop nothing advertised
 * that it could be done. Search grew this control first; every other grid was
 * left without one, which is why the bulk-download bar could not be reached
 * from Charts, Favorites, Genres or Playlists.
 */
export function SelectionToggle({items, disabled, className}: SelectionToggleProps) {
  const active = useSelectionStore((s) => s.active);
  const setActive = useSelectionStore((s) => s.setActive);
  const selectMany = useSelectionStore((s) => s.selectMany);

  if (disabled) return null;

  return (
    <div className={className ?? 'flex items-center gap-2'}>
      <Button
        size="sm"
        variant={active ? 'default' : 'ghost'}
        className={active ? undefined : 'text-text-muted'}
        title={active ? 'Leave selection mode' : 'Select several at once'}
        onClick={() => setActive(!active)}
      >
        <CheckSquare size={13} />
        {active ? 'Done' : 'Select'}
      </Button>

      {active && items && (
        <Button size="sm" variant="ghost" className="text-text-muted" onClick={() => selectMany(items())}>
          Select all
        </Button>
      )}
    </div>
  );
}
