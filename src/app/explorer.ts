import chalk from 'chalk';
import prompts from 'prompts';
import signale from '../lib/signale';
import {formatSecondsReadable} from '../lib/util';
import type {albumType as DeezerAlbumType} from '../core/deezer/types';
import type {albumType as QobuzAlbumType, trackType as QobuzTrackType} from '../core/qobuz/types';
import type {
  CatalogService,
  CatalogType,
  QueuePreview,
  SearchDirective,
  SearchGroups,
  SearchResult,
  SessionQueueItem,
} from './interactive-types';

interface ExplorerDependencies {
  onCancel: () => void;
  searchCatalog: (
    service: CatalogService,
    query: string,
    type: CatalogType,
    limit?: number,
    offset?: number,
  ) => Promise<SearchResult[]>;
  getDeezerArtistAlbums: (artistId: string) => Promise<DeezerAlbumType[]>;
  getQobuzArtistAlbums: (artistId: string) => Promise<QobuzAlbumType[]>;
}

const catalogTypes: CatalogType[] = ['artist', 'album', 'track', 'playlist'];

const parseSearchDirective = (input: string): SearchDirective => {
  const trimmed = input.trim();
  const typedSearch = trimmed.match(/^(artist|album|track|playlist)\s*:\s*(.+)$/i);

  if (typedSearch) {
    return {
      forcedType: typedSearch[1].toLowerCase() as CatalogType,
      query: typedSearch[2].trim(),
    };
  }

  return {query: trimmed};
};

const dedupeSearchResults = (results: SearchResult[]) => {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = `${result.type}:${result.id}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const createEmptySearchGroups = (): SearchGroups => ({
  artist: [],
  album: [],
  track: [],
  playlist: [],
});

const formatSearchChoiceTitle = (result: SearchResult) => {
  const badges: Record<CatalogType, string> = {
    artist: chalk.black.bgCyan(' ARTIST '),
    album: chalk.black.bgYellow(' ALBUM '),
    track: chalk.black.bgGreen(' TRACK '),
    playlist: chalk.black.bgMagenta(' PLAYLIST '),
  };

  return `${badges[result.type as CatalogType] || chalk.inverse(` ${result.type.toUpperCase()} `)} ${result.title}`;
};

const formatSearchChoiceDescription = (result: SearchResult) => {
  const meta = [result.artist, result.album !== 'Artist' ? result.album : null, result.duration, result.year || null]
    .filter(Boolean)
    .join(' • ');

  return meta || 'Open result';
};

const buildGroupedSearchChoices = (groups: SearchGroups) => {
  const labels: Record<CatalogType, string> = {
    artist: 'Artists',
    album: 'Albums',
    track: 'Tracks',
    playlist: 'Playlists',
  };
  const choices: any[] = [];

  for (const type of catalogTypes) {
    const items = groups[type];

    if (!items.length) {
      continue;
    }

    choices.push({
      title: chalk.bold(labels[type]),
      value: `section-${type}`,
      disabled: true,
    });

    for (const item of items) {
      choices.push({
        title: formatSearchChoiceTitle(item),
        value: item,
        description: formatSearchChoiceDescription(item),
      });
    }
  }

  return choices;
};

export const createExplorer = ({
  onCancel,
  searchCatalog,
  getDeezerArtistAlbums,
  getQobuzArtistAlbums,
}: ExplorerDependencies) => {
  const collectSearchGroups = async (
    service: CatalogService,
    query: string,
    forcedType?: CatalogType,
    limit = 6,
  ): Promise<SearchGroups> => {
    const groups = createEmptySearchGroups();
    const requestedTypes = forcedType ? [forcedType] : catalogTypes;

    const responses = await Promise.all(
      requestedTypes.map(async (type) => ({
        type,
        results: dedupeSearchResults(await searchCatalog(service, query, type, limit, 0)),
      })),
    );

    for (const response of responses) {
      groups[response.type] = response.results;
    }

    return groups;
  };

  const promptGroupedSearchSelection = async (service: CatalogService, query: string) => {
    const directive = parseSearchDirective(query);
    const groups = await collectSearchGroups(service, directive.query, directive.forcedType);
    const choices = buildGroupedSearchChoices(groups);

    if (!choices.length) {
      throw new Error(`No ${service} results found for "${directive.query}"`);
    }

    const totalResults = Object.values(groups).reduce((count, items) => count + items.length, 0);
    const selection: {item: SearchResult} = await prompts(
      {
        type: 'select',
        name: 'item',
        message: directive.forcedType
          ? `Select a ${directive.forcedType} result from ${totalResults} matches`
          : `Search anything: ${directive.query}`,
        choices,
      },
      {onCancel},
    );

    return selection.item;
  };

  const promptDeezerArtistAlbumSelection = async (artist: SearchResult): Promise<SessionQueueItem> => {
    console.log(signale.info(`Browsing albums for ${artist.title}`));
    const albums = Array.from(
      new Map((await getDeezerArtistAlbums(String(artist.id))).map((item) => [item.ALB_ID, item])).values(),
    ).sort((left, right) =>
      String(right.PHYSICAL_RELEASE_DATE || right.DIGITAL_RELEASE_DATE || '').localeCompare(
        String(left.PHYSICAL_RELEASE_DATE || left.DIGITAL_RELEASE_DATE || ''),
      ),
    );

    if (!albums.length) {
      throw new Error(`No albums found for ${artist.title}`);
    }

    const choice: {item: DeezerAlbumType} = await prompts(
      {
        type: 'select',
        name: 'item',
        message: `Select one album from ${artist.title}`,
        choices: albums.slice(0, 60).map((album) => ({
          title: album.ALB_TITLE,
          value: album,
          description: `${album.ART_NAME} • ${album.NUMBER_TRACK} tracks • ${
            album.PHYSICAL_RELEASE_DATE || album.DIGITAL_RELEASE_DATE || 'Unknown year'
          }`,
        })),
      },
      {onCancel},
    );

    return {
      label: `${artist.title} -> ${choice.item.ALB_TITLE}`,
      url: `https://deezer.com/us/album/${choice.item.ALB_ID}`,
    };
  };

  const promptQobuzArtistAlbumSelection = async (artist: SearchResult): Promise<SessionQueueItem> => {
    console.log(signale.info(`Browsing albums for ${artist.title}`));
    const albums = [...(await getQobuzArtistAlbums(String(artist.id)))].sort((left, right) =>
      String(right.release_date_original || '').localeCompare(String(left.release_date_original || '')),
    );

    if (!albums.length) {
      throw new Error(`No albums found for ${artist.title}`);
    }

    const choice: {item: QobuzAlbumType} = await prompts(
      {
        type: 'select',
        name: 'item',
        message: `Select one album from ${artist.title}`,
        choices: albums.slice(0, 60).map((album) => ({
          title: album.title,
          value: album,
          description: `${album.artist.name} • ${album.tracks_count} tracks • ${
            album.release_date_original || 'Unknown year'
          }`,
        })),
      },
      {onCancel},
    );

    return {
      label: `${artist.title} -> ${choice.item.title}`,
      url: `https://play.qobuz.com/album/${choice.item.id}`,
    };
  };

  const printExplorerIntro = (service: CatalogService, supportsSpotify = false) => {
    const serviceLabel = service === 'deezer' ? 'Deezer' : 'Qobuz';
    console.log(signale.info(`${serviceLabel} explorer ready`));
    console.log(signale.note('Search artists, albums, tracks, playlists, or paste a direct URL.'));
    console.log(signale.note('Prefix search is optional: artist:, album:, playlist:, track:'));
    if (supportsSpotify) {
      console.log(signale.note('Spotify links are converted when possible.'));
    }
  };

  const describeQobuzTrack = (track: QobuzTrackType) => {
    const artistName = track.performer?.name || track.album?.artist?.name || 'Unknown Artist';
    const albumTitle = track.album?.title || 'Unknown Album';
    return `Artist: ${artistName}\nAlbum: ${albumTitle}\nDuration: ${formatSecondsReadable(
      Number(track.duration || 0),
    )}`;
  };

  const promptCollectionDownloadMode = async (preview: QueuePreview) => {
    const collectionType = preview.contentType.toLowerCase();
    const {action} = await prompts(
      {
        type: 'select',
        name: 'action',
        message: `${preview.contentType} ready: ${preview.title} • ${preview.trackCount} tracks`,
        choices: [
          {
            title: `Download full ${collectionType}`,
            value: 'all',
            description: `Run all ${preview.trackCount} tracks now`,
          },
          {
            title: 'Pick specific tracks',
            value: 'select',
            description: 'Open the track picker for manual selection',
          },
        ],
        initial: 0,
      },
      {onCancel},
    );

    return action as 'all' | 'select';
  };

  const promptTrackSubsetSelection = async <T>(
    preview: QueuePreview,
    tracks: T[],
    buildChoice: (track: T) => {title: string; value: T; description?: string},
  ) => {
    if (tracks.length <= 1) {
      return tracks;
    }

    const action = await promptCollectionDownloadMode(preview);
    if (action === 'all') {
      console.log(signale.success(`Selected full ${preview.contentType.toLowerCase()}: ${preview.title}`));
      return tracks;
    }

    const choices: {items: T[]} = await prompts(
      {
        type: 'multiselect',
        name: 'items',
        message: `Pick tracks from ${preview.title}`,
        instructions: false,
        choices: tracks.map((track) => buildChoice(track)),
      },
      {onCancel},
    );

    console.log(signale.success(`Selected ${choices.items.length}/${tracks.length} tracks from ${preview.title}`));
    return choices.items;
  };

  return {
    promptGroupedSearchSelection,
    promptDeezerArtistAlbumSelection,
    promptQobuzArtistAlbumSelection,
    printExplorerIntro,
    describeQobuzTrack,
    promptTrackSubsetSelection,
  };
};
