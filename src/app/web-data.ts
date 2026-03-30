import * as https from 'https';
import * as http from 'http';
import type {SearchResult} from './interactive-types';

interface WebDataDependencies {
  deezer: any;
  qobuz: any;
  parseDeezerUrl: (url: string) => Promise<any>;
  parseQobuzUrl: (url: string) => Promise<any>;
  ensureDeezerDownloadReady: () => Promise<void>;
  ensureQobuzSearchReady: () => Promise<void>;
  toStandardTrack: (track: any, service: 'deezer' | 'qobuz') => SearchResult;
  getQobuzConfig: () => any;
}

interface DiscoveryItem {
  id: string;
  title: string;
  artist: string;
  type: string;
  year?: number | null;
  duration: string;
  rawData: any;
}

export const createWebData = ({
  deezer,
  qobuz,
  parseDeezerUrl,
  parseQobuzUrl,
  ensureDeezerDownloadReady,
  ensureQobuzSearchReady,
  toStandardTrack,
  getQobuzConfig,
}: WebDataDependencies) => {
  function makeHttpRequest(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https://');
      const client = isHttps ? https : http;

      client
        .get(url, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const jsonData = JSON.parse(data);
              resolve(jsonData);
            } catch (error) {
              reject(error);
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  async function searchFallback(service: string, type: string, limit: number, results: DiscoveryItem[]) {
    console.log('🔄 Using search fallback for', type);

    let searchQueries: string[] = [];
    let contentType = 'album';

    switch (type) {
      case 'new-releases':
        searchQueries = ['2025', '2024'];
        contentType = 'album';
        break;
      case 'trending-albums':
        searchQueries = ['hits', 'popular'];
        contentType = 'album';
        break;
      case 'popular-playlists':
        searchQueries = ['hits', 'top 50'];
        contentType = 'playlist';
        break;
      case 'top-artists':
        searchQueries = ['&', 'top'];
        contentType = 'artist';
        break;
      default:
        break;
    }

    for (const query of searchQueries.slice(0, 2)) {
      if (results.length >= limit) break;

      try {
        if (service === 'deezer') {
          let searchType: 'TRACK' | 'ALBUM' | 'ARTIST' | 'PLAYLIST';
          switch (contentType) {
            case 'album':
              searchType = 'ALBUM';
              break;
            case 'artist':
              searchType = 'ARTIST';
              break;
            case 'playlist':
              searchType = 'PLAYLIST';
              break;
            default:
              searchType = 'ALBUM';
          }

          const searchResult = await deezer.searchMusic(query, [searchType], Math.ceil(limit / 2));
          const items = searchResult[searchType]?.data || [];

          for (const item of items) {
            if (results.length >= limit) break;

            const rawItem = item as any;
            let standardItem: any;

            if (contentType === 'album') {
              standardItem = {
                id: rawItem.ALB_ID,
                title: rawItem.ALB_TITLE,
                artist: rawItem.ART_NAME,
                type: 'album',
                year: rawItem.PHYSICAL_RELEASE_DATE ? new Date(rawItem.PHYSICAL_RELEASE_DATE).getFullYear() : null,
                duration: `${rawItem.NUMBER_TRACK || 0} tracks`,
                rawData: rawItem,
              };
            } else if (contentType === 'artist') {
              let pictureHash = '';
              if (rawItem.picture_small) {
                const hashMatch = rawItem.picture_small.match(/\/images\/artist\/([a-f0-9]{32})\//);
                pictureHash = hashMatch ? hashMatch[1] : '';
              } else {
                pictureHash = rawItem.ART_PICTURE || '';
              }

              standardItem = {
                id: rawItem.ART_ID || String(rawItem.id),
                title: rawItem.ART_NAME || rawItem.name,
                artist: rawItem.ART_NAME || rawItem.name,
                type: 'artist',
                duration: `${rawItem.NB_FAN || rawItem.nb_fan || 0} fans`,
                rawData: {
                  ...rawItem,
                  ART_PICTURE: pictureHash,
                },
              };
            } else if (contentType === 'playlist') {
              standardItem = {
                id: rawItem.PLAYLIST_ID,
                title: rawItem.TITLE,
                artist: rawItem.PARENT_USERNAME,
                type: 'playlist',
                duration: `${rawItem.NB_SONG || 0} tracks`,
                rawData: rawItem,
              };
            }

            if (standardItem && !results.find((r: any) => r.id === standardItem.id)) {
              results.push(standardItem);
            }
          }
        } else if (service === 'qobuz') {
          let qobuzType: 'track' | 'album' | 'artist' | 'playlist';
          switch (contentType) {
            case 'album':
              qobuzType = 'album';
              break;
            case 'artist':
              qobuzType = 'artist';
              break;
            case 'playlist':
              qobuzType = 'playlist';
              break;
            default:
              qobuzType = 'album';
          }

          const searchResult = await qobuz.searchMusic(query, qobuzType, Math.ceil(limit / 2));
          const items = (searchResult as any)[qobuzType + 's']?.items || [];

          for (const item of items) {
            if (results.length >= limit) break;

            const rawItem = item as any;
            let standardItem: any;

            if (contentType === 'album') {
              standardItem = {
                id: String(rawItem.id),
                title: rawItem.title,
                artist: rawItem.artist?.name || 'Unknown Artist',
                type: 'album',
                year: rawItem.release_date_original ? new Date(rawItem.release_date_original).getFullYear() : null,
                duration: `${rawItem.tracks_count || 0} tracks`,
                rawData: rawItem,
              };
            } else if (contentType === 'artist') {
              standardItem = {
                id: String(rawItem.id),
                title: rawItem.name,
                artist: rawItem.name,
                type: 'artist',
                duration: `${rawItem.albums_count || 0} albums`,
                rawData: rawItem,
              };
            } else if (contentType === 'playlist') {
              standardItem = {
                id: String(rawItem.id),
                title: rawItem.name || rawItem.title,
                artist: rawItem.owner?.name || 'Qobuz',
                type: 'playlist',
                duration: `${rawItem.tracks_count || 0} tracks`,
                rawData: rawItem,
              };
            }

            if (standardItem && !results.find((r: any) => r.id === standardItem.id)) {
              results.push(standardItem);
            }
          }
        }
      } catch (searchError) {
        console.error('Search fallback error:', searchError);
      }
    }
  }

  const getDiscoveryContentRest = async (service: string, type: string, limit = 18): Promise<DiscoveryItem[]> => {
    const results: DiscoveryItem[] = [];
    const normalizedService = String(service || '').toLowerCase();
    const normalizedType = String(type || '').toLowerCase();
    const normalizedLimit = Math.max(1, Number(limit || 18));

    if (normalizedService === 'deezer') {
      let apiResponse: any = null;
      switch (normalizedType) {
        case 'new-releases': {
          const deezerLimit = Math.max(normalizedLimit, 30);
          apiResponse = await makeHttpRequest(`https://api.deezer.com/editorial/0/releases?limit=${deezerLimit}`);
          for (const album of (apiResponse.data || []).slice(0, normalizedLimit)) {
            results.push({
              id: String(album.id),
              title: album.title || 'Unknown Album',
              artist: album.artist?.name || 'Unknown Artist',
              type: 'album',
              year: album.release_date ? new Date(album.release_date).getFullYear() : null,
              duration: 'Album',
              rawData: {
                ALB_ID: album.id,
                ALB_TITLE: album.title,
                ART_NAME: album.artist?.name,
                ALB_PICTURE: album.md5_image,
                PHYSICAL_RELEASE_DATE: album.release_date,
                ...album,
              },
            });
          }
          break;
        }
        case 'trending-albums': {
          const deezerLimit = Math.max(normalizedLimit, 30);
          apiResponse = await makeHttpRequest(`https://api.deezer.com/chart/0/albums?limit=${deezerLimit}`);
          for (const album of (apiResponse.data || []).slice(0, normalizedLimit)) {
            results.push({
              id: String(album.id),
              title: album.title || 'Unknown Album',
              artist: album.artist?.name || 'Unknown Artist',
              type: 'album',
              year: null,
              duration: `Chart #${album.position || '?'}`,
              rawData: {
                ALB_ID: album.id,
                ALB_TITLE: album.title,
                ART_NAME: album.artist?.name,
                ALB_PICTURE: album.md5_image,
                position: album.position,
                ...album,
              },
            });
          }
          break;
        }
        case 'popular-playlists': {
          const deezerLimit = Math.max(normalizedLimit, 40);
          apiResponse = await makeHttpRequest(`https://api.deezer.com/chart/0/playlists?limit=${deezerLimit}`);
          for (const playlist of (apiResponse.data || []).slice(0, normalizedLimit)) {
            results.push({
              id: String(playlist.id),
              title: playlist.title || 'Unknown Playlist',
              artist: playlist.user?.name || 'Deezer',
              type: 'playlist',
              year: null,
              duration: `${playlist.nb_tracks || 0} tracks`,
              rawData: {
                PLAYLIST_ID: playlist.id,
                TITLE: playlist.title,
                PARENT_USERNAME: playlist.user?.name,
                NB_SONG: playlist.nb_tracks,
                PLAYLIST_PICTURE: playlist.md5_image,
                ...playlist,
              },
            });
          }
          break;
        }
        case 'top-tracks': {
          const deezerLimit = Math.max(normalizedLimit, 30);
          apiResponse = await makeHttpRequest(`https://api.deezer.com/chart/0/tracks?limit=${deezerLimit}`);
          for (const tr of (apiResponse.data || []).slice(0, normalizedLimit)) {
            results.push({
              id: String(tr.id),
              title: tr.title || 'Unknown Track',
              artist: tr.artist?.name || 'Unknown Artist',
              type: 'track',
              year: null,
              duration: tr.duration
                ? `${Math.floor(Number(tr.duration) / 60)}:${('0' + (Number(tr.duration) % 60)).slice(-2)}`
                : '',
              rawData: tr,
            });
          }
          break;
        }
        case 'genre-pop':
        case 'genre-rap':
        case 'genre-jazz': {
          const map: Record<string, number> = {'genre-pop': 132, 'genre-rap': 116, 'genre-jazz': 129};
          const gid = map[normalizedType] || 0;
          const deezerLimit = Math.max(normalizedLimit, 30);
          apiResponse = await makeHttpRequest(`https://api.deezer.com/chart/${gid}/albums?limit=${deezerLimit}`);
          for (const album of (apiResponse.data || []).slice(0, normalizedLimit)) {
            results.push({
              id: String(album.id),
              title: album.title || 'Unknown Album',
              artist: album.artist?.name || 'Unknown Artist',
              type: 'album',
              year: null,
              duration: 'Album',
              rawData: album,
            });
          }
          break;
        }
        case 'top-artists': {
          apiResponse = await makeHttpRequest('https://api.deezer.com/chart/0/artists');
          for (const artist of (apiResponse.data || []).slice(0, normalizedLimit)) {
            let pictureHash = '';
            if (artist.picture_small) {
              const hashMatch = artist.picture_small.match(/\/images\/artist\/([a-f0-9]{32})\//);
              pictureHash = hashMatch ? hashMatch[1] : '';
            }
            results.push({
              id: String(artist.id),
              title: artist.name || 'Unknown Artist',
              artist: artist.name || 'Unknown Artist',
              type: 'artist',
              year: null,
              duration: `${artist.nb_fan || 0} fans`,
              rawData: {
                ART_ID: artist.id,
                ART_NAME: artist.name,
                NB_FAN: artist.nb_fan,
                ART_PICTURE: pictureHash,
                ...artist,
              },
            });
          }
          break;
        }
        default:
          break;
      }

      if (results.length === 0) {
        await searchFallback(normalizedService, normalizedType, normalizedLimit, results);
      }
      return results.slice(0, normalizedLimit);
    }

    if (normalizedService === 'qobuz') {
      await ensureQobuzSearchReady();

      const qobuzConfig = getQobuzConfig();
      switch (normalizedType) {
        case 'new-releases': {
          if (qobuzConfig) {
            const apiUrl = `https://www.qobuz.com/api.json/0.2/album/getFeatured?type=new-releases-full&offset=0&limit=${normalizedLimit}&app_id=${qobuzConfig.app_id}&user_auth_token=${qobuzConfig.token}`;
            const apiResponse = await makeHttpRequest(apiUrl);
            for (const album of (apiResponse.albums?.items || []).slice(0, normalizedLimit)) {
              results.push({
                id: String(album.id),
                title: album.title || 'Unknown Album',
                artist: album.artist?.name || 'Unknown Artist',
                type: 'album',
                year: album.release_date_original ? new Date(album.release_date_original).getFullYear() : null,
                duration: `${album.tracks_count || 0} tracks`,
                rawData: album,
              });
            }
          }
          break;
        }
        case 'trending-albums': {
          if (qobuzConfig) {
            const apiUrl = `https://www.qobuz.com/api.json/0.2/album/getFeatured?type=press-awards&offset=0&limit=${normalizedLimit}&app_id=${qobuzConfig.app_id}&user_auth_token=${qobuzConfig.token}`;
            const apiResponse = await makeHttpRequest(apiUrl);
            for (const album of (apiResponse.albums?.items || []).slice(0, normalizedLimit)) {
              results.push({
                id: String(album.id),
                title: album.title || 'Unknown Album',
                artist: album.artist?.name || 'Unknown Artist',
                type: 'album',
                year: album.release_date_original ? new Date(album.release_date_original).getFullYear() : null,
                duration: `${album.tracks_count || 0} tracks`,
                rawData: album,
              });
            }
          }
          break;
        }
        case 'popular-playlists': {
          if (qobuzConfig) {
            const apiUrl = `https://www.qobuz.com/api.json/0.2/playlist/getFeatured?type=editor-picks&offset=0&limit=${normalizedLimit}&app_id=${qobuzConfig.app_id}&user_auth_token=${qobuzConfig.token}`;
            const apiResponse = await makeHttpRequest(apiUrl);
            for (const playlist of (apiResponse.playlists?.items || []).slice(0, normalizedLimit)) {
              results.push({
                id: String(playlist.id),
                title: playlist.name || 'Unknown Playlist',
                artist: playlist.owner?.name || 'Qobuz',
                type: 'playlist',
                year: playlist.created_at ? new Date(playlist.created_at * 1000).getFullYear() : null,
                duration: `${playlist.tracks_count || playlist.users_count || 0} tracks`,
                rawData: playlist,
              });
            }
          }
          break;
        }
        case 'top-artists': {
          await searchFallback(normalizedService, normalizedType, normalizedLimit, results);
          break;
        }
        default:
          break;
      }

      if (results.length === 0) {
        await searchFallback(normalizedService, normalizedType, normalizedLimit, results);
      }
      return results.slice(0, normalizedLimit);
    }

    return results;
  };

  const getItemTracksRest = async (
    service: string,
    itemType: string,
    id: string,
    limit = 100,
    offset = 0,
  ): Promise<{tracks: SearchResult[]; metadata: any}> => {
    const normalizedService = String(service || '').toLowerCase();
    const normalizedType = String(itemType || '').toLowerCase();
    const tracks: SearchResult[] = [];
    let metadata: any = {};

    if (!id) {
      return {tracks, metadata};
    }

    if (normalizedService === 'deezer') {
      if (normalizedType === 'album') {
        const albumData = await parseDeezerUrl(`https://deezer.com/album/${id}`);
        const list = albumData?.tracks || [];
        for (const track of list) {
          tracks.push(toStandardTrack(track, 'deezer'));
        }
        metadata = albumData?.linkinfo || {};
        return {tracks, metadata};
      }
      if (normalizedType === 'playlist') {
        await ensureDeezerDownloadReady();
        const playlistData = await parseDeezerUrl(`https://deezer.com/playlist/${id}`);
        const list = playlistData?.tracks || [];
        for (const track of list) {
          tracks.push(toStandardTrack(track, 'deezer'));
        }
        metadata = playlistData?.linkinfo || {};
        return {tracks, metadata};
      }
      if (normalizedType === 'artist') {
        const url = `https://api.deezer.com/artist/${encodeURIComponent(id)}/top?limit=${Number(limit)}&index=${Number(
          offset,
        )}`;
        const resp = await makeHttpRequest(url);
        const list = (resp && resp.data) || [];
        for (const track of list) {
          tracks.push(toStandardTrack(track, 'deezer'));
        }
        metadata = {id, type: 'artist'};
        return {tracks, metadata};
      }
      if (normalizedType === 'track') {
        const track = await deezer.getTrackInfoPublicApi(id);
        if (track) {
          tracks.push(toStandardTrack(track, 'deezer'));
        }
        metadata = {id, type: 'track'};
        return {tracks, metadata};
      }
    }

    if (normalizedService === 'qobuz') {
      await ensureQobuzSearchReady();
      if (normalizedType === 'album') {
        const albumData = await qobuz.getAlbumInfo(id);
        const list = albumData?.tracks?.items || [];
        for (const track of list) {
          tracks.push(toStandardTrack(track, 'qobuz'));
        }
        metadata = {title: albumData?.title, artist: albumData?.artist?.name, ...albumData};
        return {tracks, metadata};
      }
      if (normalizedType === 'playlist') {
        const playlistData = await parseQobuzUrl(`https://play.qobuz.com/playlist/${id}`);
        const list = playlistData?.tracks || [];
        for (const track of list) {
          tracks.push(toStandardTrack(track, 'qobuz'));
        }
        metadata = playlistData?.linkinfo || {};
        return {tracks, metadata};
      }
      if (normalizedType === 'artist') {
        const resp = await (qobuz as any).qobuzRequest?.('artist/get', {
          artist_id: id,
          extra: 'tracks',
          offset: Number(offset),
          limit: Number(limit),
        });
        const list = resp?.tracks?.items || [];
        for (const track of list) {
          tracks.push(toStandardTrack(track, 'qobuz'));
        }
        metadata = {id, type: 'artist'};
        return {tracks, metadata};
      }
      if (normalizedType === 'track') {
        const track = await qobuz.getTrackInfo(Number(id));
        if (track) {
          tracks.push(toStandardTrack(track, 'qobuz'));
        }
        metadata = {id, type: 'track'};
        return {tracks, metadata};
      }
    }

    return {tracks, metadata};
  };

  return {getDiscoveryContentRest, getItemTracksRest, makeHttpRequest};
};
