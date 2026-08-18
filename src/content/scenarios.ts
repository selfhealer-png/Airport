import {
  addRoadRun,
  addRunway,
  addStand,
  addTaxiwayRun,
  createGame,
} from '@/sim/airport';
import type { Airport, GameState } from '@/sim/types';
import { levelById } from './levels';

/**
 * Scenarios: an airport you inherit rather than one you found.
 *
 * The campaign teaches building from nothing, which is a different problem from the one most
 * airports actually have — somebody else's decisions, already paid for, already in the way.
 * Every scenario here is a layout that is *wrong* in a specific way, and the interest is in
 * working out which part of it to keep.
 *
 * Authored as code rather than as data. The `add…` helpers are the same ones the build system
 * calls, so a scenario is written the way an airport is built and typechecks the whole way
 * down; a JSON blob of tile indices would be unreadable and unreviewable.
 */

export interface Scenario {
  readonly id: string;
  readonly name: string;
  /** Two or three sentences: what you have inherited, and what is wrong with it. */
  readonly brief: string;
  readonly levelId: string;
  /**
   * Which campaign day you take over on.
   *
   * This does two jobs, which is why scenarios need no win condition of their own. Traffic
   * escalates on a fixed schedule, so the day sets the difficulty — and the campaign already
   * ends at day 50, so taking over on day 30 *is* a twenty-day scenario. Nothing new to
   * build, nothing new to explain, and the ending is the one the player already knows.
   */
  readonly startDay: number;
  readonly cash: number;
  /** Lays out the airport as it was left to you. */
  readonly build: (airport: Airport) => void;
}

/**
 * A flying club that never modernised.
 *
 * Three grass strips laid out for aeroplanes that weigh a ton, on the day the commuters start
 * coming. Everything here is real and paid for and none of it is what is needed: the strips
 * are too short and too soft, every stand is small, and there is no tower to sequence
 * anything.
 *
 * There is not a taxiway on the field, and that is authentic rather than lazy — a club parks
 * beside its strip and walks. It is also the trap: the strips sit in three neat columns with
 * their stands and service roads packed between them, so the long hard runway this airport
 * needs has nowhere to go that is not already somebody's.
 */
const GRASS_ROOTS: Scenario = {
  id: 'grass-roots',
  name: 'Grass Roots',
  brief:
    'You have taken over a flying club that never modernised: three short grass strips, six ' +
    'small stands and no tower at all. The commuters start arriving today.',
  levelId: 'meadow',
  startDay: 22,
  cash: 11_000,
  build(airport) {
    // The landside spine along the top. Every road below hangs off it, which is what makes
    // them one network rather than three private drives.
    addRoadRun(airport, 6, 0, 22, 0);

    // Three strips, each with its stands beside it and a service road on either hand.
    addRoadRun(airport, 7, 0, 7, 14);
    addRunway(airport, 8, 6, 10, 'grass');
    addStand(airport, 9, 7, 'small');
    addStand(airport, 9, 9, 'small');

    addRoadRun(airport, 10, 0, 10, 14);
    addRunway(airport, 11, 6, 11, 'grass');
    addStand(airport, 12, 7, 'small');
    addStand(airport, 12, 9, 'small');

    addRoadRun(airport, 13, 0, 13, 14);
    addRoadRun(airport, 15, 0, 15, 16);
    addRunway(airport, 16, 8, 13, 'grass');
    addStand(airport, 17, 9, 'small');
    addStand(airport, 17, 11, 'small');
    addRoadRun(airport, 18, 0, 18, 16);

    // The clubhouse: a terminal core with nothing bolted to it, and a desk inside.
    airport.facilities.push({ id: 'sc-terminal', type: 'terminal', x: 20, y: 4, level: 0 });
    addRoadRun(airport, 21, 0, 21, 6);
    airport.nextEntityId = 200;
  },
};

/**
 * An apron with no room left on it.
 *
 * The opposite inheritance: a proper airport, competently built, for aeroplanes one size
 * smaller than the ones now booked in. It is not short of money and it is not short of field
 * — it is short of *apron*. Eleven small stands run the length of it, boxed in by the taxiway
 * on one side and the service road on the other, so there is no tile beside a stand to drop a
 * bigger one onto.
 *
 * Every medium stand therefore costs a demolition at 40% back, and the airport this teaches
 * against is the one the campaign quietly encourages: fill the cheap rows early, and find out
 * on day 30 that you built the wrong airport very efficiently.
 */
const OVERSPILL: Scenario = {
  id: 'overspill',
  name: 'Overspill',
  brief:
    'A well-run regional airport, built for aeroplanes one size smaller than the ones now ' +
    'booked in. Eleven small stands fill the only flat ground you have.',
  levelId: 'bracken-rise',
  startDay: 30,
  cash: 32_000,
  build(airport) {
    // The landside spine, and the road down the west side that lets the runway open at all.
    addRoadRun(airport, 15, 0, 26, 0);
    addRoadRun(airport, 16, 0, 16, 26);

    addRunway(airport, 17, 6, 17, 'asphalt'); // twelve tiles: regionals and narrowbodies

    /*
     * The apron, boxed in on all four sides by the airport's own infrastructure — taxiway to
     * the west, service road to the east, and taxiway filling every gap between the stands.
     *
     * That is what makes this a scenario rather than a shortage of cash: there is no tile
     * beside the apron to drop a bigger stand onto, so the only way to a medium one is
     * through something already built and already paid for.
     */
    for (let y = 6; y <= 26; y++) addTaxiwayRun(airport, 18, y, 18, y);
    for (let y = 5; y <= 27; y += 2) addTaxiwayRun(airport, 19, y, 19, y);
    for (let y = 6; y <= 26; y += 2) addStand(airport, 19, y, 'small');
    addRoadRun(airport, 20, 0, 20, 27);

    airport.facilities.push(
      { id: 'sc-tower', type: 'tower', x: 23, y: 4, level: 2 },
      { id: 'sc-terminal', type: 'terminal', x: 23, y: 8, level: 0 },
      { id: 'sc-gate-0', type: 'gate-hall', x: 23, y: 9, level: 0 },
      { id: 'sc-gate-1', type: 'gate-hall', x: 23, y: 10, level: 0 },
      { id: 'sc-bags', type: 'baggage-hall', x: 23, y: 11, level: 0 },
      { id: 'sc-shop', type: 'shop', x: 23, y: 12, level: 0 },
      { id: 'sc-fuel', type: 'fuel-farm', x: 23, y: 14, level: 0 },
      { id: 'sc-fire', type: 'fire-station', x: 23, y: 16, level: 0 },
    );
    addRoadRun(airport, 24, 0, 24, 20);

    airport.certification = 2;
    airport.nextEntityId = 200;
  },
};

export const SCENARIOS: readonly Scenario[] = [GRASS_ROOTS, OVERSPILL];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Builds the game a scenario describes.
 *
 * Returns null for a scenario naming a level that no longer exists, for the same reason
 * `fromSnapshot` returns null on anything it does not trust: a broken scenario must decline
 * to start, never start something wrong.
 */
export function startScenario(scenario: Scenario): GameState | null {
  const map = levelById(scenario.levelId);
  if (!map) return null;

  const state = createGame(map, scenario.startDay * 7919);
  scenario.build(state.airport);
  state.cash = scenario.cash;
  state.day = scenario.startDay;
  state.scenarioId = scenario.id;
  return state;
}
