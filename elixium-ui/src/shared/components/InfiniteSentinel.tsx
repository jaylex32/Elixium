import {useEffect, useRef} from 'react';
import {Spinner} from '@/shared/components/ui/Spinner';

interface InfiniteSentinelProps {
  /** Whether another page exists. */
  hasMore: boolean;
  /** True while a page is in flight, so scrolling cannot queue several. */
  loading: boolean;
  onLoadMore: () => void;
  /** Shown once everything has been loaded; omit to show nothing. */
  endLabel?: string;
}

/**
 * The element that scrolls, which is not the page.
 *
 * The shell keeps its own scroller (`main.scroll-container`), so watching the
 * viewport is the wrong frame of reference: `rootMargin` then expands the
 * window rect rather than the scroller's, and whether that fires at all
 * depends on the engine — it worked in a browser and did nothing in the
 * desktop app, which is a different Chromium build. Observing the real
 * scrolling ancestor behaves identically everywhere.
 */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const {overflowY} = getComputedStyle(current);
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Loads the next page when the end of a list comes into view.
 *
 * An IntersectionObserver rather than a scroll handler: a list can sit in the
 * page scroller or inside a modal's own, and the observer works for both once
 * it is pointed at the right root. A scroll listener would have to be attached
 * to the correct ancestor and would fire on every frame.
 *
 * The 400px margin starts the fetch before the bottom is actually reached,
 * which is what makes the list feel continuous rather than stalling at each
 * page boundary.
 */
export function InfiniteSentinel({hasMore, loading, onLoadMore, endLabel}: InfiniteSentinelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Kept in a ref so the observer is not torn down and rebuilt on every
  // render — re-observing mid-scroll can drop the intersection that was about
  // to fire, which shows up as a list that stops loading until nudged.
  const fire = useRef(onLoadMore);
  fire.current = onLoadMore;

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fire.current();
      },
      // null falls back to the viewport, which is correct when the page itself
      // is what scrolls — a modal's list, for instance.
      {root: findScrollParent(node), rootMargin: '400px'},
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  /*
   * Safety net for the case the observer cannot cover: a first page shorter
   * than the container. Nothing scrolls, so no intersection is ever crossed,
   * and the list sits there looking finished when more exists.
   */
  useEffect(() => {
    if (!hasMore || loading) return;
    const node = ref.current;
    const parent = findScrollParent(node);
    if (!parent || parent.scrollHeight <= parent.clientHeight) {
      const timer = window.setTimeout(() => fire.current(), 250);
      return () => window.clearTimeout(timer);
    }
  }, [hasMore, loading]);

  if (!hasMore) {
    return endLabel ? <p className="py-6 text-center text-xs text-text-muted">{endLabel}</p> : null;
  }

  return (
    <div ref={ref} className="flex justify-center py-6">
      {loading ? <Spinner size="sm" /> : <span className="h-4" aria-hidden="true" />}
    </div>
  );
}
