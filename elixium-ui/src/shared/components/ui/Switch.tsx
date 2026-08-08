import * as SwitchPrimitive from '@radix-ui/react-switch';
import {cn} from '@/shared/lib/utils';

interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({checked, onCheckedChange, disabled, className}: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
