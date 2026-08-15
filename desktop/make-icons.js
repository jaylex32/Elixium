/* eslint-disable @typescript-eslint/no-var-requires -- build script, CommonJS. */
'use strict';

/**
 * Generate the app icons from the Elixium mark.
 *
 * The source of truth is elixium-ui/public/elixium-icon.svg — the same mark the
 * web UI shows as its favicon — so the desktop app, the installer and the
 * browser tab cannot drift apart.
 *
 * The geometry is drawn here rather than shelled out to ImageMagick, Inkscape
 * or sharp on purpose: this has to run on a GitHub runner for Windows, macOS
 * and Linux, and every one of those tools is an extra install that can be
 * missing or a different version on one platform and quietly produce a
 * different icon. zlib is in Node, and the mark is four shapes.
 *
 * Outputs build/icon.png (1024), build/icon.ico and build/icon.icns.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- rendering

/** Colours and geometry, transcribed from the SVG's 64x64 viewBox. */
const VIEWBOX = 64;
const BG = [0x17, 0x14, 0x0f];
const GRAD_FROM = [0xe8, 0xa8, 0x7c];
const GRAD_TO = [0xd4, 0x82, 0x4a];
const CORNER_RADIUS = 14;
const RINGS = [
  {r: 19, width: 3.5, opacity: 1},
  {r: 10.5, width: 2, opacity: 0.55},
];
const HUB_RADIUS = 4;

/**
 * Gradient colour at a point.
 *
 * The SVG gradient uses the default objectBoundingBox units and runs corner to
 * corner, so it is relative to each shape's own box — not the canvas. Ignoring
 * that flattens the rings into near-solid colour.
 */
const gradientAt = (x, y, cx, cy, radius) => {
  const u = (x - (cx - radius)) / (radius * 2);
  const v = (y - (cy - radius)) / (radius * 2);
  const t = Math.min(1, Math.max(0, (u + v) / 2));
  return [
    GRAD_FROM[0] + (GRAD_TO[0] - GRAD_FROM[0]) * t,
    GRAD_FROM[1] + (GRAD_TO[1] - GRAD_FROM[1]) * t,
    GRAD_FROM[2] + (GRAD_TO[2] - GRAD_FROM[2]) * t,
  ];
};

/**
 * Signed-distance test for the rounded background square.
 *
 * The straight edges and the corner arcs need one combined expression. Testing
 * the axes separately and falling back to the corner circle punches the middle
 * of each edge out of the square, because a point there is inside on one axis
 * and past the corner-centre line on the other.
 */
const insideRoundedRect = (x, y, size, radius) => {
  const qx = Math.abs(x - size / 2) - (size / 2 - radius);
  const qy = Math.abs(y - size / 2) - (size / 2 - radius);
  const beyond = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const within = Math.min(Math.max(qx, qy), 0);
  return beyond + within - radius <= 0;
};

/**
 * Render at `size` px, supersampled.
 *
 * 4x4 samples per pixel: the rings are 2–3.5 units wide in a 64-unit box, so at
 * a 32px favicon size they land on well under a pixel and alias into dashes
 * without averaging.
 */
const render = (size) => {
  const SS = 4;
  const scale = size / VIEWBOX;
  const pixels = Buffer.alloc(size * size * 4);
  const centre = VIEWBOX / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Sample at sub-pixel centres, in SVG user units.
          const x = (px + (sx + 0.5) / SS) / scale;
          const y = (py + (sy + 0.5) / SS) / scale;

          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;

          if (insideRoundedRect(x, y, VIEWBOX, CORNER_RADIUS)) {
            [sr, sg, sb] = BG;
            sa = 1;
          }

          const dist = Math.hypot(x - centre, y - centre);

          const paint = (colour, alpha) => {
            // Source-over, straight alpha.
            sr = colour[0] * alpha + sr * (1 - alpha);
            sg = colour[1] * alpha + sg * (1 - alpha);
            sb = colour[2] * alpha + sb * (1 - alpha);
            sa = alpha + sa * (1 - alpha);
          };

          for (const ring of RINGS) {
            if (Math.abs(dist - ring.r) <= ring.width / 2) {
              paint(gradientAt(x, y, centre, centre, ring.r + ring.width / 2), ring.opacity);
            }
          }
          if (dist <= HUB_RADIUS) {
            paint(gradientAt(x, y, centre, centre, HUB_RADIUS), 1);
          }

          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }

      const n = SS * SS;
      const o = (py * size + px) * 4;
      pixels[o] = Math.round(r / n);
      pixels[o + 1] = Math.round(g / n);
      pixels[o + 2] = Math.round(b / n);
      pixels[o + 3] = Math.round((a / n) * 255);
    }
  }
  return pixels;
};

// ------------------------------------------------------------------- encode

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Encode RGBA pixels as an 8-bit truecolour-with-alpha PNG. */
const encodePng = (pixels, size) => {
  const stride = size * 4;
  // Filter byte 0 (None) per scanline; the shapes are smooth enough that the
  // fancier filters buy little, and this keeps the encoder honest.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * Windows .ico containing PNG-compressed entries.
 *
 * Vista and later read PNG payloads directly, which avoids hand-rolling the
 * legacy BMP-with-AND-mask layout for the large sizes.
 */
const encodeIco = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;

  entries.forEach((entry, i) => {
    const o = i * 16;
    // 256 is stored as 0 — the field is a single byte.
    dir[o] = entry.size >= 256 ? 0 : entry.size;
    dir[o + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[o + 2] = 0; // palette size
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(entry.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
};

/** Apple .icns; the modern ic* types take PNG payloads as-is. */
const encodeIcns = (entries) => {
  const TYPES = {32: 'ic11', 64: 'ic12', 128: 'ic07', 256: 'ic13', 512: 'ic14', 1024: 'ic10'};
  const chunks = entries
    .filter((e) => TYPES[e.size])
    .map((e) => {
      const head = Buffer.alloc(8);
      head.write(TYPES[e.size], 0, 4, 'ascii');
      head.writeUInt32BE(e.png.length + 8, 4);
      return Buffer.concat([head, e.png]);
    });

  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
};

// --------------------------------------------------------------------- main

const outDir = path.join(__dirname, 'build');
fs.mkdirSync(outDir, {recursive: true});

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const entries = SIZES.map((size) => ({size, png: encodePng(render(size), size)}));
const bySize = (size) => entries.find((e) => e.size === size).png;

fs.writeFileSync(path.join(outDir, 'icon.png'), bySize(1024));
// Windows shells still read the small entries for list views; .ico caps at 256.
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(entries.filter((e) => e.size <= 256)));
fs.writeFileSync(path.join(outDir, 'icon.icns'), encodeIcns(entries));

// Linux wants a directory of sizes for the desktop entry.
const linuxDir = path.join(outDir, 'icons');
fs.mkdirSync(linuxDir, {recursive: true});
for (const {size, png} of entries) {
  if (size >= 16 && size <= 512) fs.writeFileSync(path.join(linuxDir, `${size}x${size}.png`), png);
}

/*
 * A second copy outside build/ for the window icon at runtime.
 *
 * electron-builder treats build/ as buildResources and excludes it from the
 * packaged app, so anything main.js has to load at runtime cannot live there —
 * it would resolve in development and silently be missing once installed.
 * Windows and macOS take the window icon from the executable and the bundle,
 * but Linux does not, and neither does `npm start`.
 */
const assetsDir = path.join(__dirname, 'assets');
fs.mkdirSync(assetsDir, {recursive: true});
fs.writeFileSync(path.join(assetsDir, 'icon.png'), bySize(512));

/*
 * Raster copies for the web UI, from the same mark.
 *
 * iOS ignores an SVG apple-touch-icon, so adding the site to a home screen
 * produced a blank tile — the one place the icon matters most on a phone.
 * These are committed rather than gitignored: the web build has no hook that
 * runs this script, so they have to exist in the tree.
 */
const webDir = path.join(__dirname, '..', 'elixium-ui', 'public');
if (fs.existsSync(webDir)) {
  fs.writeFileSync(path.join(webDir, 'elixium-icon-180.png'), encodePng(render(180), 180));
  fs.writeFileSync(path.join(webDir, 'elixium-icon-512.png'), bySize(512));
}

console.log('icons written to desktop/build:');
console.log('  icon.png   1024x1024');
console.log(
  '  icon.ico   ' +
    entries
      .filter((e) => e.size <= 256)
      .map((e) => e.size)
      .join(', '),
);
console.log('  icon.icns  ' + [32, 64, 128, 256, 512, 1024].join(', '));
console.log('  icons/     ' + entries.filter((e) => e.size <= 512).length + ' png sizes for Linux');
