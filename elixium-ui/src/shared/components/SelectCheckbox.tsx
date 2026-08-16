import {Check} from 'lucide-react';
import {cn} from '@/shared/lib/utils';

interface SelectCheckboxProps {
  selected: boolean;
  onToggle: () => void;
  label: string;
  /** Keep it visible when selection mode is on, or when the item is chosen. */
  alwaysVisible?: boolean;
  className?: string;
}

/**
 * The pick-me control on a card or row.
 *
 * Hidden until hover during ordinary browsing and permanently visible once
 * selection mode is on — a checkbox on every card at all times turns a browsing
 * surface into a form, while a control that only ever appears on hover is
 * unreachable on a touchscreen.
 *
 * It stops the click from reaching the card, which would otherwise open the
 * item at the same moment it is being ticked.
 */
export function SelectCheckbox({selected, onToggle, label, alwaysVisible, className}: SelectCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onToggle();
      }}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 transition-all',
        selected
          ? 'border-accent bg-accent text-white'
          : 'border-white/70 bg-black/40 text-transparent backdrop-blur-sm hover:border-accent',
        // Touch has no hover, so anything not permanently shown must at least
        // appear as soon as the mode is on.
        selected || alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      <Check size={14} strokeWidth={3} />
    </button>
  );
}
