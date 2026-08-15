import {formatSecondsReadable} from '../lib/util';
import type {SearchResult} from './interactive-types';

/**
 * Ranked charts, per genre.
 *
 * Distinct from the Discover page, which shows editorial selections — new
 * releases, trending, curated playlists. These are the ordered charts: the
 * top tracks, albums, artists and playlists for a genre, in position order.
 *
 * Deezer publishes them on its public API, so no account is needed and the
 * free-account restrictions do not apply to browsing them. Qobuz has no chart
 * endpoint at all, so its equivalent is built from the featured lists it does
 * publish, which are already ordered by popularity.
 */

interface ChartsDependencies {
  qobuz: any;
  makeHttpRequest: (url: string) => Promise<any>;
  ensureQobuzSearchReady: () => Promise<void>;
}

export type ChartKind = 'tracks' | 'albums' | 'artists' | 'playlists';

export interface ChartGenre {
  id: string;
  name: string;
  picture?: string;
}

/** Qobuz featured lists that stand in for charts, in the order they are shown. */
const QOBUZ_CHART_GENRES: ChartGenre[] = [
  {id: 'best-sellers', name: 'Best Sellers'},
  {id: 'most-streamed', name: 'Most Streamed'},
  {id: 'press-awards', name: 'Press Awards'},
  {id: 'editor-picks', name: 'Editor Picks'},
  {id: 'new-releases', name: 'New Releases'},
];

const QOBUZ_FEATURED_TYPE: Record<string, string> = {
  'best-sellers': 'best-sellers',
  'most-streamed': 'most-streamed',
  'press-awards': 'press-awards',
  'editor-picks': 'editor-picks',
  'new-releases': 'new-releases',
};

export const createCharts = ({qobuz, makeHttpRequest, ensureQobuzSearchReady}: ChartsDependencies) => {
  /** The genres a chart can be filtered to. Genre 0 is Deezer's overall chart. */
  const getChartGenres = async (service: string): Promise<ChartGenre[]> => {
    if (service === 'qobuz') return QOBUZ_CHART_GENRES;

    const response = await makeHttpRequest('https://api.deezer.com/genre');
    const genres: ChartGenre[] = ((response && response.data) || [])
      .filter((genre: any) => String(genre.id) !== '0')
      .map((genre: any) => ({id: String(genre.id), name: genre.name, picture: genre.picture_medium}));

    // "All" first: it is the chart most people want, and Deezer returns it as
    // genre 0 with the unhelpful name "All".
    return [{id: '0', name: 'All genres'}, ...genres];
  };

  const mapDeezerChart = (kind: ChartKind, items: any[]): SearchResult[] => {
    if (kind === 'tracks') {
      return items.map((track: any) => ({
        id: String(track.id),
        title: track.title + (track.title_version ? ` ${track.title_version}` : ''),
        artist: track.artist?.name || 'Unknown Artist',
        album: track.album?.title || '',
        type: 'track',
        duration: formatSecondsReadable(Number(track.duration || 0)),
        rawData: track,
      }));
    }
    if (kind === 'albums') {
      return items.map((album: any) => ({
        id: String(album.id),
        title: album.title,
        artist: album.artist?.name || 'Unknown Artist',
        album: album.title,
        type: 'album',
        duration: album.record_type ? String(album.record_type) : '',
        rawData: album,
      }));
    }
    if (kind === 'artists') {
      return items.map((artist: any) => ({
        id: String(artist.id),
        title: artist.name,
        artist: artist.name,
        album: 'Artist',
        type: 'artist',
        duration: '',
        rawData: artist,
      }));
    }
    return items.map((playlist: any) => ({
      id: String(playlist.id),
      title: playlist.title,
      artist: playlist.user?.name || 'Deezer',
      album: 'Playlist',
      type: 'playlist',
      duration: `${playlist.nb_tracks || 0} tracks`,
      rawData: playlist,
    }));
  };

  const getCharts = async (
    service: string,
    genreId: string,
    kind: ChartKind,
    limit = 50,
    offset = 0,
  ): Promise<SearchResult[]> => {
    if (service === 'deezer') {
      const url = `https://api.deezer.com/chart/${encodeURIComponent(genreId || '0')}/${kind}?limit=${Number(
        limit,
      )}&index=${Number(offset)}`;
      const response = await makeHttpRequest(url);
      return mapDeezerChart(kind, (response && response.data) || []);
    }

    if (service === 'qobuz') {
      // Qobuz's featured lists are albums only; asking for another kind here
      // would return an empty grid with no explanation, so say so instead.
      if (kind !== 'albums') return [];

      await ensureQobuzSearchReady();
      const type = QOBUZ_FEATURED_TYPE[genreId] || 'best-sellers';
      const response = await (qobuz as any).qobuzRequest?.('album/getFeatured', {
        type,
        offset: Number(offset),
        limit: Number(limit),
      });

      return ((response?.albums?.items as any[]) || []).map((album: any) => ({
        id: String(album.id),
        title: album.title,
        artist: album.artist?.name || 'Unknown Artist',
        album: album.title,
        type: 'album',
        duration: album.tracks_count ? `${album.tracks_count} tracks` : '',
        year: album.release_date_original ? Number(String(album.release_date_original).slice(0, 4)) : null,
        maximum_bit_depth: album.maximum_bit_depth,
        maximum_sampling_rate: album.maximum_sampling_rate,
        hires: album.hires,
        rawData: album,
      }));
    }

    return [];
  };

  return {getChartGenres, getCharts};
};

export type Charts = ReturnType<typeof createCharts>;
