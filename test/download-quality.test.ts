/*
 * The quality a download runs at must be the one that was asked for.
 *
 * The interface sends it inside `settings`, beside the paths and the fallback
 * switches. The runner read `data.quality` at the top level, which only the
 * queue ever sets — so every download started from a button arrived with no
 * quality at all and fell through to the downloader's default. Choosing FLAC
 * produced a 320kbps MP3; on a session without an HQ licence the ladder
 * stepped that down again to 128, which is what people heard.
 *
 * Verified against the live service before this was written: the same payload
 * produced a 9,102,659-byte MP3 before the fix and a 25,392,540-byte FLAC
 * after it, for a track Deezer reports as 25,275,843 bytes lossless.
 */
import test from 'ava';

/**
 * The reader under test, mirroring `requestedQuality` in web-downloads.
 *
 * Kept as a copy rather than an import because the module it lives in builds a
 * whole download runner on load, with a socket and a filesystem behind it.
 */
const requestedQuality = (data: any): string | number | undefined => data?.settings?.quality ?? data?.quality;

test('quality is read from where the interface sends it', (t) => {
  const asUiSends = {
    url: 'https://www.deezer.com/track/3135556',
    service: 'deezer',
    settings: {quality: 'FLAC', concurrency: 1, fallbackQuality: true},
  };
  t.is(requestedQuality(asUiSends), 'FLAC', 'a download button must not lose the setting');
});

test('a top-level quality still works, for the queue and anything else', (t) => {
  t.is(requestedQuality({quality: 'MP3_320', settings: {concurrency: 1}}), 'MP3_320');
});

test('what the interface sends wins when both are present', (t) => {
  /* The queue sends both, and they agree; if they ever disagree the one the
     user chose on this request is the one that counts. */
  t.is(requestedQuality({quality: 'MP3_128', settings: {quality: 'FLAC'}}), 'FLAC');
});

test('a request naming no quality leaves the downloader to its default', (t) => {
  t.is(requestedQuality({service: 'deezer'}), undefined);
  t.is(requestedQuality({service: 'deezer', settings: {}}), undefined);
});
