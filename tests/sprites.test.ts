import { describe, expect, it } from 'vitest';
import { SPRITES, type SpriteName } from '@/sprites/data';
import { blankGrid, blit, fillRect, scaleGrid, toPixelGrid } from '@/sprites/pixels';
import { TILE_PX } from '@/sprites/palette';

describe('sprite data', () => {
  it('is rectangular and uses only palette keys', () => {
    // toPixelGrid throws on ragged rows or unknown colour keys, so parsing every sprite is
    // the check. This is what stops a typo in an authored grid reaching the canvas.
    for (const name of Object.keys(SPRITES) as SpriteName[]) {
      expect(() => toPixelGrid(SPRITES[name]), name).not.toThrow();
    }
  });

  it('sizes every map sprite to exactly one tile', () => {
    for (const name of Object.keys(SPRITES) as SpriteName[]) {
      if (name.startsWith('plane.')) continue;
      const grid = toPixelGrid(SPRITES[name]);
      expect({ name, w: grid.width, h: grid.height }).toEqual({
        name,
        w: TILE_PX,
        h: TILE_PX,
      });
    }
  });

  /**
   * Aircraft may be longer than a tile — that size difference is how the player reads the
   * progression — but they stay one tile wide and a whole number of tiles long, which is
   * what lets the renderer rotate them in quarter turns without a fractional offset.
   */
  it('sizes every aircraft to a whole number of tiles', () => {
    for (const name of Object.keys(SPRITES) as SpriteName[]) {
      if (!name.startsWith('plane.')) continue;
      const grid = toPixelGrid(SPRITES[name]);
      expect({ name, w: grid.width, tiles: grid.height / TILE_PX }).toEqual({
        name,
        w: TILE_PX,
        tiles: Math.round(grid.height / TILE_PX),
      });
    }
  });

  it('rejects a ragged sprite', () => {
    expect(() => toPixelGrid(['gg', 'g'])).toThrow(/row 1 is 1 px wide/);
  });

  it('rejects a colour that is not in the palette', () => {
    expect(() => toPixelGrid(['##', '##'])).toThrow(/not a palette key/);
  });
});

describe('pixel composition', () => {
  it('treats "." as transparent and leaves the destination untouched', () => {
    const dst = blankGrid(2, 1);
    fillRect(dst, 0, 0, 2, 1, 'g');
    const before = dst.rgba.slice(0, 4);

    blit(dst, toPixelGrid(['.w']), 0, 0);

    expect([...dst.rgba.slice(0, 4)]).toEqual([...before]); // transparent pixel skipped
    expect(dst.rgba[7]).toBe(255); // opaque pixel written
  });

  it('clips a blit that runs off the edge instead of throwing', () => {
    const dst = blankGrid(2, 2);
    expect(() => blit(dst, toPixelGrid(['ww', 'ww']), 1, 1)).not.toThrow();
    expect(dst.rgba[(1 * 2 + 1) * 4 + 3]).toBe(255);
    expect(dst.rgba[3]).toBe(0);
  });

  it('scales by nearest neighbour, keeping edges hard', () => {
    const scaled = scaleGrid(toPixelGrid(['gw']), 2);
    expect({ w: scaled.width, h: scaled.height }).toEqual({ w: 4, h: 2 });
    // Column 1 must still be pure grass, not a blend with the water beside it.
    expect([...scaled.rgba.slice(4, 8)]).toEqual([...scaled.rgba.slice(0, 4)]);
  });
});
