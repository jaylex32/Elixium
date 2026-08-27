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
  /**
   * Ran before navigating. The fullscreen player sits at the same layer as the
   * window it would open, so it has to stand down first or the artist opens
   * behind it.
   */
  onNavigate?: () => void;
}

export function ArtistLink({name, relations, service, className, onNavigate}: LinkProps & {name?: string}) {
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
        onNavigate?.();
        openArtist({id, name: label, picture: relations?.artistPicture, service});
      }}
    >
      {label}
    </button>
  );
}

export function AlbumLink({title, relations, service, className, onNavigate}: LinkProps & {title?: string}) {
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
        onNavigate?.();
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

/**
 * The line under a track title: who made it, and what it came from.
 *
 * Every list drew this line itself, which is why it disagreed with itself —
 * some rows linked the artist, some linked the album, some showed neither, and
 * an album's own rows hid the artist entirely on the theory that the header
 * already said it. Anywhere a track appears the same line is now drawn the
 * same way, and both names are links wherever the payload carries their ids.
 */
export function TrackByline({
  artist,
  album,
  relations,
  service,
  className,
  onNavigate,
}: LinkProps & {artist?: string; album?: string}) {
  const albumTitle = album || relations?.albumTitle;

  /*
   * Everyone credited, not just the headline name. A track made with someone
   * else named only the first of them, so the guest on it was unreachable —
   * and on an album, where every row repeats the album's artist, that was the
   * only name that ever differed between rows.
   *
   * Falls back to the single name when a payload carries no credit list, which
   * is what a converted or hand-built row has.
   */
  const credits =
    relations?.artists && relations.artists.length > 0
      ? relations.artists
      : artist || relations?.artistName
        ? [{id: relations?.artistId, name: (artist || relations?.artistName) as string}]
        : [];

  if (credits.length === 0 && !albumTitle) return null;

  return (
    <span className={cn('flex min-w-0 items-center gap-1 text-xs text-text-muted', className)}>
      {credits.map((credit, index) => (
        <span key={`${credit.id ?? 'x'}-${credit.name}`} className="flex min-w-0 items-center">
          <ArtistLink
            name={credit.name}
            /* Each name carries its own id; the rest of the relations still
               describe the row, so the picture and album travel with it. */
            relations={{...relations, artistId: credit.id, artistName: credit.name}}
            service={service}
            onNavigate={onNavigate}
          />
          {index < credits.length - 1 && <span className="shrink-0 pr-1">,</span>}
        </span>
      ))}
      {credits.length > 0 && albumTitle && <span className="shrink-0 opacity-60">·</span>}
      {albumTitle && <AlbumLink title={albumTitle} relations={relations} service={service} onNavigate={onNavigate} />}
    </span>
  );
}
