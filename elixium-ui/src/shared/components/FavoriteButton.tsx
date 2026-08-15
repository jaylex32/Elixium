import {Heart} from 'lucide-react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {useFavorites, useToggleFavorite, type FavoriteRecord} from '@/shared/lib/api';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';

interface FavoriteButtonProps {
  item: Omit<FavoriteRecord, 'addedAt'>;
  className?: string;
}

/**
 * Star anything, from anywhere it appears.
 *
 * Favourites live on the server rather than in this browser: Elixium is
 * normally run on one machine and reached from several, and a list kept in
 * localStorage would be a different list on the phone, the laptop and the
 * desktop app — and would disappear with the site data.
 *
 * The whole favourites list is read here rather than a per-item lookup. It is
 * a small list held in one cache entry, so every star on a page shares a single
 * request instead of issuing one each.
 */
export function FavoriteButton({item, className}: FavoriteButtonProps) {
  const queryClient = useQueryClient();
  const {data: favorites = []} = useFavorites();
  const toggle = useToggleFavorite();

  const isFavorite = favorites.some(
    (entry) => entry.id === item.id && entry.type === item.type && entry.service === item.service,
  );

  const onClick = (event: React.MouseEvent) => {
    // These sit inside cards and rows that navigate or play on click.
    event.stopPropagation();
    event.preventDefault();

    toggle.mutate(item, {
      onSuccess: (result) => {
        // Every list keyed on favorites refreshes, including the page itself.
        queryClient.invalidateQueries({queryKey: ['favorites']});
        toast.success(result.favorited ? `Saved ${item.title}` : `Removed ${item.title}`);
      },
      onError: (error: Error) => toast.error(error.message || 'Could not update favorites'),
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={toggle.isPending}
      aria-label={isFavorite ? `Remove ${item.title} from favorites` : `Save ${item.title} to favorites`}
      aria-pressed={isFavorite}
      title={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
      className={cn('shrink-0', isFavorite ? 'text-accent' : 'text-text-muted hover:text-accent', className)}
    >
      <Heart size={14} className={isFavorite ? 'fill-current' : undefined} />
    </Button>
  );
}
