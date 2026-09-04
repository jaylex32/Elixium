/*
 * A completed download must not be reported as a failure.
 *
 * The playlist file needs paths in the casing the filesystem really uses, and
 * looking that up walks the directory tree. On Android that walk throws:
 * external storage is a FUSE mount that refuses listing even where writing is
 * allowed. Because the lookup ran after the file had been written but inside
 * the same try, every track arrived on disk and every track was reported as
 * having failed — which is worse than a real failure, because it leaves no way
 * to tell what actually downloaded.
 */

import test from 'ava';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {safeTrueCasePath} from '../src/lib/util';

test('a path that cannot be walked comes back unchanged rather than throwing', (t) => {
  const unreachable = '/storage/emulated/0/Music/Elixium/Deezer/Music/Album/Track.mp3';
  t.is(safeTrueCasePath(unreachable), unreachable);
});

test('a real file still resolves', (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'elixium-tcp-')), 'Track.mp3');
  fs.writeFileSync(file, 'x');

  const resolved = safeTrueCasePath(file);
  /* Case may be corrected on Windows and macOS, so compare case-insensitively. */
  t.is(resolved.toLowerCase(), file.toLowerCase());

  fs.rmSync(path.dirname(file), {recursive: true, force: true});
});

test('nothing on the way to a missing file throws', (t) => {
  for (const candidate of ['', '   ', 'relative/path.mp3', '/does/not/exist/at/all.flac']) {
    t.notThrows(() => safeTrueCasePath(candidate));
  }
});
