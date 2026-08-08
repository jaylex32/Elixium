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
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      width: {
        sidebar: 'var(--sidebar-width)',
      },
      height: {
        header: 'var(--header-height)',
        player: 'var(--player-height)',
      },
      spacing: {
        sidebar: 'var(--sidebar-width)',
        header: 'var(--header-height)',
        player: 'var(--player-height)',
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
        shimmer: {
          '0%': {backgroundPosition: '-200% 0'},
          '100%': {backgroundPosition: '200% 0'},
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in-left': 'slide-in-left 0.2s ease-out',
        shimmer: 'shimmer 1.5s infinite linear',
      },
    },
  },
  plugins: [],
};
