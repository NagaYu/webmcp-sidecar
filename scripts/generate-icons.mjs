import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Generates simple placeholder PNG icons (solid rounded-square, no deps)
// for the extension. Not wired into the build — run manually if you want
// to regenerate them: `node scripts/generate-icons.mjs`.
import { deflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "extension", "icons");
mkdirSync(outDir, { recursive: true });

const BG = [0x21, 0x6b, 0x63]; // teal
const FG = [0xf2, 0xf7, 0xf6]; // near-white

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** A rounded square with a small centered "dot" (standing in for a tool /
 * connector glyph) — simple enough to draw pixel-by-pixel without a canvas
 * dependency. */
function pixelColor(x, y, size) {
  const r = size * 0.18;
  const inCorner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 > r * r;
  const nearCorner =
    (x < r && y < r && inCorner(r, r)) ||
    (x >= size - r && y < r && inCorner(size - r, r)) ||
    (x < r && y >= size - r && inCorner(r, size - r)) ||
    (x >= size - r && y >= size - r && inCorner(size - r, size - r));
  if (nearCorner) return null; // transparent

  const cx = size / 2;
  const cy = size / 2;
  const dotR = size * 0.16;
  if ((x - cx) ** 2 + (y - cy) ** 2 <= dotR * dotR) return FG;
  return BG;
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // no filter for this scanline
    for (let x = 0; x < size; x++) {
      const color = pixelColor(x, y, size);
      if (color) {
        raw[offset++] = color[0];
        raw[offset++] = color[1];
        raw[offset++] = color[2];
        raw[offset++] = 0xff;
      } else {
        raw[offset++] = 0;
        raw[offset++] = 0;
        raw[offset++] = 0;
        raw[offset++] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  const png = makePng(size);
  const path = join(outDir, `icon${size}.png`);
  writeFileSync(path, png);
  console.log(`[generate-icons] wrote ${path} (${png.length} bytes)`);
}
