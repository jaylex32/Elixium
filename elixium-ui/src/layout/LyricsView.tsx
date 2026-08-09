import {useEffect, useMemo, useRef} from 'react';
import {Mic2, Loader2} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useLyrics} from '@/shared/lib/api';
import {usePlayerStore} from '@/store/player-store';
import {usePrefersReducedMotion} from '@/shared/hooks/useMediaQuery';

/**
 * Lyrics for the current track.
 *
 * Renders a karaoke-style synced view when the source provides timestamps and
 * falls back to plain text otherwise. A missing lyric is an ordinary outcome,
 * not an error, so the empty state is neutral.
 */
export function LyricsView() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const reducedMotion = usePrefersReducedMotion();

  const {data, isLoading, isError} = useLyrics(currentTrack?.id, currentTrack?.service, Boolean(currentTrack));

  const synced = data?.synced ?? [];
  const hasSynced = synced.length > 0;

  /** Index of the line that should be highlighted at the current playhead. */
  const activeIndex = useMemo(() => {
    if (!hasSynced) return -1;
    const nowMs = currentTime * 1000;
    // Lines are ordered, so the last line whose start has passed is current.
    let index = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].timeMs <= nowMs) index = i;
      else break;
    }
    return index;
  }, [synced, hasSynced, currentTime]);

  const activeRef = useRef<HTMLParagraphElement>(null);

  // Keep the active line centred as playback advances.
  useEffect(() => {
    if (!hasSynced || activeIndex < 0) return;
    activeRef.current?.scrollIntoView({
      block: 'center',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [activeIndex, hasSynced, reducedMotion]);

  if (!currentTrack) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-text-muted">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Looking for lyrics…</span>
      </div>
    );
  }

  if (isError || !data?.text) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-text-muted">
        <Mic2 size={28} className="opacity-30" />
        <p className="mt-3 text-sm font-medium text-text-secondary">No lyrics available</p>
        <p className="mt-1 max-w-xs text-xs">
          This track has none, or the lyrics source could not be reached.
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      {hasSynced ? (
        <div className="space-y-3 text-center">
          {synced.map((line, index) => {
            const isActive = index === activeIndex;
            const isPast = index < activeIndex;
            return (
              <p
                key={`${line.timeMs}-${index}`}
                ref={isActive ? activeRef : undefined}
                className={cn(
                  'text-balance text-lg font-semibold leading-snug transition-all duration-slow',
                  isActive && 'scale-[1.03] text-text-primary',
                  !isActive && isPast && 'text-text-muted opacity-50',
                  !isActive && !isPast && 'text-text-secondary opacity-70',
                )}
              >
                {line.text}
              </p>
            );
          })}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-center text-base leading-relaxed text-text-secondary">{data.text}</p>
      )}

      {(data.writers || data.copyright) && (
        <p className="mt-8 text-center text-[11px] leading-relaxed text-text-muted">
          {data.writers && <>Written by {data.writers}</>}
          {data.writers && data.copyright && <br />}
          {data.copyright}
        </p>
      )}
    </div>
  );
}
