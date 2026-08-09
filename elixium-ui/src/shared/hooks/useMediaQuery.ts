import {useSyncExternalStore} from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * useSyncExternalStore rather than useEffect + useState: it reads the match
 * during render, so the first paint is already correct. The effect-based
 * version renders the desktop tree once and then corrects itself, which on a
 * phone shows a full-width sidebar for a frame.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };

  const getSnapshot = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };

  // Server snapshot: assume desktop so static output keeps the full layout.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Breakpoints mirror the layout-metric media query in index.css. Both must
 * change together — the CSS controls sizing, this controls which components
 * mount, and a mismatch produces a sidebar with zero width or a bottom nav
 * overlapping a rail.
 */
export const useIsMobile = (): boolean => useMediaQuery('(max-width: 1023px)');
export const useIsCompact = (): boolean => useMediaQuery('(max-width: 639px)');
export const usePrefersReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)');
