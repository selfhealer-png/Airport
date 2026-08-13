import { PALETTE, TRANSPARENT, type PaletteKey } from './palette';

/**
 * A sprite is authored as rows of palette keys, one character per pixel.
 * `.` means transparent. This module is deliberately DOM-free so the same sprite data
 * can be baked to a canvas in the browser and encoded to a PNG in Node (app icons).
 */
export type SpriteSource = readonly string[];

export interface PixelGrid {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

function colourOf(key: string): readonly [number, number, number, number] {
  if (key === TRANSPARENT) return [0, 0, 0, 0];
  const hex = PALETTE[key as PaletteKey];
  if (hex === undefined) {
    throw new Error(`Sprite uses '${key}', which is not a palette key or '${TRANSPARENT}'.`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

/** Turns authored sprite rows into RGBA bytes, validating that the grid is rectangular. */
export function toPixelGrid(rows: SpriteSource): PixelGrid {
  const height = rows.length;
  if (height === 0) throw new Error('Sprite has no rows.');
  const width = rows[0]!.length;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    if (row.length !== width) {
      throw new Error(`Sprite row ${y} is ${row.length} px wide, expected ${width}.`);
    }
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = colourOf(row[x]!);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width, height, rgba };
}

/** Creates an empty (transparent) grid to compose into. */
export function blankGrid(width: number, height: number): PixelGrid {
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
}

/** Alpha-aware blit of `src` onto `dst` at (dx, dy). Out-of-bounds pixels are dropped. */
export function blit(dst: PixelGrid, src: PixelGrid, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      if (src.rgba[si + 3] === 0) continue;
      const di = (ty * dst.width + tx) * 4;
      dst.rgba[di] = src.rgba[si]!;
      dst.rgba[di + 1] = src.rgba[si + 1]!;
      dst.rgba[di + 2] = src.rgba[si + 2]!;
      dst.rgba[di + 3] = src.rgba[si + 3]!;
    }
  }
}

/** Nearest-neighbour upscale by an integer factor, so pixel art stays pixel art. */
export function scaleGrid(src: PixelGrid, factor: number): PixelGrid {
  const width = src.width * factor;
  const height = src.height * factor;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = (y / factor) | 0;
    for (let x = 0; x < width; x++) {
      const sx = (x / factor) | 0;
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      out[di] = src.rgba[si]!;
      out[di + 1] = src.rgba[si + 1]!;
      out[di + 2] = src.rgba[si + 2]!;
      out[di + 3] = src.rgba[si + 3]!;
    }
  }
  return { width, height, rgba: out };
}

/** Fills every fully-transparent pixel with a palette colour. Used for opaque app icons. */
export function fillBackground(grid: PixelGrid, key: PaletteKey): void {
  const [r, g, b] = colourOf(key);
  for (let i = 0; i < grid.rgba.length; i += 4) {
    if (grid.rgba[i + 3] === 0) {
      grid.rgba[i] = r;
      grid.rgba[i + 1] = g;
      grid.rgba[i + 2] = b;
      grid.rgba[i + 3] = 255;
    }
  }
}

/** Paints a solid rectangle in palette colour `key`. Clipped to the grid. */
export function fillRect(
  grid: PixelGrid,
  x: number,
  y: number,
  width: number,
  height: number,
  key: PaletteKey,
): void {
  const [r, g, b, a] = colourOf(key);
  for (let py = Math.max(0, y); py < Math.min(grid.height, y + height); py++) {
    for (let px = Math.max(0, x); px < Math.min(grid.width, x + width); px++) {
      const i = (py * grid.width + px) * 4;
      grid.rgba[i] = r;
      grid.rgba[i + 1] = g;
      grid.rgba[i + 2] = b;
      grid.rgba[i + 3] = a;
    }
  }
}
