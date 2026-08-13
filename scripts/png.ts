import { deflateSync } from 'node:zlib';
import type { PixelGrid } from '@/sprites/pixels';

/**
 * Minimal PNG encoder, just enough for the app icons.
 *
 * Node has zlib built in, so encoding RGBA ourselves is cheaper than adding an image
 * dependency for three files that only change when the palette does.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

export function encodePng(grid: PixelGrid): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(grid.width, 0);
  header.writeUInt32BE(grid.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline, then the raw row.
  const stride = grid.width * 4;
  const raw = Buffer.alloc((stride + 1) * grid.height);
  for (let y = 0; y < grid.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(grid.rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
