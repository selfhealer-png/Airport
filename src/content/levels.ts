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
 * Sized so the whole field fits on a phone at the 2/3 zoom step.
 *
 * Two constraints pull against each other. An airport that can take a superheavy needs about
 * 19x31 tiles once its runways, apron, taxiways and landside roads are in — and an obstacle
 * level has to lose a fifth of its ground to rock and woods on top of that. But zoom snaps to
 * whole device pixels, so the rungs are 1/3, 2/3, 1 and 4/3 and nothing in between.
 *
 * At 24x36 the field fitted at scale 1 and looked handsome, and an airport filled 68% of it —
 * which left almost nothing once terrain took its share. Dropping one rung to 2/3 makes a tile
 * 10.7 CSS px and buys 1.8x the ground: 35x45 is the largest field that still fits *entirely*
 * on the smallest phone worth supporting (an SE, 375x490 of map area), so no level ever needs
 * panning to be seen whole. That matters more than sprite size here, because the puzzle is the
 * road and taxiway network and you have to be able to see all of it at once.
 *
 * Grow this and the field stops fitting an SE. Check `fitScale` against a real viewport first;
 * the cost is invisible on a desktop window.
 */
const FIELD_WIDTH = 35;
const FIELD_HEIGHT = 45;

export const LEVEL_MEADOW: LevelMap = {
  id: 'meadow',
  name: 'Hensley Meadow',
  width: FIELD_WIDTH,
  height: FIELD_HEIGHT,
  terrain: filled(FIELD_WIDTH, FIELD_HEIGHT, 'grass'),
};

/**
 * The second field: rock across the north-west, woods through the south-centre.
 *
 * Placed so the map does not play as the meadow with holes in it. The rock pushes the
 * obvious long-runway column east, and the woods stop the apron sprawling south the way it
 * can on an empty field — so the player has to choose a shape rather than repeat the one
 * they already know.
 *
 * Obstacles are no longer permanent — see `terrainAllows`. Woods here can be felled and the
 * rock tunnelled for a road, which turns this map from "build around it" into "decide what
 * it is worth moving".
 */
export const LEVEL_BRACKEN_RISE: LevelMap = {
  id: 'bracken-rise',
  name: 'Bracken Rise',
  ...terrainFrom([
    'ggggggggggggggggggggggggggggggggggg',
    'ggggggggggggggggggggggggggggggggggg',
    'gggrggggggggggggggggggggggggggggggg',
    'grrrrrggggrgggggggggggggggggggggggg',
    'rrrrrrrgrrrrrgggggggggggggggggggggg',
    'rrrrrrrrrrrrrrggggggggggggggggggggg',
    'rrrrrrrrrrrrrgggggggggggggggggggggg',
    'rrrrrrrrrrrgggggggggggggggggggggggg',
    'rrrrrrrrrrggggggggggggggggggggggggg',
    'grrrrrrrrrggggggggggggggggggggggggg',
    'gggrrrrrrrrgggggggggggggggggggggggg',
    'gggggrrrrrggggggggggggggggggggggggg',
    'ggggrrrrrrggggggggggggggggggggggggg',
    'ggrrrrrrggggggggggggggggggggggggrgg',
    'grrrrrrrgggggggggggggggggggggggrrrg',
    'ggrrrrrgggggggggggggggggggggggrrrrr',
    'ggggrgggggggggggggggggggggggggrrrrr',
    'gggggggggggggggggggggggggggggrrrrrr',
    'ggggggggggggggggggggggggggggggrrrrr',
    'ggggggggggggggggggggggggggggggrrrrr',
    'ggggggggggggggggggggggggggggggrrrrg',
    'gggggggggggggggggggggggggggggrrrrgg',
    'gggggggggggggggggggggggggggggrrrggg',
    'ggggggggggggggggggggggggggggrrrrrgg',
    'gggggggggggggggggggggggggggggrrrggg',
    'gggggggggggggggggggggggggggggrrrggg',
    'ggggggggggggggggggggggggggggggrgggg',
    'ggggggggggggggggggggggggfgggggggggg',
    'gggggggggggggfggggggggfffffgggggggg',
    'gggggggggggfffffggggggfffffgggggggg',
    'ggggggggggfffffffggggfffffffggggggg',
    'gggggggggfffffffffgfggfffffgggggggg',
    'ggggggggggfffffffffffffffffgggggggg',
    'gggggggggggffffffffffffgfgggggggggg',
    'gggggggggggggfggfffffffgggggggggggg',
    'ggggggggggfggggfffffffffggggggggggg',
    'ggggggggfffffgggfffffffggggfggggggg',
    'ggggggggfffffgggfffffffggfffffggggg',
    'gggggggfffffffgggfffffgggfffffggggg',
    'ggggggggfffffggggfffggggfffffffgggg',
    'ggggggggfffffgfffffffggggfffffggggg',
    'ggggggggggfggfffffffffgggfffffggggg',
    'ggggggggggggggfffffffggggggfggggggg',
    'gggggggggggggggggfggggggggggggggggg',
    'ggggggggggggggggggggggggggggggggggg',
  ]),
};

/**
 * The third field: a tidal inlet, and buildable ground on both banks.
 *
 * Water is the strongest constraint in the game because it is the one obstacle that splits
 * the *ground* rather than merely occupying it. A bridge carries roads and taxiways across;
 * nothing stands on one. So both banks are real airports-in-waiting and neither is quite big
 * enough to be the whole thing — the inlet is roughly 16 columns from either edge, which is
 * comfortable for a first strip and its apron and tight for the airport day 40 wants.
 *
 * That makes bridging a mid-campaign decision rather than a day-one tax, which is the right
 * shape: a level that demanded £4,500 of causeway before the first aeroplane would be a wall,
 * not a puzzle. Woods on both banks are the pressure valve, and the rock shoulder in the
 * north-east pushes the east bank's long columns south, so the two sides do not simply
 * mirror each other.
 */
export const LEVEL_TIDEWATER: LevelMap = {
  id: 'tidewater',
  name: 'Tidewater',
  ...terrainFrom([
    'gggggggggggggggggwwgggggggrgggggggg',
    'gggggggggggggggggwwgggggrrrrrgrgggg',
    'gggggggggggggggggggwwgggrrrrrrrrrgg',
    'gggggggggggggggggggwwggrrrrrrrrrrrg',
    'gggggggggggggggggggwwgggrrrrrrrrrrg',
    'gggggggggggggggggggwwgggrrrrrrrrrrr',
    'ggggggggggggggggggggwwwgggrrrrrrrrg',
    'ggggggggggggggggggggwwwggggrrrrrrrg',
    'ggggggggggggggggggggwwwgggggrrrrrgg',
    'gggggggggggggggggggwwwggggggggrgggg',
    'gggggggggggggggggggwwwggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'gggggggggggggggggwwwggggggggggggggg',
    'gggggggggggggggggwwwggggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggggggggggggggggwwwgggggggggggggg',
    'ggggfggggggggggggwwwggggggggggggggg',
    'gggfffgggggggggggwwwggggggggggggggg',
    'ggfffffggggggggggwwwggggggggggggfgg',
    'gggfffgggggggggggwwwgggggggggggfffg',
    'ggggfggggggggggwwwggggggggggggfffff',
    'gggggggfgggggggwwwgggggggggggggfffg',
    'gggggfffffgggggwwwwgggggggggggggfgg',
    'ggggfffffffgggwwwwgggggggggggfggggg',
    'ggggfffffffgggwwwwgggggggggfffffggg',
    'gggfffffffffggwwwwgggggggggfffffggg',
    'ggggfffffffgggwwwwggggggggfffffffgg',
    'ggggfffffffgggwwwwgggggggggfffffggg',
    'gggggfffffgfggwwwwgggggggggfffffggg',
    'gggggggfgfffffwwwwgggggggggggfggggg',
    'gggggggggfffffgwwwwgggggggfgggggggg',
    'ggggggggfffffffgwwwwggggfffffgggggg',
    'gggggggggfffffggwwwwggggfffffgggggg',
    'gggggggggfffffgggwwwwggfffffffggggg',
    'gggggggggggfgggggwwwwgggfffffgggggg',
    'ggggggggggggggggggwwwwggfffffgggggg',
    'ggggggggggggggggggwwwwggggfgggggggg',
  ]),
};

/** Order is the campaign order — `isUnlocked()` reads it as a chain. */
export const LEVELS: readonly LevelMap[] = [LEVEL_MEADOW, LEVEL_BRACKEN_RISE, LEVEL_TIDEWATER];

export function levelById(id: string): LevelMap | undefined {
  return LEVELS.find((level) => level.id === id);
}
