import * as TabsPrimitive from '@radix-ui/react-tabs';
import {cn} from '@/shared/lib/utils';

export const TabsRoot = TabsPrimitive.Root;

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

export function TabsList({children, className}: TabsListProps) {
  return (
    <TabsPrimitive.List className={cn('flex gap-1 rounded-xl bg-secondary-bg p-1 border border-border', className)}>
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
        'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium text-text-muted transition-all',
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
