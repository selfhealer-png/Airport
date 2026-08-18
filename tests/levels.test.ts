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
import { AIRCRAFT_CLASSES } from '@/content/aircraft';
import { terrainAllows } from '@/sim/types';

/** Connected runs of grass, largest first. */
function grassRegions(level: (typeof LEVELS)[number]): Array<Set<number>> {
  const seen = new Set<number>();
  const regions: Array<Set<number>> = [];

  for (let i = 0; i < level.terrain.length; i++) {
    if (seen.has(i) || level.terrain[i] !== 'grass') continue;
    const region = new Set<number>([i]);
    seen.add(i);
    const stack = [i];
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
        region.add(next);
        stack.push(next);
      }
    }
    regions.push(region);
  }

  return regions.sort((a, b) => b.size - a.size);
}

/** The longest runway any class asks for. A map with no room for it is unwinnable. */
const LONGEST_RUNWAY = Math.max(
  ...Object.values(AIRCRAFT_CLASSES).map((spec) => spec.runwayLength),
);

/**
 * The longest runway any *military* class asks for. Used below to check for two qualifying
 * columns rather than one — see that test for why one is not enough.
 */
const LONGEST_MILITARY_RUNWAY = Math.max(
  ...Object.values(AIRCRAFT_CLASSES)
    .filter((spec) => spec.use === 'military')
    .map((spec) => spec.runwayLength),
);

/** Row-major index helper, matching `terrainAt`. */
const at = (level: (typeof LEVELS)[number], x: number, y: number) =>
  level.terrain[y * level.width + x];

describe.each(LEVELS.map((level) => [level.name, level] as const))(
  'level invariants: %s',
  (_name, level) => {
    it('has terrain matching its declared size', () => {
      expect(level.terrain).toHaveLength(level.width * level.height);
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
     * Runway use is exclusive in both directions (see CLAUDE.md): a military strip will not
     * take airliners and a civil runway will not take fast jets, so the campaign needs both
     * kinds of strip standing at once. One column with room for the longest military class
     * would satisfy "a runway fits here" and then stall military traffic on every day it is
     * due, with nothing on screen to explain why — so this checks for two distinct columns,
     * enough for a civil strip and a military one side by side.
     */
    it('has two distinct columns with room for the longest military runway', () => {
      let qualifying = 0;
      for (let x = 0; x < level.width; x++) {
        let run = 0;
        let best = 0;
        for (let y = 0; y < level.height; y++) {
          run = at(level, x, y) === 'grass' ? run + 1 : 0;
          best = Math.max(best, run);
        }
        if (best >= LONGEST_MILITARY_RUNWAY) qualifying += 1;
      }
      expect(qualifying).toBeGreaterThanOrEqual(2);
    });

    /**
     * The invariant that replaced "all buildable ground in one connected region".
     *
     * That rule existed because roads count only as a single connected network, so grass
     * split in two meant one half could never be served: a runway there would be paid for and
     * never open, with nothing on screen to explain it. It caught a real bug while Bracken
     * Rise was being drawn.
     *
     * Groundworks retired it. Every obstacle can now be worked to carry a road — felled,
     * bridged or tunnelled — so no grass region can be stranded any more, and Tidewater
     * splits its ground deliberately. What survives is the *reason*: a region a road cannot
     * reach is unusable ground. Stated against `terrainAllows` rather than against a list of
     * terrains, so the day something is added that roads cannot cross, this fires instead of
     * shipping a map with a dead half.
     */
    it('can get a road to every part of the field', () => {
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
          if (seen.has(next)) continue;
          const terrain = level.terrain[next]!;
          // Worked, because the question is what a player can *reach*, not what is free.
          if (!terrainAllows(terrain, true, 'road')) continue;
          seen.add(next);
          stack.push(next);
        }
      }

      const reachable = [...seen].filter((i) => level.terrain[i] === 'grass').length;
      expect(reachable).toBe(level.terrain.filter((t) => t === 'grass').length);
    });

    /**
     * The main airport site has to work without spending anything on groundworks first.
     *
     * Splitting a field is fine; making the player bridge before they can lay their first
     * strip is a wall rather than a puzzle, and on day one there is no money for it. So the
     * largest single region must hold the longest runway in the game on its own.
     */
    it('has room for the longest runway inside one region', () => {
      const regions = grassRegions(level);
      const largest = regions[0] ?? new Set<number>();

      let best = 0;
      for (let x = 0; x < level.width; x++) {
        let run = 0;
        for (let y = 0; y < level.height; y++) {
          run = largest.has(y * level.width + x) ? run + 1 : 0;
          best = Math.max(best, run);
        }
      }
      expect(best).toBeGreaterThanOrEqual(LONGEST_RUNWAY);
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

  it('offers a third level built around water, which splits the ground itself', () => {
    const third = LEVELS[2];
    expect(third).toBeDefined();
    expect(third!.terrain).toContain('water');
  });

  it('gives Tidewater two banks worth building on', () => {
    /*
     * Its premise. Water is the only obstacle that splits the *ground* rather than occupying
     * it — a bridge carries roads and taxiways, but nothing stands on one — so both banks
     * have to be real airports-in-waiting. One usable bank and one strip of scenery would be
     * Bracken Rise with a blue edge.
     */
    const tidewater = LEVELS.find((l) => l.id === 'tidewater')!;
    const regions = grassRegions(tidewater);

    expect(regions.length).toBeGreaterThanOrEqual(2);
    expect(regions[0]!.size).toBeGreaterThan(400);
    expect(regions[1]!.size).toBeGreaterThan(400);
  });

  it('separates the banks of Tidewater with water rather than rock', () => {
    /*
     * Which obstacle divides them decides how the level plays. Rock takes a tunnel and
     * carries a road alone, so an airport could never straddle it; water takes a bridge and
     * carries taxiways too, so the apron and the runway may sit on opposite banks. This map
     * is about the second thing.
     */
    const tidewater = LEVELS.find((l) => l.id === 'tidewater')!;
    const regions = grassRegions(tidewater);
    const west = regions[0]!;

    // Walk out of the largest region through water only. If that reaches the second region,
    // water is what stands between them.
    const seen = new Set<number>(west);
    const stack = [...west];
    while (stack.length > 0) {
      const key = stack.pop()!;
      const x = key % tidewater.width;
      const y = Math.floor(key / tidewater.width);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= tidewater.width || ny >= tidewater.height) continue;
        const next = ny * tidewater.width + nx;
        if (seen.has(next)) continue;
        const terrain = tidewater.terrain[next];
        if (terrain !== 'water' && terrain !== 'grass') continue;
        seen.add(next);
        if (terrain === 'water') stack.push(next);
      }
    }

    expect([...regions[1]!].some((i) => seen.has(i))).toBe(true);
  });

  it('gives every level a distinct id, since a save stores the id', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });
});
