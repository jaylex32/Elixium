/*
 * Reading Qobuz's app id and signing secrets out of their web player.
 *
 * This is the part that silently rotted: Qobuz restructured their bundle, the
 * regex stopped matching, `get_app_id()` returned null, and that null was
 * written into the config and dereferenced — so Qobuz was dead on every fresh
 * install and the symptom was an internal-looking crash.
 *
 * These tests pin the layouts we know about against fixtures, so the next time
 * Qobuz changes shape it fails here rather than on a user's machine. No test
 * reaches the network: the HTTP client is injected.
 */
import test from 'ava';
import {QobuzSpoofer} from '../src/core/qobuz/spoofer';

/** The environment map Qobuz's bundle carries today, trimmed to what is read. */
const CURRENT_BUNDLE =
  'var s=(0,r(54549).getSoftwareVersionParts)(),l={appName:"Qobuz Web Player"},' +
  'c={integration:{api:{appId:"377257687",appSecret:"f686f063cb0841079d48495d4dea7cf2"},braze:u,extra:l},' +
  'nightly:{api:{appId:"377257687",appSecret:"05a4851e74ee47fda346f50cfdfc4f09"},braze:u,extra:l},' +
  'recette:{api:{appId:"724307056",appSecret:"05a4851e74ee47fda346f50cfdfc4f09"},braze:u,extra:l},' +
  'beta:{api:{appId:"XXXXX",appSecret:"XXXXX"},braze:u,extra:l},' +
  'production:{api:{appId:"798273057",appSecret:"05a4851e74ee47fda346f50cfdfc4f09"},braze:o,extra:l}};' +
  'var d=window.__ENVIRONMENT__;t.default=c[d]||null;';

/** The layout Qobuz used before, kept working as a fallback. */
const LEGACY_BUNDLE =
  'x={app_id:"950096963",app_secret:"979549437fcc4a3faad4867b5cd25dcb",base_port:"80",' +
  'base_url:"https://www.qobuz.com",base_method:"/api.json/0.2/"},n.base_url="https://play.qobuz.com"';

/** Build a spoofer with a bundle already in place, so init() is not needed. */
const spooferWith = (bundle: string) => {
  const spoofer = new QobuzSpoofer();
  spoofer.bundle = bundle;
  return spoofer;
};

test('the production app id is read from the current bundle', (t) => {
  const spoofer = spooferWith(CURRENT_BUNDLE);
  t.is(spoofer.get_app_id(), 798273057);
});

test('production is chosen over the other environments', (t) => {
  // integration and nightly appear first in the bundle; taking the first match
  // would hand out a staging app id that real accounts cannot authenticate to.
  const spoofer = spooferWith(CURRENT_BUNDLE);
  t.is(spoofer.get_app_id(), 798273057);
  t.not(spoofer.get_app_id(), 377257687);
  t.not(spoofer.get_app_id(), 724307056);
});

test('the secret published beside the app id is captured', (t) => {
  const spoofer = spooferWith(CURRENT_BUNDLE);
  spoofer.get_app_id();
  t.is(spoofer.app_secret, '05a4851e74ee47fda346f50cfdfc4f09');
});

test('the published secret is offered first, ahead of derived ones', (t) => {
  const spoofer = spooferWith(CURRENT_BUNDLE);
  const secrets = spoofer.get_secrets();
  t.true(secrets.length >= 1);
  t.is(secrets[0], '05a4851e74ee47fda346f50cfdfc4f09');
});

test('the previous bundle layout still works', (t) => {
  const spoofer = spooferWith(LEGACY_BUNDLE);
  t.is(spoofer.get_app_id(), 950096963);
});

test('a bundle in neither known layout yields null rather than a wrong id', (t) => {
  const spoofer = spooferWith('window.somethingEntirelyDifferent = true;');
  t.is(spoofer.get_app_id(), null, 'null is the signal to fail loudly, not a value to pass on');
});

test('the app id is read once and cached', (t) => {
  const spoofer = spooferWith(CURRENT_BUNDLE);
  t.is(spoofer.get_app_id(), 798273057);
  spoofer.bundle = 'the bundle changed underneath us';
  t.is(spoofer.get_app_id(), 798273057);
});

test('secrets never contain duplicates', (t) => {
  const spoofer = spooferWith(CURRENT_BUNDLE);
  const secrets = spoofer.get_secrets();
  t.is(new Set(secrets).size, secrets.length);
});

test('the bundle fetch is bounded and uses the injected client', async (t) => {
  const calls: string[] = [];
  const fake = {
    get: async (url: string) => {
      calls.push(url);
      if (url.endsWith('/login')) {
        return {data: '<script src="/resources/7.1.3-b002/bundle.js"></script>'};
      }
      return {data: CURRENT_BUNDLE};
    },
  };

  const spoofer = new QobuzSpoofer(fake as never);
  await spoofer.init();

  t.deepEqual(calls, ['https://play.qobuz.com/login', 'https://play.qobuz.com/resources/7.1.3-b002/bundle.js']);
  t.is(spoofer.get_app_id(), 798273057);
});

test('a login page without a bundle link fails with a clear error', async (t) => {
  const fake = {get: async () => ({data: '<html>maintenance</html>'})};
  const spoofer = new QobuzSpoofer(fake as never);
  await t.throwsAsync(spoofer.init(), {message: /Failed to fetch Qobuz API data/});
});

test('a hanging fetch is the client’s concern, and the client carries a timeout', (t) => {
  // The default client is the one used in production; the point of the change
  // was that it is no longer the bare axios default, which had no timeout and
  // could wait forever on a nine-megabyte download.
  const spoofer = new QobuzSpoofer();
  const http = (spoofer as unknown as {http: {defaults?: {timeout?: number}}}).http;
  t.true(typeof http.defaults?.timeout === 'number' && (http.defaults?.timeout ?? 0) > 0);
});
