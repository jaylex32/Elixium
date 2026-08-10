import type {Socket} from 'socket.io';
import type {QobuzWatchlistService} from './qobuz-watchlist';

interface WebSocketWatchlistDependencies {
  socket: Socket;
  io: any;
  watchlist: QobuzWatchlistService;
}

export const registerWatchlistSocketHandlers = ({socket, io, watchlist}: WebSocketWatchlistDependencies) => {
  const broadcastState = (state?: any) => {
    io.emit('watchlistState', state || watchlist.getState());
  };

  socket.on('getWatchlistState', async () => {
    await watchlist.loadAvailableGenres();
    socket.emit('watchlistState', watchlist.getState());
  });

  socket.on('addWatchedArtist', async (artist) => {
    try {
      const state = watchlist.addWatchedArtist(artist);
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to add watched artist'});
    }
  });

  socket.on('removeWatchedArtist', async ({artistId}) => {
    try {
      const state = watchlist.removeWatchedArtist(String(artistId));
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to remove watched artist'});
    }
  });

  socket.on('addWatchedPlaylist', async ({url}) => {
    try {
      const state = await watchlist.addWatchedPlaylist(String(url || ''));
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to add watched playlist'});
    }
  });

  socket.on('removeWatchedPlaylist', async ({playlistId}) => {
    try {
      const state = watchlist.removeWatchedPlaylist(String(playlistId));
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to remove watched playlist'});
    }
  });

  socket.on('refreshWatchedArtist', async ({artistId}) => {
    try {
      const result = await watchlist.refreshWatchedArtist(String(artistId));
      broadcastState(result.state);
      if (result.queueItems?.length) {
        socket.emit('watchlistQueueItems', {
          queueItems: result.queueItems,
          autoStart: true,
        });
      }
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to refresh artist'});
    }
  });

  socket.on('refreshAllWatchedArtists', async () => {
    try {
      const result = await watchlist.refreshAllWatchedArtists();
      broadcastState(result.state);
      if (result.queueItems?.length) {
        socket.emit('watchlistQueueItems', {
          queueItems: result.queueItems,
          autoStart: true,
        });
      }
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to refresh watchlist'});
    }
  });

  socket.on('refreshWatchedPlaylist', async ({playlistId}) => {
    try {
      const result = await watchlist.refreshWatchedPlaylist(String(playlistId));
      broadcastState(result.state);
      if (result.queueItems?.length) {
        io.emit('watchlistQueueItems', {
          queueItems: result.queueItems,
          autoStart: true,
        });
      }
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to refresh playlist'});
    }
  });

  socket.on('refreshAllWatchedPlaylists', async () => {
    try {
      const result = await watchlist.refreshAllWatchedPlaylists();
      broadcastState(result.state);
      if (result.queueItems?.length) {
        io.emit('watchlistQueueItems', {
          queueItems: result.queueItems,
          autoStart: true,
        });
      }
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to refresh playlists'});
    }
  });

  socket.on('queueWatchedArtistReleases', async ({albumIds, autoStart = false}) => {
    try {
      const result = watchlist.queueWatchedArtistReleases(Array.isArray(albumIds) ? albumIds.map(String) : []);
      broadcastState(result.state);
      socket.emit('watchlistQueueItems', {
        queueItems: result.queueItems,
        autoStart: Boolean(autoStart),
      });
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to queue watchlist albums'});
    }
  });

  socket.on('queueWatchedArtistDiscography', async ({artistId, autoStart = false}) => {
    try {
      const result = await watchlist.queueWatchedArtistDiscography(String(artistId));
      broadcastState(result.state);
      socket.emit('watchlistQueueItems', {
        queueItems: result.queueItems,
        autoStart: Boolean(autoStart),
      });
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to queue discography'});
    }
  });

  socket.on('queueWatchedArtistTracks', async ({artistId, autoStart = false}) => {
    try {
      const result = await watchlist.queueWatchedArtistTracks(String(artistId), {reason: 'queued'});
      broadcastState(result.state);
      socket.emit('watchlistQueueItems', {
        queueItems: result.queueItems,
        autoStart: Boolean(autoStart),
      });
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to queue artist tracks'});
    }
  });

  socket.on('saveWatchedArtistRules', async ({artistId, rules}) => {
    try {
      const state = watchlist.updateWatchedArtistRules(String(artistId), rules || {});
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to save artist rules'});
    }
  });

  socket.on('saveWatchedPlaylistRules', async ({playlistId, rules}) => {
    try {
      const state = watchlist.updateWatchedPlaylistRules(String(playlistId), rules || {});
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to save playlist rules'});
    }
  });

  socket.on('markWatchlistAlbumsProcessed', async ({albumIds, reason}) => {
    try {
      const state = watchlist.markWatchlistAlbumsProcessed(
        Array.isArray(albumIds) ? albumIds.map(String) : [],
        reason || 'dismissed',
      );
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to update watchlist history'});
    }
  });

  socket.on('queueWatchedPlaylistTracks', async ({playlistId, trackIds, autoStart = false}) => {
    try {
      const result = await watchlist.queueWatchedPlaylistTracks(
        String(playlistId || ''),
        Array.isArray(trackIds) ? trackIds.map(String) : [],
      );
      broadcastState(result.state);
      io.emit('watchlistQueueItems', {
        queueItems: result.queueItems,
        autoStart: Boolean(autoStart),
      });
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to queue playlist tracks'});
    }
  });

  socket.on('markWatchlistTracksProcessed', async ({playlistId, trackIds, reason}) => {
    try {
      const state = watchlist.markWatchlistTracksProcessed(
        String(playlistId || ''),
        Array.isArray(trackIds) ? trackIds.map(String) : [],
        reason || 'dismissed',
      );
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to update playlist history'});
    }
  });

  socket.on('getFavoriteGenres', async () => {
    await watchlist.loadAvailableGenres();
    socket.emit('favoriteGenres', watchlist.getFavoriteGenres());
  });

  socket.on('getReleaseTypes', () => {
    socket.emit('releaseTypes', {types: watchlist.getReleaseTypes()});
  });

  socket.on('saveReleaseTypes', ({types}) => {
    try {
      const state = watchlist.saveReleaseTypes(Array.isArray(types) ? types : []);
      io.emit('releaseTypes', {types: watchlist.getReleaseTypes()});
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to save release types'});
    }
  });

  socket.on('saveFavoriteGenres', async ({genreIds}) => {
    try {
      await watchlist.loadAvailableGenres();
      const state = watchlist.saveFavoriteGenres(Array.isArray(genreIds) ? genreIds.map(String) : []);
      socket.emit('favoriteGenres', watchlist.getFavoriteGenres());
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to save favorite genres'});
    }
  });

  socket.on('getGenreDiscovery', async ({genreId, limit = 18, offset = 0}) => {
    try {
      await watchlist.loadAvailableGenres();
      const genre = watchlist.getAvailableGenres().find((entry) => entry.id === String(genreId));
      const result = await watchlist.getGenreDiscovery(String(genreId), Number(limit), Number(offset));
      socket.emit('genreDiscovery', {
        genreId: String(genreId),
        title: genre?.label || 'Genre',
        service: 'qobuz',
        items: result.items,
        hasMore: result.hasMore,
        offset: result.offset,
        limit: result.limit,
      });
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to load genre discovery'});
    }
  });

  socket.on('getWatchlistHistory', () => {
    socket.emit('watchlistHistory', {
      items: watchlist.getWatchlistHistory(),
    });
  });

  socket.on('getMonitorSchedules', () => {
    socket.emit('monitorSchedules', watchlist.getMonitorSchedules());
  });

  socket.on('saveMonitorSchedule', async ({kind, schedule}) => {
    try {
      const state = watchlist.saveMonitorSchedule(kind === 'playlists' ? 'playlists' : 'artists', schedule || {});
      socket.emit('monitorSchedules', watchlist.getMonitorSchedules());
      broadcastState(state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to save monitor schedule'});
    }
  });

  const runMonitor = async (kind?: string) => {
    // Scan lifecycle is broadcast so any connected client can show progress,
    // not just the one that started it. Without a terminal event a client that
    // flips into a "scanning" state has nothing to turn it off again.
    io.emit('watchlistScanStarted', {kind: kind === 'playlists' ? 'playlists' : 'artists'});
    try {
      const result = await watchlist.runMonitorNow(kind === 'playlists' ? 'playlists' : 'artists');
      socket.emit('monitorSchedules', watchlist.getMonitorSchedules());
      io.emit('monitorHistory', {items: watchlist.getMonitorHistory()});
      broadcastState(result.state);
      io.emit('watchlistScanComplete', {time: new Date().toISOString(), kind});
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to run monitor'});
      // Emit the terminal event on failure too, or the UI stays stuck spinning.
      io.emit('watchlistScanComplete', {time: new Date().toISOString(), kind, failed: true});
    }
  };

  /*
   * Optional-chained payloads, and no promise left unhandled.
   *
   * `async ({kind}) => …` destructured the payload directly, so a client that
   * emitted this event with no argument threw a TypeError inside an async
   * function — an unhandled rejection, which Node turns into process exit.
   * That killed the whole server from a single malformed emit.
   *
   * runMonitor resolves rather than rejects in normal use, but it is called
   * without awaiting, so a throw from the io.emit before its try would escape
   * the same way. Catching here keeps that contained.
   */
  socket.on('runMonitorNow', (data) => {
    void runMonitor((data as {kind?: string} | undefined)?.kind).catch((error: any) => {
      socket.emit('watchlistError', {message: error?.message || 'Unable to run monitor'});
    });
  });

  // Alias for the web UI, which names the action after the user-facing button.
  socket.on('runWatchlistScan', (data) => {
    void runMonitor((data as {kind?: string} | undefined)?.kind).catch((error: any) => {
      socket.emit('watchlistError', {message: error?.message || 'Unable to run scan'});
    });
  });

  socket.on('getMonitorHistory', () => {
    socket.emit('monitorHistory', {
      items: watchlist.getMonitorHistory(),
    });
  });
};
