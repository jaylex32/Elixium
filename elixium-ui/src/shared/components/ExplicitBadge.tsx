import {cn} from '@/shared/lib/utils';

/**
 * The standard explicit marker.
 *
 * Outlined rather than filled. The first version was a solid block using the
 * muted text colour with the page background as its letter — which on a dark
 * theme is dark-on-dark, so it read as a black smudge and was effectively
 * invisible. An outline inherits `currentColor`, so it takes the colour of
 * whatever text it sits beside and stays legible in every theme without
 * hardcoding a palette entry.
 *
 * Slightly larger than the surrounding text and never shrunk below 14px: at the
 * cap height of a 12px label the letter is unreadable.
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
        'inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px]',
        'border border-current text-[10px] font-bold leading-none opacity-70',
        // Sits with the text baseline rather than riding above it.
        'translate-y-[0.5px]',
        className,
      )}
    >
      E
    </span>
  );
}
