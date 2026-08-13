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
 * Sized for the whole campaign, not for day one. The longest aeroplane wants sixteen tiles
 * of runway, and beside that has to fit taxiways, an apron, the landside road network and
 * the buildings it feeds — so the field has to be big enough to run out of room in an
 * interesting way rather than an arbitrary one.
 */
const FIELD_WIDTH = 24;
const FIELD_HEIGHT = 42;

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
