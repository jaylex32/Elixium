import fs from 'fs';
import path from 'path';

/**
 * Things the user starred, kept on the server.
 *
 * Server-side rather than in the browser deliberately: this is normally run on
 * one machine and reached from others — a phone, a laptop, the desktop app —
 * and favourites held in localStorage would be a different set on each of
 * them, and would vanish with the site data.
 *
 * Stored beside the config as its own file rather than inside it. The config
 * holds credentials and gets rewritten by the settings screen; a list that
 * grows with every star does not belong in the same write path.
 */

export type FavoriteType = 'track' | 'album' | 'artist' | 'playlist';

export interface FavoriteRecord {
  id: string;
  type: FavoriteType;
  service: 'deezer' | 'qobuz' | 'ytmusic';
  title: string;
  artist?: string;
  cover?: string;
  /** Kept so a favourited album can be re-opened without another lookup. */
  duration?: string;
  /**
   * Where this belongs in the catalogue, kept so a starred track can still
   * reach its artist and its album. A favourite outlives the page it was
   * starred from, and without these it is a name with nowhere to go. Absent on
   * anything starred before they were recorded, which reads as plain text.
   */
  album?: string;
  artistId?: string;
  albumId?: string;
  addedAt: number;
}

/** Identity of a favourite: the same id can exist on both services. */
const keyOf = (service: string, type: string, id: string) => `${service}:${type}:${id}`;

export const createFavoritesStore = (filePath: string) => {
  let favorites: FavoriteRecord[] = [];
  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      favorites = Array.isArray(parsed?.favorites) ? parsed.favorites : [];
    } catch {
      // Missing or unreadable is the normal first-run case, not an error.
      favorites = [];
    }
  };

  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(filePath), {recursive: true});
      fs.writeFileSync(filePath, JSON.stringify({favorites}, null, 2), 'utf8');
    } catch (error: any) {
      // A failed write must not take down the request that triggered it; the
      // star still works for this session and the reason is visible in Logs.
      console.error('Could not save favorites:', error?.message ?? error);
    }
  };

  const list = (type?: FavoriteType, service?: string): FavoriteRecord[] => {
    load();
    return favorites
      .filter((entry) => (!type || entry.type === type) && (!service || entry.service === service))
      .sort((a, b) => b.addedAt - a.addedAt);
  };

  const has = (service: string, type: string, id: string): boolean => {
    load();
    return favorites.some((entry) => keyOf(entry.service, entry.type, entry.id) === keyOf(service, type, id));
  };

  const add = (record: Omit<FavoriteRecord, 'addedAt'>): FavoriteRecord[] => {
    load();
    const key = keyOf(record.service, record.type, record.id);
    // Re-starring something updates it rather than adding a second row; the
    // cover or title may have improved since it was first saved.
    favorites = favorites.filter((entry) => keyOf(entry.service, entry.type, entry.id) !== key);
    favorites.push({...record, addedAt: Date.now()});
    persist();
    return list();
  };

  const remove = (service: string, type: string, id: string): FavoriteRecord[] => {
    load();
    const key = keyOf(service, type, id);
    favorites = favorites.filter((entry) => keyOf(entry.service, entry.type, entry.id) !== key);
    persist();
    return list();
  };

  /** Star or unstar in one call, so the client does not have to track state. */
  const toggle = (record: Omit<FavoriteRecord, 'addedAt'>): {favorited: boolean; favorites: FavoriteRecord[]} => {
    if (has(record.service, record.type, record.id)) {
      return {favorited: false, favorites: remove(record.service, record.type, record.id)};
    }
    return {favorited: true, favorites: add(record)};
  };

  const clear = (): FavoriteRecord[] => {
    load();
    favorites = [];
    persist();
    return [];
  };

  return {list, has, add, remove, toggle, clear};
};

export type FavoritesStore = ReturnType<typeof createFavoritesStore>;
