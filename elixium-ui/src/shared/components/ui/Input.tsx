import {forwardRef, type InputHTMLAttributes} from 'react';
import {cn} from '@/shared/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({className, icon, suffix, ...props}, ref) => {
  if (icon || suffix) {
    return (
      <div className="relative flex items-center">
        {icon && <span className="absolute left-3 text-text-muted pointer-events-none">{icon}</span>}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg border border-border bg-surface-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            icon && 'pl-9',
            suffix && 'pr-9',
            className,
          )}
          {...props}
        />
        {suffix && <span className="absolute right-3 text-text-muted pointer-events-none">{suffix}</span>}
      </div>
    );
  }

  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-border bg-surface-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
        'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';
