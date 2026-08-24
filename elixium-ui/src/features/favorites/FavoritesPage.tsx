import {useState} from 'react';
import {Heart, Trash2, Music2, Download, Play} from 'lucide-react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {useFavorites, useClearFavorites, type FavoriteRecord} from '@/shared/lib/api';
import {cn, toSeconds} from '@/shared/lib/utils';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import {useDownload} from '@/shared/hooks/useDownload';
import {AlbumCard} from '@/shared/components/AlbumCard';
import {useNavigationStore} from '@/store/navigation-store';
import {ArtistCard} from '@/shared/components/ArtistCard';
import {Button} from '@/shared/components/ui/Button';
import {SelectionToggle} from '@/shared/components/SelectionToggle';
import {SelectCheckbox} from '@/shared/components/SelectCheckbox';
import {useSelectionStore, type SelectableItem} from '@/store/selection-store';
import {EmptyState, ListSkeleton} from '@/shared/components/States';
import {FavoriteButton} from '@/shared/components/FavoriteButton';
import {serviceLabel} from '@/shared/lib/desktop';

type Filter = 'all' | FavoriteRecord['type'];

const FILTERS: {id: Filter; label: string}[] = [
  {id: 'all', label: 'All'},
  {id: 'track', label: 'Tracks'},
  {id: 'album', label: 'Albums'},
  {id: 'artist', label: 'Artists'},
  {id: 'playlist', label: 'Playlists'},
];

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5';

/** Everything the user starred, on any service. */
export function FavoritesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const openAlbum = useNavigationStore((s) => s.openAlbum);

  const queryClient = useQueryClient();
  const {data: favorites = [], isLoading} = useFavorites();
  const clearAll = useClearFavorites();
  const {download} = useDownload();
  const setTrack = usePlayerStore((s) => s.setTrack);

  const visible = favorites.filter((entry) => filter === 'all' || entry.type === filter);
  const tracks = visible.filter((entry) => entry.type === 'track');

  const playTracks = (startIndex: number) => {
    const queue = tracks.map((t) =>
      makeTrack({
        id: t.id,
        title: t.title,
        artist: t.artist ?? '',
        cover: t.cover,
        duration: toSeconds(t.duration ?? ''),
        service: t.service,
      }),
    );
    if (queue[startIndex]) setTrack(queue[startIndex], queue);
  };

  const selectionActive = useSelectionStore((s) => s.active);
  const selectionItems = useSelectionStore((s) => s.items);
  const toggleSelect = useSelectionStore((s) => s.toggle);

  /** Whatever the current filter is showing. */
  const selectables = (): SelectableItem[] =>
    visible.map((entry) => ({
      id: entry.id,
      type: entry.type,
      service: entry.service,
      title: entry.title,
      artist: entry.artist,
      cover: entry.cover,
    }));

  const countFor = (id: Filter) => (id === 'all' ? favorites.length : favorites.filter((f) => f.type === id).length);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-content px-4 pt-6 sm:px-6">
        <ListSkeleton count={8} />
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={<Heart size={24} />}
        title="Nothing saved yet"
        hint="Tap the heart on any track, album, artist or playlist to keep it here."
      />
    );
  }

  return (
    <div className="mx-auto max-w-content animate-fade-in px-4 pb-8 pt-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold text-text-primary">
          <Heart size={18} className="text-accent" />
          Favorites
        </h1>

        <div className="scroll-row ml-auto flex gap-1 rounded-sm border border-border bg-secondary-bg p-1">
          {FILTERS.map((f) => {
            const count = countFor(f.id);
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  'min-h-9 shrink-0 rounded-xs px-3 text-xs font-medium transition-colors',
                  filter === f.id ? 'bg-card-bg text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {f.label}
                {count > 0 && <span className="ml-1.5 tabular-nums opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>

        {visible.length > 0 && <SelectionToggle items={selectables} />}

        <Button
          variant="ghost"
          size="sm"
          className="text-text-muted"
          onClick={() =>
            clearAll.mutate(undefined, {
              onSuccess: () => {
                queryClient.invalidateQueries({queryKey: ['favorites']});
                toast.success('Favorites cleared');
              },
            })
          }
        >
          <Trash2 size={13} />
          Clear all
        </Button>
      </div>

      {visible.length === 0 && <EmptyState title="Nothing of that kind saved" hint="Try another filter." />}

      {/* Tracks read best as a list; everything else as cards. */}
      {visible.some((entry) => entry.type === 'track') && (
        <div className="mb-6 space-y-0.5">
          {tracks.map((entry, index) => (
            <div
              key={`${entry.service}-${entry.id}`}
              className="rows-track group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-bg sm:px-3"
            >
              {selectionActive && (
                <SelectCheckbox
                  selected={Boolean(selectionItems[`${entry.service}:track:${entry.id}`])}
                  alwaysVisible
                  label={`Select ${entry.title}`}
                  onToggle={() =>
                    toggleSelect({
                      id: entry.id,
                      type: 'track',
                      service: entry.service,
                      title: entry.title,
                      artist: entry.artist,
                      cover: entry.cover,
                    })
                  }
                />
              )}

              <button onClick={() => playTracks(index)} className="relative h-11 w-11 shrink-0" aria-label={`Play ${entry.title}`}>
                {entry.cover ? (
                  <img src={entry.cover} alt="" loading="lazy" className="h-11 w-11 rounded-sm object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-bg">
                    <Music2 size={16} className="text-text-muted" />
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play size={15} className="text-white" />
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{entry.title}</p>
                <p className="truncate text-xs text-text-muted">
                  {entry.artist} · {serviceLabel(entry.service)}
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Download ${entry.title}`}
                onClick={() =>
                  download({
                    id: entry.id,
                    type: 'track',
                    title: entry.title,
                    artist: entry.artist,
                    cover: entry.cover,
                    service: entry.service,
                  })
                }
              >
                <Download size={14} />
              </Button>

              <FavoriteButton item={entry} />
            </div>
          ))}
        </div>
      )}

      {visible.some((entry) => entry.type !== 'track') && (
        <div className={GRID}>
          {visible
            .filter((entry) => entry.type !== 'track')
            .map((entry) =>
              entry.type === 'artist' ? (
                <ArtistCard
                  key={`${entry.service}-${entry.id}`}
                  artist={{id: entry.id, name: entry.title, picture: entry.cover, service: entry.service}}
                />
              ) : (
                <AlbumCard
                  key={`${entry.service}-${entry.id}`}
                  album={{
                    id: entry.id,
                    title: entry.title,
                    artist: entry.artist ?? '',
                    cover: entry.cover,
                    type: entry.type,
                  }}
                  selectable={{
                    id: entry.id,
                    type: entry.type as 'album' | 'playlist',
                    service: entry.service,
                    title: entry.title,
                    artist: entry.artist,
                    cover: entry.cover,
                  }}
                  onClick={() =>
                    openAlbum({
                      id: entry.id,
                      title: entry.title,
                      artist: entry.artist ?? '',
                      cover: entry.cover,
                      type: entry.type,
                      service: entry.service,
                    })
                  }
                  onDownload={() =>
                    download({
                      id: entry.id,
                      type: entry.type as 'album' | 'playlist',
                      title: entry.title,
                      artist: entry.artist,
                      cover: entry.cover,
                      service: entry.service,
                    })
                  }
                />
              ),
            )}
        </div>
      )}

    </div>
  );
}
