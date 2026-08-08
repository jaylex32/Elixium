import * as TabsPrimitive from '@radix-ui/react-tabs';
import {cn} from '@/shared/lib/utils';

export const TabsRoot = TabsPrimitive.Root;

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

export function TabsList({children, className}: TabsListProps) {
  return (
    // scroll-row (index.css) hides the scrollbar and enables momentum scrolling;
    // four tab labels do not fit 360px, so the strip scrolls instead of
    // overflowing the viewport.
    <TabsPrimitive.List
      className={cn('scroll-row flex gap-1 rounded-md border border-border bg-secondary-bg p-1', className)}
    >
      {children}
    </TabsPrimitive.List>
  );
}

interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsTrigger({value, children, className}: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        // min-h keeps the tab a usable tap target on touch; py alone left it
        // at 32px, under every platform's 44px guidance.
        'flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-text-muted transition-all lg:min-h-0 lg:flex-1 lg:shrink',
        'data-[state=active]:bg-card-bg data-[state=active]:text-text-primary data-[state=active]:shadow-sm',
        'hover:text-text-secondary',
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export const TabsContent = TabsPrimitive.Content;
