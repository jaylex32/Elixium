import chalk from 'chalk';
import prompts from 'prompts';
import signale from '../lib/signale';
import type {CatalogService, QueuePreview, SearchResult, SessionQueueItem} from './interactive-types';

interface SessionQueueDependencies {
  onCancel: () => void;
  urlRegex: RegExp;
  printExplorerIntro: (service: CatalogService, supportsSpotify?: boolean) => void;
  promptGroupedSearchSelection: (service: CatalogService, query: string) => Promise<SearchResult>;
  promptDeezerArtistAlbumSelection: (artist: SearchResult) => Promise<SessionQueueItem>;
  promptQobuzArtistAlbumSelection: (artist: SearchResult) => Promise<SessionQueueItem>;
  parseDeezerUrl: (url: string) => Promise<any>;
  parseToQobuz: (url: string) => Promise<any>;
}

const formatQueueStatusBadge = (status: QueuePreview['status']) =>
  status === 'ready' ? chalk.black.bgGreen(' READY ') : chalk.white.bgRed(' ERROR ');

const normalizeContentTypeLabel = (value: string) =>
  value
    .replace(/^qobuz-/, '')
    .replace(/^spotify-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const createSessionQueue = ({
  onCancel,
  urlRegex,
  printExplorerIntro,
  promptGroupedSearchSelection,
  promptDeezerArtistAlbumSelection,
  promptQobuzArtistAlbumSelection,
  parseDeezerUrl,
  parseToQobuz,
}: SessionQueueDependencies) => {
  const buildDeezerQueuePreview = (parsedData: any): QueuePreview => {
    const title =
      parsedData.linkinfo?.TITLE ||
      parsedData.linkinfo?.ALB_TITLE ||
      parsedData.linkinfo?.ART_NAME ||
      parsedData.tracks?.[0]?.SNG_TITLE ||
      'Unknown Deezer item';
    const artist =
      parsedData.linkinfo?.ART_NAME ||
      parsedData.tracks?.[0]?.ART_NAME ||
      parsedData.linkinfo?.PARENT_USERNAME ||
      'Unknown Artist';
    const trackCount = Array.isArray(parsedData.tracks) ? parsedData.tracks.length : 0;
    const contentType = normalizeContentTypeLabel(parsedData.linktype || parsedData.info?.type || 'track');

    return {
      status: 'ready',
      contentType,
      title,
      artist,
      trackCount,
      detail: `${contentType} • ${trackCount} track${trackCount === 1 ? '' : 's'}`,
    };
  };

  const buildQobuzQueuePreview = (parsedData: any): QueuePreview => {
    const title =
      parsedData.linkinfo?.title ||
      parsedData.linkinfo?.name ||
      parsedData.linkinfo?.album?.title ||
      parsedData.tracks?.[0]?.album?.title ||
      parsedData.tracks?.[0]?.title ||
      'Unknown Qobuz item';
    const artist =
      parsedData.linkinfo?.artist?.name ||
      parsedData.linkinfo?.owner?.name ||
      parsedData.tracks?.[0]?.performer?.name ||
      parsedData.tracks?.[0]?.album?.artist?.name ||
      'Unknown Artist';
    const trackCount = Array.isArray(parsedData.tracks) ? parsedData.tracks.length : 0;
    const contentType = normalizeContentTypeLabel(parsedData.linktype || parsedData.info?.type || 'track');

    return {
      status: 'ready',
      contentType,
      title,
      artist,
      trackCount,
      detail: `${contentType} • ${trackCount} track${trackCount === 1 ? '' : 's'}`,
    };
  };

  const hydrateQueuePreview = async (service: CatalogService, item: SessionQueueItem) => {
    if (item.preview) {
      return item.preview;
    }

    try {
      if (service === 'deezer') {
        item.preview = buildDeezerQueuePreview(await parseDeezerUrl(item.url));
      } else {
        item.preview = buildQobuzQueuePreview(await parseToQobuz(item.url));
      }
    } catch (error: any) {
      item.preview = {
        status: 'error',
        contentType: 'Unresolved',
        title: item.label,
        artist: service === 'deezer' ? 'Deezer' : 'Qobuz',
        trackCount: 0,
        detail: 'Preview failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    return item.preview;
  };

  const printQueueReview = async (service: CatalogService, queueItems: SessionQueueItem[]) => {
    console.log(signale.info(`Reviewing ${service === 'deezer' ? 'Deezer' : 'Qobuz'} queue...`));
    for (const item of queueItems) {
      const preview = await hydrateQueuePreview(service, item);
      console.log(`${formatQueueStatusBadge(preview.status)} ${item.label}`);
      console.log(signale.note(`${preview.detail} • ${preview.artist}`));
      if (preview.errorMessage) {
        console.log(signale.note(preview.errorMessage));
      }
    }
  };

  const promptQueueReviewResolution = async (queueItems: SessionQueueItem[]) => {
    const {action} = await prompts(
      {
        type: 'select',
        name: 'action',
        message: 'Queue review found one or more unresolved items. What next?',
        choices: [
          {title: 'Go back to queue', value: 'back', description: 'Review or edit the queue again'},
          {title: 'Remove unresolved items', value: 'remove', description: 'Keep only items with a ready preflight'},
          {title: 'Start anyway', value: 'continue', description: 'Proceed even though some previews failed'},
        ],
      },
      {onCancel},
    );

    if (action === 'remove') {
      return queueItems.filter((item) => item.preview?.status !== 'error');
    }

    return action as 'back' | 'continue';
  };

  const printQueueSummary = (service: CatalogService, queueItems: SessionQueueItem[]) => {
    console.log(signale.info(`${service === 'deezer' ? 'Deezer' : 'Qobuz'} queue ready`));
    queueItems.forEach((item, index) => {
      console.log(signale.note(`${index + 1}. ${item.label}`));
    });
  };

  const promptQueueRemoval = async (queueItems: SessionQueueItem[]) => {
    if (!queueItems.length) {
      return;
    }

    const {item} = await prompts(
      {
        type: 'select',
        name: 'item',
        message: 'Remove which item from the queue?',
        choices: queueItems.map((entry, index) => ({
          title: entry.label,
          value: index,
          description: entry.url,
        })),
      },
      {onCancel},
    );

    if (item !== undefined) {
      queueItems.splice(item, 1);
    }
  };

  const promptQueueAction = async (queueItems: SessionQueueItem[]) => {
    const {action} = await prompts(
      {
        type: 'select',
        name: 'action',
        message: `Queue has ${queueItems.length} item${queueItems.length === 1 ? '' : 's'}. What next?`,
        choices: [
          {title: 'Start download', value: 'download', description: 'Run the current queue now'},
          {title: 'Review queue', value: 'review', description: 'Preflight each item and inspect details'},
          {title: 'Add another item', value: 'add', description: 'Search or paste another URL'},
          {title: 'Remove an item', value: 'remove', description: 'Trim the queue before starting'},
        ],
      },
      {onCancel},
    );

    return action as 'download' | 'review' | 'add' | 'remove';
  };

  const collectSessionQueue = async (
    service: CatalogService,
    promptMessage: string,
    resolver: (query: string) => Promise<SessionQueueItem>,
    supportsSpotify = false,
  ) => {
    const queueItems: SessionQueueItem[] = [];
    printExplorerIntro(service, supportsSpotify);
    let collecting = true;

    while (collecting) {
      const {query} = await prompts(
        {
          type: 'text',
          name: 'query',
          message: promptMessage,
          validate: (value) => (value ? true : false),
        },
        {onCancel},
      );

      const item = await resolver(query);
      queueItems.push(item);
      console.log(signale.success(`Added to queue: ${item.label}`));
      printQueueSummary(service, queueItems);

      while (queueItems.length) {
        const action = await promptQueueAction(queueItems);

        if (action === 'download') {
          await printQueueReview(service, queueItems);
          const failedItems = queueItems.filter((entry) => entry.preview?.status === 'error');

          if (!failedItems.length) {
            return queueItems;
          }

          const resolution = await promptQueueReviewResolution(queueItems);
          if (resolution === 'continue') {
            return queueItems;
          }
          if (Array.isArray(resolution)) {
            queueItems.splice(0, queueItems.length, ...resolution);
            if (!queueItems.length) {
              console.log(signale.warn('Queue is empty after removing unresolved items.'));
              collecting = true;
              break;
            }
            printQueueSummary(service, queueItems);
            continue;
          }
          continue;
        }

        if (action === 'review') {
          await printQueueReview(service, queueItems);
          continue;
        }

        if (action === 'add') {
          collecting = true;
          break;
        }

        await promptQueueRemoval(queueItems);
        if (queueItems.length) {
          printQueueSummary(service, queueItems);
        } else {
          collecting = true;
          break;
        }
      }
    }

    return queueItems;
  };

  const resolveDeezerQueueItem = async (query: string): Promise<SessionQueueItem> => {
    const trimmed = query.trim();
    if (trimmed.match(urlRegex)) {
      return {label: trimmed, url: trimmed};
    }

    const selectedResult = await promptGroupedSearchSelection('deezer', trimmed);

    if (selectedResult.type === 'artist') {
      return promptDeezerArtistAlbumSelection(selectedResult);
    }

    if (selectedResult.type === 'album') {
      return {
        label: `${selectedResult.artist} -> ${selectedResult.title}`,
        url: `https://deezer.com/us/album/${selectedResult.id}`,
      };
    }

    if (selectedResult.type === 'playlist') {
      return {
        label: `${selectedResult.title} (${selectedResult.duration})`,
        url: `https://deezer.com/us/playlist/${selectedResult.id}`,
      };
    }

    return {
      label: `${selectedResult.artist} - ${selectedResult.title}`,
      url: `https://www.deezer.com/track/${selectedResult.id}`,
    };
  };

  const resolveQobuzQueueItem = async (query: string): Promise<SessionQueueItem> => {
    const trimmed = query.trim();
    if (trimmed.match(urlRegex) || trimmed.startsWith('spotify:')) {
      return {label: trimmed, url: trimmed};
    }

    const selectedResult = await promptGroupedSearchSelection('qobuz', trimmed);

    if (selectedResult.type === 'artist') {
      return promptQobuzArtistAlbumSelection(selectedResult);
    }

    if (selectedResult.type === 'album') {
      return {
        label: `${selectedResult.artist} -> ${selectedResult.title}`,
        url: `https://play.qobuz.com/album/${selectedResult.id}`,
      };
    }

    if (selectedResult.type === 'playlist') {
      return {
        label: `${selectedResult.title} (${selectedResult.duration})`,
        url: `https://play.qobuz.com/playlist/${selectedResult.id}`,
      };
    }

    return {
      label: `${selectedResult.artist} - ${selectedResult.title}`,
      url: `https://play.qobuz.com/track/${selectedResult.id}`,
    };
  };

  return {
    buildDeezerQueuePreview,
    buildQobuzQueuePreview,
    collectSessionQueue,
    resolveDeezerQueueItem,
    resolveQobuzQueueItem,
  };
};
