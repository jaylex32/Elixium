import {formatSecondsReadable} from '../lib/util';
import type {artistType, trackType, albumType, playlistInfoMinimal} from '../core/deezer/types';
import type {SearchResult} from './interactive-types';

interface CatalogSearchDependencies {
  deezer: any;
  qobuz: any;
  ensureQobuzSearchReady: () => Promise<void>;
}

export const createCatalogSearch = ({deezer, qobuz, ensureQobuzSearchReady}: CatalogSearchDependencies) => {
  const performDeezerSearch = async (query: string, type: string, limit = 50, offset = 0): Promise<SearchResult[]> => {
    const searchTypes = type.toUpperCase() as 'TRACK' | 'ALBUM' | 'ARTIST' | 'PLAYLIST';
    const searchResult = await deezer.searchMusic(query, [searchTypes], limit, offset);

    const results: SearchResult[] = [];
    const data = searchResult[searchTypes]?.data || [];

    for (const item of data) {
      if (type === 'track') {
        const track = item as unknown as trackType;
        results.push({
          id: track.SNG_ID,
          title: track.SNG_TITLE + (track.VERSION ? ` ${track.VERSION}` : ''),
          artist: track.ART_NAME,
          album: track.ALB_TITLE,
          duration: formatSecondsReadable(Number(track.DURATION)),
          year: (track as any).PHYSICAL_RELEASE_DATE
            ? new Date((track as any).PHYSICAL_RELEASE_DATE).getFullYear()
            : null,
          type: 'track',
          rawData: track,
        });
      } else if (type === 'album') {
        const album = item as unknown as albumType;
        results.push({
          id: album.ALB_ID,
          title: album.ALB_TITLE,
          artist: album.ART_NAME,
          album: album.ALB_TITLE,
          duration: `${album.NUMBER_TRACK} tracks`,
          year: album.PHYSICAL_RELEASE_DATE ? new Date(album.PHYSICAL_RELEASE_DATE).getFullYear() : null,
          type: 'album',
          rawData: album,
        });
      } else if (type === 'artist') {
        const artist = item as unknown as artistType;
        results.push({
          id: artist.ART_ID,
          title: artist.ART_NAME,
          artist: artist.ART_NAME,
          album: 'Artist',
          duration: `${(artist as any).NB_FAN} fans`,
          type: 'artist',
          rawData: artist,
        });
      } else if (type === 'playlist') {
        const playlist = item as unknown as playlistInfoMinimal;
        results.push({
          id: playlist.PLAYLIST_ID,
          title: playlist.TITLE,
          artist: playlist.PARENT_USERNAME,
          album: 'Playlist',
          duration: `${playlist.NB_SONG} tracks`,
          type: 'playlist',
          rawData: playlist,
        });
      }
    }

    return results;
  };

  const performQobuzSearch = async (query: string, type: string, limit = 50, offset = 0): Promise<SearchResult[]> => {
    await ensureQobuzSearchReady();

    const results: SearchResult[] = [];

    if (type === 'track') {
      const searchResult = await qobuz.searchMusic(query, 'track', limit, offset);
      for (const item of searchResult.tracks.items) {
        results.push({
          id: String(item.id),
          title: item.title + (item.version ? ` (${item.version})` : ''),
          artist: item.performer.name,
          album: item.album?.title || 'N/A',
          duration: formatSecondsReadable(Number(item.duration)),
          year: item.album?.release_date_original ? new Date(item.album.release_date_original).getFullYear() : null,
          type: 'track',
          maximum_bit_depth: item.maximum_bit_depth,
          maximum_sampling_rate: item.maximum_sampling_rate,
          hires: item.hires,
          hires_streamable: item.hires_streamable,
          rawData: item,
        });
      }
    } else if (type === 'album') {
      const searchResult = await qobuz.searchMusic(query, 'album', limit, offset);
      for (const item of searchResult.albums.items) {
        results.push({
          id: String(item.id),
          title: item.title,
          artist: item.artist.name,
          album: item.title,
          duration: `${item.tracks_count} tracks`,
          year: item.release_date_original ? new Date(item.release_date_original).getFullYear() : null,
          type: 'album',
          maximum_bit_depth: item.maximum_bit_depth,
          maximum_sampling_rate: item.maximum_sampling_rate,
          hires: item.hires,
          hires_streamable: item.hires_streamable,
          rawData: item,
        });
      }
    } else if (type === 'artist') {
      const searchResult = await qobuz.searchMusic(query, 'artist', limit, offset);
      for (const item of searchResult.artists.items) {
        results.push({
          id: String(item.id),
          title: item.name,
          artist: item.name,
          album: 'Artist',
          duration: `${item.albums_count} albums`,
          type: 'artist',
          rawData: item,
        });
      }
    } else if (type === 'playlist') {
      const searchResult = await qobuz.searchMusic(query, 'playlist', limit, offset);
      for (const item of searchResult.playlists.items) {
        results.push({
          id: String(item.id),
          title: item.name,
          artist: item.owner.name,
          album: 'Playlist',
          duration: `${item.tracks_count} tracks`,
          type: 'playlist',
          rawData: item,
        });
      }
    }

    return results;
  };

  return {performDeezerSearch, performQobuzSearch};
};
