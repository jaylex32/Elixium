import {useNavigationStore} from '@/store/navigation-store';
import {AlbumModal} from '@/shared/components/AlbumModal';
import {ArtistModal} from '@/shared/components/ArtistModal';

/**
 * Renders whatever detail view is on top of the navigation stack.
 *
 * Mounted once in the shell rather than per page. Every page used to own a
 * `selected` state and render its own AlbumModal, which meant an album could
 * only ever be opened from the page that happened to hold that state — there
 * was no way to reach an artist from a track row, and no memory of the route
 * taken to get anywhere.
 */
export function DetailHost() {
  const stack = useNavigationStore((s) => s.stack);
  const back = useNavigationStore((s) => s.back);

  // A reference already held by the array, so the snapshot stays stable.
  const top = stack[stack.length - 1];
  if (!top) return null;

  if (top.kind === 'album') {
    return (
      <AlbumModal
        // Keyed so stepping between two albums remounts rather than reusing
        // the previous one's fetched tracks under a new title.
        key={`${top.album.service}:${top.album.id}`}
        album={top.album}
        open
        onClose={back}
        canGoBack={stack.length > 1}
      />
    );
  }

  return (
    <ArtistModal
      key={`${top.artist.service}:${top.artist.id}`}
      artist={top.artist}
      open
      onClose={back}
      canGoBack={stack.length > 1}
    />
  );
}
