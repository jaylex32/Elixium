import * as DialogPrimitive from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {cn} from '@/shared/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
}

export function DialogContent({children, className, title, description}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-2xl border border-border bg-card-bg p-6 shadow-2xl',
          'data-[state=open]:animate-fade-in',
          className,
        )}
      >
        {title && (
          <DialogPrimitive.Title className="text-lg font-semibold text-text-primary mb-1">
            {title}
          </DialogPrimitive.Title>
        )}
        {description && (
          <DialogPrimitive.Description className="text-sm text-text-muted mb-4">
            {description}
          </DialogPrimitive.Description>
        )}
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1 text-text-muted hover:text-text-primary hover:bg-surface-bg transition-colors">
          <X size={16} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
