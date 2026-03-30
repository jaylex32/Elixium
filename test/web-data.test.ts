import test from 'ava';
import {createWebData} from '../src/app/web-data';

const toStandardTrack = (track: any, service: 'deezer' | 'qobuz') =>
  ({
    id: String(track.id ?? track.SNG_ID ?? '0'),
    title: track.title || track.SNG_TITLE || 'Unknown Track',
    artist: track.artist?.name || track.ART_NAME || track.performer?.name || 'Unknown Artist',
    album: track.album?.title || track.ALB_TITLE || '',
    duration: '',
    type: 'track',
    rawData: {...track, __service: service},
  } as any);

test('web data resolves Deezer playlist item tracks after ensuring download auth', async (t) => {
  let ensured = 0;
  const parsedUrls: string[] = [];

  const {getItemTracksRest} = createWebData({
    deezer: {},
    qobuz: {},
    parseDeezerUrl: async (url: string) => {
      parsedUrls.push(url);
      return {
        tracks: [{id: 'track-1', title: 'Song One'}],
        linkinfo: {TITLE: 'Playlist One'},
      };
    },
    parseQobuzUrl: async () => ({tracks: []}),
    ensureDeezerDownloadReady: async () => {
      ensured += 1;
    },
    ensureQobuzSearchReady: async () => undefined,
    toStandardTrack,
    getQobuzConfig: () => null,
  });

  const result = await getItemTracksRest('deezer', 'playlist', '42');

  t.is(ensured, 1);
  t.deepEqual(parsedUrls, ['https://deezer.com/playlist/42']);
  t.is(result.tracks.length, 1);
  t.is(result.tracks[0].id, 'track-1');
  t.deepEqual(result.metadata, {TITLE: 'Playlist One'});
});

test('web data resolves Qobuz album item tracks after ensuring search readiness', async (t) => {
  let ensured = 0;

  const {getItemTracksRest} = createWebData({
    deezer: {},
    qobuz: {
      getAlbumInfo: async (id: string) => ({
        id,
        title: 'Album Alpha',
        artist: {name: 'Artist Alpha'},
        tracks: {
          items: [{id: 9, title: 'Track Nine'}],
        },
      }),
    },
    parseDeezerUrl: async () => ({tracks: []}),
    parseQobuzUrl: async () => ({tracks: []}),
    ensureDeezerDownloadReady: async () => undefined,
    ensureQobuzSearchReady: async () => {
      ensured += 1;
    },
    toStandardTrack,
    getQobuzConfig: () => null,
  });

  const result = await getItemTracksRest('qobuz', 'album', 'album-9');

  t.is(ensured, 1);
  t.is(result.tracks.length, 1);
  t.is(result.tracks[0].id, '9');
  t.is(result.metadata.title, 'Album Alpha');
  t.is(result.metadata.artist.name, 'Artist Alpha');
});

test('web data discovery falls back to Qobuz search for top artists', async (t) => {
  let ensured = 0;
  const searchCalls: Array<{query: string; type: string; limit: number}> = [];

  const {getDiscoveryContentRest} = createWebData({
    deezer: {},
    qobuz: {
      searchMusic: async (query: string, type: string, limit: number) => {
        searchCalls.push({query, type, limit});
        return {
          artists: {
            items: [
              {id: 1, name: 'Artist One', albums_count: 5},
              {id: 2, name: 'Artist Two', albums_count: 3},
            ],
          },
        };
      },
    },
    parseDeezerUrl: async () => ({tracks: []}),
    parseQobuzUrl: async () => ({tracks: []}),
    ensureDeezerDownloadReady: async () => undefined,
    ensureQobuzSearchReady: async () => {
      ensured += 1;
    },
    toStandardTrack,
    getQobuzConfig: () => null,
  });

  const result = await getDiscoveryContentRest('qobuz', 'top-artists', 2);

  t.is(ensured, 1);
  t.true(searchCalls.length >= 1);
  t.is(searchCalls[0].query, '&');
  t.is(searchCalls[0].type, 'artist');
  t.is(result.length, 2);
  t.is(result[0].title, 'Artist One');
  t.is(result[1].artist, 'Artist Two');
});
