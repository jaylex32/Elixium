import {create} from 'zustand';
import type {Service} from '@/types';

export type SelectableType = 'track' | 'album' | 'artist' | 'playlist';

export interface SelectableItem {
  id: string;
  type: SelectableType;
  service: Service;
  title: string;
  artist?: string;
  cover?: string;
  /** Share URL, when the item came from another service and needs converting. */
  url?: string;
}

/** Same id can exist on both services, and as different types. */
const keyOf = (item: {service: string; type: string; id: string}) => `${item.service}:${item.type}:${item.id}`;

interface SelectionState {
  /** Keyed so lookups during render stay O(1) across long lists. */
  items: Record<string, SelectableItem>;
  /**
   * Selection mode is explicit rather than implied by a non-empty selection.
   *
   * Without it, checkboxes would appear on every card permanently and clutter
   * ordinary browsing; with it, the first click on "Select" reveals them and
   * leaving clears up after itself.
   */
  active: boolean;

  toggle: (item: SelectableItem) => void;
  isSelected: (item: {service: string; type: string; id: string}) => boolean;
  selectMany: (items: SelectableItem[]) => void;
  clear: () => void;
  setActive: (active: boolean) => void;
  /** Enter selection mode and select the item that started it, in one step. */
  beginWith: (item: SelectableItem) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  items: {},
  active: false,

  toggle: (item) =>
    set((s) => {
      const key = keyOf(item);
      const next = {...s.items};
      if (next[key]) delete next[key];
      else next[key] = item;
      return {items: next};
    }),

  isSelected: (item) => Boolean(get().items[keyOf(item)]),

  /** Select-all for a visible list; already-selected entries are left alone. */
  selectMany: (items) =>
    set((s) => {
      const next = {...s.items};
      for (const item of items) next[keyOf(item)] = item;
      return {items: next, active: true};
    }),

  /*
   * Clearing also leaves selection mode.
   *
   * It used to empty the items and keep `active` true. The bar hides itself
   * when nothing is selected, so the mode stayed on with no way to turn it
   * off — checkboxes remained on every card and clicking one ticked it instead
   * of opening the album.
   */
  clear: () => set({items: {}, active: false}),

  // Leaving selection mode drops the selection: keeping it would mean a later
  // "Download selected" acts on things chosen in a context the user has left.
  setActive: (active) => set(active ? {active} : {active: false, items: {}}),

  beginWith: (item) => set((s) => ({active: true, items: {...s.items, [keyOf(item)]: item}})),
}));

/*
 * Deliberately no `selectedItems` selector.
 *
 * One existed and was passed straight to useSelectionStore, which meant a new
 * array on every snapshot read; React's useSyncExternalStore then aborted the
 * render and the window went blank. Subscribe to `items` and derive the list in
 * the component with useMemo instead.
 */
