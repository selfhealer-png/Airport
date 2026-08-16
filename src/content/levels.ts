import type { LevelMap, Terrain } from '@/sim/types';

/**
 * Level maps. Level 1 is a plain grass field with nothing in the way — the whole point is
 * that the player starts with an empty meadow. Later levels introduce water, rock and
 * pre-existing structures that constrain where runways can go.
 */

function filled(width: number, height: number, terrain: Terrain): Terrain[] {
  return Array.from({ length: width * height }, () => terrain);
}

/**
 * The characters a level map is authored in.
 *
 * Terrain is written as a block of strings, one character per tile, for the same reason
 * sprites are: a map is far easier to read, diff and edit as a picture than as an array of
 * enum values, and a mistake shows up as a shape that looks wrong.
 */
const TERRAIN_KEYS: Readonly<Record<string, Terrain>> = {
  g: 'grass',
  w: 'water',
  r: 'rock',
  f: 'woods',
};

/**
 * Parses an authored map. Throws on anything malformed rather than producing a map with a
 * hole in it — `tests/levels.test.ts` parses every level, so a bad block fails the suite.
 */
export function terrainFrom(rows: readonly string[]): {
  width: number;
  height: number;
  terrain: Terrain[];
} {
  const first = rows[0];
  if (first === undefined) throw new Error('A level map needs at least one row.');

  const width = first.length;
  const terrain: Terrain[] = [];

  for (const [y, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`Level map row ${y} is ${row.length} tiles wide, expected ${width}.`);
    }
    for (const [x, key] of [...row].entries()) {
      const tile = TERRAIN_KEYS[key];
      if (tile === undefined) {
        throw new Error(`Unknown terrain character '${key}' at ${x},${y}.`);
      }
      terrain.push(tile);
    }
  }

  return { width, height: rows.length, terrain };
}

/**
 * Sized so the whole field fits on a phone at one CSS pixel per sprite pixel.
 *
 * The longest aeroplane wants sixteen tiles of runway, and beside that has to fit taxiways,
 * an apron, the landside road network and the buildings it feeds — so the field has to be big
 * enough to run out of room in an interesting way rather than an arbitrary one. But the
 * binding constraint turned out to be the screen, not the campaign.
 *
 * Zoom is a whole number of device pixels per sprite pixel, so it steps: on a 3x phone the
 * levels either side of 1 are 2/3 and 4/3. At 42 rows the field was a hair too tall to fit at
 * 1, which dropped it to 2/3 and drew the entire airport a third smaller than it needed to be.
 * 36 rows clears it with room for the advice line — 576 world pixels against roughly 630 of
 * map area on a modern iPhone — and still leaves twenty rows more than the longest runway
 * needs. Grow this and check `fitScale` against a real phone viewport before assuming it is
 * free.
 */
const FIELD_WIDTH = 24;
const FIELD_HEIGHT = 36;

export const LEVEL_MEADOW: LevelMap = {
  id: 'meadow',
  name: 'Hensley Meadow',
  width: FIELD_WIDTH,
  height: FIELD_HEIGHT,
  terrain: filled(FIELD_WIDTH, FIELD_HEIGHT, 'grass'),
};

export const LEVELS: readonly LevelMap[] = [LEVEL_MEADOW];

export function levelById(id: string): LevelMap | undefined {
  return LEVELS.find((level) => level.id === id);
}
