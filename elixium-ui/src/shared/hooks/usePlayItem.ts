import {useCallback} from 'react';
import {toast} from 'sonner';
import {http} from '@/shared/lib/api';
import {extractCover} from '@/shared/lib/cover';
import {toSeconds} from '@/shared/lib/utils';
import {usePlayerStore, makeTrack} from '@/store/player-store';
import type {RawTrack, Service, Track} from '@/types';

export interface PlayableItem {
  id: string;
  type: 'track' | 'album' | 'playlist' | 'artist';
  service: Service;
  title: string;
  artist?: string;
  cover?: string;
  /** For a track, the payload it came from — it already holds everything. */
  rawData?: Record<string, unknown>;
}

/**
 * Play anything a card can represent, from a card that only knows its id.
 *
 * A row of albums has no track lists — the cards are built from a catalogue
 * listing — so "play" on one means fetching what it contains first. A track is
 * the exception: its own payload is enough, and going to the network for it
 * would put a delay in front of the most immediate action in the app.
 *
 * The whole collection becomes the queue, not just its first track, because
 * pressing play on an album and getting one song is not what anybody means.
 */
export function usePlayItem() {
  const setTrack = usePlayerStore((s) => s.setTrack);

  const playItem = useCallback(
    async (item: PlayableItem) => {
      if (item.type === 'track') {
        const track = makeTrack({
          id: item.id,
          title: item.title,
          artist: item.artist ?? '',
          cover: item.cover,
          service: item.service,
          previewUrl: item.rawData?.preview as string | undefined,
        });
        setTrack(track, [track]);
        return;
      }

      try {
        /*
         * YouTube Music is fetched from its own endpoints.
         *
         * `/item-tracks` knows only the catalogue services, so a YouTube
         * playlist resolved to something else entirely — the player showed a
         * first track and then had nothing it could actually stream.
         *
         * The id carried forward has to be the videoId: that is what the
         * stream route resolves, and a browse id there plays nothing.
         */
        if (item.service === 'ytmusic') {
          const endpoint =
            item.type === 'artist'
              ? '/ytmusic/artist'
              : item.type === 'playlist'
                ? '/ytmusic/playlist'
                : '/ytmusic/album';
          const {data} = await http.get(endpoint, {params: {id: item.id}});
          const source = (item.type === 'artist' ? data?.topTracks : data?.tracks) ?? [];

          const ytTracks = (source as RawTrack[])
            .map((raw) => {
              const raw2 = raw.rawData as Record<string, unknown> | undefined;
              const videoId = String(raw2?.videoId ?? raw.id ?? '');
              if (!videoId) return null;
              return makeTrack({
                id: videoId,
                title: raw.title,
                artist: raw.artist || item.artist || '',
                album: typeof raw.album === 'string' ? raw.album : item.title,
                cover: (raw2?.cover as string | undefined) || data?.cover || item.cover,
                duration: toSeconds(raw.duration),
                service: 'ytmusic',
              });
            })
            .filter(Boolean) as Track[];

          if (ytTracks.length === 0) {
            toast.error('Nothing to play', {description: item.title});
            return;
          }
          setTrack(ytTracks[0], ytTracks);
          return;
        }

        const res = await http.get('/item-tracks', {
          params: {service: item.service, itemType: item.type, id: item.id, limit: 100},
        });
        const tracks = ((res.data?.tracks ?? []) as RawTrack[]).map((raw) =>
          makeTrack({
            id: raw.id,
            title: raw.title,
            artist: raw.artist || item.artist || '',
            album: typeof raw.album === 'string' ? raw.album : item.title,
            cover: extractCover(raw.rawData, item.service) || item.cover,
            duration: toSeconds(raw.duration),
            service: item.service,
            previewUrl: (raw.rawData as Record<string, unknown> | undefined)?.preview as string | undefined,
          }),
        ) as Track[];

        if (tracks.length === 0) {
          toast.error('Nothing to play', {description: item.title});
          return;
        }
        setTrack(tracks[0], tracks);
      } catch {
        // A failure here is a dead end for the reader, so it is worth saying.
        toast.error('Could not load this to play', {description: item.title});
      }
    },
    [setTrack],
  );

  return {playItem};
}
