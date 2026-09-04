/*
 * Which release date ends up in the tags.
 *
 * Deezer's public album endpoint reports the date the release arrived on the
 * service, so anything reissued is tagged with the reissue. A 1973 record that
 * reached streaming in 2011 was filed under 2011, next to music made four
 * decades later, which is wrong in the one way a library owner notices.
 *
 * The private payload carries the physical and original dates beside it, and
 * those are what a listener means by "what year is this from".
 */

import test from 'ava';
import {bestReleaseDate} from '../src/lib/metadata-extra';

test('a reissue keeps the year it was originally released', (t) => {
  const track = {PHYSICAL_RELEASE_DATE: '1973-03-01'};
  const album = {release_date: '2011-09-26'};
  t.is(bestReleaseDate(track, album), '1973-03-01');
});

test('the original release date wins over the physical one', (t) => {
  const track = {ORIGINAL_RELEASE_DATE: '1968-06-01', PHYSICAL_RELEASE_DATE: '1972-01-01'};
  t.is(bestReleaseDate(track, {release_date: '2015-01-01'}), '1968-06-01');
});

test('the album carries the date when the track does not', (t) => {
  t.is(bestReleaseDate({}, {PHYSICAL_RELEASE_DATE: '1994-04-05'}), '1994-04-05');
});

test('falls back to what was used before', (t) => {
  t.is(bestReleaseDate({}, {release_date: '2020-02-14'}), '2020-02-14');
});

test('a placeholder date is refused rather than tagged as year 0', (t) => {
  /* Deezer answers 0000-00-00 for a release it has no date for. */
  t.is(bestReleaseDate({PHYSICAL_RELEASE_DATE: '0000-00-00'}, {release_date: '2019-07-01'}), '2019-07-01');
  t.is(bestReleaseDate({PHYSICAL_RELEASE_DATE: '0000-00-00'}, {release_date: '0000-00-00'}), null);
});

test('malformed and missing values are skipped, not written', (t) => {
  t.is(bestReleaseDate({PHYSICAL_RELEASE_DATE: ''}, {release_date: '1999-12-31'}), '1999-12-31');
  t.is(bestReleaseDate({PHYSICAL_RELEASE_DATE: '1999'}, {release_date: '2001-05-05'}), '2001-05-05');
  t.is(bestReleaseDate(null, null), null);
  t.is(bestReleaseDate(undefined, {}), null);
});
