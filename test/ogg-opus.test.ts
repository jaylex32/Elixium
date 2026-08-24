/*
 * Rewrapping YouTube's Opus so it can carry tags.
 *
 * YouTube ships Opus inside WebM, which has no tag writer, so those downloads
 * arrived with no title, artist or cover. Ogg is Opus's native container and
 * holds exactly the packets WebM was already holding, so the wrapper is
 * rewritten and the audio is left alone.
 *
 * The tests that matter are the structural ones. A malformed Ogg page is not
 * subtly wrong — players reject the file outright — and the failure modes are
 * all in the bookkeeping: checksums computed the wrong way, packets larger
 * than a page can hold, granule positions that misreport the duration.
 */
import test from 'ava';
import {packetSamples, writeOggOpus, readWebmOpus, remuxWebmToOgg, type OpusStream} from '../src/core/ytmusic/ogg-opus';

/** A minimal but valid OpusHead: magic, version, channels, pre-skip, rate. */
const opusHead = (preSkip = 312): Buffer => {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head.writeUInt8(1, 8); // version
  head.writeUInt8(2, 9); // channels
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(48_000, 12);
  head.writeUInt16LE(0, 16); // output gain
  head.writeUInt8(0, 18); // channel mapping family
  return head;
};

/** A packet whose first byte declares a 20ms single-frame CELT configuration. */
const packet = (size: number, toc = 0b1111_1000): Buffer => {
  const data = Buffer.alloc(size, 0x55);
  data[0] = toc;
  return data;
};

/** Ogg's CRC, written independently here so the muxer cannot mark its own work. */
const oggCrc = (data: Buffer): number => {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000_0000 ? ((crc << 1) ^ 0x04c1_1db7) >>> 0 : (crc << 1) >>> 0;
    }
    crc >>>= 0;
  }
  return crc >>> 0;
};

/** Walk an Ogg stream, verifying checksums and reassembling packets. */
const parseOgg = (ogg: Buffer) => {
  const packets: Buffer[] = [];
  let partial: Buffer[] = [];
  let at = 0;
  let pages = 0;
  let badChecksums = 0;
  let lastGranule = 0;
  let sawBos = false;
  let sawEos = false;

  while (at < ogg.length && ogg.subarray(at, at + 4).toString('latin1') === 'OggS') {
    const flags = ogg[at + 5];
    const low = ogg.readUInt32LE(at + 6);
    const high = ogg.readUInt32LE(at + 10);
    const stored = ogg.readUInt32LE(at + 22);
    const count = ogg[at + 26];
    const lacing = [...ogg.subarray(at + 27, at + 27 + count)];
    const bodyAt = at + 27 + count;
    const end = bodyAt + lacing.reduce((a, b) => a + b, 0);

    const copy = Buffer.from(ogg.subarray(at, end));
    copy.writeUInt32LE(0, 22);
    if (oggCrc(copy) !== stored) badChecksums += 1;

    if (flags & 0x02) sawBos = true;
    if (flags & 0x04) sawEos = true;
    if (low !== 0xffff_ffff || high !== 0xffff_ffff) lastGranule = high * 0x1_0000_0000 + low;

    let offset = bodyAt;
    for (const value of lacing) {
      partial.push(ogg.subarray(offset, offset + value));
      offset += value;
      if (value < 255) {
        packets.push(Buffer.concat(partial));
        partial = [];
      }
    }

    pages += 1;
    at = end;
  }

  return {packets, pages, badChecksums, lastGranule, sawBos, sawEos, trailing: ogg.length - at};
};

const streamOf = (packets: Buffer[], preSkip = 312): OpusStream => ({head: opusHead(preSkip), packets, preSkip});

test('packet duration is read from the configuration in the first byte', (t) => {
  // config 20 (CELT WB) at 2.5ms, and config 15 (hybrid FB) at 20ms.
  t.is(packetSamples(packet(10, 20 << 3)), 120, '2.5ms at 48kHz');
  t.is(packetSamples(packet(10, 15 << 3)), 960, '20ms at 48kHz');
  t.is(packetSamples(Buffer.alloc(0)), 0, 'an empty packet has no duration');
});

test('a two-frame packet lasts twice as long as a one-frame packet', (t) => {
  const one = packetSamples(packet(10, (15 << 3) | 0));
  const two = packetSamples(packet(10, (15 << 3) | 1));
  t.is(two, one * 2);
});

test('the headers come first, each as its own packet', (t) => {
  const parsed = parseOgg(writeOggOpus(streamOf([packet(50), packet(50)]), {title: 'A'}));
  t.is(parsed.packets[0].subarray(0, 8).toString('latin1'), 'OpusHead');
  t.is(parsed.packets[1].subarray(0, 8).toString('latin1'), 'OpusTags');
});

test('every page checksum is valid', (t) => {
  const parsed = parseOgg(writeOggOpus(streamOf(Array.from({length: 600}, () => packet(120))), {title: 'A'}));
  t.is(parsed.badChecksums, 0);
  t.is(parsed.trailing, 0, 'the stream must end on a page boundary');
});

test('the stream is marked at both ends', (t) => {
  const parsed = parseOgg(writeOggOpus(streamOf([packet(40)]), {}));
  t.true(parsed.sawBos, 'the first page must carry the beginning-of-stream flag');
  t.true(parsed.sawEos, 'the last page must carry the end-of-stream flag');
});

test('the audio survives the rewrap byte for byte', (t) => {
  const packets = Array.from({length: 500}, (_, i) => packet(60 + (i % 40)));
  const parsed = parseOgg(writeOggOpus(streamOf(packets), {title: 'A'}));
  const audio = parsed.packets.slice(2);
  t.is(audio.length, packets.length);
  t.true(
    audio.every((p, i) => p.equals(packets[i])),
    'no audio packet may differ from the one that went in',
  );
});

/*
 * The bug this file exists to prevent.
 *
 * An Ogg page holds at most 255 segments of 255 bytes, so a packet over about
 * 65KB does not fit in one. An embedded cover pushes the tags packet well past
 * that, and the first version simply wrote the segment count into a byte and
 * threw a range error — a cover made the whole download fail.
 */
test('a tags packet too large for one page is split across pages', (t) => {
  const cover = Buffer.alloc(200_000, 0x7f);
  const ogg = writeOggOpus(streamOf([packet(80)]), {title: 'Big', cover});
  const parsed = parseOgg(ogg);
  t.is(parsed.badChecksums, 0);
  t.is(parsed.packets[1].subarray(0, 8).toString('latin1'), 'OpusTags');
  t.true(parsed.packets[1].length > 200_000, 'the whole tags packet must survive the split');
  t.true(parsed.pages > 3, 'a cover this size cannot fit on one page');
});

test('a packet that is an exact multiple of 255 is not merged with the next', (t) => {
  // Without a closing zero lacing value, a reader joins this to what follows.
  const packets = [packet(255), packet(510), packet(64)];
  const audio = parseOgg(writeOggOpus(streamOf(packets), {})).packets.slice(2);
  t.is(audio.length, 3);
  t.deepEqual(
    audio.map((p) => p.length),
    [255, 510, 64],
  );
});

test('the final granule reports the true duration', (t) => {
  // 100 packets of 20ms is two seconds, plus the pre-skip.
  const preSkip = 312;
  const packets = Array.from({length: 100}, () => packet(60, 15 << 3));
  const parsed = parseOgg(writeOggOpus(streamOf(packets, preSkip), {}));
  t.is(parsed.lastGranule, preSkip + 100 * 960);
});

test('tags are written as they were given', (t) => {
  const ogg = writeOggOpus(streamOf([packet(40)]), {
    title: 'Trip',
    artist: 'Pooh Shiesty',
    album: 'All Eyes on Shiest',
    year: 2021,
    trackNumber: 1,
    trackTotal: 17,
  });
  const tags = parseOgg(ogg).packets[1].toString('utf8');
  t.regex(tags, /TITLE=Trip/);
  t.regex(tags, /ARTIST=Pooh Shiesty/);
  t.regex(tags, /ALBUM=All Eyes on Shiest/);
  t.regex(tags, /DATE=2021/);
  t.regex(tags, /TRACKNUMBER=1/);
  t.regex(tags, /TRACKTOTAL=17/);
});

test('an absent field is left out rather than written empty', (t) => {
  const tags = parseOgg(writeOggOpus(streamOf([packet(40)]), {title: 'Only'})).packets[1].toString('utf8');
  t.regex(tags, /TITLE=Only/);
  t.notRegex(tags, /ARTIST=/, 'an empty tag is worse than a missing one');
  t.notRegex(tags, /METADATA_BLOCK_PICTURE/);
});

test('a cover is embedded as a picture block', (t) => {
  const cover = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const tags = parseOgg(writeOggOpus(streamOf([packet(40)]), {cover})).packets[1].toString('utf8');
  const encoded = /METADATA_BLOCK_PICTURE=([A-Za-z0-9+/=]+)/.exec(tags);
  t.truthy(encoded);
  const block = Buffer.from(encoded![1], 'base64');
  t.is(block.readUInt32BE(0), 3, 'picture type 3 is the front cover');
  t.is(block.subarray(8, 8 + block.readUInt32BE(4)).toString('latin1'), 'image/jpeg');
  t.true(block.subarray(block.length - cover.length).equals(cover), 'the image must survive intact');
});

test('a PNG cover is labelled as one', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]);
  const tags = parseOgg(writeOggOpus(streamOf([packet(40)]), {cover: png})).packets[1].toString('utf8');
  const block = Buffer.from(/METADATA_BLOCK_PICTURE=([A-Za-z0-9+/=]+)/.exec(tags)![1], 'base64');
  t.is(block.subarray(8, 8 + block.readUInt32BE(4)).toString('latin1'), 'image/png');
});

/*
 * Refusing is a real answer.
 *
 * Handed something that is not WebM Opus, this must decline so the caller
 * keeps the file it already has. Writing a malformed Ogg over a working
 * download would be worse than not trying.
 */
test('anything that is not WebM Opus is declined', (t) => {
  t.is(readWebmOpus(Buffer.alloc(0)), null);
  t.is(readWebmOpus(Buffer.from('not a container at all')), null);
  t.is(readWebmOpus(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), null, 'EBML alone is not enough');
  t.is(remuxWebmToOgg(Buffer.from('rubbish'), {title: 'x'}), null);
});
