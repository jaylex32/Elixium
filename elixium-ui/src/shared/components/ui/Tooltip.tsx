import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {cn} from '@/shared/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delayDuration?: number;
}

export function Tooltip({children, content, side = 'top', delayDuration = 400}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 rounded-lg bg-card-bg border border-border px-2.5 py-1.5 text-xs text-text-primary shadow-lg',
            'animate-fade-in',
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-card-bg" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
