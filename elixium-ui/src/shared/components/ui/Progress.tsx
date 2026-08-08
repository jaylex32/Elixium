import * as ProgressPrimitive from '@radix-ui/react-progress';
import {cn} from '@/shared/lib/utils';

interface ProgressProps {
  value?: number;
  className?: string;
  indicatorClassName?: string;
}

export function Progress({value = 0, className, indicatorClassName}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-bg', className)}
      value={value}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full bg-accent transition-all duration-300', indicatorClassName)}
        style={{width: `${Math.min(100, Math.max(0, value))}%`}}
      />
    </ProgressPrimitive.Root>
  );
}
