/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'primary-bg': 'var(--primary-bg)',
        'secondary-bg': 'var(--secondary-bg)',
        'card-bg': 'var(--card-bg)',
        'surface-bg': 'var(--surface-bg)',
        'accent-bg': 'var(--accent-bg)',
        border: 'var(--border-color)',
        accent: 'var(--primary-accent)',
        'accent-2': 'var(--secondary-accent)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        success: 'var(--success-color)',
        warning: 'var(--warning-color)',
        danger: 'var(--error-color)',
        info: 'var(--info-color)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        // Fluid display sizes: scale with the viewport but never collapse on a
        // phone or run away on an ultrawide.
        'display-sm': ['clamp(1.5rem, 1.2rem + 1.4vw, 2rem)', {lineHeight: '1.15', letterSpacing: '-0.02em'}],
        'display-md': ['clamp(1.875rem, 1.4rem + 2.2vw, 2.75rem)', {lineHeight: '1.1', letterSpacing: '-0.025em'}],
        'display-lg': ['clamp(2.25rem, 1.6rem + 3.2vw, 3.75rem)', {lineHeight: '1.05', letterSpacing: '-0.03em'}],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        spring: 'var(--ease-spring)',
        smooth: 'var(--ease-smooth)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      zIndex: {
        sticky: 'var(--z-sticky)',
        header: 'var(--z-header)',
        player: 'var(--z-player)',
        'bottom-nav': 'var(--z-bottom-nav)',
        drawer: 'var(--z-drawer)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
      width: {
        sidebar: 'var(--sidebar-width)',
      },
      height: {
        header: 'var(--header-height)',
        player: 'var(--player-height)',
        'bottom-nav': 'var(--bottom-nav-height)',
      },
      maxWidth: {
        content: 'var(--content-max)',
      },
      spacing: {
        sidebar: 'var(--sidebar-width)',
        header: 'var(--header-height)',
        player: 'var(--player-height)',
        'bottom-nav': 'var(--bottom-nav-height)',
        'safe-top': 'var(--safe-top)',
        'safe-bottom': 'var(--safe-bottom)',
      },
      keyframes: {
        'fade-in': {
          from: {opacity: '0', transform: 'translateY(8px)'},
          to: {opacity: '1', transform: 'translateY(0)'},
        },
        'slide-in-left': {
          from: {opacity: '0', transform: 'translateX(-16px)'},
          to: {opacity: '1', transform: 'translateX(0)'},
        },
        'slide-up': {
          from: {opacity: '0', transform: 'translateY(100%)'},
          to: {opacity: '1', transform: 'translateY(0)'},
        },
        shimmer: {
          '0%': {backgroundPosition: '-200% 0'},
          '100%': {backgroundPosition: '200% 0'},
        },
        'pulse-ring': {
          '0%': {transform: 'scale(0.9)', opacity: '0.7'},
          '70%': {transform: 'scale(1.25)', opacity: '0'},
          '100%': {transform: 'scale(1.25)', opacity: '0'},
        },
      },
      animation: {
        'fade-in': 'fade-in var(--duration-base) var(--ease-out)',
        'slide-in-left': 'slide-in-left var(--duration-base) var(--ease-out)',
        'slide-up': 'slide-up var(--duration-slow) var(--ease-out)',
        shimmer: 'shimmer 1.5s infinite linear',
        'pulse-ring': 'pulse-ring 2s var(--ease-out) infinite',
      },
    },
  },
  plugins: [],
};
