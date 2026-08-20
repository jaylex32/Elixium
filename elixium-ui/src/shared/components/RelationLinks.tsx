import {cn} from '@/shared/lib/utils';
import {useNavigationStore} from '@/store/navigation-store';
import type {Relations} from '@/shared/lib/relations';
import type {Service} from '@/types';

/**
 * The artist and album under a row, as links rather than captions.
 *
 * A track named its album and artist in plain text with no way to reach
 * either, which made every list a dead end: the only route to an artist was to
 * search for them again by name. Where the payload carries no id — some
 * playlist and conversion results have none — the text renders exactly as
 * before, so nothing ever looks clickable and then refuses to work.
 */

const linkClass =
  'truncate rounded-xs text-left transition-colors hover:text-accent hover:underline underline-offset-2 ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

interface LinkProps {
  relations: Relations | undefined;
  service: Service;
  className?: string;
}

export function ArtistLink({name, relations, service, className}: LinkProps & {name?: string}) {
  const openArtist = useNavigationStore((s) => s.openArtist);
  const label = name || relations?.artistName;
  if (!label) return null;

  const id = relations?.artistId;
  if (!id) return <span className={cn('truncate', className)}>{label}</span>;

  return (
    <button
      type="button"
      title={`Go to ${label}`}
      className={cn(linkClass, className)}
      onClick={(event) => {
        // Rows are themselves clickable; without this the row's own action
        // fires as well and the link appears to do two things at once.
        event.stopPropagation();
        openArtist({id, name: label, picture: relations?.artistPicture, service});
      }}
    >
      {label}
    </button>
  );
}

export function AlbumLink({title, relations, service, className}: LinkProps & {title?: string}) {
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const label = title || relations?.albumTitle;
  if (!label) return null;

  const id = relations?.albumId;
  if (!id) return <span className={cn('truncate', className)}>{label}</span>;

  return (
    <button
      type="button"
      title={`Go to ${label}`}
      className={cn(linkClass, className)}
      onClick={(event) => {
        event.stopPropagation();
        openAlbum({
          id,
          title: label,
          artist: relations?.artistName ?? '',
          cover: relations?.albumCover,
          type: 'album',
          service,
        });
      }}
    >
      {label}
    </button>
  );
}
