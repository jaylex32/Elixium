/**
 * Keeps a dialog open when the click landed on the selection bar.
 *
 * The bar is rendered in the shell, not inside the dialog, so Radix counts a
 * pointer-down on it as an interaction outside the modal and dismisses it —
 * the album or artist window would vanish the moment "Download selected" was
 * pressed, taking the rest of the list with it.
 *
 * Spread onto DialogPrimitive.Content: it guards the pointer, focus and the
 * generic interact-outside paths, since Radix routes different input methods
 * through different ones.
 */
const isInSelectionBar = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest('[data-selection-bar]'));

type OutsideEvent = {target: EventTarget | null; preventDefault: () => void};

const guard = (event: OutsideEvent) => {
  if (isInSelectionBar(event.target)) event.preventDefault();
};

export const keepOpenForSelection = {
  onPointerDownOutside: guard,
  onFocusOutside: guard,
  onInteractOutside: guard,
};
