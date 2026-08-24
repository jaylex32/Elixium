/**
 * Putting YouTube's Opus into a container that can carry tags.
 *
 * YouTube serves Opus inside WebM, and WebM has no tag writer — so an Opus
 * download arrived with no title, artist or cover and stayed that way. That
 * left a choice between the better-sounding file and the one that was actually
 * usable in a library, which is not a choice worth making: Opus is the
 * stronger codec and YouTube ships it at a higher bitrate than the AAC
 * alternative (measured on one track: 147kbps against 131).
 *
 * There is no need to choose. Ogg is Opus's native container, it carries
 * Vorbis comments and embedded artwork, and the audio inside WebM is already
 * exactly what an Ogg stream wants — the same packets, and a `CodecPrivate`
 * that is already a verbatim `OpusHead`. So this rewrites the wrapper and
 * leaves every audio byte untouched. Nothing is re-encoded, so nothing is lost.
 *
 * Deliberately not a general Matroska implementation. It reads the one shape
 * YouTube sends and declines anything else, which keeps it small enough to be
 * read and checked rather than trusted.
 */

/** Opus always reports its timing at 48kHz, whatever the source rate was. */
const OPUS_RATE = 48_000;

/** Ogg pages carry at most 255 segments of at most 255 bytes. */
const MAX_SEGMENTS = 255;

/** EBML element ids, in the order this needs them. */
const EBML = {
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Cluster: 0x1f43b675,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
};

/**
 * An EBML variable-length integer.
 *
 * `keepMarker` distinguishes an element id, which keeps its length marker as
 * part of its value, from a size, which does not.
 */
const readVint = (data: Buffer, at: number, keepMarker: boolean): {value: number; length: number} | null => {
  const first = data[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length += 1;
  if (length > 8 || at + length > data.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i += 1) value = value * 256 + data[at + i];
  return {value, length};
};

/** Visit each element between `start` and `end`, without descending. */
const walk = (
  data: Buffer,
  start: number,
  end: number,
  visit: (id: number, from: number, to: number) => void,
): void => {
  let at = start;
  while (at < end) {
    const id = readVint(data, at, true);
    if (!id) return;
    const size = readVint(data, at + id.length, false);
    if (!size) return;
    const from = at + id.length + size.length;
    /* An all-ones size means "until the parent ends", which Clusters use. */
    const unknown = size.value === Math.pow(2, 7 * size.length) - 1;
    const to = unknown ? end : Math.min(from + size.value, end);
    if (to < from) return;
    visit(id.value, from, to);
    at = to;
  }
};

/**
 * How many 48kHz samples a packet represents, from its first byte.
 *
 * The table of frame durations is fixed by the Opus specification: the top
 * five bits of the first byte choose a configuration, and each configuration
 * has one duration. Reading it matters because a wrong duration lands in the
 * Ogg granule positions, and a player believes those over the audio — the file
 * would report the wrong length and seek to the wrong place.
 */
export const packetSamples = (packet: Buffer): number => {
  if (packet.length < 1) return 0;
  const toc = packet[0];
  const config = toc >> 3;

  /* Tenths of a millisecond, so 2.5ms stays an integer. */
  const tenths = [
    100, 200, 400, 600, 100, 200, 400, 600, 100, 200, 400, 600, 100, 200, 100, 200, 25, 50, 100, 200, 25, 50, 100, 200,
    25, 50, 100, 200, 25, 50, 100, 200,
  ][config];

  const code = toc & 0b11;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else frames = packet.length >= 2 ? packet[1] & 0b0011_1111 : 1;

  return Math.round((tenths * OPUS_RATE * frames) / 10_000);
};

export interface OpusStream {
  /** The `OpusHead` identification header, verbatim from the source. */
  head: Buffer;
  /** Audio packets, in order, byte for byte as they arrived. */
  packets: Buffer[];
  /** Samples to discard at the start, read out of the header. */
  preSkip: number;
}

/**
 * Read the Opus stream out of a WebM file.
 *
 * Returns null when this is not a WebM carrying Opus, so a caller can leave
 * the file alone rather than write something malformed.
 */
export const readWebmOpus = (data: Buffer): OpusStream | null => {
  if (data.length < 4 || data[0] !== 0x1a || data[1] !== 0x45 || data[2] !== 0xdf || data[3] !== 0xa3) return null;

  let codec = '';
  let head: Buffer | null = null;
  let track = 1;
  const packets: Buffer[] = [];

  const readBlock = (from: number, to: number): void => {
    const number = readVint(data, from, false);
    if (!number || number.value !== track) return;
    /* Track number, then a signed 16-bit timestamp and one flags byte. */
    const flagsAt = from + number.length + 2;
    if (flagsAt >= to) return;
    const lacing = (data[flagsAt] >> 1) & 0b11;
    const payload = flagsAt + 1;
    if (payload >= to) return;

    /*
     * Only unlaced blocks are handled, which is what YouTube sends: one Opus
     * packet per block. Laced blocks would need their frame sizes unpacked,
     * and silently treating one as unlaced would splice several packets into
     * one and corrupt the timing.
     */
    if (lacing !== 0) return;
    packets.push(data.subarray(payload, to));
  };

  walk(data, 0, data.length, (id, from, to) => {
    if (id !== EBML.Segment) return;
    walk(data, from, to, (sid, sfrom, sto) => {
      if (sid === EBML.Tracks) {
        walk(data, sfrom, sto, (tid, tfrom, tto) => {
          if (tid !== EBML.TrackEntry) return;
          walk(data, tfrom, tto, (eid, efrom, eto) => {
            if (eid === EBML.CodecID) codec = data.subarray(efrom, eto).toString('latin1').replace(/\0+$/, '');
            if (eid === EBML.CodecPrivate) head = data.subarray(efrom, eto);
            if (eid === EBML.TrackNumber && eto > efrom) track = data[efrom];
          });
        });
      }
      if (sid === EBML.Cluster) {
        walk(data, sfrom, sto, (cid, cfrom, cto) => {
          if (cid === EBML.SimpleBlock) readBlock(cfrom, cto);
          if (cid === EBML.BlockGroup) {
            walk(data, cfrom, cto, (bid, bfrom, bto) => {
              if (bid === EBML.Block) readBlock(bfrom, bto);
            });
          }
        });
      }
    });
  });

  if (codec !== 'A_OPUS' || !head) return null;
  const header = head as Buffer;
  if (header.length < 12 || header.subarray(0, 8).toString('latin1') !== 'OpusHead') return null;
  if (packets.length === 0) return null;

  return {head: header, packets, preSkip: header.readUInt16LE(10)};
};

/**
 * Ogg's CRC.
 *
 * Not the common CRC-32: no input or output reflection and no final inversion,
 * which is why a stock implementation produces pages every player rejects.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 0x8000_0000 ? ((value << 1) ^ 0x04c1_1db7) >>> 0 : (value << 1) >>> 0;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const oggCrc = (data: Buffer): number => {
  let crc = 0;
  for (const byte of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc >>> 0;
};

/** One Ogg page, with its checksum filled in. */
const buildPage = (
  lacing: number[],
  body: Buffer,
  granule: number,
  serial: number,
  sequence: number,
  flags: number,
): Buffer => {
  const page = Buffer.alloc(27 + lacing.length + body.length);
  page.write('OggS', 0, 'latin1');
  page.writeUInt8(0, 4); // stream structure version
  page.writeUInt8(flags, 5);

  /*
   * Granule is 64-bit, and -1 is a real value meaning "no packet finishes on
   * this page" — which happens whenever a packet is large enough to span
   * several, as a tagged cover image is.
   */
  if (granule < 0) {
    page.writeUInt32LE(0xffff_ffff, 6);
    page.writeUInt32LE(0xffff_ffff, 10);
  } else {
    page.writeUInt32LE(granule >>> 0, 6);
    page.writeUInt32LE(Math.floor(granule / 0x1_0000_0000), 10);
  }

  page.writeUInt32LE(serial >>> 0, 14);
  page.writeUInt32LE(sequence >>> 0, 18);
  page.writeUInt32LE(0, 22); // checksum, filled in below
  page.writeUInt8(lacing.length, 26);
  for (let i = 0; i < lacing.length; i += 1) page.writeUInt8(lacing[i], 27 + i);
  body.copy(page, 27 + lacing.length);

  page.writeUInt32LE(oggCrc(page), 22);
  return page;
};

/** One lacing value and the bytes it covers. */
interface Segment {
  lacing: number;
  data: Buffer;
  /** Set when this segment completes a packet, carrying the granule for it. */
  granule: number | null;
}

/**
 * Cut packets into Ogg's 255-byte segments.
 *
 * A packet becomes as many 255s as it needs plus a remainder, and a packet
 * that is an exact multiple of 255 gets a closing zero — without it a reader
 * treats the packet as continuing into whatever follows.
 */
const toSegments = (packets: Buffer[], startGranule: number, samples: (packet: Buffer) => number): Segment[] => {
  const segments: Segment[] = [];
  let granule = startGranule;

  for (const packet of packets) {
    granule += samples(packet);
    let at = 0;
    let left = packet.length;
    while (left >= 255) {
      segments.push({lacing: 255, data: packet.subarray(at, at + 255), granule: null});
      at += 255;
      left -= 255;
    }
    segments.push({lacing: left, data: packet.subarray(at), granule});
  }

  return segments;
};

/** Metadata to write into the file. */
export interface OggTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number | null;
  trackNumber?: number | null;
  trackTotal?: number | null;
  comment?: string;
  /** Front cover, embedded as a picture block. */
  cover?: Buffer | null;
  coverMime?: string;
}

/**
 * A FLAC picture block, which is how Ogg carries embedded artwork.
 *
 * Base64 of this structure goes into a `METADATA_BLOCK_PICTURE` comment. The
 * dimensions are declared as zero: they are advisory, every player reads the
 * real ones from the image, and inventing numbers would be worse than omitting
 * them.
 */
const pictureBlock = (image: Buffer, mime: string): Buffer => {
  const description = Buffer.from('', 'utf8');
  const mimeBytes = Buffer.from(mime, 'latin1');
  const block = Buffer.alloc(32 + mimeBytes.length + description.length + image.length);
  let at = 0;
  block.writeUInt32BE(3, at); // picture type 3: front cover
  at += 4;
  block.writeUInt32BE(mimeBytes.length, at);
  at += 4;
  mimeBytes.copy(block, at);
  at += mimeBytes.length;
  block.writeUInt32BE(description.length, at);
  at += 4;
  at += description.length;
  for (const value of [0, 0, 0, 0]) {
    block.writeUInt32BE(value, at); // width, height, depth, colours
    at += 4;
  }
  block.writeUInt32BE(image.length, at);
  at += 4;
  image.copy(block, at);
  return block;
};

/** The `OpusTags` header: a vendor string and a list of `KEY=value` comments. */
const buildTags = (tags: OggTags): Buffer => {
  const comments: string[] = [];
  const add = (key: string, value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (text) comments.push(`${key}=${text}`);
  };

  add('TITLE', tags.title);
  add('ARTIST', tags.artist);
  add('ALBUM', tags.album);
  add('ALBUMARTIST', tags.albumArtist);
  add('DATE', tags.year);
  add('TRACKNUMBER', tags.trackNumber);
  add('TRACKTOTAL', tags.trackTotal);
  add('COMMENT', tags.comment);
  if (tags.cover && tags.cover.length > 0) {
    const mime = tags.coverMime || (tags.cover[0] === 0x89 ? 'image/png' : 'image/jpeg');
    comments.push(`METADATA_BLOCK_PICTURE=${pictureBlock(tags.cover, mime).toString('base64')}`);
  }

  const vendor = Buffer.from('Elixium', 'utf8');
  const encoded = comments.map((comment) => Buffer.from(comment, 'utf8'));
  const size = 8 + 4 + vendor.length + 4 + encoded.reduce((total, c) => total + 4 + c.length, 0);

  const out = Buffer.alloc(size);
  let at = 0;
  out.write('OpusTags', at, 'latin1');
  at += 8;
  out.writeUInt32LE(vendor.length, at);
  at += 4;
  vendor.copy(out, at);
  at += vendor.length;
  out.writeUInt32LE(encoded.length, at);
  at += 4;
  for (const comment of encoded) {
    out.writeUInt32LE(comment.length, at);
    at += 4;
    comment.copy(out, at);
    at += comment.length;
  }
  return out;
};

/**
 * Write an Ogg Opus file from a stream and its tags.
 *
 * The two headers each take a page of their own, as the specification
 * requires, and the audio follows in pages of up to 255 segments.
 */
export const writeOggOpus = (stream: OpusStream, tags: OggTags, serial = 0x454c_4958): Buffer => {
  const pages: Buffer[] = [];
  let sequence = 0;

  /**
   * Emit one page's worth of segments.
   *
   * `continued` marks a page that opens in the middle of a packet, which is
   * how a reader knows to join it to what came before.
   */
  const emit = (segments: Segment[], flags: number) => {
    const lacing = segments.map((segment) => segment.lacing);
    const body = Buffer.concat(segments.map((segment) => segment.data));
    /* The granule belongs to the last packet that *finishes* here; a page that
       finishes none carries -1. */
    let granule = -1;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (segments[i].granule !== null) {
        granule = segments[i].granule as number;
        break;
      }
    }
    pages.push(buildPage(lacing, body, granule, serial, sequence++, flags));
  };

  /* The two headers each take a page of their own, as the specification
     requires — and each may span pages of its own if the tags are large. */
  const writeHeader = (packet: Buffer, first: boolean) => {
    const segments = toSegments([packet], 0, () => 0);
    for (let at = 0; at < segments.length; at += MAX_SEGMENTS) {
      const slice = segments.slice(at, at + MAX_SEGMENTS);
      const continued = at > 0 ? 0x01 : first ? 0x02 : 0x00;
      /* A header carries granule 0, not the -1 an unfinished audio page uses. */
      emit(
        slice.map((segment) => ({...segment, granule: segment.granule === null ? null : 0})),
        continued,
      );
    }
  };

  writeHeader(stream.head, true);
  writeHeader(buildTags(tags), false);

  const audio = toSegments(stream.packets, stream.preSkip, packetSamples);
  for (let at = 0; at < audio.length; at += MAX_SEGMENTS) {
    const slice = audio.slice(at, at + MAX_SEGMENTS);
    const last = at + MAX_SEGMENTS >= audio.length;
    /* Continued when the previous page ended part-way through a packet. */
    const continued = at > 0 && audio[at - 1].granule === null ? 0x01 : 0x00;
    emit(slice, continued | (last ? 0x04 : 0x00));
  }

  return Buffer.concat(pages);
};

/**
 * Rewrap a WebM Opus download as a tagged Ogg Opus file.
 *
 * Returns null when the input is not WebM Opus, so the caller keeps what it
 * already has rather than replacing a good file with a broken one.
 */
export const remuxWebmToOgg = (webm: Buffer, tags: OggTags): Buffer | null => {
  const stream = readWebmOpus(webm);
  return stream ? writeOggOpus(stream, tags) : null;
};
