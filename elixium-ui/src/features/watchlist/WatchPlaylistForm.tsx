import {useEffect, useState} from 'react';
import {Plus, ListMusic} from 'lucide-react';
import {toast} from 'sonner';
import {getSocket} from '@/shared/lib/socket';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';

/**
 * Start watching a playlist by its share link.
 *
 * The server has handled `addWatchedPlaylist` all along, and it resolves
 * Deezer, Qobuz, Spotify and Tidal playlist URLs — but nothing in the
 * interface ever emitted the event, so watched playlists could only appear if
 * something else had put them there. The empty state even told people to "add
 * one from the Watchlist", which is where they already were.
 *
 * A URL rather than a picker because that is what the server accepts, and
 * because it is the only way to follow a playlist on a service you are not
 * currently browsing — a Spotify playlist watched into Qobuz downloads being
 * the whole point.
 */
export function WatchPlaylistForm() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The server answers a failed add on the shared error channel, so clearing
  // the pending state has to be driven by it rather than by a timer.
  useEffect(() => {
    const socket = getSocket();

    const onError = (data: {message?: string}) => {
      setSubmitting(false);
      toast.error(data?.message ?? 'Could not add that playlist');
    };
    const onState = () => setSubmitting(false);

    socket.on('watchlistError', onError);
    socket.on('watchlistState', onState);
    return () => {
      socket.off('watchlistError', onError);
      socket.off('watchlistState', onState);
    };
  }, []);

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSubmitting(true);
    getSocket().emit('addWatchedPlaylist', {url: trimmed});
    toast.info('Adding playlist…', {description: 'Reading its tracks now.'});
    setUrl('');
  };

  return (
    <div className="rounded-md border border-border bg-card-bg p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListMusic size={15} className="text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Watch a playlist</h3>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Paste a Deezer, Qobuz, Spotify or Tidal playlist link…"
          aria-label="Playlist URL"
          className="h-10 flex-1"
        />
        <Button onClick={submit} disabled={!url.trim() || submitting} className="shrink-0">
          <Plus size={14} />
          {submitting ? 'Adding…' : 'Watch'}
        </Button>
      </div>

      <p className="mt-2 text-xs text-text-muted">
        New tracks added to the playlist are collected on each scan, ready to download.
      </p>
    </div>
  );
}
