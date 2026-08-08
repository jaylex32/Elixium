import {useEffect, useState} from 'react';
import {Sparkles, Check} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {useSocketEvent, socketSend} from '@/shared/lib/socket-client';
import {Button} from '@/shared/components/ui/Button';

interface Genre {
  id: string;
  label: string;
  service?: string;
}

/**
 * Favourite genres, which bias what the watchlist surfaces.
 *
 * The server has exposed getFavoriteGenres/saveFavoriteGenres and a list of
 * available genres all along; nothing in the UI read either.
 */
export function FavoriteGenres() {
  const [available, setAvailable] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useSocketEvent<{genres?: unknown; availableGenres?: Genre[]}>('favoriteGenres', (data) => {
      setAvailable(Array.isArray(data?.availableGenres) ? data.availableGenres : []);
      // The server returns either ids or objects depending on how they were saved.
      const raw: unknown[] = Array.isArray(data?.genres) ? data.genres : [];
      setSelected(
        raw
          .map((g) => (typeof g === 'string' ? g : String((g as {id?: unknown})?.id ?? '')))
          .filter((id): id is string => Boolean(id)),
      );
    setLoaded(true);
    setDirty(false);
  });

  useEffect(() => {
    socketSend('getFavoriteGenres');
  }, []);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]));
    setDirty(true);
  };

  const save = () => {
    socketSend('saveFavoriteGenres', {genres: selected});
    setDirty(false);
    toast.success(selected.length ? `Saved ${selected.length} genres` : 'Cleared genre preferences');
  };

  return (
    <section className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <Sparkles size={14} />
        Genres you follow influence what the watchlist recommends.
      </p>

      {!loaded ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({length: 6}).map((_, i) => (
            <div key={i} className="skeleton h-10 w-28 rounded-sm" />
          ))}
        </div>
      ) : available.length === 0 ? (
        <div className="rounded-md border border-border bg-card-bg px-4 py-10 text-center text-sm text-text-muted">
          No genres available from this service.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {available.map((genre) => {
              const on = selected.includes(genre.id);
              return (
                <button
                  key={genre.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(genre.id)}
                  className={cn(
                    'flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    on
                      ? 'border-accent/40 bg-accent/15 text-accent'
                      : 'border-border text-text-secondary hover:border-accent/30 hover:text-text-primary',
                  )}
                >
                  {on && <Check size={13} />}
                  {genre.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={!dirty}>
              {dirty ? 'Save genres' : 'Saved'}
            </Button>
            <span className="text-xs text-text-muted">
              {selected.length} of {available.length} selected
            </span>
          </div>
        </>
      )}
    </section>
  );
}
