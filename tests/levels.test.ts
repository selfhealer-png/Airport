import { describe, expect, it } from 'vitest';
import { terrainFrom } from '@/content/levels';

/**
 * Level maps are authored as characters, the way sprites are, so that a typo fails a test
 * rather than producing a map with a hole in it.
 */
describe('terrainFrom', () => {
  it('reads a grid of characters into terrain', () => {
    const map = terrainFrom(['gw', 'rf']);

    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.terrain).toEqual(['grass', 'water', 'rock', 'woods']);
  });

  it('refuses a ragged block rather than guessing the width', () => {
    expect(() => terrainFrom(['ggg', 'gg'])).toThrow(/row 1/i);
  });

  it('refuses a character that is not terrain', () => {
    expect(() => terrainFrom(['gg', 'gx'])).toThrow(/'x'/);
  });

  it('refuses an empty map', () => {
    expect(() => terrainFrom([])).toThrow();
  });
});
