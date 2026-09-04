/*
 * Which tags get written.
 *
 * ReplayGain is the reason this exists. Deezer reports a loudness figure on
 * every track — around -12 dB is common — and a player that honours it plays
 * the file that much quieter than a copy from a source that writes no gain.
 * Nothing about the audio differs, but quieter is reliably heard as worse, and
 * people conclude the download is poor. It is off by default now.
 *
 * Every other default matches what was written before, so a library keeps
 * being tagged the way it always was.
 */
import test from 'ava';
import {
  DEFAULT_METADATA_OPTIONS,
  metadataOptionsFrom,
  metadataSettingsFrom,
  SUPPORTED_TAGS,
} from '../src/lib/metadata-options';

test('ReplayGain is off, and it is the only thing that changed', (t) => {
  t.false(DEFAULT_METADATA_OPTIONS.replayGain);

  /* Everything previously written unconditionally still is. */
  for (const key of [
    'isrc',
    'barcode',
    'label',
    'copyright',
    'explicit',
    'credits',
    'provenance',
    'releaseType',
    'compilation',
    'media',
  ] as const) {
    t.true(DEFAULT_METADATA_OPTIONS[key], `${key} still written by default`);
  }
});

test('the additions are opt-in', (t) => {
  /* Deezer credits more roles than were ever read, and reports no tempo for
     much of its catalogue — neither should arrive unasked. */
  t.false(DEFAULT_METADATA_OPTIONS.extraCredits);
  t.false(DEFAULT_METADATA_OPTIONS.bpm);
});

test('a stored choice is honoured', (t) => {
  const options = metadataOptionsFrom({replayGain: true, barcode: false});
  t.true(options.replayGain);
  t.false(options.barcode);
});

test('a setting absent from an older config keeps its default', (t) => {
  /* A config written before a tag existed has no key for it. Treating the
     whole object as missing would quietly revert every other choice. */
  const options = metadataOptionsFrom({replayGain: true});
  t.true(options.replayGain, 'the one they set');
  t.true(options.isrc, 'and the rest as they were');
  t.false(options.bpm);
});

test('nothing stored means the defaults', (t) => {
  t.deepEqual(metadataOptionsFrom(undefined), DEFAULT_METADATA_OPTIONS);
  t.deepEqual(metadataOptionsFrom(null), DEFAULT_METADATA_OPTIONS);
  t.deepEqual(metadataOptionsFrom({}), DEFAULT_METADATA_OPTIONS);
});

test('junk in the config cannot turn a tag on or off', (t) => {
  const options = metadataOptionsFrom({replayGain: 'yes', isrc: 1, nonsense: true});
  t.false(options.replayGain, 'only a real boolean counts');
  t.true(options.isrc);
  t.false('nonsense' in options, 'unknown keys are dropped');
});

/*
 * Per service, because the three do not carry the same tags.
 *
 * Deezer sends a loudness figure, a barcode and a deep credit list; Qobuz
 * sends most of the same and its own peak; YouTube Music sends none of it, so
 * only the provenance line applies there. Offering a service switches it will
 * ignore is worse than not offering them.
 */

test('each service is offered only what it can write', (t) => {
  t.true(SUPPORTED_TAGS.deezer.includes('bpm'), 'Deezer knows the tempo');
  t.false(SUPPORTED_TAGS.qobuz.includes('bpm'), 'Qobuz does not send one');

  t.true(SUPPORTED_TAGS.qobuz.includes('replayGain'), 'Qobuz writes a gain too, so it needs the switch');
  t.deepEqual(SUPPORTED_TAGS.ytmusic, ['provenance'], 'and YouTube Music has only the one');
});

test('the services keep separate choices', (t) => {
  const settings = metadataSettingsFrom({
    deezer: {replayGain: true},
    qobuz: {replayGain: false},
  });
  t.true(settings.deezer.replayGain);
  t.false(settings.qobuz.replayGain, 'turning it on for one does not turn it on for the other');
});

test('a config from before the split still reads correctly', (t) => {
  /* One flat set used to mean Deezer alone. Reading it as nothing would
     silently drop a choice somebody had already made. */
  const settings = metadataSettingsFrom({replayGain: true, barcode: false});
  t.true(settings.deezer.replayGain, 'the old values become Deezer');
  t.false(settings.deezer.barcode);
  t.deepEqual(settings.qobuz, DEFAULT_METADATA_OPTIONS, 'the others start from the defaults');
  t.deepEqual(settings.ytmusic, DEFAULT_METADATA_OPTIONS);
});

test('nothing stored means defaults for all three', (t) => {
  const settings = metadataSettingsFrom(undefined);
  for (const service of ['deezer', 'qobuz', 'ytmusic'] as const) {
    t.deepEqual(settings[service], DEFAULT_METADATA_OPTIONS, service);
    t.false(settings[service].replayGain, `${service} does not write a gain by default`);
  }
});
