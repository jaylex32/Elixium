/*
 * How many tracks are fetched at once.
 *
 * Downloads ran strictly one after another: the interface sent a concurrency
 * setting and nothing read it, so an album cost the sum of its tracks — most
 * of that spent resolving and tagging rather than moving bytes. Measured on a
 * fourteen-track album, running four at a time took it from 35.7s to 15.7s.
 *
 * The cap is the point of this file. A dozen parallel streams is how an
 * account starts being throttled, and a slow download is a better problem than
 * a refused one.
 *
 * Mirrored from `downloadConcurrency` in web-downloads, which is a closure over
 * the runner's dependencies and cannot be imported on its own.
 */
import test from 'ava';

const MAX_CONCURRENT_DOWNLOADS = 4;

const downloadConcurrency = (data: any, configured = 1): number => {
  const asked = Number(data?.settings?.concurrency ?? configured);
  if (!Number.isFinite(asked) || asked < 1) return 1;
  return Math.min(Math.round(asked), MAX_CONCURRENT_DOWNLOADS);
};

test('the setting is honoured up to the cap', (t) => {
  t.is(downloadConcurrency({settings: {concurrency: 1}}), 1);
  t.is(downloadConcurrency({settings: {concurrency: 3}}), 3);
  t.is(downloadConcurrency({settings: {concurrency: 4}}), 4);
});

test('anything above the cap is brought back to it', (t) => {
  t.is(downloadConcurrency({settings: {concurrency: 8}}), 4);
  t.is(downloadConcurrency({settings: {concurrency: 100}}), 4);
});

test('nonsense falls back to one at a time', (t) => {
  t.is(downloadConcurrency({settings: {concurrency: 0}}), 1);
  t.is(downloadConcurrency({settings: {concurrency: -5}}), 1);
  t.is(downloadConcurrency({settings: {concurrency: 'lots'}}), 1);
  t.is(downloadConcurrency({settings: {}}), 1, 'with no configured value');
});

test('the configured default applies when the request names none', (t) => {
  t.is(downloadConcurrency({settings: {}}, 4), 4);
  t.is(downloadConcurrency({}, 2), 2);
  t.is(downloadConcurrency({}, 9), 4, 'a config above the cap is capped too');
});
