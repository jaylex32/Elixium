/*
 * YouTube Music parsing and matching.
 *
 * The parsers read a UI tree that YouTube can reshape without notice, and the
 * matcher decides which file lands in somebody's library. Both are pinned here
 * against fixtures that mirror the live responses, so a change on their side
 * fails in this file rather than as a page that silently shows nothing, or —
 * far worse — as a wrong track downloaded under the right name.
 *
 * No test here touches the network.
 */
import test from 'ava';
import {
  parseSearch,
  parseSearchItem,
  parseCollection,
  durationToSeconds,
  upgradeThumbnail,
  musicVideoTypeOf,
  isAlbumAudio,
} from '../src/core/ytmusic/parse';
import {
  normalise,
  similarity,
  durationCloseness,
  scoreCandidate,
  matchTrack,
  versionTags,
  sameVersion,
  MATCH_THRESHOLD,
} from '../src/app/ytmusic-match';
import {YtMusicClient} from '../src/core/ytmusic/innertube';
import type {SearchResult} from '../src/app/interactive-types';

// ── fixtures, shaped as the live API returns them ────────────────────────────

const runs = (...texts: string[]) => ({text: {runs: texts.map((text) => ({text}))}});

const songRow = (title: string, meta: string[], videoId: string) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      {musicResponsiveListItemFlexColumnRenderer: runs(title)},
      {musicResponsiveListItemFlexColumnRenderer: runs(...meta)},
    ],
    playlistItemData: {videoId},
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: {
          thumbnails: [{url: 'https://lh3.googleusercontent.com/x=w120-h120-l90-rj', width: 120, height: 120}],
        },
      },
    },
  },
});

const searchResponse = (rows: unknown[]) => ({
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [{tabRenderer: {content: {sectionListRenderer: {contents: [{musicShelfRenderer: {contents: rows}}]}}}}],
    },
  },
});

// ── search parsing ───────────────────────────────────────────────────────────

test('a song row yields title, artist, album and duration', (t) => {
  const parsed = parseSearchItem(
    songRow('Get Lucky', ['Daft Punk', ' • ', 'Random Access Memories', ' • ', '6:10'], 'abc12345678')
      .musicResponsiveListItemRenderer,
    'track',
  );
  t.truthy(parsed);
  t.is(parsed?.id, 'abc12345678');
  t.is(parsed?.title, 'Get Lucky');
  t.is(parsed?.artist, 'Daft Punk');
  t.is(parsed?.album, 'Random Access Memories');
  t.is(parsed?.duration, '6:10');
  t.is(parsed?.rawData.durationSeconds, 370);
});

test('a single with no album still parses, and does not mistake the duration for one', (t) => {
  // The album segment is simply absent here; reading by position would put
  // "3:45" into the album field.
  const parsed = parseSearchItem(
    songRow('Some Single', ['An Artist', ' • ', '3:45'], 'xyz98765432').musicResponsiveListItemRenderer,
    'track',
  );
  t.is(parsed?.album, '');
  t.is(parsed?.duration, '3:45');
  t.is(parsed?.artist, 'An Artist');
});

test('a row without a videoId is dropped rather than returned half-built', (t) => {
  const row = songRow('No Id', ['Artist', ' • ', '1:00'], '').musicResponsiveListItemRenderer;
  t.is(parseSearchItem(row, 'track'), null);
});

test('a malformed row does not take the whole page with it', (t) => {
  const response = searchResponse([
    songRow('Good One', ['Artist', ' • ', '2:00'], 'aaaaaaaaaaa'),
    {musicResponsiveListItemRenderer: {flexColumns: []}},
    songRow('Another', ['Artist', ' • ', '3:00'], 'bbbbbbbbbbb'),
  ]);
  const results = parseSearch(response, 'track');
  t.is(results.length, 2, 'nineteen results beat zero results');
});

test('an empty response yields an empty list, not a throw', (t) => {
  t.deepEqual(parseSearch({}, 'track'), []);
  t.deepEqual(parseSearch(null, 'album'), []);
});

test('the limit is honoured', (t) => {
  const rows = Array.from({length: 30}, (_, i) => songRow(`T${i}`, ['A', ' • ', '1:00'], `id${i}`.padEnd(11, 'x')));
  t.is(parseSearch(searchResponse(rows), 'track', 5).length, 5);
});

// ── covers ───────────────────────────────────────────────────────────────────

test('a thumbnail URL is upgraded to full size', (t) => {
  t.is(
    upgradeThumbnail('https://lh3.googleusercontent.com/abc=w120-h120-l90-rj'),
    'https://lh3.googleusercontent.com/abc=w1000-h1000-l90-rj',
  );
  t.is(upgradeThumbnail('https://i.ytimg.com/vi/abc/hqdefault.jpg'), 'https://i.ytimg.com/vi/abc/maxresdefault.jpg');
});

test('an unrecognised image URL is left alone rather than mangled', (t) => {
  t.is(upgradeThumbnail('https://example.com/cover.jpg'), 'https://example.com/cover.jpg');
  t.is(upgradeThumbnail(''), '');
});

test('durations parse, and nonsense does not', (t) => {
  t.is(durationToSeconds('6:10'), 370);
  t.is(durationToSeconds('1:02:03'), 3723);
  t.is(durationToSeconds('nope'), null);
  t.is(durationToSeconds('1.2.3'), null);
});

// ── album pages ──────────────────────────────────────────────────────────────

const albumResponse = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicResponsiveHeaderRenderer: {
                      title: {runs: [{text: 'Random Access Memories'}]},
                      subtitle: {runs: [{text: 'Album'}, {text: ' • '}, {text: '2013'}]},
                      secondSubtitle: {runs: [{text: '13 songs • 1 hour, 14 minutes'}]},
                      straplineTextOne: {runs: [{text: 'Daft Punk'}]},
                      thumbnail: {
                        musicThumbnailRenderer: {
                          thumbnail: {
                            thumbnails: [
                              {url: 'https://lh3.googleusercontent.com/c=w544-h544', width: 544, height: 544},
                            ],
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
      secondaryContents: {
        sectionListRenderer: {
          contents: [
            {
              musicShelfRenderer: {
                contents: [
                  {
                    musicResponsiveListItemRenderer: {
                      index: {runs: [{text: '1'}]},
                      flexColumns: [
                        {musicResponsiveListItemFlexColumnRenderer: runs('Give Life Back to Music')},
                        {musicResponsiveListItemFlexColumnRenderer: runs('')},
                      ],
                      fixedColumns: [{musicResponsiveListItemFixedColumnRenderer: {text: {runs: [{text: '4:36'}]}}}],
                      playlistItemData: {videoId: 'IluRBvnYMoY'},
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

test('an album page yields its header and its tracks', (t) => {
  const album = parseCollection(albumResponse, 'MPREb_test');
  t.truthy(album);
  t.is(album?.title, 'Random Access Memories');
  t.is(album?.year, 2013);
  t.is(album?.trackCount, 13, 'the declared count is used, not the number of rows returned');
  t.is(album?.tracks.length, 1);
  t.is(album?.tracks[0].title, 'Give Life Back to Music');
  t.is(album?.tracks[0].duration, '4:36', 'the duration lives in a fixed column, not the text columns');
  t.is(album?.tracks[0].rawData.trackNumber, 1);
});

test('the album artist comes from the strapline, not the subtitle', (t) => {
  // The subtitle is only "Album • 2013"; reading the artist from it left every
  // album unattributed and every match weaker than it should have been.
  const album = parseCollection(albumResponse, 'MPREb_test');
  t.is(album?.artist, 'Daft Punk');
});

test('a track row with no artist inherits the album artist', (t) => {
  const album = parseCollection(albumResponse, 'MPREb_test');
  t.is(album?.tracks[0].artist, 'Daft Punk', 'otherwise the matcher has no artist to work with');
});

test('a page with no header is declined rather than half-parsed', (t) => {
  t.is(parseCollection({}, 'x'), null);
});

// ── matching ─────────────────────────────────────────────────────────────────

const candidate = (title: string, artist: string, duration: string): SearchResult => ({
  id: `${title}-${artist}`,
  title,
  artist,
  album: '',
  duration,
  type: 'track',
  rawData: {},
});

test('noise that appears on only one side is ignored', (t) => {
  t.is(normalise('Get Lucky (Official Audio)'), 'get lucky');
  t.is(normalise('Dreams (2004 Remaster)'), 'dreams');
  t.is(normalise('Motörhead'), 'motorhead');
  t.is(normalise('bad guy (with Justin Bieber)'), 'bad guy');
});

test('word order does not penalise a match', (t) => {
  t.is(similarity('David Bowie', 'Bowie, David'), 1);
});

test('different songs score near zero', (t) => {
  t.true(similarity('Get Lucky', 'Instant Crush') < 0.2);
});

test('duration tolerates a fade but not a different take', (t) => {
  t.is(durationCloseness(370, 372), 1);
  t.is(durationCloseness(370, 420), 0);
  t.is(durationCloseness(370, null), null, 'unknown is not the same as wrong');
});

test('a confident match clears the bar', (t) => {
  const score = scoreCandidate(
    {title: 'Get Lucky', artist: 'Daft Punk', durationSeconds: 369},
    candidate('Get Lucky (feat. Pharrell Williams)', 'Daft Punk', '6:09'),
  );
  t.true(score.score >= MATCH_THRESHOLD);
});

test('a same-titled song by another artist does not', (t) => {
  const score = scoreCandidate(
    {title: 'Dreams', artist: 'Fleetwood Mac', durationSeconds: 257},
    candidate('Dreams', 'The Cranberries', '4:32'),
  );
  t.true(score.score < MATCH_THRESHOLD, 'a wrong file is worse than no file');
});

test('a match is returned when one is confident enough', async (t) => {
  const outcome = await matchTrack({title: 'Get Lucky', artist: 'Daft Punk', durationSeconds: 369}, async () => [
    candidate('Instant Crush', 'Daft Punk', '5:37'),
    candidate('Get Lucky', 'Daft Punk', '6:09'),
  ]);
  t.is(outcome.reason, 'matched');
  t.is(outcome.match?.title, 'Get Lucky');
});

test('an unconfident best guess is declined, and reported as such', async (t) => {
  const outcome = await matchTrack(
    {title: 'Some Obscure Bootleg', artist: 'Nobody', durationSeconds: 200},
    async () => [candidate('Something Else Entirely', 'A Different Band', '3:10')],
  );
  t.is(outcome.reason, 'low-confidence');
  t.is(outcome.match, null);
  t.is(outcome.candidates.length, 1, 'the near-misses are kept so a person can choose');
});

test('no results is distinguished from a bad match', async (t) => {
  const outcome = await matchTrack({title: 'x', artist: 'y', durationSeconds: null}, async () => []);
  t.is(outcome.reason, 'no-results');
});

test('a failing search does not abort the match', async (t) => {
  let call = 0;
  const outcome = await matchTrack({title: 'Get Lucky', artist: 'Daft Punk', durationSeconds: 369}, async () => {
    call += 1;
    if (call === 1) throw new Error('upstream hiccup');
    return [candidate('Get Lucky', 'Daft Punk', '6:09')];
  });
  t.is(outcome.reason, 'matched', 'the second query still had its chance');
});

/*
 * Album audio against music video.
 *
 * A music video's audio is not the record — it carries an intro, an outro,
 * applause and a different mix — so a playlist of videos downloads as files
 * that do not match the album they claim to come from. YouTube marks which is
 * which; these pin that reading, and pin the refusal to accept a different
 * recording of the same song as a substitute.
 */

const watchRow = (musicVideoType?: string) => ({
  overlay: {
    musicItemThumbnailOverlayRenderer: {
      content: {
        musicPlayButtonRenderer: {
          playNavigationEndpoint: {
            watchEndpoint: {
              videoId: 'abc123',
              ...(musicVideoType
                ? {watchEndpointMusicSupportedConfigs: {watchEndpointMusicConfig: {musicVideoType}}}
                : {}),
            },
          },
        },
      },
    },
  },
});

test('a row says whether it is album audio or a video', (t) => {
  t.is(musicVideoTypeOf(watchRow('MUSIC_VIDEO_TYPE_ATV')), 'MUSIC_VIDEO_TYPE_ATV');
  t.is(musicVideoTypeOf(watchRow('MUSIC_VIDEO_TYPE_OMV')), 'MUSIC_VIDEO_TYPE_OMV');
  t.is(musicVideoTypeOf(watchRow()), '', 'no marker is not the same as a video');
});

test('only the album track counts as album audio', (t) => {
  t.true(isAlbumAudio('MUSIC_VIDEO_TYPE_ATV'));
  t.false(isAlbumAudio('MUSIC_VIDEO_TYPE_OMV'), 'the official video is still a video');
  t.false(isAlbumAudio('MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC'));
  t.false(isAlbumAudio('MUSIC_VIDEO_TYPE_UGC'));
  t.false(isAlbumAudio(undefined), 'not knowing is not a yes');
});

test('a version qualifier is read from the raw title', (t) => {
  t.deepEqual([...versionTags('Walk This Way (Instrumental)')], ['instrumental']);
  t.deepEqual([...versionTags('Walk This Way [Instrumental]')], ['instrumental'], 'brackets count too');
  t.deepEqual([...versionTags('Walk This Way')], []);
  t.deepEqual([...versionTags('Alive')], [], 'a word inside another word is not a qualifier');
});

test('the same kind of recording matches, a different kind does not', (t) => {
  t.true(sameVersion('Walk This Way', 'Walk This Way (Official Video)'));
  t.true(sameVersion('Song (Live)', 'Song - Live'), 'live still matches live');
  t.false(sameVersion('Walk This Way', 'Walk This Way (Instrumental)'));
  t.false(sameVersion('Song', 'Song (Karaoke Version)'));
  t.false(sameVersion('Song', 'Song (Remix)'));
});

test('an instrumental is refused however well the words line up', (t) => {
  /* This scored 0.94 and was downloaded in place of the song: every word of
     the title matches, the artist matches, and the length can too. */
  const score = scoreCandidate(
    {title: 'Walk This Way', artist: 'Run-D.M.C.', durationSeconds: 244},
    candidate('Walk This Way (Instrumental)', 'Run-D.M.C.', '4:04'),
  );
  t.is(score.score, 0, 'no confidence makes an instrumental the right answer');
});

test('a live take is not offered for a studio track, or the reverse', (t) => {
  t.is(
    scoreCandidate({title: 'Africa', artist: 'Toto', durationSeconds: 295}, candidate('Africa (Live)', 'Toto', '4:55'))
      .score,
    0,
  );
  t.true(
    scoreCandidate(
      {title: 'Africa (Live)', artist: 'Toto', durationSeconds: 295},
      candidate('Africa (Live)', 'Toto', '4:55'),
    ).score >= MATCH_THRESHOLD,
    'the same live take is still a match',
  );
});

/*
 * Transient failures.
 *
 * A dropped connection or a moment of 503 in the middle of a hundred-track
 * playlist used to end that track for good: the request threw, nothing caught
 * it, and the download reported a failure for something that would have
 * worked a second later. A refusal is still a refusal, though — retrying a 403
 * only makes it firmer.
 */

/** A client whose transport can be told how to fail. */
const clientOver = (responses: Array<{status: number; data?: unknown; headers?: Record<string, string>} | Error>) => {
  const calls: number[] = [];
  let index = 0;
  const http = {
    get: async () => ({
      status: 200,
      data: '"INNERTUBE_API_KEY":"k","INNERTUBE_CLIENT_VERSION":"1.0","VISITOR_DATA":"v"',
    }),
    post: async () => {
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      calls.push(Date.now());
      if (next instanceof Error) throw next;
      return {status: next.status, data: next.data ?? {ok: true}, headers: next.headers ?? {}};
    },
  } as never;
  return {client: new YtMusicClient(http), attempts: () => index};
};

test('a dropped connection is retried rather than failing the track', async (t) => {
  const {client, attempts} = clientOver([new Error('ECONNRESET'), {status: 200, data: {ok: true}}]);
  const data = await client.call('browse', {browseId: 'x'});
  t.deepEqual(data, {ok: true});
  t.is(attempts(), 2, 'it asked again rather than giving up');
});

test('a rate limit is waited out, once', async (t) => {
  const {client, attempts} = clientOver([
    {status: 429, headers: {'retry-after': '0'}},
    {status: 200, data: {ok: true}},
  ]);
  t.deepEqual(await client.call('search', {query: 'x'}), {ok: true});
  t.is(attempts(), 2);
});

test('a refusal is reported immediately', async (t) => {
  const {client, attempts} = clientOver([{status: 403}]);
  await t.throwsAsync(client.call('browse', {browseId: 'x'}));
  t.is(attempts(), 1, 'retrying a refusal only makes it firmer');
});

test('a service that stays down is reported rather than looped on', async (t) => {
  const {client, attempts} = clientOver([{status: 503}]);
  await t.throwsAsync(client.call('browse', {browseId: 'x'}));
  t.is(attempts(), 3, 'bounded');
});
