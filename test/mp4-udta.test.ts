/*
 * Giving an MP4 the metadata box its tagger will not create.
 *
 * YouTube's audio has no `udta` box, and node-taglib-sharp throws rather than
 * adding one — so most of an album downloaded untagged, and the handful that
 * worked were the tracks where YouTube had already embedded artwork. Thirteen
 * of seventeen failed before this existed.
 *
 * The risk in a fix like this is doing damage to a file that was fine, so most
 * of what follows checks that: an unparseable file comes back untouched, a file
 * that already has the box is not given a second one, and the audio after
 * `moov` never moves.
 */
import test from 'ava';
import {ensureMetadataBox} from '../src/core/ytmusic/mp4-udta';

/** A box: four-byte size, four-byte type, then payload. */
const box = (type: string, payload: Buffer = Buffer.alloc(0)): Buffer => {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(8 + payload.length, 0);
  out.write(type, 4, 'latin1');
  payload.copy(out, 8);
  return out;
};

/** A fragmented MP4 shaped like YouTube's: ftyp, a bare moov, then audio. */
const bareFile = (): Buffer =>
  Buffer.concat([
    box('ftyp', Buffer.from('dash')),
    box('moov', box('mvhd', Buffer.alloc(96))),
    box('sidx', Buffer.alloc(40)),
    box('moof', Buffer.alloc(64)),
    box('mdat', Buffer.alloc(4096, 0x5a)),
  ]);

/** The same, but already carrying a metadata box. */
const taggedFile = (): Buffer => {
  const meta = Buffer.concat([Buffer.alloc(4), box('hdlr', Buffer.alloc(25)), box('ilst')]);
  const udta = box('udta', box('meta', meta));
  return Buffer.concat([
    box('ftyp', Buffer.from('dash')),
    box('moov', Buffer.concat([box('mvhd', Buffer.alloc(96)), udta])),
    box('mdat', Buffer.alloc(1024, 0x5a)),
  ]);
};

/** Read the top-level boxes back out. */
const topLevel = (data: Buffer) => {
  const boxes: {type: string; start: number; size: number}[] = [];
  let at = 0;
  while (at + 8 <= data.length) {
    const size = data.readUInt32BE(at);
    if (size < 8 || at + size > data.length) break;
    boxes.push({type: data.subarray(at + 4, at + 8).toString('latin1'), start: at, size});
    at += size;
  }
  return boxes;
};

const countOccurrences = (data: Buffer, needle: string): number => {
  let count = 0;
  let at = data.indexOf(needle, 0, 'latin1');
  while (at !== -1) {
    count += 1;
    at = data.indexOf(needle, at + 1, 'latin1');
  }
  return count;
};

test('a file with no metadata box is given one', (t) => {
  const before = bareFile();
  const after = ensureMetadataBox(before);
  t.true(after.length > before.length, 'the box has to go somewhere');
  t.is(countOccurrences(after, 'udta'), 1);
  t.is(countOccurrences(after, 'ilst'), 1);
  t.is(countOccurrences(after, 'mdir'), 1, 'the iTunes handler must be present');
});

test('moov grows by exactly what was put inside it', (t) => {
  const before = bareFile();
  const after = ensureMetadataBox(before);
  const moovBefore = topLevel(before).find((b) => b.type === 'moov');
  const moovAfter = topLevel(after).find((b) => b.type === 'moov');
  t.is((moovAfter?.size ?? 0) - (moovBefore?.size ?? 0), after.length - before.length);
});

test('the boxes after moov are unchanged', (t) => {
  // The audio is the point of the file; a tagging convenience must not move it.
  const before = bareFile();
  const after = ensureMetadataBox(before);
  const types = (data: Buffer) => topLevel(data).map((b) => b.type);
  t.deepEqual(types(after), types(before), 'the same boxes, in the same order');

  const mdatBefore = topLevel(before).find((b) => b.type === 'mdat');
  const mdatAfter = topLevel(after).find((b) => b.type === 'mdat');
  t.is(mdatAfter?.size, mdatBefore?.size);
  t.true(
    after
      .subarray(mdatAfter!.start, mdatAfter!.start + mdatAfter!.size)
      .equals(before.subarray(mdatBefore!.start, mdatBefore!.start + mdatBefore!.size)),
    'the audio must be byte-identical',
  );
});

/*
 * Running twice must not add a second box.
 *
 * The same file can be handed through this more than once — a retry, a
 * re-tag — and two `udta` boxes is exactly the ambiguity the tagger warns
 * about, since it then has to guess which one holds the tags.
 */
test('a file that already has the box is returned untouched', (t) => {
  const already = taggedFile();
  t.is(ensureMetadataBox(already).length, already.length);
  t.true(ensureMetadataBox(already).equals(already));
});

test('applying it twice is the same as applying it once', (t) => {
  const once = ensureMetadataBox(bareFile());
  const twice = ensureMetadataBox(once);
  t.is(twice.length, once.length);
  t.is(countOccurrences(twice, 'udta'), 1);
});

/*
 * Anything unrecognisable is left exactly as it arrived.
 *
 * A download that cannot be parsed confidently is still a working audio file.
 * Rewriting one on a guess would turn a missing tag into a broken track.
 */
test('a file with no moov is left alone', (t) => {
  const noMoov = Buffer.concat([box('ftyp', Buffer.from('dash')), box('mdat', Buffer.alloc(64))]);
  t.true(ensureMetadataBox(noMoov).equals(noMoov));
});

test('something that is not an MP4 at all is left alone', (t) => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
  t.true(ensureMetadataBox(webm).equals(webm));
  const empty = Buffer.alloc(0);
  t.true(ensureMetadataBox(empty).equals(empty));
  const junk = Buffer.from('not a container');
  t.true(ensureMetadataBox(junk).equals(junk));
});

test('a truncated box does not send the parser past the end', (t) => {
  // A size field claiming more than the file holds must stop the walk, not
  // read off the end of the buffer.
  const lying = Buffer.alloc(16);
  lying.writeUInt32BE(999_999, 0);
  lying.write('moov', 4, 'latin1');
  t.notThrows(() => ensureMetadataBox(lying));
  t.true(ensureMetadataBox(lying).equals(lying));
});
