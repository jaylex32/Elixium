/*
 * The account's licence must follow the session it was read under.
 *
 * `getTrackUrlFromServer` refuses MP3_320 and FLAC up front when the account
 * is not licensed for them, which is right — but the licence was read once per
 * process and cached forever. The first read can happen before the ARL session
 * exists: playing a track moments after launch resolves a URL while the login
 * is still in flight, and an anonymous session reports no HQ and no lossless.
 *
 * From then on every 320 request threw WrongLicense, the downloader's ladder
 * stepped down, and a premium account received 128kbps files for the rest of
 * the process — labelled 320, because the request had asked for it. Pasting a
 * new ARL did not help either: the stale answer outlived the new session.
 *
 * No network: the shared client and axios.head are stubbed.
 */
import test from 'ava';
import axios from 'axios';
import instance from '../src/core/deezer/lib/request';
import {getTrackDownloadUrl} from '../src/core/deezer/lib/get-url';
import type {trackType} from '../src/core/deezer/types';
import {deezerFormatCode, deezerFormatFallbacks} from '../src/app/api/quality';

const track = {
  SNG_ID: '1',
  TRACK_TOKEN: 'token',
  MD5_ORIGIN: '',
  FILESIZE_MP3_320: '1000',
} as unknown as trackType;

/** How many times the licence was actually asked for. */
let licenceReads = 0;

/** What the account is entitled to, as the current session reports it. */
let entitled = {hq: false, lossless: false};

const install = () => {
  licenceReads = 0;
  (instance as any).get = async () => {
    licenceReads += 1;
    return {
      data: {
        results: {
          USER: {
            OPTIONS: {
              license_token: 'lt',
              web_hq: entitled.hq,
              mobile_hq: entitled.hq,
              web_lossless: entitled.lossless,
              mobile_loseless: entitled.lossless,
            },
          },
          COUNTRY: 'US',
        },
      },
    };
  };
  (instance as any).post = async () => ({
    data: {data: [{media: [{sources: [{url: 'https://cdn.example/media/track'}]}]}]},
  });
  (axios as any).head = async () => ({headers: {'content-length': '5000000'}});
};

const setSession = (sid: string) => {
  (instance.defaults.params as Record<string, unknown>).sid = sid;
};

test.serial('a licence read before login does not condemn the session that follows', async (t) => {
  install();

  // Before login: no session, and an anonymous account has no HQ.
  setSession('');
  entitled = {hq: false, lossless: false};
  await t.throwsAsync(getTrackDownloadUrl(track, 3), {message: /can't stream MP3_320/});

  // The ARL session lands, and this account is premium.
  setSession('a-real-session');
  entitled = {hq: true, lossless: true};

  const resolved = await getTrackDownloadUrl(track, 3);
  t.truthy(resolved, 'a premium account must get its 320 stream');
  t.true(licenceReads >= 2, 'the licence is re-read for the new session, not remembered from the old one');
});

test.serial('a login that completes mid-read does not get the old account filed under it', async (t) => {
  install();

  /*
   * The race the session stamp exists for: the licence request is in flight
   * when the ARL login lands. Recording the session in force on *return* would
   * file the anonymous account's answer under the premium session that
   * replaced it — the same staleness, now wearing the right name.
   */
  setSession('');
  entitled = {hq: false, lossless: false};

  const original = (instance as any).get;
  (instance as any).get = async (...args: unknown[]) => {
    const result = await original(...args);
    setSession('premium-session'); // login completes while this is in flight
    return result;
  };

  await t.throwsAsync(getTrackDownloadUrl(track, 3), {message: /can't stream MP3_320/});

  (instance as any).get = original;
  entitled = {hq: true, lossless: true};

  const resolved = await getTrackDownloadUrl(track, 3);
  t.truthy(resolved, 'the new session is read afresh rather than trusted from the old one');
});

test.serial('a free account is refused the paid tiers and served the free one', async (t) => {
  install();
  setSession('free-session');
  entitled = {hq: false, lossless: false};

  /*
   * Refusal is what the downloader's ladder listens for: FLAC steps to 320,
   * 320 steps to 128. If these resolved instead of throwing, a free account
   * would be handed a URL it cannot play.
   */
  await t.throwsAsync(getTrackDownloadUrl(track, 9), {message: /can't stream FLAC/});
  await t.throwsAsync(getTrackDownloadUrl(track, 3), {message: /can't stream MP3_320/});

  /* 128 is the one tier Deezer never licence-gates, so it must still resolve. */
  const resolved = await getTrackDownloadUrl(track, 1);
  t.truthy(resolved, 'a free account still gets its 128kbps stream');
});

test.serial('a premium account is refused nothing', async (t) => {
  install();
  setSession('premium-session');
  entitled = {hq: true, lossless: true};

  for (const quality of [9, 3, 1]) {
    t.truthy(await getTrackDownloadUrl(track, quality), `quality ${quality} resolves`);
  }
});

test.serial('the licence is not re-read on every track within one session', async (t) => {
  install();
  setSession('one-session');
  entitled = {hq: true, lossless: true};

  await getTrackDownloadUrl(track, 3);
  const afterFirst = licenceReads;
  await getTrackDownloadUrl(track, 3);
  await getTrackDownloadUrl(track, 3);

  t.is(licenceReads, afterFirst, 'still cached while the session is unchanged');
});

/*
 * The quality a caller names must be the quality they get.
 *
 * Deezer's own format names are what the interface stores and what the
 * documented API accepts, and MP3_320 was not among the strings this
 * understood — it fell through to the default, which was 128. A request for
 * the higher tier quietly produced the lower one, written under a .mp3 name
 * that gave nothing away.
 */
test('a Deezer quality maps to the format that was asked for', (t) => {
  t.is(deezerFormatCode('FLAC'), 9);
  t.is(deezerFormatCode('flac'), 9);
  t.is(deezerFormatCode('lossless'), 9);

  t.is(deezerFormatCode('320'), 3);
  t.is(deezerFormatCode('320kbps'), 3);
  t.is(deezerFormatCode('MP3_320'), 3, 'the name the interface stores');

  t.is(deezerFormatCode('128'), 1);
  t.is(deezerFormatCode('128kbps'), 1);
  t.is(deezerFormatCode('MP3_128'), 1, 'asking for 128 still gives 128');
});

test('an unrecognised quality keeps the tier that always works', (t) => {
  /*
   * Deliberately unchanged. Two callers resolve a single format with no ladder
   * beneath them, and 128 is the one tier Deezer never licence-gates — raising
   * this would turn a working download into a refusal for a free account.
   */
  t.is(deezerFormatCode('something-new'), 1);
  t.is(deezerFormatCode(''), 1);
});

test('the fallback ladder descends from what was asked for', (t) => {
  t.deepEqual(deezerFormatFallbacks('MP3_320'), [3, 1]);
  t.deepEqual(deezerFormatFallbacks('FLAC'), [9, 3, 1]);
  t.deepEqual(deezerFormatFallbacks('MP3_128'), [1]);
});
