/*
 * Reading a cookies.txt export.
 *
 * This is how a YouTube session gets into Elixium, and it is the only route
 * that works from every browser — so the parser has to cope with what real
 * exporters actually emit rather than an idealised format. Every fixture here
 * is synthetic; no real session appears in this file.
 */
import test from 'ava';
import {cookieHeaderFromCookiesTxt, verifyYouTubeSession, CookiesTxtError} from '../src/core/ytmusic/cookies-txt';

/** ava types a thrown error as possibly undefined; this keeps assertions readable. */
const messageOf = (error: Error | undefined) => String(error?.message ?? '');

/** One tab-separated Netscape line. */
const line = (domain: string, name: string, value: string) =>
  [domain, 'TRUE', '/', 'TRUE', '1799999999', name, value].join('\t');

const withSession = [
  '# Netscape HTTP Cookie File',
  '# This is a generated file! Do not edit.',
  line('.youtube.com', 'SAPISID', 'sapisid-value'),
  line('.youtube.com', 'SID', 'sid-value'),
  line('.youtube.com', 'LOGIN_INFO', 'login-value'),
].join('\n');

test('a signed-in export becomes a Cookie header', (t) => {
  const summary = cookieHeaderFromCookiesTxt(withSession);
  t.regex(summary.cookie, /SAPISID=sapisid-value/);
  t.regex(summary.cookie, /SID=sid-value/);
  t.true(summary.names.includes('SAPISID'));
});

/*
 * The bug this file exists to prevent.
 *
 * The parser used to keep only a list of cookie names that looked like the
 * session and drop the rest. `__Secure-1PSIDTS` and `__Secure-3PSIDTS` were not
 * on that list, and Google binds a session to them — so a perfectly good export
 * was reduced to something YouTube answered `LOGGED_IN: false` for, and every
 * download failed telling the user to supply the cookie they had just supplied.
 * Verified against a real export: the whole jar authenticated, the filtered jar
 * did not, and restoring those two names alone fixed it.
 *
 * The lesson is not "add two names" — any list encodes a guess about what
 * Google requires this year. Nothing on a YouTube domain gets dropped now.
 */
test('the session timestamp cookies survive, which the old allowlist dropped', (t) => {
  const summary = cookieHeaderFromCookiesTxt(
    [
      '# Netscape HTTP Cookie File',
      line('.youtube.com', 'SAPISID', 'sapisid-value'),
      line('.youtube.com', 'SID', 'sid-value'),
      line('.youtube.com', '__Secure-1PSIDTS', 'sidts-one'),
      line('.youtube.com', '__Secure-3PSIDTS', 'sidts-three'),
      line('.youtube.com', '__Secure-1PSIDCC', 'sidcc-one'),
      line('.youtube.com', 'SIDCC', 'sidcc-plain'),
    ].join('\n'),
  );
  t.regex(summary.cookie, /__Secure-1PSIDTS=sidts-one/, 'Google binds the session to this');
  t.regex(summary.cookie, /__Secure-3PSIDTS=sidts-three/);
  t.regex(summary.cookie, /__Secure-1PSIDCC=sidcc-one/);
  t.regex(summary.cookie, /SIDCC=sidcc-plain/);
  t.is(summary.ignored, 0, 'nothing on a YouTube domain may be dropped');
});

test('a cookie name nobody has seen before is still kept', (t) => {
  // Whatever Google adds next must arrive intact without a code change here.
  const summary = cookieHeaderFromCookiesTxt(
    [withSession, line('.youtube.com', '__Secure-9PFUTURE', 'not-invented-yet')].join('\n'),
  );
  t.regex(summary.cookie, /__Secure-9PFUTURE=not-invented-yet/);
});

test('HttpOnly lines are read, not skipped as comments', (t) => {
  // The session cookies are all HttpOnly, so treating "#HttpOnly_" as a
  // comment would silently discard everything that matters.
  const summary = cookieHeaderFromCookiesTxt(
    ['# Netscape HTTP Cookie File', line('#HttpOnly_.youtube.com', 'SAPISID', 'httponly-value')].join('\n'),
  );
  t.regex(summary.cookie, /SAPISID=httponly-value/);
});

test('cookies for other sites are discarded', (t) => {
  const summary = cookieHeaderFromCookiesTxt(
    [withSession, line('.example.com', 'SAPISID', 'not-yours'), line('.bank.com', 'SESSION', 'private')].join('\n'),
  );
  t.notRegex(summary.cookie, /not-yours/, 'another site must never reach the header');
  t.notRegex(summary.cookie, /private/);
  t.is(summary.ignored, 2);
});

test('the youtube.com copy wins over the google.com one', (t) => {
  const summary = cookieHeaderFromCookiesTxt(
    [
      '# Netscape HTTP Cookie File',
      line('.google.com', 'SAPISID', 'google-copy'),
      line('.youtube.com', 'SAPISID', 'youtube-copy'),
    ].join('\n'),
  );
  t.regex(summary.cookie, /SAPISID=youtube-copy/);
  t.notRegex(summary.cookie, /google-copy/);
});

test('a signed-out export is refused with an actionable reason', (t) => {
  const error = t.throws(
    () =>
      cookieHeaderFromCookiesTxt(
        [
          '# Netscape HTTP Cookie File',
          line('.youtube.com', 'VISITOR_INFO1_LIVE', 'anon'),
          line('.youtube.com', 'YSC', 'x'),
        ].join('\n'),
      ),
    {instanceOf: CookiesTxtError},
  );
  t.regex(messageOf(error), /Sign in to youtube\.com first/);
});

test('a file that is not cookies.txt says so', (t) => {
  const error = t.throws(() => cookieHeaderFromCookiesTxt('just some text\nand another line'), {
    instanceOf: CookiesTxtError,
  });
  t.regex(messageOf(error), /does not look like a cookies\.txt/);
});

test('an empty file is refused', (t) => {
  t.throws(() => cookieHeaderFromCookiesTxt('   '), {instanceOf: CookiesTxtError});
});

test('space-separated exports are accepted too', (t) => {
  // Not every extension emits tabs.
  const spaced = ['# Netscape HTTP Cookie File', '.youtube.com TRUE / TRUE 1799999999 SAPISID spaced-value'].join('\n');
  t.regex(cookieHeaderFromCookiesTxt(spaced).cookie, /SAPISID=spaced-value/);
});

test('CRLF line endings are handled', (t) => {
  t.regex(cookieHeaderFromCookiesTxt(withSession.replace(/\n/g, '\r\n')).cookie, /SAPISID=sapisid-value/);
});

/*
 * Verifying that an import is really a signed-in session.
 *
 * A cookies.txt can carry every cookie by name — SAPISID included — and still
 * be signed out, because the values rotate and an export taken from a profile
 * that was not signed in is indistinguishable from a good one by inspection.
 * That exact case cost an afternoon: the file parsed, the header was built,
 * the signature was correct, and YouTube reported the session as signed out.
 * These pin the check that now says so at import time rather than letting the
 * first failed download deliver the news.
 */

test('a signed-out session is reported as signed out', async (t) => {
  const result = await verifyYouTubeSession('SAPISID=x', async () => '{"LOGGED_IN":false}');
  t.deepEqual(result, {signedIn: false});
});

test('a signed-in session is reported with the account name', async (t) => {
  const result = await verifyYouTubeSession('SAPISID=x', async () => '{"LOGGED_IN":true,"accountName":"Real Person"}');
  t.deepEqual(result, {signedIn: true, account: 'Real Person'});
});

test('a signed-in session without a readable name is still signed in', async (t) => {
  const result = await verifyYouTubeSession('SAPISID=x', async () => '{"LOGGED_IN":true}');
  t.deepEqual(result, {signedIn: true});
});

test('a network failure is not mistaken for a bad cookie', async (t) => {
  const result = await verifyYouTubeSession('SAPISID=x', async () => {
    throw new Error('offline');
  });
  t.is(result, null, 'a failed check must not accuse the cookie');
});

test('a page that says neither is inconclusive rather than false', async (t) => {
  t.is(await verifyYouTubeSession('SAPISID=x', async () => '<html>something else</html>'), null);
  t.is(await verifyYouTubeSession('SAPISID=x', async () => ''), null);
});
