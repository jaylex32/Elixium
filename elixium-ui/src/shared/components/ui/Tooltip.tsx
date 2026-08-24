import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {cn} from '@/shared/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  children: React.ReactNode;
  /*
   * Rich content, not just a label.
   *
   * A one-line string covers most uses, but an explanation worth hiding behind
   * a hover is usually a short list — and the alternative to allowing that is
   * leaving the list on the page taking up room nobody needs after the first
   * read.
   */
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delayDuration?: number;
  /** Widen past the default for multi-line content. */
  wide?: boolean;
}

export function Tooltip({children, content, side = 'top', delayDuration = 400, wide}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 rounded-lg border border-border bg-card-bg px-2.5 py-1.5 text-xs text-text-primary shadow-lg',
            'animate-fade-in',
            wide && 'max-w-xs px-3 py-2.5 leading-relaxed',
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-card-bg" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
