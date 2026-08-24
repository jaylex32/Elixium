/**
 * Giving an MP4 the metadata box its tagger refuses to create.
 *
 * YouTube's audio arrives as fragmented MP4 with a minimal `moov` — 608 bytes,
 * carrying the track layout and nothing else. There is no `udta` box, because
 * nothing has ever written a tag into it.
 *
 * node-taglib-sharp cannot add one. Its `Mpeg4File.save` builds an empty
 * `udta` when the file has none, then reads `udtaBox.parentTree` before the
 * check that handles exactly that case, and an empty box has no parent tree —
 * so it throws `Cannot read properties of undefined (reading 'slice')` and the
 * file is written with no tags at all. The guard is there, three lines below
 * the dereference that prevents it ever running.
 *
 * The effect was that most of an album came out untitled: the few tracks that
 * did tag were the ones where YouTube had already embedded artwork, so a
 * `udta` existed for the library to find. Thirteen of seventeen failed.
 *
 * So this writes the box the tagger expects to find. An empty
 * `udta/meta/hdlr+ilst`, inserted into `moov`, is enough for `findAppleTagUdta`
 * to succeed, after which the library tags the file normally. Nothing else is
 * touched — no audio is moved, and a file that already has the box is returned
 * unchanged.
 */

/**
 * The iTunes metadata handler, as a hex string.
 *
 * Written this way because a byte array of it becomes thirty-odd lines once
 * formatted, and the structure is easier to check against the specification in
 * one place: size 0x21, `hdlr`, version and flags, predefined, `mdir`, `appl`,
 * eight reserved bytes, and an empty null-terminated name.
 */
const HANDLER = Buffer.from(
  '00000021' + '68646c72' + '00000000' + '00000000' + '6d646972' + '6170706c' + '00000000' + '00000000' + '00',
  'hex',
);

/** An empty item list — where the tags themselves will go. */
const EMPTY_ILST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x69, 0x6c, 0x73, 0x74]);

/** Build `udta > meta > (hdlr, ilst)`, all empty. */
const buildUserDataBox = (): Buffer => {
  /* meta carries a version/flags word before its children, unlike most boxes. */
  const metaSize = 8 + 4 + HANDLER.length + EMPTY_ILST.length;
  const meta = Buffer.alloc(metaSize);
  meta.writeUInt32BE(metaSize, 0);
  meta.write('meta', 4, 'latin1');
  meta.writeUInt32BE(0, 8); // version and flags
  HANDLER.copy(meta, 12);
  EMPTY_ILST.copy(meta, 12 + HANDLER.length);

  const udtaSize = 8 + meta.length;
  const udta = Buffer.alloc(udtaSize);
  udta.writeUInt32BE(udtaSize, 0);
  udta.write('udta', 4, 'latin1');
  meta.copy(udta, 8);
  return udta;
};

/** One box's position, header length and total size. */
interface Box {
  type: string;
  start: number;
  headerLength: number;
  size: number;
}

/** Read the boxes directly inside a region, without descending. */
const readBoxes = (data: Buffer, start: number, end: number): Box[] => {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = data.readUInt32BE(at);
    let headerLength = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const large = data.readBigUInt64BE(at + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerLength = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerLength || at + size > end) break;
    boxes.push({type: data.subarray(at + 4, at + 8).toString('latin1'), start: at, headerLength, size});
    at += size;
  }
  return boxes;
};

/** Does this box, or anything inside it, contain an item list? */
const hasItemList = (data: Buffer, box: Box): boolean => {
  for (const child of readBoxes(data, box.start + box.headerLength, box.start + box.size)) {
    if (child.type === 'ilst') return true;
    /* `meta` puts a version/flags word before its children. */
    const from = child.start + child.headerLength + (child.type === 'meta' ? 4 : 0);
    if (child.type === 'meta' || child.type === 'udta') {
      for (const grand of readBoxes(data, from, child.start + child.size)) {
        if (grand.type === 'ilst') return true;
      }
    }
  }
  return false;
};

/**
 * Make sure an MP4 has the metadata box a tagger can write into.
 *
 * Returns the file unchanged when it already has one, or is not an MP4 this
 * understands — a file that cannot be parsed confidently is better left exactly
 * as it arrived than rewritten on a guess.
 */
export const ensureMetadataBox = (data: Buffer): Buffer => {
  const top = readBoxes(data, 0, data.length);
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) return data;

  const insideMoov = readBoxes(data, moov.start + moov.headerLength, moov.start + moov.size);
  const existing = insideMoov.find((box) => box.type === 'udta');
  if (existing && hasItemList(data, existing)) return data;

  /*
   * Appended at the end of `moov`, which is where a tagger looks and what the
   * specification allows. Only `moov`'s own size changes; every child keeps
   * its position relative to it, and the audio after it is untouched.
   */
  const udta = buildUserDataBox();
  const insertAt = moov.start + moov.size;

  const out = Buffer.alloc(data.length + udta.length);
  data.copy(out, 0, 0, insertAt);
  udta.copy(out, insertAt);
  data.copy(out, insertAt + udta.length, insertAt);

  /* Grow `moov` by what was put inside it. */
  if (moov.headerLength === 16) {
    out.writeBigUInt64BE(BigInt(moov.size + udta.length), moov.start + 8);
  } else {
    out.writeUInt32BE(moov.size + udta.length, moov.start);
  }

  return out;
};
