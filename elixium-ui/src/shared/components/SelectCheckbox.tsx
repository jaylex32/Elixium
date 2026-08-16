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
        /* 20px, not 24. The larger box crowded the play control on a card and
           read as the primary action rather than a secondary one. */
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-all duration-fast',
        selected
          ? 'border-accent bg-accent text-white shadow-sm'
          : // Solid backing rather than a translucent one: over pale artwork a
            // semi-transparent box vanished into the cover, which is why it
            // sometimes looked as though there was no checkbox at all.
            'border-white/80 bg-black/65 text-transparent shadow-sm hover:border-accent hover:bg-black/80',
        // Touch has no hover, so anything not permanently shown must at least
        // appear as soon as the mode is on.
        selected || alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      <Check size={12} strokeWidth={3.5} />
    </button>
  );
}
