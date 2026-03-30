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

  socket.on('runMonitorNow', async ({kind}) => {
    try {
      const result = await watchlist.runMonitorNow(kind === 'playlists' ? 'playlists' : 'artists');
      socket.emit('monitorSchedules', watchlist.getMonitorSchedules());
      io.emit('monitorHistory', {items: watchlist.getMonitorHistory()});
      broadcastState(result.state);
    } catch (error: any) {
      socket.emit('watchlistError', {message: error.message || 'Unable to run monitor'});
    }
  });

  socket.on('getMonitorHistory', () => {
    socket.emit('monitorHistory', {
      items: watchlist.getMonitorHistory(),
    });
  });
};
