/*
 * The folder a playlist file is written into.
 *
 * Derived from where the tracks landed, so it has to be a folder that exists.
 * Comparing the paths as strings returns the longest shared prefix, which can
 * stop in the middle of a name — "Justin Quiles & Lenny Tavárez" and "Justin
 * Quiles" share "Justin Quiles" — and writing there fails with ENOENT because
 * no such folder was ever created. A playlist spanning several artists is
 * exactly when that happens, and exactly when a playlist file is most useful.
 */
import test from 'ava';
import {commonPath} from '../src/lib/util';

const BACKSLASH = String.fromCharCode(92);
const win = (...parts: string[]) => parts.join(BACKSLASH);

test('paths in one folder give that folder', (t) => {
  t.is(
    commonPath(['/music/Daft Punk/Discovery/1.opus', '/music/Daft Punk/Discovery/2.opus']),
    '/music/Daft Punk/Discovery',
  );
});

test('paths in sibling folders give the parent', (t) => {
  t.is(commonPath(['/music/A/x.opus', '/music/B/y.opus']), '/music');
});

/*
 * The bug this exists to prevent: one artist's name being a prefix of
 * another's, which cut the result mid-name and produced a folder that had
 * never been created.
 */
test('a name that is a prefix of another does not truncate the folder', (t) => {
  t.is(
    commonPath(['/music/Justin Quiles & Lenny Tavarez/A/1.opus', '/music/Justin Quiles/B/2.opus']),
    '/music',
    'the shared prefix stops mid-name, so it must fall back to the parent',
  );
});

test('windows separators are cut the same way', (t) => {
  t.is(commonPath([win('C:', 'M', 'Ann Lee', 'a.mp3'), win('C:', 'M', 'Anna', 'b.mp3')]), win('C:', 'M'));
});

test('a single path gives its own folder path unchanged', (t) => {
  t.is(commonPath(['/music/One/two.opus']), '/music/One/two.opus');
});

test('nothing in gives nothing out', (t) => {
  t.is(commonPath([]), '');
});
