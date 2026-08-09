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
        // Touch-friendly below lg:, dense from lg: up. The boundary matches
        // where the shell swaps its mobile layout for the desktop rail, so
        // control density and layout change together rather than at 640px.
        sm: 'h-10 px-3 text-xs lg:h-8',
        default: 'h-10 px-4 lg:h-9',
        lg: 'h-12 px-6 text-base lg:h-11',
        icon: 'h-10 w-10 p-0 lg:h-9 lg:w-9',
        'icon-sm': 'h-10 w-10 p-0 lg:h-7 lg:w-7',
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
