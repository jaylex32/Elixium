import {create} from 'zustand';
import type {Service} from '@/types';

export interface AlbumTarget {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  year?: string | number;
  /** 'album' or 'playlist' — they open into the same view. */
  type?: string;
  service: Service;
}

export interface ArtistTarget {
  id: string;
  name: string;
  picture?: string;
  service: Service;
}

export type DetailEntry = {kind: 'album'; album: AlbumTarget} | {kind: 'artist'; artist: ArtistTarget};

interface NavigationState {
  /**
   * Detail views stacked over the current page, oldest first.
   *
   * A stack rather than a single "selected item" because the interesting
   * journeys are several steps deep: a track leads to its album, the album to
   * its artist, the artist to another album. Each page used to hold its own
   * `selected` state and could show exactly one thing, so stepping sideways
   * meant losing where you came from with no way back.
   */
  stack: DetailEntry[];

  openAlbum: (album: AlbumTarget) => void;
  openArtist: (artist: ArtistTarget) => void;
  /** Step back one view; the caller decides what an empty stack means. */
  back: () => void;
  /** Leave every detail view, for a deliberate jump elsewhere. */
  reset: () => void;
}

/** Same id can exist on both services, and an album and artist can share one. */
const sameEntry = (a: DetailEntry, b: DetailEntry): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'album' && b.kind === 'album') {
    return a.album.id === b.album.id && a.album.service === b.album.service;
  }
  if (a.kind === 'artist' && b.kind === 'artist') {
    return a.artist.id === b.artist.id && a.artist.service === b.artist.service;
  }
  return false;
};

const push = (stack: DetailEntry[], entry: DetailEntry): DetailEntry[] => {
  const top = stack[stack.length - 1];
  // Re-opening what is already showing would stack duplicates that each need
  // their own Back press to get past.
  if (top && sameEntry(top, entry)) return stack;
  return [...stack, entry];
};

export const useNavigationStore = create<NavigationState>((set) => ({
  stack: [],

  openAlbum: (album) => set((s) => ({stack: push(s.stack, {kind: 'album', album})})),
  openArtist: (artist) => set((s) => ({stack: push(s.stack, {kind: 'artist', artist})})),
  back: () => set((s) => (s.stack.length === 0 ? s : {stack: s.stack.slice(0, -1)})),
  reset: () => set((s) => (s.stack.length === 0 ? s : {stack: []})),
}));

/*
 * Deliberately no `current` selector.
 *
 * Reading `stack[stack.length - 1]` in the component returns a reference held
 * by the array, which is stable between renders; a selector that built an
 * object would give React a new snapshot every read and abort the render — the
 * failure that once shipped a blank window.
 */
