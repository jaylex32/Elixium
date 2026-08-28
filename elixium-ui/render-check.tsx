/*
 * Render every page and fail if any of them throws.
 *
 * This exists because Settings shipped broken. A tooltip without its provider
 * throws when React executes the tree — and nothing before that point can see
 * it: TypeScript compiles it, eslint passes it, vite builds it, and the engine
 * serves it. The page is only known to work once something renders it.
 *
 * Pages are rendered inside the same providers App puts around them, so this
 * reflects the real tree rather than a convenient one.
 */
import {renderToString} from 'react-dom/server';
import {createElement, type ComponentType} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {ChartsPage} from '@/features/charts/ChartsPage';
import {HomePage} from '@/features/discovery/HomePage';
import {DownloadsPage} from '@/features/downloads/DownloadsPage';
import {FavoritesPage} from '@/features/favorites/FavoritesPage';
import {GenresPage} from '@/features/genres/GenresPage';
import {LibraryPage} from '@/features/library/LibraryPage';
import {LogsPage} from '@/features/logs/LogsPage';
import {PlaylistsPage} from '@/features/playlists/PlaylistsPage';
import {SearchPage} from '@/features/search/SearchPage';
import {SettingsPage} from '@/features/settings/SettingsPage';
import {UrlDownloadPage} from '@/features/url-download/UrlDownloadPage';
import {WatchlistPage} from '@/features/watchlist/WatchlistPage';
import {PlayerBar} from '@/layout/PlayerBar';
import {QueuePanel} from '@/layout/QueuePanel';
import {Sidebar} from '@/layout/Sidebar';

const PAGES: Array<[string, ComponentType<never>]> = [
  ['Home', HomePage as ComponentType<never>],
  ['Search', SearchPage as ComponentType<never>],
  ['Charts', ChartsPage as ComponentType<never>],
  ['Genres', GenresPage as ComponentType<never>],
  ['Downloads', DownloadsPage as ComponentType<never>],
  ['Favorites', FavoritesPage as ComponentType<never>],
  ['Watchlist', WatchlistPage as ComponentType<never>],
  ['Library', LibraryPage as ComponentType<never>],
  ['Playlists', PlaylistsPage as ComponentType<never>],
  ['UrlDownload', UrlDownloadPage as ComponentType<never>],
  ['Logs', LogsPage as ComponentType<never>],
  ['Settings', SettingsPage as ComponentType<never>],
  ['Sidebar', Sidebar as ComponentType<never>],
  ['PlayerBar', PlayerBar as ComponentType<never>],
  ['QueuePanel', QueuePanel as ComponentType<never>],
];

const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
let failures = 0;

for (const [name, Page] of PAGES) {
  try {
    const html = renderToString(
      createElement(
        QueryClientProvider,
        {client},
        createElement(Page),
      ),
    );
    console.log('  ok    ' + name.padEnd(14) + html.length + ' chars');
  } catch (error) {
    failures += 1;
    console.log('  FAIL  ' + name.padEnd(14) + String((error as Error).message).split('\n')[0]);
  }
}

console.log('');
console.log(failures === 0 ? 'every page renders' : failures + ' page(s) failed to render');
process.exitCode = failures === 0 ? 0 : 1;
