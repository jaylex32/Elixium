import {forwardRef, type ButtonHTMLAttributes} from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/shared/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white hover:opacity-90 active:scale-95',
        secondary: 'bg-surface-bg text-text-primary border border-border hover:bg-accent-bg active:scale-95',
        ghost: 'text-text-secondary hover:bg-surface-bg hover:text-text-primary active:scale-95',
        destructive: 'bg-danger text-white hover:opacity-90 active:scale-95',
        outline: 'border border-border bg-transparent text-text-primary hover:bg-surface-bg active:scale-95',
        link: 'text-accent underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({className, variant, size, ...props}, ref) => (
  <button ref={ref} className={cn(buttonVariants({variant, size}), className)} {...props} />
));
Button.displayName = 'Button';
