/*
 * Keeping a YouTube session alive as Google rotates it.
 *
 * Every value here is invented. The behaviour being pinned is the one that cost
 * an hour of misdiagnosis: an imported session works, then quietly stops,
 * because Google reissues the short-lived half of it on ordinary responses and
 * we kept replaying the values from the original export. It presents as YouTube
 * refusing requests, which is why it got blamed on rate limiting.
 *
 * The second half of the behaviour matters just as much. A response that is
 * signing us out also carries Set-Cookie lines, and honouring those would
 * destroy a working session on the strength of one bad reply.
 */
import test from 'ava';
import {mergeSetCookie, parseCookieHeader, renderCookieHeader, ROTATING_COOKIES} from '../src/core/ytmusic/cookie-jar';

const session = 'SID=sid-value; SAPISID=sapisid-value; __Secure-1PSIDTS=old-ts; SIDCC=old-cc';

test('a cookie header round-trips through the jar unchanged', (t) => {
  t.is(renderCookieHeader(parseCookieHeader(session)), session);
});

test('a header with odd spacing and empty segments still parses', (t) => {
  const jar = parseCookieHeader('  A=1 ;; B=2;  ; C=3  ');
  t.deepEqual(
    [...jar.entries()],
    [
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
    ],
  );
});

test('a rotated timestamp cookie replaces the stored one', (t) => {
  const merged = mergeSetCookie(session, ['__Secure-1PSIDTS=new-ts; Path=/; Secure; HttpOnly']);
  t.truthy(merged);
  t.regex(merged as string, /__Secure-1PSIDTS=new-ts/);
  t.regex(merged as string, /SID=sid-value/, 'the rest of the session must survive');
});

test('every cookie Google rotates is accepted', (t) => {
  const lines = ROTATING_COOKIES.map((name) => `${name}=rotated-${name}; Secure`);
  const merged = mergeSetCookie(session, lines) as string;
  for (const name of ROTATING_COOKIES) t.regex(merged, new RegExp(`${name.replace(/\$/g, '\\$')}=rotated-`));
});

/*
 * The dangerous case.
 *
 * A signed-out response reissues the credentials themselves as throwaway
 * values. Storing those would replace a working session with a broken one, and
 * the next request would fail for a reason that had nothing to do with the
 * session we started with.
 */
test('a response reissuing the core session cookies is ignored', (t) => {
  const merged = mergeSetCookie(session, [
    'SID=throwaway; Secure',
    'SAPISID=throwaway; Secure',
    'LOGIN_INFO=; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]);
  t.is(merged, null, 'nothing here may be persisted');
});

test('a deletion is never mistaken for a rotation', (t) => {
  t.is(mergeSetCookie(session, ['__Secure-1PSIDTS=; Expires=Thu, 01 Jan 1970 00:00:00 GMT']), null);
  t.is(mergeSetCookie(session, ['__Secure-1PSIDTS=EXPIRED; Secure']), null);
});

test('an unchanged value does not count as a rotation', (t) => {
  // The caller rewrites its configuration on a non-null result, so an
  // unchanged session must report nothing rather than churn the file.
  t.is(mergeSetCookie(session, ['__Secure-1PSIDTS=old-ts; Secure']), null);
});

test('no Set-Cookie at all is not a change', (t) => {
  t.is(mergeSetCookie(session, undefined), null);
  t.is(mergeSetCookie(session, []), null);
});

test('malformed Set-Cookie lines are skipped rather than stored', (t) => {
  t.is(mergeSetCookie(session, ['', '   ', 'novalue', '=leading-equals']), null);
});

test('a rotation arriving alongside a sign-out still takes only the rotation', (t) => {
  const merged = mergeSetCookie(session, [
    'SID=throwaway; Secure',
    '__Secure-3PSIDTS=fresh; Secure',
    'LOGIN_INFO=; Max-Age=0',
  ]) as string;
  t.regex(merged, /__Secure-3PSIDTS=fresh/);
  t.regex(merged, /SID=sid-value/, 'the real credential must be untouched');
  t.notRegex(merged, /throwaway/);
});
