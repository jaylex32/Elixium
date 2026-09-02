/*
 * What the per-item quality menu offers must be something the engine accepts.
 *
 * The menu sends its `value` straight to the downloader, so a label that maps
 * to nothing would download silently at the wrong tier — the exact failure
 * this area has just been through, where MP3_320 fell through to 128 because
 * no one had listed it.
 *
 * The values are mirrored here rather than imported: they live in the
 * interface project, which builds under its own config and its own path
 * aliases. Mirroring keeps the check in the suite that runs on every release;
 * the cost is that this list and `qualityChoicesFor` have to agree, which is
 * what the first assertion is for.
 */
import test from 'ava';
import {deezerFormatCode, deezerFormatFallbacks} from '../src/app/api/quality';

/** Copied from elixium-ui/src/shared/lib/download-quality.ts */
const MENU = {
  deezer: ['FLAC', 'MP3_320', 'MP3_128'],
  qobuz: ['27', '7', '6', '5'],
  ytmusic: ['opus', 'aac'],
};

test('every Deezer choice resolves to the format it names', (t) => {
  t.deepEqual(MENU.deezer.map(deezerFormatCode), [9, 3, 1], 'lossless, 320, 128 — in that order');
});

test('the paid tiers are recognised rather than falling through', (t) => {
  /*
   * Falling through is how this broke: MP3_320 was not listed, so it took the
   * default and became 128. Asking for 128 and getting 128 is indistinguishable
   * from falling through, and correct either way — it is the tiers above it
   * that have to be recognised in their own right.
   */
  const fallthrough = deezerFormatCode('a-value-nobody-recognises');
  t.not(deezerFormatCode('FLAC'), fallthrough);
  t.not(deezerFormatCode('MP3_320'), fallthrough, 'the bug that shipped');
});

test('choosing a lower tier does not offer to climb back up', (t) => {
  /* Asking for 128 explicitly means 128, not "128 or better". */
  t.deepEqual(deezerFormatFallbacks('MP3_128'), [1]);
  t.deepEqual(deezerFormatFallbacks('MP3_320'), [3, 1]);
  t.deepEqual(deezerFormatFallbacks('FLAC'), [9, 3, 1]);
});

test('Deezer offers only the tiers Deezer serves', (t) => {
  /* Asked directly, it reports nothing for MP3_64, MP3_256, AAC_64 or its 360
     Reality Audio formats, so offering them would be offering nothing. */
  t.is(MENU.deezer.length, 3);
});

test('the other services keep their own vocabularies', (t) => {
  t.true(MENU.qobuz.includes('27'), 'hi-res');
  t.true(MENU.qobuz.includes('5'), 'mp3');
  t.deepEqual(MENU.ytmusic, ['opus', 'aac'], 'containers, not bitrates');
});
