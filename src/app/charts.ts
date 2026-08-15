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

export interface ChartCountry {
  /** The official chart playlist's id. */
  id: string;
  /** Country name, taken from the playlist title ("Top Brazil" -> "Brazil"). */
  name: string;
  picture?: string;
  trackCount?: number;
}

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

/** Deezer's own account for official country charts. */
const CHART_OWNER = 'Deezer Charts';

/** Discovery is a handful of searches; the result barely changes day to day. */
const COUNTRY_CACHE_MS = 6 * 60 * 60 * 1000;

export const createCharts = ({qobuz, makeHttpRequest, ensureQobuzSearchReady}: ChartsDependencies) => {
  let countryCache: {at: number; countries: ChartCountry[]} | null = null;

  /**
   * The per-country charts, the way deemix shows them.
   *
   * Deezer's public API has no country-chart endpoint — /chart takes a genre,
   * and /editorial turns out to list genres too. What it does publish is one
   * official "Top <Country>" playlist per market, owned by the Deezer Charts
   * account, so these are found by searching for those and keeping the ones
   * that account actually owns.
   *
   * Discovered rather than hardcoded on purpose. A list of ids checked by hand
   * was wrong within minutes: three of nine pointed at the wrong country
   * ("Top Honduras" under Spain, "Top Germany" under Mexico) and over half had
   * become someone's private "Favorite tracks". Searching re-derives the list
   * every few hours instead of rotting silently.
   */
  const getChartCountries = async (): Promise<ChartCountry[]> => {
    if (countryCache && Date.now() - countryCache.at < COUNTRY_CACHE_MS) return countryCache.countries;

    const seen = new Map<string, ChartCountry>();

    // Several passes: one search page does not reach every market, and the
    // ranking differs per term.
    for (const query of ['Top', 'Top 100', 'charts']) {
      for (const index of [0, 25, 50, 75]) {
        const url = `https://api.deezer.com/search/playlist?q=${encodeURIComponent(query)}&limit=25&index=${index}`;
        let response: any;
        try {
          response = await makeHttpRequest(url);
        } catch {
          // One failed page must not lose the ones that worked.
          continue;
        }

        for (const playlist of (response && response.data) || []) {
          if (playlist?.user?.name !== CHART_OWNER) continue;
          const title = String(playlist.title || '');
          if (!title.toLowerCase().startsWith('top ')) continue;

          seen.set(String(playlist.id), {
            id: String(playlist.id),
            name: title.replace(/^top\s+/i, '').trim() || title,
            picture: playlist.picture_medium || playlist.picture,
            trackCount: Number(playlist.nb_tracks || 0),
          });
        }
      }
    }

    const countries = [...seen.values()].sort((a, b) => {
      // Worldwide first; it is the default anyone wants.
      if (/worldwide/i.test(a.name)) return -1;
      if (/worldwide/i.test(b.name)) return 1;
      return a.name.localeCompare(b.name);
    });

    if (countries.length > 0) countryCache = {at: Date.now(), countries};
    return countries;
  };

  /** Tracks of one country chart, in chart order. */
  const getCountryChart = async (playlistId: string, limit = 50, offset = 0): Promise<SearchResult[]> => {
    const url = `https://api.deezer.com/playlist/${encodeURIComponent(playlistId)}/tracks?limit=${Number(
      limit,
    )}&index=${Number(offset)}`;
    const response = await makeHttpRequest(url);
    return mapDeezerChart('tracks', (response && response.data) || []);
  };

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

  return {getChartGenres, getCharts, getChartCountries, getCountryChart};
};

export type Charts = ReturnType<typeof createCharts>;
