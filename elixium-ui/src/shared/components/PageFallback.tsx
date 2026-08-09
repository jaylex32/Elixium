/**
 * Placeholder shown while a lazily-loaded page chunk arrives.
 *
 * Deliberately a skeleton rather than a spinner: it occupies roughly the space
 * the real page will, so the transition does not collapse the scroll container
 * and bounce the layout when content lands.
 */
export function PageFallback() {
  return (
    <div className="animate-fade-in space-y-6 p-4 sm:p-6" role="status" aria-busy="true" aria-label="Loading page">
      <div className="skeleton h-4 w-56 rounded-sm" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({length: 12}).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="skeleton aspect-square w-full rounded-md" />
            <div className="skeleton h-3 w-4/5 rounded-xs" />
            <div className="skeleton h-3 w-3/5 rounded-xs" />
          </div>
        ))}
      </div>
    </div>
  );
}
