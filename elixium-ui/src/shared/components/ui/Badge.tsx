import {type HTMLAttributes} from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/shared/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-accent/20 text-accent border border-accent/30',
      secondary: 'bg-surface-bg text-text-secondary border border-border',
      success: 'bg-success/20 text-success border border-success/30',
      warning: 'bg-warning/20 text-warning border border-warning/30',
      danger: 'bg-danger/20 text-danger border border-danger/30',
      info: 'bg-info/20 text-info border border-info/30',
      ghost: 'bg-transparent text-text-muted',
    },
  },
  defaultVariants: {variant: 'default'},
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({className, variant, ...props}: BadgeProps) {
  return <span className={cn(badgeVariants({variant}), className)} {...props} />;
}
