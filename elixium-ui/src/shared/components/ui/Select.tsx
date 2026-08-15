import * as SelectPrimitive from '@radix-ui/react-select';
import {Check, ChevronDown} from 'lucide-react';
import {cn} from '@/shared/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({value, onValueChange, options, placeholder, disabled, className}: SelectProps) {
  /*
   * Radix throws if an item value is an empty string — it reserves "" for
   * "cleared, show the placeholder". Thrown from render that takes down the
   * whole page rather than degrading one control, which is what it did to the
   * Charts page. Dropping the option keeps the rest usable and says why.
   */
  const safeOptions = options.filter((opt) => {
    if (opt.value !== '') return true;
    console.warn(`Select: dropped option "${opt.label}" — an empty value is not allowed.`);
    return false;
  });

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-sm border border-border bg-surface-bg px-3 text-sm text-text-primary lg:h-9',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder ?? 'Select…'} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-modal min-w-[8rem] overflow-hidden rounded-xl border border-border bg-card-bg shadow-xl animate-fade-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {safeOptions.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-primary outline-none',
                  'hover:bg-surface-bg data-[highlighted]:bg-surface-bg',
                )}
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto">
                  <Check size={12} className="text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
