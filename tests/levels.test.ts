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

import { LEVELS } from '@/content/levels';
import { MIN_RUNWAY_TILES } from '@/content/costs';
import { AIRCRAFT_CLASSES } from '@/content/aircraft';

/** The longest runway any class asks for. A map with no room for it is unwinnable. */
const LONGEST_RUNWAY = Math.max(
  ...Object.values(AIRCRAFT_CLASSES).map((spec) => spec.runwayLength),
);

/** Row-major index helper, matching `terrainAt`. */
const at = (level: (typeof LEVELS)[number], x: number, y: number) =>
  level.terrain[y * level.width + x];

describe.each(LEVELS.map((level) => [level.name, level] as const))(
  'level invariants: %s',
  (_name, level) => {
    it('has terrain matching its declared size', () => {
      expect(level.terrain).toHaveLength(level.width * level.height);
      expect(level.width).toBeGreaterThan(MIN_RUNWAY_TILES);
    });

    it('has room somewhere for the longest runway in the game', () => {
      let best = 0;
      for (let x = 0; x < level.width; x++) {
        let run = 0;
        for (let y = 0; y < level.height; y++) {
          run = at(level, x, y) === 'grass' ? run + 1 : 0;
          best = Math.max(best, run);
        }
      }
      expect(best).toBeGreaterThanOrEqual(LONGEST_RUNWAY);
    });

    /**
     * The one that matters most. Roads count only as a single connected network, so grass
     * split into two regions means one of them can never be served — a runway built there
     * would be paid for and never open, with nothing on screen to explain it.
     */
    it('has all its buildable ground in one connected region', () => {
      const total = level.terrain.filter((t) => t === 'grass').length;
      const start = level.terrain.indexOf('grass');
      expect(start).toBeGreaterThanOrEqual(0);

      const seen = new Set<number>([start]);
      const stack = [start];
      while (stack.length > 0) {
        const key = stack.pop()!;
        const x = key % level.width;
        const y = Math.floor(key / level.width);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
          const next = ny * level.width + nx;
          if (seen.has(next) || level.terrain[next] !== 'grass') continue;
          seen.add(next);
          stack.push(next);
        }
      }

      expect(seen.size).toBe(total);
    });
  },
);

describe('the level ladder', () => {
  it('starts on the meadow, which has nothing in the way', () => {
    expect(LEVELS[0]?.id).toBe('meadow');
    expect(new Set(LEVELS[0]!.terrain)).toEqual(new Set(['grass']));
  });

  it('offers a second level with obstacles to build around', () => {
    const second = LEVELS[1];
    expect(second).toBeDefined();
    expect(second!.terrain).toContain('woods');
    expect(second!.terrain).toContain('rock');
  });

  it('gives every level a distinct id, since a save stores the id', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });
});
