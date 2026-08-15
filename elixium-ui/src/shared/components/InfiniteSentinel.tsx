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
 * Loads the next page when the end of a list comes into view.
 *
 * An IntersectionObserver rather than a scroll handler: the list can sit in
 * the page scroller or inside a modal's own scroll container, and the observer
 * works for both without being told which. A scroll listener would have to be
 * attached to the right ancestor and would fire on every frame.
 *
 * The sentinel is given room below it and a 400px margin so the fetch starts
 * before the user actually hits the bottom, which is what makes it feel like
 * the list simply continues rather than stalling at each boundary.
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
      {rootMargin: '400px'},
    );

    observer.observe(node);
    return () => observer.disconnect();
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
