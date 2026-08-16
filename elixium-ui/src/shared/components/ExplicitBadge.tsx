import {cn} from '@/shared/lib/utils';

/**
 * The standard explicit marker.
 *
 * A filled "E" square rather than the word, which is what every music service
 * uses and what people recognise at a glance in a dense list. Kept to the text
 * line height so it sits inline with a title without changing the row's rhythm.
 */
export function ExplicitBadge({className}: {className?: string}) {
  return (
    <span
      // Not aria-hidden: "explicit" is information, and a screen reader user
      // has the same reason to know as anyone else.
      role="img"
      aria-label="Explicit"
      title="Explicit content"
      className={cn(
        'inline-flex h-[1.1em] w-[1.1em] shrink-0 items-center justify-center rounded-[0.2em]',
        'bg-text-muted/70 text-[0.7em] font-bold leading-none text-primary-bg',
        className,
      )}
    >
      E
    </span>
  );
}
