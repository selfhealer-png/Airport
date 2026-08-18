import { buildServices } from '@/sim/connectivity';
import { runwayLength, type GameState, type TileIndex } from '@/sim/types';

/**
 * The first six things to do, and how the game knows each one is done.
 *
 * Airfield asks two things of a player that no amount of watching aeroplanes will teach: an
 * aeroplane needs a runway *and a way off it*, and everything except a taxiway needs a road.
 * Both are invisible until they bite, and when they bite the aeroplane is already gone.
 *
 * Steps are **predicates over a real `GameState`**, kept pure and DOM-free for the same reason
 * `ui/placement.ts` is: `tests/tutorial.test.ts` can drive a game through all six headlessly,
 * which is the only way to know the sequence can be finished at all. Prose that has never been
 * followed end to end is just prose.
 *
 * Every predicate reuses the connectivity functions the *simulation* uses, so the tutorial can
 * never congratulate a player on something that will not work when the day opens.
 */

export interface TutorialStep {
  readonly id: string;
  /** One instruction. Short: it sits in the planning bar on a phone. */
  readonly text: string;
  /** Satisfied — move on. Reads the game state and nothing else. */
  readonly done: (state: GameState) => boolean;
  /** Tiles to outline on the map. Empty for a step that is not about a place. */
  readonly where: (state: GameState) => readonly TileIndex[];
}

/**
 * Where the tutorial suggests the first runway goes.
 *
 * Middle of the field rather than the edge, and short of the full height, so there is room
 * for the apron, the roads and the rest of a real airport around it afterwards. A tutorial
 * that walks the player into a corner has taught them the wrong thing twice.
 */
const RUNWAY_X = 15;
const RUNWAY_TOP = 10;
const RUNWAY_TILES = 4;

const column = (x: number, top: number, tiles: number): TileIndex[] =>
  Array.from({ length: tiles }, (_, i) => ({ x, y: top + i }));

const nowhere = (): readonly TileIndex[] => [];

/** The runway the player actually built, whichever it is. */
const firstRunway = (state: GameState) => state.airport.runways[0];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'runway',
    text: 'Aeroplanes need somewhere to land. Pick the grass strip and drag out a runway here.',
    done: (state) => state.airport.runways.some((r) => runwayLength(r) >= RUNWAY_TILES),
    where: () => column(RUNWAY_X, RUNWAY_TOP, RUNWAY_TILES),
  },
  {
    id: 'runway-road',
    text: 'A runway with no road cannot open — the fire crew has to be able to reach it. Lay a road alongside.',
    done: (state) => {
      const runway = firstRunway(state);
      return runway !== undefined && buildServices(state.airport).roadServed.has(runway.id);
    },
    where: (state) => {
      const runway = firstRunway(state);
      if (!runway) return [];
      // Beside the strip, not on it — the outline is where the road goes.
      return column(runway.x - 1, runway.y0, runwayLength(runway));
    },
  },
  {
    id: 'stand',
    text: 'Now somewhere to park. Put a small stand a few tiles clear of the runway.',
    done: (state) => state.airport.stands.length > 0,
    where: (state) => {
      const runway = firstRunway(state);
      if (!runway) return [];
      return [{ x: runway.x + 3, y: runway.y0 + 1 }];
    },
  },
  {
    id: 'taxiway',
    text: 'Join them with a taxiway. An aeroplane that lands with nowhere to taxi blocks the runway behind it.',
    done: (state) => {
      const runway = firstRunway(state);
      if (!runway) return false;
      return (buildServices(state.airport).links.get(runway.id) ?? []).length > 0;
    },
    where: (state) => {
      const runway = firstRunway(state);
      const stand = state.airport.stands[0];
      if (!runway || !stand) return [];
      const step = Math.sign(stand.x - runway.x) || 1;
      const tiles: TileIndex[] = [];
      for (let x = runway.x + step; x !== stand.x; x += step) tiles.push({ x, y: stand.y });
      return tiles;
    },
  },
  {
    id: 'stand-road',
    text: 'The stand needs a road too, or there is no way to get the passengers off it.',
    done: (state) => {
      const stand = state.airport.stands[0];
      return stand !== undefined && buildServices(state.airport).roadServed.has(stand.id);
    },
    where: (state) => {
      const stand = state.airport.stands[0];
      return stand ? [{ x: stand.x + 1, y: stand.y }] : [];
    },
  },
  {
    id: 'open',
    text: 'That is an airport. Open it and watch — the aeroplanes fly themselves.',
    done: (state) => state.phase !== 'planning',
    where: nowhere,
  },
];

/**
 * Whether this game is one the tutorial has anything to say to.
 *
 * Kept apart from the steps because it is a different question. `currentStep` asks what is
 * left to do; this asks whether to be here at all — and the answer is only on a brand new
 * campaign. A scenario hands the player a finished airport, so every step would already be
 * satisfied and the panel would flash past; a campaign already under way belongs to someone
 * who learned this weeks ago, and being told again reads as the game losing its place.
 */
export function tutorialApplies(state: GameState): boolean {
  return state.day === 1 && state.scenarioId === null;
}

/**
 * The step the player is on, or null when there is nothing left to say.
 *
 * The first *unsatisfied* step rather than a stored index, which is what makes the tutorial
 * impossible to trap someone in: build the stand before the road and the game simply skips
 * the step, because it was asking for a state rather than for an action.
 */
export function currentStep(state: GameState): TutorialStep | null {
  return TUTORIAL_STEPS.find((step) => !step.done(state)) ?? null;
}
