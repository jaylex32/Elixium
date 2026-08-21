/*
 * Signing in with an email address and password.
 *
 * Neither service documents these endpoints, so the shapes here are pinned
 * against recorded responses. The point of the tests is less "does the happy
 * path work" — that needs a real account — and more that every failure is
 * reported as the thing that actually went wrong. Telling somebody their
 * password is wrong when their account has no password at all is how support
 * threads start.
 *
 * No test reaches the network: the HTTP client is injected.
 */
import test from 'ava';
import crypto from 'crypto';
import {loginToDeezer, loginToQobuz, LoginError} from '../src/app/account-login';

const md5 = (value: string) => crypto.createHash('md5').update(value, 'utf8').digest('hex');

/** A fake axios whose responses are chosen by URL. */
const clientOf = (routes: Record<string, unknown>, record?: Array<{url: string; config: any}>) =>
  ({
    get: async (url: string, config: any) => {
      record?.push({url, config});
      const key = Object.keys(routes).find((route) => url.includes(route));
      if (!key) throw Object.assign(new Error('unexpected url ' + url), {code: 'ENOTFOUND'});
      const value = routes[key];
      if (value instanceof Error) throw value;
      return value;
    },
  } as never);

// ── Deezer ───────────────────────────────────────────────────────────────────

const deezerHappyPath = {
  'auth.deezer.com': {status: 200, data: {access_token: 'access-123'}},
  'api.deezer.com': {status: 200, data: {}, headers: {'set-cookie': ['sid=session-abc; Path=/; HttpOnly']}},
  'gw-light.php': {status: 200, data: {results: 'the-arl-value'}},
};

test('a Deezer sign-in returns the ARL', async (t) => {
  const result = await loginToDeezer('someone@example.com', 'hunter2', clientOf(deezerHappyPath));
  t.is(result.arl, 'the-arl-value');
});

test('the Deezer password is hashed, never sent in the clear', async (t) => {
  const calls: Array<{url: string; config: any}> = [];
  await loginToDeezer('someone@example.com', 'hunter2', clientOf(deezerHappyPath, calls));

  const auth = calls.find((call) => call.url.includes('auth.deezer.com'));
  t.is(auth?.config.params.password, md5('hunter2'));
  t.not(auth?.config.params.password, 'hunter2');
  t.is(JSON.stringify(calls).includes('hunter2'), false, 'the raw password must not appear in any request');
});

test('the Deezer request carries the signature the endpoint requires', async (t) => {
  const calls: Array<{url: string; config: any}> = [];
  await loginToDeezer('someone@example.com', 'hunter2', clientOf(deezerHappyPath, calls));

  const auth = calls.find((call) => call.url.includes('auth.deezer.com'));
  const expected = md5(`447462someone@example.com${md5('hunter2')}a83bf7f38ad2f137e444727cfc3775cf`);
  t.is(auth?.config.params.hash, expected);
});

test('a wrong Deezer password is reported as wrong credentials', async (t) => {
  const error = (await t.throwsAsync(
    loginToDeezer(
      'someone@example.com',
      'wrong',
      clientOf({'auth.deezer.com': {status: 200, data: {error: {type: 'invalid_credentials'}}}}),
    ),
  )) as LoginError;
  t.is(error.stage, 'credentials');
  t.regex(error.message, /did not accept/);
});

test('a captcha challenge is reported as unsupported, not as a bad password', async (t) => {
  const error = (await t.throwsAsync(
    loginToDeezer(
      'someone@example.com',
      'hunter2',
      clientOf({'auth.deezer.com': {status: 200, data: {error: {type: 'captcha_needed'}}}}),
    ),
  )) as LoginError;
  t.is(error.stage, 'unsupported');
  t.regex(error.message, /captcha/i);
  t.regex(error.message, /paste your ARL/i, 'the reader needs the way forward, not just the refusal');
});

test('a social-login account is told it has no password', async (t) => {
  const error = (await t.throwsAsync(
    loginToDeezer(
      'someone@example.com',
      'hunter2',
      clientOf({'auth.deezer.com': {status: 200, data: {error: {type: 'social_account'}}}}),
    ),
  )) as LoginError;
  t.is(error.stage, 'unsupported');
  t.regex(error.message, /Google, Facebook or Apple/);
});

test('a missing session cookie is reported as a service problem, not a credential one', async (t) => {
  const error = (await t.throwsAsync(
    loginToDeezer(
      'someone@example.com',
      'hunter2',
      clientOf({
        'auth.deezer.com': {status: 200, data: {access_token: 'access-123'}},
        'api.deezer.com': {status: 200, data: {}, headers: {}},
      }),
    ),
  )) as LoginError;
  t.is(error.stage, 'service');
});

test('a session that yields no ARL is reported as a service problem', async (t) => {
  const error = (await t.throwsAsync(
    loginToDeezer(
      'someone@example.com',
      'hunter2',
      clientOf({...deezerHappyPath, 'gw-light.php': {status: 200, data: {results: ''}}}),
    ),
  )) as LoginError;
  t.is(error.stage, 'service');
  t.regex(error.message, /paste it in Settings/);
});

test('an unreachable Deezer is reported as a network problem', async (t) => {
  const offline = Object.assign(new Error('getaddrinfo ENOTFOUND auth.deezer.com'), {code: 'ENOTFOUND'});
  const error = (await t.throwsAsync(
    loginToDeezer('someone@example.com', 'hunter2', clientOf({'auth.deezer.com': offline})),
  )) as LoginError;
  t.is(error.stage, 'network');
});

test('empty Deezer fields are refused before any request is made', async (t) => {
  const calls: Array<{url: string; config: any}> = [];
  const error = (await t.throwsAsync(loginToDeezer('  ', 'hunter2', clientOf({}, calls)))) as LoginError;
  t.is(error.stage, 'credentials');
  t.is(calls.length, 0, 'no point asking Deezer about an empty email address');
});

// ── Qobuz ────────────────────────────────────────────────────────────────────

const qobuzHappyPath = {
  'user/login': {
    status: 200,
    data: {user_auth_token: 'qobuz-token-123', user: {credential: {parameters: {label: 'Studio'}}}},
  },
};

test('a Qobuz sign-in returns the token and the app id it belongs to', async (t) => {
  const result = await loginToQobuz('someone@example.com', 'hunter2', 798273057, clientOf(qobuzHappyPath));
  t.is(result.token, 'qobuz-token-123');
  t.is(result.appId, 798273057, 'the token is only valid with this id, so they travel together');
});

test('the Qobuz password is hashed — sending it raw is why this used to fail', async (t) => {
  const calls: Array<{url: string; config: any}> = [];
  await loginToQobuz('someone@example.com', 'hunter2', 798273057, clientOf(qobuzHappyPath, calls));
  t.is(calls[0].config.params.password, md5('hunter2'));
  t.is(calls[0].config.params.app_id, 798273057);
});

test('a rejected Qobuz login is reported as wrong credentials', async (t) => {
  const error = (await t.throwsAsync(
    loginToQobuz('someone@example.com', 'wrong', 798273057, clientOf({'user/login': {status: 401, data: {}}})),
  )) as LoginError;
  t.is(error.stage, 'credentials');
});

test('a free Qobuz account is told downloads will not work, but browsing will', async (t) => {
  const error = (await t.throwsAsync(
    loginToQobuz(
      'someone@example.com',
      'hunter2',
      798273057,
      clientOf({'user/login': {status: 200, data: {user_auth_token: 'tok', user: {}}}}),
    ),
  )) as LoginError;
  t.is(error.stage, 'unsupported');
  t.regex(error.message, /no streaming subscription/);
  t.regex(error.message, /browsing will/, 'the account is not useless, and saying so avoids a wrong conclusion');
});

test('signing in without an app id is refused rather than sent', async (t) => {
  const calls: Array<{url: string; config: any}> = [];
  const error = (await t.throwsAsync(
    loginToQobuz('someone@example.com', 'hunter2', Number.NaN, clientOf({}, calls)),
  )) as LoginError;
  t.is(error.stage, 'service');
  t.is(calls.length, 0);
});

test('an unreachable Qobuz is reported as a network problem', async (t) => {
  const offline = Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'});
  const error = (await t.throwsAsync(
    loginToQobuz('someone@example.com', 'hunter2', 798273057, clientOf({'user/login': offline})),
  )) as LoginError;
  t.is(error.stage, 'network');
});
